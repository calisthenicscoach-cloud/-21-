# Matan Kopel — Instagram trial-reel campaign

Take the account's top-performing reels, render 5 micro-transform **variants** of each, and
schedule them as Instagram **trial reels** through Metricool — every variant reusing its own
source reel's original caption. **Matan Kopel brand only. No cross-posting, no other brand.**

The pipeline is four steps plus one helper. Every step is idempotent and resumable, and each
writes a file the next step reads:

| Step | Script | Reads | Writes |
|-----|--------|-------|--------|
| 1 | `scripts/rank_reels.py` | account (Apify) or `shortcodes.txt` | `winners.json`, `captions.json` |
| 2 | `scripts/run_media.py` → `gen_variants.py` | `winners.json` | `trial_variants/<sc>/*.mp4` |
| 3 | `scripts/plan_schedule.py` | winners + variants | `plan.json` |
| 4 | `scripts/schedule_campaign.py` → `host_media.py` | `plan.json` | posts to Metricool, `scheduled_posts.json` |
| 5 | `scripts/audit.py` | Metricool calendar | prints status / rejections / bad media |

`host_media.py` (step 4's helper) uploads each variant to a temporary public host
(uguu → litterbox → catbox, with byte-verify read-back) and returns a direct URL; Metricool
fetches that URL server-side and keeps its own copy on static.metricool.com.

`audit.py` (step 5) is the safety net — run it daily the first week, then weekly. It reports
every trial reel's status, surfaces rate **rejections** (the only way this account's true
ceiling gets measured), and flags any pending post whose stored media would fail to transcode.

---

## ⚠️ This cannot run in a cloud sandbox — it runs on YOUR machine

Two hard requirements tie this to a computer where **you are logged into Instagram**:

1. **Downloading your reels** (`run_media.py`) uses `yt-dlp --cookies-from-browser chrome`.
   That reads your logged-in Instagram session from Chrome. A server with no browser session
   cannot pull your reels — Instagram refuses.
2. Ranking needs either your **Apify token** or your own **top-50 list**, and posting needs
   your **Metricool guard host + Matan Kopel blogId** — none of which live in a repo.

So: clone this, `cd reels-campaign`, and run it on your laptop (Chrome logged into the Matan
Kopel Instagram), or hand me those inputs and I can take it further.

---

## Setup (once)

```bash
cd reels-campaign
cp config.example.json config.json          # then edit config.json (see below)
export GUARD_KEY=matan_xxxxxxxxxxxxxxxxxxxx  # your Metricool guard key — NEVER commit this
pip install requests yt-dlp                  # plus ffmpeg + ffprobe on PATH (brew/apt)
```

`config.json`, secrets, generated videos and all state files are `.gitignore`d — only the
`.example` template is tracked.

### config.json fields

| field | what it is |
|-------|-----------|
| `account` | the Matan Kopel Instagram handle |
| `topN` | how many top reels to take (**50**) |
| `blogId` | the **Matan Kopel** brand's Metricool blog id — this is the *only* brand guard |
| `guardBase` | your Metricool guard endpoint (the base the scripts POST/GET against) |
| `perDay` | variants posted per day — **see the ceiling note below** |
| `slots` | `[hour, minute]` posting times, one per `perDay` |
| `timezone` | `Asia/Jerusalem` |
| `startDate` | `null` = start tomorrow, or `"YYYY-MM-DD"` |
| `shareTrialAutomatically` | `false` keeps trials in front of non-followers only; you then promote the single best variant by hand |

---

## ⚠️ "~12 per day" fights the trial-reel ceiling — read this

Instagram's trial-reel limit is a cap on how many reels are **concurrently in trial at once**,
and each reel occupies a slot for **72 hours** — it is *not* a daily allowance. So the
sustainable daily rate is:

```
perDay  ≤  ceiling / 3
```

`plan_schedule.py` simulates this at real timestamps and **refuses** to emit a plan that ever
exceeds the ceiling. Measured ceilings so far: 19 on one account, 12 on another (default here
is a conservative **12**).

- With a ceiling of 12 → **~4/day** is the ceiling-safe rate (what `config.example.json` uses).
- To actually post **~12/day**, your account's real ceiling would need to be **~36+**, which
  no measured account has shown. Forcing it (`--ceiling 36`) risks Instagram silently
  downgrading variants to normal reels or rejecting them.

50 reels × 5 variants = **250 posts.** At 4/day that's ~9 weeks; at 12/day (if your ceiling
allowed it) ~3 weeks. **Decide the cadence with your real ceiling in mind before step 3.**

---

## Run it

```bash
# STEP 1 — pick the top 50 and grab their own captions
export APIFY_TOKEN=...                        # route A: automatic
python3 scripts/rank_reels.py --apify
#   — or route B: paste your 50 best reel URLs/shortcodes (best first) into shortcodes.txt
python3 scripts/rank_reels.py --manual shortcodes.txt
#   then fill captions.json with each reel's OWN original caption before step 3

# STEP 2 — download + render 5 clean variants each (resumable; retry ranges like 1-10)
python3 scripts/run_media.py

# STEP 3 — lay out the calendar and PROVE it fits under the ceiling (nothing is posted)
python3 scripts/plan_schedule.py              # add --ceiling N only if you know your real cap
#   review plan.json by eye here

# STEP 4 — post to Metricool as trial reels
python3 scripts/schedule_campaign.py --dry    # preview
python3 scripts/schedule_campaign.py --go     # do it (add --limit N to ramp in slowly)

# STEP 5 — audit daily the first week, then weekly (the safety net)
python3 scripts/audit.py                      # status, rejections (= your real ceiling), bad media
```

## Guardrails baked in

- **Captions never mix brands** — each variant reuses *its own source reel's* caption verbatim;
  an empty caption becomes `.` (never invented copy).
- **Instagram-only trial reels** — `instagramData.type = "TRIAL_REEL"`, no cross-post provider.
- **A reel's 5 variants never land on the same day** (step 3 refuses a plan that collides).
- **Three integrity gates** on every upload (local full-decode, host read-back, Metricool's
  stored-copy box check); anything that fails is deleted rather than left to die on Instagram.

## Security

`GUARD_KEY` and `APIFY_TOKEN` are read from the environment and must **never** be committed. If
a key was ever shared in plain text (chat, email), rotate it in Metricool.
