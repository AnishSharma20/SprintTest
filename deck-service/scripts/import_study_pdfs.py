# -*- coding: utf-8 -*-
"""Copy the SOURCE PDF (not just its extracted text) into the Next app's public folder, keyed
by PMID, so the frontend can link straight to the real paper instead of falling back to its
DOI/PubMed page.

Companion to import_fulltext_pdfs.py: that script resolves a folder of `Author Year.pdf`
files to PMIDs and writes their extracted TEXT into assets/; this one reuses that same
resolution (read from assets/fulltext/index.json, which already has the winning pmid ->
filename mapping, including any entries added by hand for scanned/image-only PDFs the text
extractor can't resolve on its own).

Unlike assets/figures/ (needed by BOTH the Python renderer, for deck appendix slides, AND the
Next frontend, hence mirrored into public/), nothing in deck-service ever reads the PDF back
at runtime — only the browser does — so there is no separate deck-service/assets copy here,
just the one Next actually serves. Re-run this straight from the original supplied folder if
the manifest ever needs rebuilding; there is no committed intermediate to regenerate it from.

    python scripts/import_study_pdfs.py <folder-of-pdfs> [--write]

Without --write it only reports (dry run). Writes:
    ../public/study-pdfs/<pmid>.pdf      the PDF Next.js serves
    ../app/study-pdfs.json               pmid -> {file, sizeKB} manifest the frontend reads
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "assets" / "fulltext" / "index.json"
PUBLIC_DIR = ROOT.parent / "public" / "study-pdfs"
MANIFEST_PATH = ROOT.parent / "app" / "study-pdfs.json"


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    src = Path(args[0]).expanduser()

    index: dict = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    manifest: dict[str, dict] = {}
    copied, missing = [], []

    for pmid, info in sorted(index.items()):
        pdf_name = info.get("pdf")
        if not pdf_name:
            continue
        source = src / pdf_name
        if not source.exists():
            missing.append(pdf_name)
            print(f"  MISSING SOURCE  {pmid:<9} {pdf_name}")
            continue
        size_kb = source.stat().st_size // 1024
        manifest[pmid] = {"file": f"{pmid}.pdf", "sizeKB": size_kb}
        copied.append((pmid, pdf_name, size_kb))
        print(f"  ok  {pmid:<9} {pdf_name:<34} {size_kb:>6,} KB")
        if write:
            PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, PUBLIC_DIR / f"{pmid}.pdf")

    if write:
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
        print(f"  wrote {MANIFEST_PATH.name} ({len(manifest)} studies)")

    total_mb = sum(c[2] for c in copied) / 1024
    print(f"\n  copied  : {len(copied)}/{len(index)}  ({total_mb:.1f} MB total)")
    print(f"  missing : {len(missing)}  {missing}")
    print(f"  {'WROTE' if write else 'DRY RUN — pass --write to save'} -> {PUBLIC_DIR}")


if __name__ == "__main__":
    main()
