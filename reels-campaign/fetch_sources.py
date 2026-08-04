#!/usr/bin/env python3
"""Download the 50 source reels from the signed CDN URLs in matan_sources.json, decode-verify
each, and emit winners.json + captions.json for the rest of the pipeline. Time-sensitive:
the URLs expire in hours. Resumable — a source that already decodes clean is skipped."""
import concurrent.futures as cf
import json, os, subprocess

import requests

HERE = os.getcwd()
SRC = json.load(open(os.path.join(HERE, "matan_sources.json")))
reels = sorted(SRC["reels"], key=lambda r: r["rank"])
os.makedirs(os.path.join(HERE, "sources"), exist_ok=True)

# winners.json + captions.json in the shape plan_schedule.py / schedule_campaign.py expect
json.dump({"_account": SRC.get("_account"), "_source": SRC.get("_source"),
           "_ranking": SRC.get("_ranking"),
           "winners": [{"rank": r["rank"], "shortCode": r["shortCode"],
                        "plays": r.get("plays"), "dur": r.get("dur")} for r in reels]},
          open(os.path.join(HERE, "winners.json"), "w"), ensure_ascii=False, indent=1)
json.dump({"_note": "each variant reuses its source reel's own caption, verbatim; empty -> '.'",
           "captions": {r["shortCode"]: (r.get("caption") or "").strip() or "." for r in reels}},
          open(os.path.join(HERE, "captions.json"), "w"), ensure_ascii=False, indent=1)
print(f"wrote winners.json ({len(reels)}) + captions.json", flush=True)


def decodes_clean(path):
    if not (os.path.exists(path) and os.path.getsize(path) > 50_000):
        return False
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.returncode == 0 and not r.stderr.strip()


def fetch(r):
    sc, url = r["shortCode"], r["videoUrl"]
    dst = os.path.join(HERE, "sources", f"{sc}.mp4")
    if decodes_clean(dst):
        return (r["rank"], sc, "skip-have")
    try:
        with requests.get(url, stream=True, timeout=180,
                          headers={"User-Agent": "Mozilla/5.0"}) as resp:
            resp.raise_for_status()
            tmp = dst + ".part"
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_content(1 << 20):
                    fh.write(chunk)
            os.replace(tmp, dst)
    except Exception as e:
        return (r["rank"], sc, f"DL-FAIL {str(e)[:80]}")
    if decodes_clean(dst):
        return (r["rank"], sc, f"ok {os.path.getsize(dst)//1024} KB")
    return (r["rank"], sc, "DECODE-FAIL")


ok, bad = [], []
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    for rank, sc, status in sorted(ex.map(fetch, reels)):
        print(f"[{rank:>2}] {sc}  {status}", flush=True)
        (ok if status.startswith(("ok", "skip")) else bad).append(sc)

print(f"\n=== {len(ok)}/{len(reels)} sources clean | {len(bad)} failed ===", flush=True)
if bad:
    print("FAILED:", bad)
