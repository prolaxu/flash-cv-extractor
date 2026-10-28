#!/usr/bin/env bash
# Download a public corpus of cv pdfs for testing.
#
#   bash scripts/fetch-corpus.sh opensporks ./corpus
#
# Corpora (all public, check each one's licence before redistributing):
#   opensporks  2484 pdfs, CC0-1.0, text-based, contact details redacted
#   d4rk3r      1940 pdfs, MIT, ~794MB, heavier real-world layouts
#   bench         38 pdfs, CC-BY-4.0, ships per-field ground truth jsonl
set -euo pipefail

name="${1:-opensporks}"
dest="${2:-./corpus/$name}"

case "$name" in
  opensporks) repo="opensporks/resumes" ;;
  d4rk3r)     repo="d4rk3r/resumes-raw-pdf" ;;
  bench)      repo="Careerflow/ResumeExtractBench" ;;
  *) echo "unknown corpus: $name (opensporks|d4rk3r|bench)" >&2; exit 2 ;;
esac

mkdir -p "$dest"
echo "fetching $repo -> $dest"
python3 - "$repo" "$dest" <<'PY'
import json, os, re, sys, urllib.parse, urllib.request
import concurrent.futures as cf

repo, dest = sys.argv[1], sys.argv[2]
api = f"https://huggingface.co/api/datasets/{repo}/tree/main?recursive=true&limit=1000"
paths, url = [], api
while url:
    req = urllib.request.Request(url, headers={"User-Agent": "curl"})
    with urllib.request.urlopen(req) as r:
        data, link = json.load(r), r.headers.get("Link", "")
    paths += [f["path"] for f in data
              if isinstance(f, dict) and f.get("type") == "file"
              and f["path"].lower().endswith((".pdf", ".jsonl"))]
    m = re.search(r'<([^>]+)>;\s*rel="next"', link)
    url = m.group(1) if m else None
print(f"  {len(paths)} files to fetch")

def get(path):
    out = os.path.join(dest, "__".join(path.split("/")[-2:]))
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return True
    src = f"https://huggingface.co/datasets/{repo}/resolve/main/" + urllib.parse.quote(path)
    try:
        req = urllib.request.Request(src, headers={"User-Agent": "curl"})
        with urllib.request.urlopen(req, timeout=120) as r, open(out, "wb") as f:
            f.write(r.read())
        return True
    except Exception:
        return False

ok = 0
with cf.ThreadPoolExecutor(max_workers=16) as ex:
    for i, res in enumerate(ex.map(get, paths), 1):
        ok += bool(res)
        if i % 500 == 0:
            print(f"  {i}/{len(paths)}")
print(f"  done: {ok}/{len(paths)}")
PY
echo "now run:  node scripts/check-corpus.mjs $dest"
