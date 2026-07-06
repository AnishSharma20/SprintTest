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
TERM = '"Aker BioMarine"[Affiliation]'
CURATED = {"35880828", "38776073", "27701428", "17353582"}  # have verified summaries already
MODEL = os.environ.get("DECK_MODEL", "").strip() or "claude-sonnet-4-6"

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

def summarise(client, title, abstract):
    msg = client.messages.create(
        model=MODEL, max_tokens=1500, system=SYSTEM,
        tools=[{"name": "emit_summary", "description": "Emit the 4-section summary.", "input_schema": SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_summary"},
        messages=[{"role": "user", "content": f"TITLE: {title}\n\nABSTRACT:\n{abstract}"}])
    for b in msg.content:
        if b.type == "tool_use" and isinstance(b.input, dict):
            return b.input
    return None

def main():
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    existing = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    pmids = [p for p in esearch() if p not in CURATED and p not in existing]
    if limit: pmids = pmids[:limit]
    print(f"{len(pmids)} studies to summarise (model {MODEL}); {len(existing)} already done")
    if not pmids:
        return
    abstracts = efetch_abstracts(pmids)
    client = anthropic.Anthropic()
    done = 0
    for pmid in pmids:
        info = abstracts.get(pmid)
        if not info or len(info["abstract"]) < 120:
            print(f"  skip {pmid} (no usable abstract)"); continue
        try:
            s = summarise(client, info["title"], info["abstract"])
        except Exception as e:  # noqa: BLE001
            print(f"  fail {pmid}: {e}"); continue
        if s:
            existing[pmid] = s; done += 1
            OUT.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")  # save as we go
            print(f"  ✓ {pmid}  {info['title'][:60]}")
        time.sleep(0.34)  # NCBI courtesy
    print(f"wrote {done} new summaries -> {OUT} (total {len(existing)})")

if __name__ == "__main__":
    main()
