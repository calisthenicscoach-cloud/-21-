#!/usr/bin/env python3
"""Step 5 — run this every day for the first week, then weekly. It is the whole safety net.

  export GUARD_KEY=...
  python3 scripts/audit.py

Reports, for this brand only:
  * status of every scheduled/recent trial reel (PENDING / PUBLISHED / ERROR + the reason)
  * REJECTIONS, and the in-trial stock at the moment of each one. The first rejection is
    how this account's own ceiling gets MEASURED — Instagram never publishes the number.
    Metricool surfaces it verbatim as:
      "You reached maximum number of trial reels that is allowed to be published by
       Content Publishing API."
  * any pending post whose stored media does not tile (would die as `Video Transcoding
    Fatal` on its slot) — fix these BEFORE they fire
  * the current and projected in-trial stock against the assumed ceiling

Published posts drop out of the scheduler listing after a few hours — they are not lost,
they are just no longer here. So a shrinking PENDING count with no ERRORs is success.
"""
import datetime as dt
import json, os, struct, sys

import requests

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
BASE = CFG["guardBase"]
TRIAL_HOURS = 72
CEILING = int(sys.argv[sys.argv.index("--ceiling") + 1]) if "--ceiling" in sys.argv else 12
REJECT_MARK = "maximum number of trial reels"


def hdrs():
    return {"X-Mc-Auth": os.environ["GUARD_KEY"], "Content-Type": "application/json"}


def boxes_tile(url):
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


now = dt.datetime.now()
r = requests.get(BASE, headers=hdrs(),
                 params={"start": (now - dt.timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S"),
                         "end": (now + dt.timedelta(days=200)).strftime("%Y-%m-%dT%H:%M:%S")},
                 timeout=180)
r.raise_for_status()
posts = [p for p in (r.json().get("data") or [])
         if (p.get("instagramData") or {}).get("type") == "TRIAL_REEL"]
for p in posts:
    p["_when"] = dt.datetime.fromisoformat(p["publicationDate"]["dateTime"])
posts.sort(key=lambda p: p["_when"])
stamps = [p["_when"] for p in posts]


def status(p):
    for pr in (p.get("providers") or []):
        if pr.get("network") == "instagram":
            return (pr.get("status") or "?"), (pr.get("detailedStatus") or "")
    return "?", ""


def in_trial_at(t):
    return sum(1 for s in stamps if t - dt.timedelta(hours=TRIAL_HOURS) < s <= t)


counts, errors, rejects = {}, [], []
for p in posts:
    st, detail = status(p)
    counts[st] = counts.get(st, 0) + 1
    if st == "ERROR":
        (rejects if REJECT_MARK in detail else errors).append((p, detail))

print(f"{len(posts)} trial reels visible on {CFG['account']} "
      f"({posts[0]['_when'].date()} .. {posts[-1]['_when'].date()})" if posts else "none visible")
print("  by status:", counts)
print(f"  in trial right now: {in_trial_at(now)} (assumed ceiling {CEILING})")

if rejects:
    print(f"\n!! {len(rejects)} RATE REJECTIONS — this is the ceiling measurement:")
    lowest = min(in_trial_at(p["_when"]) for p, _ in rejects)
    for p, _ in rejects[:10]:
        print(f"   {p['_when']:%m-%d %H:%M}  stock at that moment: {in_trial_at(p['_when'])}")
    print(f"   LOWEST stock at a rejection = {lowest}. This account's real ceiling is "
          f"BELOW {lowest}\n   -> set perDay to floor(({lowest} - 1) / 3) in config.json, "
          f"re-plan, and re-schedule everything still pending.\n"
          f"   (If the owner also posts trial reels by hand, the true stock was higher than "
          f"anything computed here — that is the usual explanation for a surprise rejection.)")

if errors:
    print(f"\n!! {len(errors)} other errors:")
    for p, d in errors[:10]:
        print(f"   {p['_when']:%m-%d %H:%M}  {d[:110]}")

pending = [p for p in posts if status(p)[0] not in ("PUBLISHED", "ERROR") and p["_when"] > now]
print(f"\nchecking stored media on {len(pending)} pending posts …")
bad = [p for p in pending if not ((p.get("media") or [""])[0] and boxes_tile(p["media"][0]))]
if bad:
    print(f"!! {len(bad)} pending posts have media that will fail to transcode:")
    for p in bad[:15]:
        print(f"   id={p['id']}  {p['_when']:%m-%d %H:%M}")
    print("   -> re-render those variants and create-then-delete the posts. Do NOT use PUT.")
else:
    print("   all clean")
