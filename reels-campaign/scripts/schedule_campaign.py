#!/usr/bin/env python3
"""Step 4 — post plan.json to Metricool as Instagram TRIAL REELS. Idempotent, resumable.

  export GUARD_KEY=...
  python3 scripts/schedule_campaign.py --dry
  python3 scripts/schedule_campaign.py --go [--limit N]

Each post is uploaded and POSTed back-to-back in the same pass — the temp host keeps a file
~3h and Metricool copies it to static.metricool.com within seconds, so pre-hosting the whole
campaign would leave dead links. ids are appended to scheduled_posts.json as they succeed;
re-running skips anything already in there.

THREE GATES, all of which have failed in production at least once:
  1. local decode  — `ffmpeg -f null -` on the variant. ffprobe passes corrupt files.
  2. host verify   — host_media.py GETs real bytes back (a host can 200 a 0-byte file).
  3. stored verify — Metricool's own copy must exist AND its mp4 boxes must tile the file
                     exactly (one moov, mdat ending at EOF). This is the cheap remote
                     equivalent of a decode and it separated 117 bad uploads from 108 good
                     ones with no false positives.
A post whose stored copy fails gate 3 is DELETED again rather than left to fail on Instagram.

instagramData.type = "TRIAL_REEL" is the whole mechanism. Any other spelling
(trialReel / isTrial / reelType / shareMode ...) is silently stripped and you get a normal
Reel on the grid with NO error. Trials are Instagram-only — never add a cross-post provider.
"""
import datetime as dt
import json, os, struct, subprocess, sys, time

import requests

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
BASE = CFG["guardBase"]
TZ = CFG["timezone"]


def hdrs():
    return {"X-Mc-Auth": os.environ["GUARD_KEY"], "Content-Type": "application/json"}


def decodes_clean(path):
    if not os.path.exists(path) or os.path.getsize(path) < 50_000:
        return False
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.returncode == 0 and not r.stderr.strip()


def boxes_tile(url):
    """The mp4 boxes must tile the file exactly: walk ftyp/moov/free/mdat from byte 0 and
    require mdat to end at Content-Length with exactly one moov. One HEAD + one 256 KB
    range read. A spliced second moov or an mdat overshooting EOF fails here — and those
    files pass every ffprobe check there is."""
    try:
        size = int(requests.head(url, timeout=60, allow_redirects=True)
                   .headers.get("content-length") or 0)
        b = requests.get(url, headers={"Range": "bytes=0-262143"}, timeout=60).content
    except Exception:
        return False
    if not size:
        return False
    off, seen_moov = 0, 0
    while off + 8 <= len(b):
        n = struct.unpack(">I", b[off:off + 4])[0]
        t = b[off + 4:off + 8].decode("latin1", "replace")
        if n == 1:
            if off + 16 > len(b):
                return False
            n = struct.unpack(">Q", b[off + 8:off + 16])[0]
        if n <= 0:
            return False
        seen_moov += (t == "moov")
        if t == "mdat":
            return off + n == size and seen_moov == 1
        off += n
    return False


def main():
    live = "--go" in sys.argv
    if not live and "--dry" not in sys.argv:
        sys.exit(__doc__)
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None

    plan = json.load(open(os.path.join(HERE, "plan.json")))
    logp = os.path.join(HERE, "scheduled_posts.json")
    log = json.load(open(logp)) if os.path.exists(logp) else {}
    todo = [p for p in plan if p["key"] not in log]
    if limit:
        todo = todo[:limit]
    print(f"{len(plan)} planned | {len(plan) - len(todo)} already scheduled | posting {len(todo)}")

    if not live:
        for p in todo[:10]:
            print(f"  {p['when']}  {p['key']:<24} {p['caption'][:34]}")
        print("\nDRY RUN — nothing scheduled. re-run with --go")
        return

    scripts = os.path.dirname(os.path.abspath(__file__))
    ok, fail = 0, []
    for p in todo:
        if not decodes_clean(p["file"]):
            print(f"  SKIP {p['key']}: file missing or fails decode — refusing to post", flush=True)
            fail.append((p["key"], "decode"))
            continue

        up = subprocess.run(["python3", os.path.join(scripts, "host_media.py"), p["file"]],
                            capture_output=True, text=True)
        url = up.stdout.strip()
        if not url.startswith("http"):
            print(f"  HOST FAIL {p['key']}", flush=True)
            fail.append((p["key"], "host"))
            continue

        body = {"publicationDate": {"dateTime": p["when"], "timezone": TZ},
                "text": p["caption"],
                "providers": [{"network": "instagram"}],
                "media": [url], "saveExternalMediaFiles": True,
                "draft": False, "autoPublish": True,
                "instagramData": {"type": "TRIAL_REEL",
                                  "shareTrialAutomatically": CFG["shareTrialAutomatically"]}}
        try:
            r = requests.post(BASE, headers=hdrs(),
                              data=json.dumps(body, ensure_ascii=False).encode(), timeout=180)
        except Exception as e:
            # transient egress/guard timeout — don't crash the whole run; reconcile (match by
            # publicationDate) on the next pass adopts any post the guard created anyway.
            print(f"  POST ERR {p['key']}: {str(e)[:120]}", flush=True)
            fail.append((p["key"], "post-exc"))
            continue
        if r.status_code != 200 or not (r.json().get("data") or {}).get("id"):
            print(f"  FAIL {p['key']}: {r.status_code} {r.text[:140]}", flush=True)
            fail.append((p["key"], r.status_code))
            continue
        pid = r.json()["data"]["id"]

        stored, good = None, False
        for _ in range(6):
            time.sleep(2.5)
            try:
                g = requests.get(f"{BASE}/{pid}", headers=hdrs(), timeout=60)
            except Exception:
                continue        # transient timeout during verify — keep polling, never crash
            if g.status_code == 200:
                m = ((g.json().get("data") or {}).get("media")) or []
                if m:
                    stored = m[0]
                    if "static.metricool.com" in stored and boxes_tile(stored):
                        good = True
                        break

        if not good:
            # Never leave a post pointing at media Instagram will refuse. Delete and retry
            # later — this key stays out of the log, so a re-run picks it up.
            try:
                requests.delete(f"{BASE}/{pid}", headers=hdrs(), timeout=60)
            except Exception:
                pass
            print(f"  BAD MEDIA {p['key']} — post {pid} deleted ({stored})", flush=True)
            fail.append((p["key"], "media"))
            continue

        log[p["key"]] = pid
        json.dump(log, open(logp, "w"), indent=1)
        ok += 1
        print(f"  ok   {p['when']} {p['key']:<24} id={pid}", flush=True)
        os.remove(p["file"])      # Metricool owns a verified copy now; reclaim the disk

    print(f"\n{ok}/{len(todo)} scheduled as trial reels on {CFG['account']}; {len(fail)} failed")
    if fail:
        print("failed (re-run to retry):", fail[:20])


if __name__ == "__main__":
    main()
