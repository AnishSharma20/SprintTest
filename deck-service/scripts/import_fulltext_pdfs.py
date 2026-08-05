# -*- coding: utf-8 -*-
"""Import full-text study PDFs (as supplied by AKBM) into assets/fulltext/, keyed by PMID.

The study view and the claims/findings extraction previously had only the PubMed ABSTRACT to work
from. This turns a folder of `Author Year.pdf` files into committed full text the pipeline can use.

Matching is deliberately conservative — a wrong PMID would attach a paper's text to the wrong study:
  1. DOI found in the first pages -> esearch `<doi>[DOI]`   (most reliable)
  2. else the title guess          -> esearch `<title>[Title]`
  3. every hit is CROSS-CHECKED against the filename's author + year (diacritics folded, so
     "Kohler" matches "Köhler"). A hit that fails the check is reported, never written.
Unmatched or image-only PDFs (no text layer) are listed for manual handling rather than guessed at.

    python scripts/import_fulltext_pdfs.py <folder-of-pdfs> [--write]

Without --write it only reports (dry run). Writes:
    assets/fulltext/<pmid>.txt          extracted text, one file per study
    assets/fulltext/index.json          pmid -> {pdf, pages, chars, doi, title, matched_by}
"""
from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

import fitz  # PyMuPDF, already a dependency

ROOT = Path(__file__).resolve().parent.parent
OUTDIR = ROOT / "assets" / "fulltext"
# The study view reads the supplied-paper list from inside app/ (same convention as
# ai-summaries.json) so the Next build never reaches outside it.
APP_LIST = ROOT.parent / "app" / "fulltext-studies.json"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
COMMON = "tool=akbm-fulltext&email=anish.sharma@sprint.no"
DOI_RE = re.compile(r"10\.\d{4,9}/\S{4,}")
MIN_CHARS = 500          # below this there is effectively no text layer (scanned image)


def fold(s: str) -> str:
    """Strip diacritics so a filename can match a PubMed author name (Kohler == Köhler)."""
    return "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)).lower()


def _get(url: str, tries: int = 3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "akbm"}), timeout=30) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (i + 1))
    return None


def esearch(term: str, n: int = 8) -> list[str]:
    raw = _get(f"{EUTILS}/esearch.fcgi?db=pubmed&{COMMON}&retmax={n}&term={urllib.parse.quote(term)}")
    if not raw:
        return []
    try:
        return [e.text for e in ET.fromstring(raw).findall(".//Id")]
    except ET.ParseError:
        return []


def esummary(pmids: list[str]) -> dict:
    if not pmids:
        return {}
    raw = _get(f"{EUTILS}/esummary.fcgi?db=pubmed&{COMMON}&retmode=json&id={','.join(pmids)}")
    try:
        res = json.loads(raw).get("result", {})
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for k, v in res.items():
        if k == "uids":
            continue
        a = v.get("authors") or [{}]
        out[k] = {"title": v.get("title", ""), "year": (v.get("pubdate") or "")[:4],
                  "first_author": a[0].get("name", "") if a else ""}
    return out


def read_pdf(path: Path) -> tuple[str, str, int]:
    """Return (full_text, head_text, page_count). head = first 3 pages, for DOI/title detection."""
    doc = fitz.open(path)
    pages = [doc[i].get_text() for i in range(doc.page_count)]
    n = doc.page_count
    doc.close()
    return "\n".join(pages), "\n".join(pages[:3]), n


