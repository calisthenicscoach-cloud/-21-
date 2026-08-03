#!/usr/bin/env python3
"""Generate the 5 trial-reel transform-variants for ONE source reel.

These five profiles are the ones two real campaigns ran on (~420 posts). They are micro-
transforms, NOT clone-spinning or hash evasion: centre zoom, colour grade, a sub-1% speed
change (video setpts kept in sync with the audio so nothing drifts), audio treated either
by tempo (speed only, pitch preserved) or pitch (asetrate — pitch and speed), and
per-variant container metadata. Instagram is shown five genuinely different encodes of the
same idea and picks the one its audience responds to.

Usage: python3 gen_variants.py <source.mp4> <shortcode>
Output: ./trial_variants/<shortcode>/<shortcode>_<tag>.mp4  + manifest.json  (cwd-relative)
"""
import json, os, subprocess, sys

HERE = os.getcwd()          # campaign dir, not the scripts dir
W, H = 1080, 1920

# zoom / amode / aamt are the recovered originals. eq+cb / crf are the reconstruction.
PROFILES = [
    {"tag": "v1_tight", "zoom": 1.032, "amode": "tempo", "aamt": 1.004, "crf": 25,
     "eq": "contrast=1.03:saturation=1.01", "cb": None},
    {"tag": "v2_warm",  "zoom": 1.035, "amode": "tempo", "aamt": 0.996, "crf": 26,
     "eq": "contrast=1.02:saturation=1.04:brightness=0.008", "cb": "rs=0.03:bs=-0.03"},
    {"tag": "v3_punch", "zoom": 1.050, "amode": "pitch", "aamt": 1.005, "crf": 24,
     "eq": "contrast=1.09:saturation=1.10", "cb": None},
    {"tag": "v4_text",  "zoom": 1.040, "amode": "tempo", "aamt": 1.006, "crf": 27,
     "eq": "contrast=1.01:saturation=0.98:brightness=0.02", "cb": None},
    {"tag": "v5_cool",  "zoom": 1.045, "amode": "pitch", "aamt": 0.995, "crf": 25,
     "eq": "contrast=1.04:saturation=1.02", "cb": "rs=-0.03:bs=0.04"},
]


def probe_dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def stream_dims(path):
    """(w, h) of the first video stream, or None if the file has no video at all."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    parts = [p for p in r.stdout.strip().split(",") if p.strip().isdigit()]
    return (int(parts[0]), int(parts[1])) if len(parts) >= 2 else None


def has_audio(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                        "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return "audio" in r.stdout


def decodes_clean(path):
    """THE integrity gate. ffprobe reads the FRONT moov atom, so it happily reports
    width/height/duration for a file whose H.264 bitstream is shredded — 117 of 225 uploads
    on a previous campaign passed every size / ftyp / stream=width check and then died on
    Instagram with `Video Transcoding Fatal`, one at a time, over nine days. Only a full
    decode catches it. Requires returncode 0 AND empty stderr; a warning here is a defect."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.returncode == 0 and not r.stderr.strip()


def valid_output(path):
    """A variant is only 'ok' if it really carries video AND fully decodes. yt-dlp can leave
    a DASH .m4a behind, and encoding one of those produces an audio-only mp4 that is
    megabytes big and passes any size check — 60 of 220 files were silently broken that way
    on the first run. The decode gate covers the second, worse failure (see decodes_clean)."""
    return (os.path.exists(path) and os.path.getsize(path) > 50_000
            and stream_dims(path) is not None and probe_dur(path) > 0.3
            and decodes_clean(path))


def build(src, dst, p, seed, audio=True):
    """ffmpeg command for one variant. Video and audio speed always move together."""
    z = p["zoom"]
    zw, zh = int(W * z) // 2 * 2, int(H * z) // 2 * 2
    # crop offsets must be EVEN for yuv420p chroma siting, otherwise libx264 can reject the
    # frame outright (-22 Invalid argument) instead of just warning.
    ox, oy = (zw - W) // 2 // 2 * 2, (zh - H) // 2 // 2 * 2
    vf = [
        # conform to canonical vertical first, then zoom in and centre-crop back
        f"scale={W}:{H}:force_original_aspect_ratio=increase",
        f"crop={W}:{H}",
        f"scale={zw}:{zh}",
        f"crop={W}:{H}:{ox}:{oy}",
        f"eq={p['eq']}",
    ]
    if p["cb"]:
        vf.append(f"colorbalance={p['cb']}")
    vf.append("setsar=1")
    vf.append(f"setpts=PTS/{p['aamt']}")          # match the audio speed change exactly

    if p["amode"] == "tempo":
        af = f"atempo={p['aamt']}"                 # speed only, pitch preserved
    else:
        af = f"asetrate=48000*{p['aamt']},aresample=48000"   # pitch + speed

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src]
    if not audio:
        # a few sources are silent; synthesise a track so the Reel still has one
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"]
    cmd += ["-vf", ",".join(vf)]
    cmd += ["-af", af] if audio else []
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", str(p["crf"]),
            "-pix_fmt", "yuv420p", "-profile:v", "high",
            "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
            "-metadata", f"comment={seed}", "-metadata", f"title={seed}",
            "-movflags", "+faststart", dst]
    return cmd


def gen(src, sc):
    outd = os.path.join(HERE, "trial_variants", sc)
    os.makedirs(outd, exist_ok=True)
    if stream_dims(src) is None:
        print(f"  ABORT: {src} has no video stream — refusing to make audio-only 'variants'")
        return []
    audio = has_audio(src)
    man = []
    for i, p in enumerate(PROFILES):
        dst = os.path.join(outd, f"{sc}_{p['tag']}.mp4")
        if valid_output(dst):
            man.append({"variant": p["tag"], "file": os.path.relpath(dst, HERE),
                        "bytes": os.path.getsize(dst), "zoom": p["zoom"],
                        "amode": p["amode"], "aamt": p["aamt"]})
            print(f"  have {p['tag']:<9} {os.path.getsize(dst)//1024:>5} KB")
            continue
        r = subprocess.run(build(src, dst, p, f"{sc}{i}", audio), capture_output=True, text=True)
        if r.returncode == 0 and valid_output(dst):
            man.append({"variant": p["tag"], "file": os.path.relpath(dst, HERE),
                        "bytes": os.path.getsize(dst), "zoom": p["zoom"],
                        "amode": p["amode"], "aamt": p["aamt"]})
            print(f"  ok   {p['tag']:<9} {os.path.getsize(dst)//1024:>5} KB")
        else:
            why = r.stderr.strip()[-300:] or "output had no usable video stream"
            print(f"  FAIL {p['tag']}: {why}")
            if os.path.exists(dst):
                os.remove(dst)      # never leave a broken file that a size check would pass
    json.dump(man, open(os.path.join(outd, "manifest.json"), "w"), indent=1)
    return man


if __name__ == "__main__":
    src, sc = sys.argv[1], sys.argv[2]
    print(f"source {src}  ({probe_dur(src):.1f}s) -> trial_variants/{sc}/")
    m = gen(src, sc)
    print(f"{len(m)}/5 variants ok")
    sys.exit(0 if len(m) == 5 else 1)
