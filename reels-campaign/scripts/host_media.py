#!/usr/bin/env python3
"""Upload one file and poll-verify it's really hosted. uguu is the workhorse (fast, reliable);
retry it up to 5x with backoff before ever touching the flaky fallbacks (litterbox errors,
catbox hangs on big writes right now). Metricool copies media at schedule time, so uguu's ~3h
retention is fine as long as we schedule the same run.

Usage: python3 host_media.py <file>  ->  prints direct URL (exit 0); exit 1 on total failure.
"""
import sys, os, time, requests

f = sys.argv[1]
sz = os.path.getsize(f)

def verify(url):
    # GET real bytes — uguu sometimes serves a 200 for a 0-byte file; HEAD length lies.
    for _ in range(5):
        try:
            r = requests.get(url, timeout=30, stream=True)
            head = next(r.iter_content(65536), b"")
            cl = int(r.headers.get("content-length") or 0)
            r.close()
            if r.status_code == 200 and cl >= sz * 0.9 and b"ftyp" in head[:64]:
                return True
        except Exception:
            pass
        time.sleep(1.5)
    return False

def uguu(f):
    return requests.post("https://uguu.se/upload.php",
                         files={"files[]": open(f, "rb")}, timeout=60).json()["files"][0]["url"]

def litterbox(f):
    return requests.post("https://litterbox.catbox.moe/resources/internals/api.php",
                         data={"reqtype": "fileupload", "time": "72h"},
                         files={"fileToUpload": open(f, "rb")}, timeout=60).text.strip()

def catbox(f):
    return requests.post("https://catbox.moe/user/api.php", data={"reqtype": "fileupload"},
                         files={"fileToUpload": open(f, "rb")}, timeout=20).text.strip()

def attempt(fn, tries):
    for a in range(tries):
        try:
            u = fn(f)
            if isinstance(u, str) and u.startswith("http") and verify(u):
                return u
        except Exception:
            pass
        time.sleep(1.2 * (a + 1))
    return None

for fn, tries in [(uguu, 4), (litterbox, 3), (catbox, 1)]:
    u = attempt(fn, tries)
    if u:
        print(u)
        sys.exit(0)

sys.stderr.write("all hosts failed\n")
sys.exit(1)
