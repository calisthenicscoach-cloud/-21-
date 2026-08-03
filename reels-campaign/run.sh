#!/usr/bin/env bash
# One-command runner for the Matan Kopel trial-reel campaign.
# Run this ON YOUR OWN MAC/PC — the one logged into the Matan Kopel Instagram in Chrome.
# It cannot run in a locked-down cloud box (no Instagram/Metricool network, no browser session).
#
#   cd reels-campaign
#   export GUARD_KEY=matan_xxxxxxxxxxxxxxxxxxxx      # your Metricool key
#   ./run.sh                 # steps 1-3 + a DRY preview of step 4 (nothing is posted)
#   ./run.sh --go            # same, but actually schedules to Metricool at the end
#   ./run.sh --go --ceiling 12   # pass planner flags through (see the ceiling note in README)
set -euo pipefail
cd "$(dirname "$0")"

GO=0; PASS=()
for a in "$@"; do
  if [ "$a" = "--go" ]; then GO=1; else PASS+=("$a"); fi
done

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }

# ---- preflight -------------------------------------------------------------
say "Preflight"
for t in python3 ffmpeg ffprobe yt-dlp; do
  command -v "$t" >/dev/null 2>&1 && echo "  ok   $t" \
    || die "$t is not installed. Install it, then re-run.
         macOS:  brew install ffmpeg yt-dlp   (python3 ships with macOS / brew)
         Ubuntu: sudo apt-get install -y ffmpeg && pipx install yt-dlp"
done
python3 -c 'import requests' 2>/dev/null || { echo "  installing 'requests'..."; python3 -m pip install --quiet requests; }

[ -f config.json ] || { cp config.example.json config.json; die "Created config.json from the template.
         Open it and fill in your Matan Kopel details (guardBase, blogId, account), then re-run."; }
: "${GUARD_KEY:?Set your Metricool key first:  export GUARD_KEY=matan_...}"
echo "  ok   config.json present, GUARD_KEY set"

# ---- step 1: pick the top 50 ----------------------------------------------
if [ ! -f winners.json ]; then
  say "Step 1 — rank the top 50 reels"
  if [ -n "${APIFY_TOKEN:-}" ]; then
    python3 scripts/rank_reels.py --apify
  elif [ -f shortcodes.txt ]; then
    python3 scripts/rank_reels.py --manual shortcodes.txt
  else
    die "No source for the top 50. Do ONE of:
         • export APIFY_TOKEN=...    (auto-rank by plays), or
         • create shortcodes.txt with your 50 best reel URLs, best first (one per line)
       then re-run. Reminder: fill captions.json with each reel's OWN caption before step 4."
  fi
else
  echo "  winners.json already exists — skipping step 1"
fi

# ---- step 2: download + render 5 variants each ----------------------------
say "Step 2 — download reels and render 5 clean variants each (resumable)"
python3 scripts/run_media.py

# ---- step 3: plan + prove it fits under the ceiling -----------------------
say "Step 3 — build the calendar and prove it fits the trial-reel ceiling"
python3 scripts/plan_schedule.py "${PASS[@]}"

# ---- step 4: schedule ------------------------------------------------------
say "Step 4 — schedule to Metricool"
python3 scripts/schedule_campaign.py --dry
if [ "$GO" -eq 1 ]; then
  printf '\n\033[33mAbout to SCHEDULE the plan above as live trial reels. Ctrl-C to abort.\033[0m\n'
  read -r -p "Type 'yes' to post: " ans
  [ "$ans" = "yes" ] || die "Aborted — nothing was scheduled."
  python3 scripts/schedule_campaign.py --go
  say "Done. Run 'python3 scripts/audit.py' daily this week to watch status and measure your ceiling."
else
  say "Dry run only — reviewed plan.json above. Re-run with ./run.sh --go to actually schedule."
fi
