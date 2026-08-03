#!/usr/bin/env python3
"""Step 3 — lay out the calendar and PROVE it fits under Instagram's trial-reel ceiling.

  export GUARD_KEY=...            # this account's guard key
  python3 scripts/plan_schedule.py            # plan + simulate, writes plan.json
  python3 scripts/plan_schedule.py --ceiling 12   # override the assumed ceiling

Writes plan.json = [{when, key, sc, tag, file, caption}] in time order. Nothing is posted.

WHAT IT ENFORCES
1. A reel's 5 variants never land on the same day. Posts are ordered by tag (all v1 in rank
   order, then all v2, ...) and dealt into perDay slots, which spaces a reel's variants
   about len(reels)/perDay days apart automatically.
2. The 72h concurrency simulation. Instagram's trial-reel limit is a cap on how many reels
   are CONCURRENTLY in trial (each occupies a slot for 72h), not a daily allowance. It is
   simulated here at real timestamps, seeded with whatever is already on this account's
   calendar, and the planner REFUSES to emit a plan that ever exceeds the ceiling.
3. The ramp. Reels already published sit in the window and block the start — a burst
   yesterday means the grid cannot begin today. The sim shows exactly which day is safe.

THE CEILING IS PER-ACCOUNT AND UNMEASURED UNTIL THIS ACCOUNT REJECTS ONE. Measured values:
19 on one account, 12 on another. Default here is a deliberately conservative 12. Sustainable
daily rate = ceiling / 3, so 4/day. Manual posts from the owner's phone consume the same
quota and are invisible to Metricool, so every count derived from here is a FLOOR.
"""
import datetime as dt
import json, os, sys

import requests

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
TAGS = ["v1_tight", "v2_warm", "v3_punch", "v4_text", "v5_cool"]
TRIAL_HOURS = 72
CEILING = int(sys.argv[sys.argv.index("--ceiling") + 1]) if "--ceiling" in sys.argv else 12
PER_DAY = CFG["perDay"]
SLOTS = [tuple(s) for s in CFG["slots"]][:PER_DAY]


def hdrs():
    return {"X-Mc-Auth": os.environ["GUARD_KEY"], "Content-Type": "application/json"}


def existing_trial_posts():
    """Trial reels already on this brand's calendar — scheduled or recently published.
    They occupy the same 72h quota, so the sim has to start from them, not from zero.
    Published posts drop out of this listing after a few hours, so this is a floor."""
    now = dt.datetime.now()
    r = requests.get(CFG["guardBase"], headers=hdrs(),
                     params={"start": (now - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S"),
                             "end": (now + dt.timedelta(days=200)).strftime("%Y-%m-%dT%H:%M:%S")},
                     timeout=180)
    r.raise_for_status()
    out = []
    for p in (r.json().get("data") or []):
        ig = p.get("instagramData") or {}
        if ig.get("type") != "TRIAL_REEL":
            continue
        when = (p.get("publicationDate") or {}).get("dateTime")
        if when:
            out.append(dt.datetime.fromisoformat(when))
    return sorted(out)


def in_trial_at(t, stamps):
    return sum(1 for s in stamps if t - dt.timedelta(hours=TRIAL_HOURS) < s <= t)


def build(start, ready, caps):
    plan = []
    order = [(sc, tag) for tag in TAGS for sc in ready]   # tag-major => variants spread out
    for i, (sc, tag) in enumerate(order):
        day = start + dt.timedelta(days=i // PER_DAY)
        h, m = SLOTS[i % PER_DAY]
        plan.append({"when": dt.datetime(day.year, day.month, day.day, h, m),
                     "key": f"{sc}_{tag}", "sc": sc, "tag": tag,
                     "file": os.path.join(HERE, "trial_variants", sc, f"{sc}_{tag}.mp4"),
                     "caption": caps.get(sc) or "."})
    return plan


def main():
    W = json.load(open(os.path.join(HERE, "winners.json")))
    caps = json.load(open(os.path.join(HERE, "captions.json")))["captions"]
    logp = os.path.join(HERE, "scheduled_posts.json")
    log = json.load(open(logp)) if os.path.exists(logp) else {}

    ready, missing = [], []
    for r in sorted(W["winners"], key=lambda r: r["rank"]):
        sc = r["shortCode"]
        # already-scheduled counts as ready: the scheduler deletes local files once
        # Metricool has its own copy, and the layout must not shift between runs.
        ok = all(f"{sc}_{t}" in log or
                 os.path.exists(os.path.join(HERE, "trial_variants", sc, f"{sc}_{t}.mp4"))
                 for t in TAGS)
        (ready if ok else missing).append(sc)
    print(f"{len(ready)} reels ready, {len(missing)} not ({missing[:10]})")

    prior = existing_trial_posts()
    print(f"{len(prior)} trial reels already on the calendar "
          f"(last: {prior[-1] if prior else 'none'})")

    start = (dt.date.fromisoformat(CFG["startDate"]) if CFG.get("startDate")
             else dt.date.today() + dt.timedelta(days=1))
    for attempt in range(30):                    # push the start until the ramp is clean
        plan = build(start, ready, caps)
        stamps = sorted(prior + [p["when"] for p in plan])
        over = [(p["when"], in_trial_at(p["when"], stamps)) for p in plan
                if in_trial_at(p["when"], stamps) > CEILING]
        if not over:
            break
        print(f"  start {start}: {len(over)} posts would exceed {CEILING} in-trial "
              f"(worst {max(c for _, c in over)}) — pushing start +1 day")
        start += dt.timedelta(days=1)
    else:
        sys.exit("cannot fit under the ceiling — lower perDay in config.json")

    same_day = sum(1 for i, a in enumerate(plan) for b in plan[i + 1:]
                   if a["sc"] == b["sc"] and a["when"].date() == b["when"].date())
    peak = max((in_trial_at(p["when"], stamps) for p in plan), default=0)
    print(f"\nplan: {len(plan)} posts, {start} -> {plan[-1]['when'].date()}, {PER_DAY}/day")
    print(f"  peak in-trial stock: {peak} / ceiling {CEILING}")
    print(f"  same-reel-same-day collisions: {same_day} (must be 0)")
    print("  first 8:")
    for p in plan[:8]:
        print(f"    {p['when']:%a %m-%d %H:%M}  {p['key']:<24} {p['caption'][:32]}")

    if same_day:
        sys.exit("REFUSING to write plan.json — same reel twice in one day")
    json.dump([{**p, "when": p["when"].strftime("%Y-%m-%dT%H:%M:%S")} for p in plan],
              open(os.path.join(HERE, "plan.json"), "w"), ensure_ascii=False, indent=1)
    print("\nwrote plan.json — review it, then: python3 scripts/schedule_campaign.py --go")


if __name__ == "__main__":
    main()
