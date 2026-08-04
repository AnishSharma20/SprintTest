# -*- coding: utf-8 -*-
"""Build the layout-review galleries: every layout the tool can produce, one slide each.

Part 1 = the code-built (synthetic) layouts. Part 2 = the template placeholder layouts.
Two files because the slide schema caps a single plan at 34 slides. Each slide carries its
layout name and when-to-use guidance in the SPEAKER NOTES, so the slides stay clean for
design review.

Every slide is schema-validated (in chunks, to respect the 34 cap) before rendering, so this
doubles as an end-to-end smoke test: if a layout's builder breaks, this fails.

    python scripts/build_gallery.py                 # -> deck-service/build/
    python scripts/build_gallery.py ~/Downloads      # -> anywhere you like

After adding or removing a layout, re-run it and update the SYNTH/TMPL lists below; the
coverage check at the end reports any layout in the catalog with no slide here.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import config, renderer, validate            # noqa: E402
from src.planner import LAYOUT_USAGE                  # noqa: E402

OUT = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else ROOT / "build"
OUT.mkdir(parents=True, exist_ok=True)

STUDIES = [
    ("2007", "Deutsch, JACN", "First RCT: krill oil cut CRP and improved WOMAC scores"),
    ("2016", "Suzuki, PLoS ONE", "2 g/day Superba eased mild knee pain in 30 days"),
    ("2022", "Stonehouse, AJCN", "4 g/day Superba eased WOMAC pain over 6 months"),
    ("2024", "KARAOKE, JAMA", "2 g/day showed no benefit in advanced knee OA"),
]

# ── Part 1: synthetic (code-built) layouts ───────────────────────────────────────
SYNTH = [
    {"layout": "exec_summary", "title": "Why phospholipid krill oil wins", "points": [
        {"heading": "Better uptake", "body": "Phospholipid omega-3 absorbs more readily.", "icon_generic": "research"},
        {"heading": "Cleaner oil", "body": "Cold processing keeps oxidation low.", "icon_generic": "quality"},
        {"heading": "Proven", "body": "Backed by 50+ human clinical trials.", "icon_generic": "proven"}]},
    {"layout": "numbered_cards", "title": "Three reasons Superba is positioned to win", "items": [
        {"heading": "The evidence is deep and human", "body": "More than 50 published human trials span heart, brain, joints and immunity.", "icon_generic": "proven"},
        {"heading": "The delivery form is the difference", "body": "Phospholipid EPA and DHA reach cell membranes more readily.", "icon_generic": "molecule"},
        {"heading": "The supply chain is ours end to end", "body": "One MSC-certified Antarctic fishery, traceable to capsule.", "icon_generic": "sourcing"}]},
    {"layout": "key_points", "title": "Four reasons Superba performs", "banner": "Purity, potency, proof and provenance", "items": [
        {"heading": "Purity", "body": "Cold-processed at sea\nLow oxidation\nNo fishy reflux", "icon_generic": "quality"},
        {"heading": "Potency", "body": "High phospholipid load\nEPA and DHA carried in\nReaches the membrane", "icon_generic": "research"},
        {"heading": "Proof", "body": "50+ human trials\nHeart, brain and joints\nPeer-reviewed", "icon_generic": "proven"},
        {"heading": "Provenance", "body": "One Antarctic fishery\nMSC-certified\nFully traceable", "icon_generic": "sustainability"}]},
    {"layout": "icon_grid", "title": "Where the evidence reaches", "banner": "Benefits documented across body systems", "items": [
        {"heading": "Heart", "body": "Lower triglycerides", "icon": "heart"},
        {"heading": "Brain", "body": "Cognitive support", "icon": "cognitive"},
        {"heading": "Joints", "body": "Less stiffness", "icon": "joint"},
        {"heading": "Skin", "body": "Better hydration", "icon": "skin"},
        {"heading": "Immunity", "body": "Immune support", "icon": "whole_body"},
        {"heading": "Liver", "body": "Fat metabolism", "icon": "liver"}]},
    {"layout": "pillars", "title": "Our value rests on three pillars", "banner": "Purity, potency and sustainability in one krill oil", "items": [
        {"heading": "Superior purity", "body": "Cold-processed within hours of harvest, so oxidation stays low.", "icon_generic": "quality"},
        {"heading": "Bioavailable omega-3", "body": "Phospholipid EPA and DHA integrate into membranes readily.", "icon_generic": "research"},
        {"heading": "Traceable sourcing", "body": "A single MSC-certified Antarctic fishery, traceable to capsule.", "icon_generic": "sustainability"}]},
    {"layout": "serpentine", "title": "Four forces are redefining health", "items": [
        {"heading": "From clinic to everywhere", "body": "Health now lives in devices and wearables.", "icon_generic": "global"},
        {"heading": "From treatment to prevention", "body": "Focus moved to preventing illness early.", "icon_generic": "safety"},
        {"heading": "From generic to personal", "body": "Pathways are profiled and personalised.", "icon_generic": "science"},
        {"heading": "From lifespan to healthspan", "body": "Living better for longer is the goal.", "icon_generic": "energy"}]},
    {"layout": "implications", "title": "Five mega trends and what they mean for us",
     "headers": ["Mega trend", "Overview", "Market implications"], "items": [
        {"heading": "Healthy ageing", "body": "Longevity is a cross-generational priority, with about 60% of consumers ranking it a top concern.", "implication": "Products that preserve muscle and support cognition"},
        {"heading": "Metabolic health", "body": "Rising obesity and GLP-1 adoption drive demand for glucose regulation.", "implication": "Blood sugar balance and weight management"},
        {"heading": "Combination formulas", "body": "Consumers move from single ingredients to formulas addressing several pathways.", "implication": "Synergistic lists and phospholipid delivery"},
        {"heading": "Cognitive wellbeing", "body": "Stress and performance demands increase focus on clarity and sleep.", "implication": "Focus, stress resilience and restorative sleep"},
        {"heading": "Science-led supply", "body": "Regulation and scrutiny push brands toward evidence-backed products.", "implication": "Third-party testing and certified chains"}]},
    {"layout": "photo_stats", "title": "The world is moving in our direction", "caption": "Three structural shifts shaping the next decade", "items": [
        {"value": "8.5B", "label": "Growing, ageing world", "note": "Global population by 2030, one in six aged 60 or over", "asset_id": "photo_breakfast"},
        {"value": "+1B", "label": "Wealthier middle class", "note": "New middle-class consumers by 2030, mostly in Asia", "asset_id": "photo_ingredients"},
        {"value": "77%", "label": "Wellness-first consumer", "note": "Want to live longer and healthier, not simply longer", "asset_id": "photo_capsules_daily"}]},
    {"layout": "stat", "title": "The evidence base, in numbers", "caption": "Published, peer-reviewed and human", "stats": [
        {"value": "50+", "label": "Human clinical trials", "note": "Across body systems"},
        {"value": "135+", "label": "Total studies", "note": "Pre-clinical and clinical"},
        {"value": "2x", "label": "Absorption vs fish oil", "note": "Phospholipid delivery"}]},
    {"layout": "kpi_dashboard", "title": "The evidence programme scoreboard", "caption": "Published human trials by area", "metrics": [
        {"value": "50+", "label": "Human trials"}, {"value": "17", "label": "Immune studies"},
        {"value": "8", "label": "Heart studies"}, {"value": "4", "label": "Skin studies"},
        {"value": "3", "label": "Joint studies"}, {"value": "2", "label": "Liver studies"}]},
    {"layout": "metric_bars", "title": "Superba outperforms on the metrics that matter", "caption": "Relative to standard fish oil, pooled trial data", "items": [
        {"label": "Omega-3 index uplift", "pct": 88, "value": "+88%"},
        {"label": "Absorption efficiency", "pct": 72, "value": "+72%"},
        {"label": "Oxidation reduction", "pct": 61, "value": "-61%"},
        {"label": "Consumer preference", "pct": 54, "value": "54%"}]},
    {"layout": "breakdown", "title": "Two products drive three quarters of sales", "total": "$137M", "caption": "Last 12 months of sales", "items": [
        {"label": "Superba 2", "pct": 42.9}, {"label": "Superba Boost", "pct": 32.7},
        {"label": "Rest of our products", "pct": 16.4}, {"label": "QHP", "pct": 8.0}]},
    {"layout": "chart", "title": "Superba raises the omega-3 index faster", "caption": "Omega-3 index over 12 weeks vs standard fish oil",
     "chart_type": "line", "x_axis": "Week", "y_axis": "Omega-3 index (%)", "categories": ["0", "4", "8", "12"],
     "series": [{"name": "Superba", "values": [4.2, 6.1, 7.8, 8.9]}, {"name": "Fish oil", "values": [4.2, 5.0, 5.8, 6.4]}]},
    {"layout": "chart_bands", "title": "Sales dipped, recovered, and are set to double", "caption": "Total sales by year, with the plan in three phases",
     "y_axis": "Total sales (USD m)",
     "categories": ["2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026","2027","2028","2029"],
     "values": [50,60,75,96,101,71,55,79,87,110,128,152,175,200],
     "bands": [{"label": "Road to $100M", "start": 1, "end": 4}, {"label": "Turnaround", "start": 5, "end": 10},
               {"label": "Road to $200M", "start": 11, "end": 14}]},
    {"layout": "chart_takeaways", "title": "Gut health is the largest combined opportunity",
     "headers": ["Market size (USD bn by 2030)", "Key takeaways"],
     "x_axis": "CAGR 2025 to 2030 (%)", "y_axis": "Expected revenue 2030 (USD bn)", "bubbles": [
        {"label": "Probiotics", "x": 7.1, "y": 14.7, "size": 14.7}, {"label": "Prebiotics", "x": 14.6, "y": 8.0, "size": 8.0},
        {"label": "Magnesium", "x": 7.4, "y": 6.8, "size": 6.8}, {"label": "Creatine", "x": 26.2, "y": 4.4, "size": 4.4},
        {"label": "Collagen", "x": 5.5, "y": 3.2, "size": 3.2}, {"label": "Vitamin K2", "x": 13.5, "y": 0.6, "size": 0.6}],
     "takeaways": ["Probiotics and prebiotics together reach about 22.7 bn by 2030.",
                   "Creatine grows fastest at 26.2% CAGR from a smaller base.",
                   "Magnesium is a large category with consistent growth."],
     "bottom_note": "Sources: Grand View Research, Market Reports World, Aker BioMarine analysis"},
    {"layout": "matrix", "title": "Superba sits where absorption meets breadth",
     "x_axis": "Nutrient breadth", "y_axis": "Absorption", "quadrants": [
        {"heading": "Niche actives", "body": "High uptake, single nutrient"},
        {"heading": "Superba", "body": "High uptake and multi-nutrient"},
        {"heading": "Basic fish oil", "body": "Lower uptake, narrow"},
        {"heading": "Blended oils", "body": "Broad but poorly absorbed"}]},
    {"layout": "coverage_matrix", "title": "Our portfolio is a match for healthy ageing", "caption": "Where each product delivers a documented benefit",
     "headers": ["Cellular", "Cardio", "Brain", "Metabolic", "Mobility", "Immune", "Eye", "Sleep"], "items": [
        {"label": "Superba Krill", "body": "Krill oil for broad human health.", "marks": [True,True,True,True,True,True,True,False]},
        {"label": "Revervia", "body": "Vegan algae DHA for brain and eye.", "marks": [True,True,True,False,False,False,True,False]},
        {"label": "Lysoveta", "body": "Targeted brain and eye delivery.", "marks": [True,False,True,False,False,False,True,False]},
        {"label": "PL+ Technology", "body": "Absorption booster across formulas.", "marks": [True,True,True,True,True,True,True,True]}]},
    {"layout": "harvey_ball", "title": "How the options compare on quality", "options": ["Superba", "Fish oil", "Algal"], "criteria": [
        {"label": "Evidence strength", "scores": [4,3,2]}, {"label": "Absorption", "scores": [4,2,3]},
        {"label": "Sustainability", "scores": [4,2,3]}, {"label": "Purity", "scores": [4,2,3]}]},
    {"layout": "comparison", "title": "Krill oil versus fish oil, side by side",
     "headers": ["Attribute", "Superba krill", "Fish oil"], "rows": [
        {"cells": ["Carrier", "Phospholipid", "Triglyceride"]},
        {"cells": ["Omega-3 index uplift", "+88%", "+40%"]},
        {"cells": ["Antioxidant", "Astaxanthin", "None"]},
        {"cells": ["Aftertaste", "Minimal", "Common"]}]},
    {"layout": "cause_effect", "title": "Why phospholipid delivery changes the outcome", "items": [
        {"heading": "Phospholipid carrier", "body": "EPA and DHA are water-dispersible, so uptake begins in the gut."},
        {"heading": "Membrane integration", "body": "Fatty acids embed into cell membranes, raising the index faster."},
        {"heading": "Lower dose needed", "body": "Comparable benefit at a smaller daily dose than fish oil."}]},
    {"layout": "cycle", "title": "Quality is a continuous loop, not a checkpoint", "center": "Superba QA", "items": [
        {"heading": "Harvest"}, {"heading": "Cold process"}, {"heading": "Test purity"},
        {"heading": "Encapsulate"}, {"heading": "Batch release"}]},
    {"layout": "funnel", "title": "From candidates to proven claims", "stages": [
        {"heading": "200 compounds screened", "body": "Initial library"},
        {"heading": "40 into pre-clinical", "body": "Mechanistic work"},
        {"heading": "12 into human trials", "body": "Clinical testing"},
        {"heading": "5 approved claims", "body": "Regulatory sign-off"}]},
    {"layout": "from_to", "title": "The shift Superba enables",
     "before": {"heading": "Generic fish oil", "body": "Lower absorption, fishy reflux, thin evidence base."},
     "after": {"heading": "Superba krill", "body": "High absorption, clean intake, more than 50 human trials."}},
    {"layout": "roadmap", "title": "The research roadmap ahead", "phases": [
        {"date": "Q1", "heading": "Design", "body": "Finalise endpoints and protocol"},
        {"date": "Q2", "heading": "Recruit", "body": "Enrol the study cohort"},
        {"date": "Q3", "heading": "Run", "body": "Dosing and measurement"},
        {"date": "Q4", "heading": "Publish", "body": "Peer-reviewed results"}]},
    {"layout": "gantt", "title": "The clinical study runs across four quarters", "caption": "Superba cardiovascular RCT, 2026 plan",
     "periods": ["Q1", "Q2", "Q3", "Q4"], "items": [
        {"label": "Protocol and ethics", "start": 1, "end": 1, "note": "Design"},
        {"label": "Recruitment", "start": 1, "end": 2, "note": "Enrol n=300"},
        {"label": "Dosing period", "start": 2, "end": 3, "note": "12 weeks"},
        {"label": "Data lock", "start": 3, "milestone": True},
        {"label": "Analysis", "start": 3, "end": 4, "note": "Endpoints"},
        {"label": "Publication", "start": 4, "milestone": True}]},
    {"layout": "org_chart", "title": "How the evidence programme is organised", "center": "Chief Scientific Officer", "items": [
        {"heading": "Clinical", "body": "Human trials and endpoint analysis."},
        {"heading": "Preclinical", "body": "Mechanistic and safety studies."},
        {"heading": "Regulatory", "body": "Claim dossiers and compliance."}]},
    {"layout": "decision_tree", "title": "Which product grade fits the application", "center": "What is the primary need?", "items": [
        {"heading": "Maximum potency", "body": "Route to Superba Boost, the highest phospholipid grade."},
        {"heading": "Balanced value", "body": "Route to Superba 2, the standard clinical-grade oil."},
        {"heading": "Cost sensitivity", "body": "Route to the blended krill formulation."}]},
    {"layout": "team", "title": "The science team behind the evidence", "items": [
        {"name": "Head of Clinical Research", "role": "Clinical programme", "bio": "Leads the human trial programme across cardiovascular and metabolic endpoints."},
        {"name": "Lipid Biochemistry Lead", "role": "Mechanism", "bio": "Specialist in phospholipid delivery and membrane incorporation."},
        {"name": "Regulatory Affairs Lead", "role": "Compliance", "bio": "Owns health-claim dossiers and global compliance."}]},
    {"layout": "takeaways", "title": "What this means", "items": [
        {"heading": "Superba absorbs better than standard fish oil.", "body": "Phospholipid delivery is the mechanism."},
        {"heading": "The proof base is deep, human and growing.", "body": "More than 50 clinical trials across body systems."},
        {"heading": "The supply chain is clean and traceable.", "body": "One certified Antarctic fishery, end to end."}]},
    {"layout": "ingredient"},
    {"layout": "closing", "title": "Let us build the evidence together",
     "tagline": "Superba krill oil by Aker BioMarine", "contact": "science@akerbiomarine.com"},
]

# ── Part 2: the template's own placeholder layouts ────────────────────────────────
TMPL = [
    {"layout": "section", "title": "The evidence base"},
    {"layout": "agenda", "title": "Agenda", "items": [
        "Why the form matters", "What the trials show",
        "Portfolio and needs", "Where research goes next"]},
    {"layout": "highlight", "title": "Phospholipid delivery is what sets krill oil apart"},
    {"layout": "title_only", "title": "A decade of building the evidence"},
    {"layout": "text", "title": "Krill oil delivers omega-3 in the phospholipid form",
     "body": ("Phospholipid-bound EPA and DHA are water-dispersible, so uptake begins in the gut.\n"
              "Fatty acids embed directly into cell membranes, raising the omega-3 index faster.\n"
              "Comparable benefit is reached at a smaller daily dose than triglyceride fish oil.\n"
              "More than 50 published human clinical trials span heart, brain, joints and immunity.")},
    {"layout": "two_columns", "title": "Two delivery forms, two outcomes", "columns": [
        {"heading": "Phospholipid", "body": "Water-dispersible, so absorption starts in the gut without emulsification. EPA and DHA embed into cell membranes, which raises the omega-3 index faster and at a smaller dose."},
        {"heading": "Triglyceride", "body": "Needs bile emulsification before uptake, so absorption is slower and more variable. A larger daily dose is needed to reach a comparable omega-3 index."}]},
    {"layout": "three_columns", "title": "Three pillars of the proposition", "columns": [
        {"heading": "Purity", "body": "Cold-processed within hours of harvest, so oxidation stays low and the oil arrives clean and neutral in taste."},
        {"heading": "Potency", "body": "A high phospholipid load carries EPA and DHA into cell membranes more readily than triglyceride oil does."},
        {"heading": "Provenance", "body": "One MSC-certified Antarctic fishery, fully traceable from the catch through to the finished capsule."}]},
    {"layout": "four_columns", "title": "Four documented benefit areas", "columns": [
        {"heading": "Heart", "body": "Lower triglycerides and a higher omega-3 index across several randomised controlled trials."},
        {"heading": "Brain", "body": "Support for cognitive function and markers of membrane fluidity in older adults."},
        {"heading": "Joints", "body": "Reduced WOMAC pain and stiffness scores over three to six months of daily dosing."},
        {"heading": "Immunity", "body": "Lower inflammatory markers, including CRP, and support for normal immune function."}]},
    {"layout": "text_with_picture", "title": "Cold-processed within hours of harvest",
     "body": ("Oxidation is kept low from the moment of catch.\n"
              "The oil arrives clean, neutral and stable.\n"
              "No fishy reflux at the recommended dose."),
     "asset_id": "photo_capsules_white"},
    {"layout": "picture_full", "title": "Superba krill oil", "asset_id": "photo_capsules_daily"},
]


def notes_for(layout: str) -> str:
    usage = LAYOUT_USAGE.get(layout, "")
    return f"LAYOUT: {layout}\n\nWhen to use it:\n{usage}"[:1400]


def build(name: str, slides: list[dict], cover: dict) -> None:
    full = [cover] + slides
    for s in full:
        s.setdefault("speaker_notes", notes_for(s["layout"]))
    # The schema caps a plan at 34 slides; validate in chunks so every slide is still checked,
    # then render the whole list (the renderer has no such cap).
    cat = config.catalog()
    for i in range(0, len(full), 30):
        chunk = full[i:i + 30]
        while len(chunk) < 3:
            chunk = chunk + [cover]
        errs = validate.validate_plan({"deck_title": name, "language": "en", "slides": chunk})
        if errs:
            print(f"  VALIDATION ERRORS in {name} chunk at {i}:")
            for e in errs[:12]:
                print("   -", e)
            sys.exit(1)
    data = renderer.render_deck({"deck_title": name, "language": "en", "slides": full})
    out = OUT / f"{name}.pptx"
    out.write_bytes(data)
    print(f"  WROTE {out.name}  ({len(full)} plan slides, {len({s['layout'] for s in full})} distinct layouts)")


build("Superba_layouts_1_kodebygde",
      SYNTH,
      {"layout": "title", "title": "Superba layouts, part 1",
       "subtitle": "All 32 code-built slide types"})

build("Superba_layouts_2_maloppsett",
      TMPL,
      {"layout": "title", "title": "Superba layouts, part 2",
       "subtitle": "The template placeholder types"})

print("\nlayout coverage check:")
covered = {s["layout"] for s in SYNTH} | {s["layout"] for s in TMPL} | {"title"}
allk = set(config.catalog())
print("  covered:", len(covered), "of", len(allk))
missing = sorted(allk - covered)
print("  missing:", missing or "none")
