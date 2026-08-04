#!/usr/bin/env python3
"""Resilient driver for the full trial-reel schedule.

Each pass: (1) RECONCILE the local log against the guard by matching publicationDate — which
is unique per plan slot — so a post the guard created but that a crash left unlogged is
ADOPTED (and any duplicate at the same slot deleted) instead of being re-posted; (2) run
schedule_campaign --go for whatever is still missing. Repeats until all posts are scheduled
or progress stalls. Runs entirely on the VM and is safe to re-run. Needs GUARD_KEY in env."""
import datetime as dt, json, os, subprocess, time

import requests

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
BASE = CFG["guardBase"]
SCRIPTS = os.path.join(HERE, "scripts")
PLAN = json.load(open(os.path.join(HERE, "plan.json")))
LOGP = os.path.join(HERE, "scheduled_posts.json")
TOTAL = len(PLAN)


def hdrs():
    return {"X-Mc-Auth": os.environ["GUARD_KEY"], "Content-Type": "application/json"}


def load_log():
    return json.load(open(LOGP)) if os.path.exists(LOGP) else {}


def guard_posts():
    whens = [p["when"] for p in PLAN]
    start = (dt.datetime.fromisoformat(min(whens)) - dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")
    end = (dt.datetime.fromisoformat(max(whens)) + dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")
    r = requests.get(BASE, headers=hdrs(), params={"start": start, "end": end}, timeout=120)
    r.raise_for_status()
    out = []
    for p in (r.json().get("data") or []):
        if (p.get("instagramData") or {}).get("type") != "TRIAL_REEL":
            continue
        when = (p.get("publicationDate") or {}).get("dateTime")
        pid = p.get("id")
        if when and pid:
            out.append((when, pid))
    return out


def reconcile():
    log = load_log()
    when2key = {p["when"]: p["key"] for p in PLAN}
    by_when = {}
    for when, pid in guard_posts():
        by_when.setdefault(when, []).append(pid)
    adopted = deleted = 0
    for when, pids in by_when.items():
        key = when2key.get(when)
        if not key:
            continue                                  # not one of our slots — leave it alone
        keep = log.get(key, pids[0])
        for pid in pids:                              # dedupe: one post per slot
            if pid != keep and pid not in log.values():
                try:
                    requests.delete(f"{BASE}/{pid}", headers=hdrs(), timeout=60); deleted += 1
                except Exception:
                    pass
        if key not in log:
            log[key] = keep; adopted += 1
    if adopted or deleted:
        json.dump(log, open(LOGP, "w"), indent=1)
    print(f"[reconcile] adopted {adopted}, deleted {deleted} dup(s); log {len(log)}/{TOTAL}", flush=True)
    return len(log)


def main():
    prev, stall = 0, 0
    for i in range(1, 60):
        try:
            count = reconcile()
        except Exception as e:
            print(f"[reconcile] error {str(e)[:100]}", flush=True); count = len(load_log())
        if count >= TOTAL:
            print(f"[done] all {TOTAL} scheduled", flush=True); return
        print(f"[pass {i}] scheduling, have {count}/{TOTAL}", flush=True)
        subprocess.run(["python3", os.path.join(SCRIPTS, "schedule_campaign.py"), "--go"])
        count = len(load_log())
        stall = stall + 1 if count <= prev else 0
        prev = count
        if count >= TOTAL:
            print(f"[done] all {TOTAL} scheduled", flush=True); return
        if stall >= 4:
            print(f"[stop] stalled at {count}/{TOTAL} after {stall} passes", flush=True); return
        time.sleep(15)
    print(f"[stop] pass limit at {len(load_log())}/{TOTAL}", flush=True)


if __name__ == "__main__":
    main()