def resolve(stem: str, head: str) -> tuple[str | None, str | None, dict]:
    """PMID for this paper, or (None, ...) when nothing passes the cross-check."""
    author = re.split(r"\s+(?:et al|\d)", stem)[0].strip().split()[0]
    ym = re.search(r"(19|20)\d{2}", stem)
    year = ym.group(0) if ym else None

    doi = next((m.group(0).rstrip(".,);") for m in DOI_RE.finditer(head) if len(m.group(0)) > 14), None)
    attempts: list[tuple[str, list[str]]] = []
    if doi:
        attempts.append(("doi", esearch(f"{doi}[DOI]")))
        time.sleep(0.4)
    lines = [l.strip() for l in head.splitlines() if len(l.strip()) > 25]
    if lines:
        t = re.sub(r"[^A-Za-z0-9 ]", " ", lines[0])[:110]
        attempts.append(("title", esearch(f"{t}[Title]")))
        time.sleep(0.4)
    if year:
        attempts.append(("author+year", esearch(
            f"{author}[Author] AND {year}[DP] AND (krill OR omega-3 OR omega 3 OR fatty acid)")))
        time.sleep(0.4)

    for how, pmids in attempts:
        meta = esummary(pmids[:8])
        for p in pmids[:8]:
            m = meta.get(p)
            if not m:
                continue
            year_ok = (not year) or abs(int(m["year"] or 0) - int(year)) <= 2
            auth_ok = fold(author)[:5] in fold(m["first_author"])
            if year_ok and auth_ok:
                return p, how, {"doi": doi, **m}
    return None, None, {"doi": doi}


def write_app_list(index: dict) -> None:
    """app/fulltext-studies.json — the PMIDs AKBM supplied as PDFs. The study view is built from
    THIS list (plus the curated trials), not from a PubMed affiliation search."""
    slim = {p: {"pdf": v.get("pdf"), "title": v.get("title", ""), "year": v.get("year", ""),
                "first_author": v.get("first_author", ""), "chars": v.get("chars", 0)}
            for p, v in sorted(index.items())}
    APP_LIST.parent.mkdir(parents=True, exist_ok=True)
    APP_LIST.write_text(json.dumps(slim, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {APP_LIST.name} ({len(slim)} supplied papers)")


def main() -> None:
    # --from-index regenerates the app list from the existing index.json, no PDFs or network needed.
    if "--from-index" in sys.argv:
        idx = json.loads((OUTDIR / "index.json").read_text(encoding="utf-8"))
        write_app_list(idx)
        return
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    src = Path(args[0]).expanduser()
    pdfs = sorted(src.glob("*.pdf"))
    if not pdfs:
        print(f"no PDFs in {src}")
        sys.exit(1)

    index: dict[str, dict] = {}
    if (OUTDIR / "index.json").exists():
        index = json.loads((OUTDIR / "index.json").read_text(encoding="utf-8"))
    matched, scanned, unresolved = [], [], []

    for p in pdfs:
        stem = p.stem
        full, head, pages = read_pdf(p)
        if len(full) < MIN_CHARS:
            scanned.append(p.name)
            print(f"  IMAGE-ONLY  {p.name:<34} {pages}p, no text layer — needs OCR")
            continue
        pmid, how, meta = resolve(stem, head)
        if not pmid:
            unresolved.append(p.name)
            print(f"  UNRESOLVED  {p.name:<34} {pages}p, {len(full):>7,} chars  doi={meta.get('doi') or '-'}")
            continue
        matched.append((pmid, p.name))
        print(f"  ok  {pmid:<9} {p.name:<34} {pages}p, {len(full):>7,} chars  via {how}")
        index[pmid] = {"pdf": p.name, "pages": pages, "chars": len(full), "doi": meta.get("doi"),
                       "title": meta.get("title", "")[:200], "first_author": meta.get("first_author", ""),
                       "year": meta.get("year", ""), "matched_by": how}
        if write:
            OUTDIR.mkdir(parents=True, exist_ok=True)
            (OUTDIR / f"{pmid}.txt").write_text(full, encoding="utf-8")

    if write:
        OUTDIR.mkdir(parents=True, exist_ok=True)
        (OUTDIR / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
        write_app_list(index)

    print(f"\n  matched     : {len(matched)}/{len(pdfs)}")
    print(f"  image-only  : {len(scanned)}  {scanned}")
    print(f"  unresolved  : {len(unresolved)}  {unresolved}")
    dupes = [pm for pm in {m[0] for m in matched} if sum(1 for x in matched if x[0] == pm) > 1]
    if dupes:
        print(f"  NOTE duplicate PMIDs (same paper supplied twice): {dupes}")
    print(f"  {'WROTE' if write else 'DRY RUN — pass --write to save'} -> {OUTDIR}")


if __name__ == "__main__":
    main()
