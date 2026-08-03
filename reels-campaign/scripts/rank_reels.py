#!/usr/bin/env python3
"""Step 1 — pick the source reels and collect their own captions.

Writes two files into the campaign dir:
  winners.json   [{rank, shortCode, plays, likes, comments, dur}]  ranked best-first
  captions.json  {shortCode: caption}                              verbatim originals

THREE WAYS to produce these; use the first one available.

  A) Apify (default, needs APIFY_TOKEN):
       python3 scripts/rank_reels.py --apify
     Runs apify/instagram-scraper over the account's N most recent posts, keeps videos,
     ranks by videoPlayCount desc.

  B) The account owner's own Instagram insights (BEST data, no API):
     plays are a proxy; what actually matters for a growth campaign is FOLLOWS PER REEL,
     and only the account owner can see that (IG app -> reel -> insights -> Follows).
     Have them read off their top ~40 reels, then:
       python3 scripts/rank_reels.py --manual shortcodes.txt
     where shortcodes.txt is one reel shortcode (or full URL) per line, best first.

  C) Already have the data: hand-write winners.json in the shape above.

CAPTIONS: whichever route, each variant reuses ITS OWN SOURCE REEL's caption, verbatim.
Never paste another brand's call-to-action onto this account. An empty caption becomes "."
(which is what these accounts post themselves) — do not invent copy.
"""
import json, os, re, sys, time

import requests

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
ACCOUNT = CFG["account"]
TOPN = CFG["topN"]
RECENT = 300          # how many recent posts to consider before ranking


def shortcode(s):
    s = s.strip()
    if not s:
        return None
    m = re.search(r"instagram\.com/(?:reel|p|tv)/([A-Za-z0-9_-]+)", s)
    return m.group(1) if m else s


def apify():
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("APIFY_TOKEN not set — use --manual instead (see docstring, route B)")
    run = requests.post(
        "https://api.apify.com/v2/acts/apify~instagram-scraper/runs",
        params={"token": token},
        json={"directUrls": [f"https://www.instagram.com/{ACCOUNT}/"],
              "resultsType": "posts", "resultsLimit": RECENT,
              "addParentData": False},
        timeout=120).json()["data"]
    rid, dsid = run["id"], run["defaultDatasetId"]
    print(f"apify run {rid} …", flush=True)
    while True:
        time.sleep(15)
        st = requests.get(f"https://api.apify.com/v2/actor-runs/{rid}",
                          params={"token": token}, timeout=60).json()["data"]["status"]
        print(f"  {st}", flush=True)
        if st in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            break
    if st != "SUCCEEDED":
        sys.exit(f"apify run ended {st}")
    items = requests.get(f"https://api.apify.com/v2/datasets/{dsid}/items",
                         params={"token": token, "clean": "true"}, timeout=180).json()
    print(f"  {len(items)} posts")
    vids = [i for i in items if i.get("type") == "Video" or i.get("videoPlayCount")]
    vids.sort(key=lambda i: i.get("videoPlayCount") or 0, reverse=True)
    winners, caps = [], {}
    for n, i in enumerate(vids[:TOPN], 1):
        sc = i["shortCode"]
        winners.append({"rank": n, "shortCode": sc,
                        "plays": i.get("videoPlayCount") or 0,
                        "likes": i.get("likesCount") or 0,
                        "comments": i.get("commentsCount") or 0,
                        "dur": round(float(i.get("videoDuration") or 0), 3)})
        caps[sc] = (i.get("caption") or "").strip() or "."
    cut = vids[TOPN].get("videoPlayCount") if len(vids) > TOPN else None
    src = f"apify/instagram-scraper run {rid}, dataset {dsid}, {RECENT} most recent posts"
    rank = ("videoPlayCount desc. NOTE: this is PLAYS, not follows. Follows-per-reel is the "
            "better signal but needs the account owner's own logged-in insights.")
    note = (f"top {TOPN}; #{TOPN} has {winners[-1]['plays']} plays, #{TOPN+1} has {cut} — "
            "check this is a real gap, not an arbitrary cut" if cut else f"top {TOPN}")
    return winners, caps, src, rank, note


def manual(path):
    codes = [shortcode(l) for l in open(path) if l.strip()]
    codes = [c for c in codes if c][:TOPN]
    winners = [{"rank": n, "shortCode": c, "plays": None, "likes": None,
                "comments": None, "dur": None} for n, c in enumerate(codes, 1)]
    capf = os.path.join(HERE, "captions.json")
    caps = json.load(open(capf))["captions"] if os.path.exists(capf) else {}
    missing = [c for c in codes if c not in caps]
    for c in missing:
        caps[c] = "."
    if missing:
        print(f"!! {len(missing)} captions unknown, defaulted to '.'  —  fill captions.json "
              f"with each reel's OWN original caption before scheduling:\n   {missing}")
    return (winners, caps, f"manual list from {os.path.basename(path)}",
            "owner-ranked (follows or judgement), best first", f"top {len(winners)}")


if __name__ == "__main__":
    if "--manual" in sys.argv:
        w, caps, src, rank, note = manual(sys.argv[sys.argv.index("--manual") + 1])
    elif "--apify" in sys.argv:
        w, caps, src, rank, note = apify()
    else:
        sys.exit(__doc__)

    json.dump({"_source": src, "_ranking": rank, "_cutoff": note,
               "_account": {"username": ACCOUNT, "metricoolBlogId": CFG["blogId"]},
               "winners": w},
              open(os.path.join(HERE, "winners.json"), "w"), ensure_ascii=False, indent=1)
    json.dump({"_note": "Each variant reuses its SOURCE reel's own original caption, "
                        "verbatim. Never paste another brand's CTA onto this account. "
                        "Empty caption -> '.', which is what the account itself posts.",
               "_source": src, "captions": caps},
              open(os.path.join(HERE, "captions.json"), "w"), ensure_ascii=False, indent=1)
    print(f"\nwinners.json: {len(w)} reels  |  captions.json: {len(caps)} captions")
    for r in w[:5]:
        print(f"  {r['rank']:>2}. {r['shortCode']}  {r['plays']} plays")
