#!/usr/bin/env python3
"""Upload ONE local media file to a temporary public host and print its URL.

  python3 scripts/host_media.py path/to/clip.mp4      # prints https://...  on stdout

This is gate 2 of the campaign ("host verify"): schedule_campaign.py runs this, reads the
single URL off stdout, hands that URL to Metricool with saveExternalMediaFiles=True, and
Metricool fetches the bytes server-side and copies them to static.metricool.com. So the URL
MUST be a direct, unauthenticated download of the raw file — not an HTML landing page.

CONTRACT (do not break — schedule_campaign.py depends on it):
  * stdout carries the URL and NOTHING else. All logging goes to stderr.
  * exit 0 only after the upload has been read back and its Content-Length matches the file
    on disk (a host can 200 a truncated or 0-byte object; that would sail through here and
    then die inside Instagram's transcoder). exit 1 on any failure.

HOST: default https://0x0.st (returns a bare direct URL, generous retention). Override with
env UPLOAD_ENDPOINT, or "uploadEndpoint" in config.json. The endpoint must accept a
multipart POST with the file under field "file" and answer with the direct URL as plain text.
"""
import json, os, sys

import requests

UA = "matan-reels-campaign/1.0 (+https://instagram.com/)"


def endpoint():
    if os.environ.get("UPLOAD_ENDPOINT"):
        return os.environ["UPLOAD_ENDPOINT"].strip()
    try:
        cfg = json.load(open(os.path.join(os.getcwd(), "config.json")))
        if cfg.get("uploadEndpoint"):
            return str(cfg["uploadEndpoint"]).strip()
    except Exception:
        pass
    return "https://0x0.st"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def upload(path):
    ep = endpoint()
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        r = requests.post(ep, headers={"User-Agent": UA},
                          files={"file": (os.path.basename(path), fh, "video/mp4")},
                          timeout=300)
    if r.status_code not in (200, 201):
        log(f"host POST {ep} -> {r.status_code}: {r.text[:200]}")
        return None
    url = r.text.strip().splitlines()[-1].strip() if r.text.strip() else ""
    if not url.startswith("http"):
        log(f"host gave no usable URL: {r.text[:200]}")
        return None
    return url, size


def verify(url, size):
    """Read the object back and require its byte length to match what we uploaded."""
    try:
        h = requests.head(url, headers={"User-Agent": UA}, timeout=120, allow_redirects=True)
        clen = int(h.headers.get("content-length") or 0)
        if h.status_code == 200 and clen == size:
            return True
        # some hosts don't answer HEAD honestly — fall back to a ranged GET
        g = requests.get(url, headers={"User-Agent": UA, "Range": "bytes=0-0"},
                         timeout=120, allow_redirects=True)
        crange = g.headers.get("content-range", "")
        total = int(crange.split("/")[-1]) if "/" in crange else int(g.headers.get("content-length") or 0)
        return g.status_code in (200, 206) and total == size
    except Exception as e:
        log(f"verify failed: {e}")
        return False


def main():
    if len(sys.argv) != 2:
        log("usage: host_media.py <file>")
        sys.exit(2)
    path = sys.argv[1]
    if not (os.path.exists(path) and os.path.getsize(path) > 0):
        log(f"missing or empty: {path}")
        sys.exit(1)

    for attempt in range(1, 4):
        got = upload(path)
        if got and verify(*got):
            print(got[0])           # the ONLY thing on stdout
            sys.exit(0)
        log(f"attempt {attempt} failed, retrying")
    log("giving up after 3 attempts")
    sys.exit(1)


if __name__ == "__main__":
    main()
