# -*- coding: utf-8 -*-
"""Pre-generate AI summaries for the Aker BioMarine-affiliated PubMed studies (the ones WITHOUT a
human-verified whitepaper summary). Writes app/ai-summaries.json = { "<pmid>": {background, design,
findings, limitations} }, which Tab 1 merges in and flags "AI summary — unverified".

Idempotent: only generates summaries for PMIDs not already in the file (re-run to fill new ones).

    export ANTHROPIC_API_KEY=...   # from ../.env.local
    python scripts/gen_aker_summaries.py [--limit N]
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET
import anthropic

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

ROOT = Path(__file__).resolve().parent.parent          # deck-service/
OUT = ROOT.parent / "app" / "ai-summaries.json"        # min-forste-app/app/ai-summaries.json
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
# Keep in sync with app/studies.ts — exclude non-study publication types.
TERM = '"Aker BioMarine"[Affiliation] NOT (Published Erratum[pt] OR Editorial[pt] OR Letter[pt] OR Comment[pt])'
CURATED = {"35880828", "38776073", "27701428", "17353582"}  # have verified summaries already
MODEL = os.environ.get("DECK_MODEL", "").strip() or "claude-sonnet-5"

SCHEMA = {"type": "object", "additionalProperties": False,
          "required": ["background", "design", "findings", "limitations"],
          "properties": {k: {"type": "string", "maxLength": 700} for k in
                         ("background", "design", "findings", "limitations")}}
SYSTEM = ("You summarise a scientific paper for a krill-oil research library, in the exact style of an "
          "evidence whitepaper. Given ONLY the title + abstract, write four concise plain-language sections: "
          "background (why the study was done), design (population, n, intervention/dose, duration, design), "
          "findings (key results with any numbers the abstract states), limitations (caveats + a rough quality "
          "read: study type, size, blinding). Use ONLY facts present in the abstract — never invent numbers, "
          "doses, p-values or claims. If the abstract lacks a detail, say so briefly. Emit via emit_summary.")

# Used when AKBM supplied the paper as a PDF (assets/fulltext/). The full text carries the real
# method and results detail an abstract omits, so the summary can be specific about dose, duration,
# n per arm and the actual numbers — the whole reason for importing the PDFs.
SYSTEM_FULL = ("You summarise a scientific paper for a krill-oil research library, in the exact style of an "
               "evidence whitepaper. You are given the FULL TEXT of the paper. Write four concise "
               "plain-language sections: background (why the study was done), design (population, n per arm, "
               "intervention and exact dose, duration, blinding and randomisation), findings (the key results "
               "WITH the real numbers, including the primary endpoint and any null results), limitations "
               "(caveats the paper itself states, plus a quality read: study type, size, blinding, funding or "
               "conflicts if disclosed). Prefer the Methods and Results sections over the abstract where they "
               "disagree. Use ONLY facts present in the paper — never invent numbers, doses, p-values or "
               "claims. Report null and negative findings honestly. Keep EACH section under 600 characters — "
               "be specific but tight. Emit via emit_summary.")

# Full text imported from AKBM's PDFs by scripts/import_fulltext_pdfs.py.
FULLTEXT_DIR = ROOT / "assets" / "fulltext"
FULLTEXT_CAP = 200_000        # chars; the longest paper here is ~76k, so nothing real gets cut


def load_fulltext_index() -> dict:
    f = FULLTEXT_DIR / "index.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def read_fulltext(pmid: str) -> str | None:
    f = FULLTEXT_DIR / f"{pmid}.txt"
    if not f.exists():
        return None
    return f.read_text(encoding="utf-8")[:FULLTEXT_CAP]

def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "aker-wiki"}), timeout=30) as r:
        return r.read()

def esearch():
    u = f"{EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=60&sort=date&tool=aker-wiki&term={urllib.parse.quote(TERM)}"
    return json.loads(_get(u)).get("esearchresult", {}).get("idlist", [])

def efetch_abstracts(pmids):
    u = f"{EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&tool=aker-wiki&id={','.join(pmids)}"
    root = ET.fromstring(_get(u))
    out = {}
    for art in root.findall(".//PubmedArticle"):
        pmid = art.findtext(".//PMID")
        title = "".join(art.find(".//ArticleTitle").itertext()) if art.find(".//ArticleTitle") is not None else ""
        parts = []
        for ab in art.findall(".//Abstract/AbstractText"):
            lbl = ab.get("Label")
            txt = "".join(ab.itertext()).strip()
            parts.append((f"{lbl}: {txt}" if lbl else txt))
        out[pmid] = {"title": title.strip(), "abstract": "\n".join(parts).strip()}
    return out

def summarise(client, title, body, *, full=False):
    label = "FULL TEXT" if full else "ABSTRACT"
    msg = client.messages.create(
        model=MODEL, max_tokens=3000, system=SYSTEM_FULL if full else SYSTEM,
        tools=[{"name": "emit_summary", "description": "Emit the 4-section summary.", "input_schema": SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_summary"},
        messages=[{"role": "user", "content": f"TITLE: {title}\n\n{label}:\n{body}"}])
    for b in msg.content:
        if b.type == "tool_use" and isinstance(b.input, dict):
            return b.input
    return None

def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    # --upgrade re-summarises studies that ALREADY have an abstract-based summary but now have the
    # paper as full text. Without it the run is idempotent and would skip them forever.
    upgrade = "--upgrade" in sys.argv
    only = None
    if "--pmid" in sys.argv:
        only = sys.argv[sys.argv.index("--pmid") + 1]

    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    ft_index = load_fulltext_index()

    found = esearch()
    todo = [p for p in found if p not in CURATED and p not in existing]
    if upgrade:
        todo += [p for p in found if p not in CURATED and p in existing and p in ft_index]
    # A paper AKBM supplied that the affiliation search does not return is still worth summarising.
    todo += [p for p in ft_index if p not in CURATED and p not in found and (upgrade or p not in existing)]
    todo = list(dict.fromkeys(todo))
    if only:
        # Never let an explicit --pmid override the CURATED guard: those studies have a verified
        # human summary and must not get an AI one written over them.
        if only in CURATED:
            print(f"refusing {only}: it is a CURATED study with a verified summary")
            return
        todo = [p for p in todo if p == only] or [only]
    if limit:
        todo = todo[:limit]

    n_full = sum(1 for p in todo if p in ft_index)
    print(f"{len(todo)} studies to summarise (model {MODEL}); {n_full} from FULL TEXT, "
          f"{len(todo) - n_full} from abstract; {len(existing)} already in the file")
    if not todo:
        return
    abstracts = efetch_abstracts(todo)
    client = anthropic.Anthropic()
    done = 0
    for pmid in todo:
        info = abstracts.get(pmid) or {}
        full = read_fulltext(pmid)
        title = info.get("title") or (ft_index.get(pmid, {}).get("title") or "")
        if full:
            body, is_full = full, True
        else:
            body, is_full = info.get("abstract", ""), False
            if len(body) < 120:
                print(f"  skip {pmid} (no full text and no usable abstract)"); continue
        try:
            out = summarise(client, title, body, full=is_full)
        except Exception as e:  # noqa: BLE001
            print(f"  fail {pmid}: {e}"); continue
        missing = [k for k in ("background", "design", "findings", "limitations")
                   if not (out or {}).get(k, "").strip()]
        if out and missing:
            print(f"  fail {pmid}: incomplete summary, missing {missing} (likely hit max_tokens)")
            out = None
        if out:
            existing[pmid] = out; done += 1
            OUT.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")  # save as we go
            src = f"full text, {len(body):,} chars" if is_full else "abstract"
            print(f"  ok {pmid}  [{src}]  {title[:52]}")
        time.sleep(0.34)  # NCBI courtesy
    print(f"wrote {done} summaries -> {OUT} (total {len(existing)})")

if __name__ == "__main__":
    main()
