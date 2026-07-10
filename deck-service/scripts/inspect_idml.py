"""Inspect an InDesign .idml package: spreads -> pages -> text frames -> stories.

The IDML analog of inspect_template.py. An .idml is a zip of XML; text lives in
Stories/Story_*.xml as <Content> runs, layout in Spreads/Spread_*.xml. This prints every
text frame in reading order (page, then y, then x) with its story id, character count,
paragraph styles and a text preview, so a human can curate the semantic story map that
scripts/build_idml_manifest.py turns into config/idml_manifest.json.

Usage: python scripts/inspect_idml.py assets/whitepaper_template.idml
"""
from __future__ import annotations

import io
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def story_text(z: zipfile.ZipFile, sid: str) -> str:
    try:
        s = z.read(f"Stories/Story_{sid}.xml").decode("utf-8")
    except KeyError:
        return ""
    return re.sub(r"\s+", " ", " ".join(re.findall(r"<Content>([^<]*)</Content>", s))).strip()


def story_styles(z: zipfile.ZipFile, sid: str) -> str:
    try:
        s = z.read(f"Stories/Story_{sid}.xml").decode("utf-8")
    except KeyError:
        return ""
    return ",".join(sorted(set(re.findall(r'AppliedParagraphStyle="ParagraphStyle/([^"]+)"', s))))


def main(path: str) -> None:
    z = zipfile.ZipFile(path)
    dm = z.read("designmap.xml").decode("utf-8")
    spreads = re.findall(r'<idPkg:Spread src="Spreads/Spread_([^"]+)\.xml"', dm)
    print(f"=== {path} — {len(spreads)} spreads ===")

    for sp in spreads:
        root = ET.fromstring(z.read(f"Spreads/Spread_{sp}.xml"))
        pages = []
        for pg in root.iter("Page"):
            tf = [float(v) for v in pg.get("ItemTransform").split()]
            gb = [float(v) for v in pg.get("GeometricBounds").split()]  # top left bottom right
            pages.append((tf[4] + gb[1], tf[4] + gb[3]))  # spread-space x range
        rows = []
        for frame in root.iter("TextFrame"):
            sid = frame.get("ParentStory")
            it = [float(v) for v in frame.get("ItemTransform").split()]
            xs, ys = [], []
            for pp in frame.iter("PathPointType"):
                ax, ay = [float(v) for v in pp.get("Anchor").split()]
                xs.append(it[0] * ax + it[2] * ay + it[4])
                ys.append(it[1] * ax + it[3] * ay + it[5])
            if not xs:
                continue
            x, y = min(xs), min(ys)
            pgix = 0
            for i, (xmin, xmax) in enumerate(pages):
                if xmin - 1 <= x <= xmax + 1:
                    pgix = i
            rows.append((pgix, round(y), round(x), sid))
        rows.sort()
        print(f"\n--- Spread {sp} ({len(pages)} pages) ---")
        for pgix, y, x, sid in rows:
            txt = story_text(z, sid)
            print(f" p{pgix} y={y:5d} x={x:5d} {sid:8s} chars={len(txt):5d} "
                  f"[{story_styles(z, sid)[:50]}] :: {txt[:80]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/whitepaper_template.idml")
