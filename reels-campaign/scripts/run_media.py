#!/usr/bin/env python3
"""Step 2 — download each winner reel and render its 5 variants. Resumable.

Run from the campaign dir:
  python3 scripts/run_media.py            # all winners
  python3 scripts/run_media.py 1-10       # just ranks 1..10
  python3 scripts/run_media.py 3,22,36    # retry specific ranks

Sources are deleted per reel as soon as its variants exist, so peak disk is one source plus
the variant set (~15-20 MB per reel across 5 variants).

DISK: check free space BEFORE starting. `-movflags +faststart` rewrites the moov atom in
place at the end of every render; interrupting that on a near-full disk is how a previous
campaign produced 117 files that ffprobe called valid and that Instagram refused to
transcode. gen_variants.py now full-decodes every output and deletes anything that fails,
so a full disk becomes loud failures instead of silent corruption — but leave headroom.
"""
import glob, json, os, shutil, subprocess, sys

HERE = os.getcwd()
CFG = json.load(open(os.path.join(HERE, "config.json")))
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
TAGS = ["v1_tight", "v2_warm", "v3_punch", "v4_text", "v5_cool"]

W = json.load(open(os.path.join(HERE, "winners.json")))
reels = sorted(W["winners"], key=lambda r: r["rank"])

sel = sys.argv[1] if len(sys.argv) > 1 else "all"
if sel != "all":
    want = set()
    for part in sel.split(","):
        if "-" in part:
            a, b = part.split("-"); want |= set(range(int(a), int(b) + 1))
        else:
            want.add(int(part))
    reels = [r for r in reels if r["rank"] in want]

free_gb = shutil.disk_usage(HERE).free / 1e9
need_gb = len(reels) * 0.09
print(f"disk free {free_gb:.1f} GB | this run needs roughly {need_gb:.1f} GB")
if free_gb < need_gb + 2:
    sys.exit("not enough headroom — free space first (see docstring)")


def has_video(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return r.stdout.strip().rstrip(",").isdigit()


def decodes_clean(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.returncode == 0 and not r.stderr.strip()


def have_all(sc):
    # A real VIDEO stream, not just file size: yt-dlp can leave a DASH .m4a next to the
    # video and encoding that yields a multi-MB audio-only mp4 any size check accepts.
    # Plus a full decode — the only thing that catches a shredded bitstream.
    d = os.path.join(HERE, "trial_variants", sc)
    return all(os.path.exists(f := os.path.join(d, f"{sc}_{t}.mp4")) and
               os.path.getsize(f) > 50_000 and has_video(f) and decodes_clean(f)
               for t in TAGS)


def pick_source(sc):
    """The downloaded file that actually carries video (never the DASH audio sidecar)."""
    for f in sorted(glob.glob(os.path.join(HERE, "sources", f"{sc}.*"))):
        if has_video(f):
            return f
    return None


os.makedirs(os.path.join(HERE, "sources"), exist_ok=True)
done, failed = 0, []
for r in reels:
    sc, rank = r["shortCode"], r["rank"]
    if have_all(sc):
        print(f"[{rank:>2}] {sc} variants already built — skip", flush=True)
        done += 1
        for g in glob.glob(os.path.join(HERE, "sources", f"{sc}.*")):
            os.remove(g)
        continue
    print(f"[{rank:>2}] {sc}  ({r.get('plays')} plays)", flush=True)

    if pick_source(sc) is None:
        for g in glob.glob(os.path.join(HERE, "sources", f"{sc}.*")):
            os.remove(g)                     # clear any half-merged DASH leftovers
        dl = subprocess.run(
            ["yt-dlp", "--no-update", "--cookies-from-browser", "chrome",
             "-f", "bv*+ba/b", "--merge-output-format", "mp4",
             "--no-playlist", "-o", os.path.join(HERE, "sources", f"{sc}.%(ext)s"),
             f"https://www.instagram.com/reel/{sc}/"],
            capture_output=True, text=True)
        if pick_source(sc) is None:
            print(f"     DL FAIL (no video stream): {dl.stderr.strip()[-200:]}", flush=True)
            failed.append((sc, "dl"))
            continue
    src = pick_source(sc)

    gen = subprocess.run(["python3", os.path.join(SCRIPTS, "gen_variants.py"), src, sc],
                         capture_output=True, text=True)
    print(gen.stdout.rstrip(), flush=True)
    if gen.returncode != 0:
        print(f"     GEN FAIL: {gen.stderr.strip()[-200:]}", flush=True)

    if have_all(sc):
        done += 1
        for g in glob.glob(os.path.join(HERE, "sources", f"{sc}.*")):
            os.remove(g)
    else:
        failed.append((sc, "incomplete"))

print(f"\n=== {done}/{len(reels)} reels have all 5 clean variants | {len(failed)} failures ===")
if failed:
    print("failures:", failed[:40])
