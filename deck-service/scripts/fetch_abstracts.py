"""Fetch each study's OWN abstract, verbatim, from PubMed into app/study-abstracts.json.

The Scientific Studies page shows the paper's real abstract (2026-08-17 client decision:
abstract replaced the AI written Background/Design/Findings/Limitations summary everywhere,
including what the deck/blog/whitepaper generators are fed). So this artifact is the study
library's text of record and nothing here is model generated: every character comes from
PubMed's own Abstract element.

Structured abstracts keep their section labels (BACKGROUND:, METHODS:, RESULTS:...) because
that is how the journal published them, and the panel renders those lines as they arrive.

Also prints the evidence needed to hand author studies.ts's AKBM_ROLES table (author
affiliations + the paper's own conflict of interest / funding statements). It only PRINTS that
part deliberately: which role a paper gets is a judgment call the science team owns, the same
reason ARCHIVE_CATEGORIES is hand authored rather than keyword matched.

Run from deck-service/ (Windows: `python`, not `python3`):
    python scripts/fetch_abstracts.py             # rebuild app/study-abstracts.json
    python scripts/fetch_abstracts.py --roles     # also dump the AKBM role evidence

Re-run whenever AKBM supplies new papers (after import_fulltext_pdfs.py has added them to
app/fulltext-studies.json). It rebuilds the WHOLE file from the ids it is given, same as
extract_figures.py, so a partial run does not silently drop the other studies.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
TOOL = "tool=aker-wiki&email=anish.sharma@sprint.no"

ROOT = Path(__file__).resolve().parents[2]          # min-forste-app/
APP = ROOT / "app"
FULLTEXT_INDEX = APP / "fulltext-studies.json"
STUDIES_TS = APP / "studies-data.ts"
OUT = APP / "study-abstracts.json"


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "aker-wiki"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def target_pmids() -> list[str]:
    """Every PMID the Scientific Studies page can show: the AKBM supplied full texts plus the
    curated key trials. Mirrors studies.ts canonicalStudyPmids() — kept in sync by reading the
    same two sources rather than restating the list."""
    ids = list(json.loads(FULLTEXT_INDEX.read_text(encoding="utf-8")).keys())
    curated = re.findall(r'pmid:\s*"(\d+)"', STUDIES_TS.read_text(encoding="utf-8"))
    for p in curated:
        if p not in ids:
            ids.append(p)
    return ids


def efetch(pmids: list[str]) -> ET.Element:
    url = f"{EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&{TOOL}&id={','.join(pmids)}"
    return ET.fromstring(_get(url))


def abstract_of(art: ET.Element) -> str:
    """The abstract verbatim. A structured abstract arrives as several AbstractText elements,
    each with a Label; we keep the labels so the reader sees the journal's own sectioning."""
    parts: list[str] = []
    for ab in art.findall(".//Abstract/AbstractText"):
        text = "".join(ab.itertext()).strip()
        if not text:
            continue
        label = ab.get("Label")
        parts.append(f"{label}: {text}" if label else text)
    return "\n\n".join(parts).strip()


def role_evidence(art: ET.Element) -> dict:
    """What a human needs to decide AKBM's role: does any author sit at Aker BioMarine, and what
    does the paper itself say about who paid. Never decides the role — see the module docstring."""
    affiliations = sorted({
        "".join(a.itertext()).strip()
        for a in art.findall(".//AffiliationInfo/Affiliation")
        if "".join(a.itertext()).strip()
    })
    coi = " ".join(
        "".join(c.itertext()).strip() for c in art.findall(".//CoiStatement")
    ).strip()
    hay = " ".join(affiliations + [coi]).lower()
    return {
        "akbm_in_affiliation": "aker biomarine" in hay,
        "affiliations": affiliations,
        "coi": coi,
    }


def main() -> None:
    pmids = target_pmids()
    print(f"Fetching abstracts for {len(pmids)} studies from PubMed…")
    root = efetch(pmids)

    out: dict[str, dict] = {}
    evidence: dict[str, dict] = {}
    for art in root.findall(".//PubmedArticle"):
        pmid = art.findtext(".//MedlineCitation/PMID") or art.findtext(".//PMID")
        if not pmid:
            continue
        title_el = art.find(".//ArticleTitle")
        title = "".join(title_el.itertext()).strip() if title_el is not None else ""
        abstract = abstract_of(art)
        out[pmid] = {"title": title, "abstract": abstract}
        evidence[pmid] = role_evidence(art)

    missing = [p for p in pmids if p not in out]
    empty = sorted(p for p, v in out.items() if not v["abstract"])
    if missing:
        print(f"  WARNING: PubMed returned no record for: {', '.join(missing)}")
    if empty:
        print(f"  WARNING: no abstract text published for: {', '.join(empty)}")

    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    chars = sum(len(v["abstract"]) for v in out.values())
    print(f"Wrote {OUT.relative_to(ROOT)} — {len(out)} studies, {chars:,} characters of abstract.")

    if "--roles" in sys.argv:
        print("\n=== AKBM role evidence (hand author studies.ts AKBM_ROLES from this) ===")
        for pmid in pmids:
            e = evidence.get(pmid)
            if not e:
                print(f"\n{pmid}: NO RECORD")
                continue
            flag = "AKBM AUTHOR" if e["akbm_in_affiliation"] else "no akbm affiliation"
            print(f"\n{pmid} [{flag}]")
            for a in e["affiliations"][:6]:
                print(f"   aff: {a[:160]}")
            if e["coi"]:
                print(f"   coi: {e['coi'][:600]}")


if __name__ == "__main__":
    main()
