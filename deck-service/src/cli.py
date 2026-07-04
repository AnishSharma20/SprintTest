"""CLI: python -m src.cli generate <input.txt|.docx> [--length ...] [--tone ...] [-o out.pptx]

Reads a summary (plain text or .docx), runs the two-stage pipeline, and writes the .pptx
plus a .wording.md review doc. ANTHROPIC_API_KEY must be set in the environment.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

import anthropic

from . import pipeline


def read_summary(path: Path) -> str:
    data = path.read_bytes()
    if path.suffix.lower() == ".docx":
        import docx
        return "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    return data.decode("utf-8", errors="replace")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="src.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="Generate a deck from a summary file.")
    g.add_argument("input", type=Path)
    g.add_argument("--length", default="standard", choices=["kort", "standard", "detaljert"])
    g.add_argument("--tone", default="balansert", choices=["salg", "balansert", "vitenskap"])
    g.add_argument("--quality", default="fast", choices=["fast", "polished"],
                   help="polished adds a visual QA pass (render -> vision-check -> fix flagged slides)")
    g.add_argument("-o", "--out", type=Path, default=None)
    args = parser.parse_args(argv)

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 2
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return 2

    text = read_summary(args.input).strip()
    if not text:
        print(f"No text found in {args.input}", file=sys.stderr)
        return 2

    base = args.input.stem
    client = anthropic.Anthropic()

    def prog(pct, step):
        print(f"  [{pct:>3}%] {step}", file=sys.stderr)

    result = pipeline.generate(client, text, base, length=args.length, tone=args.tone,
                               quality=args.quality, on_progress=prog)

    out = args.out or Path(f"{base}.pptx")
    out.write_bytes(result["pptx"])
    wording = out.with_suffix(".wording.md")
    wording.write_text(result["wording_md"], encoding="utf-8")
    plan_path = out.with_suffix(".plan.json")
    plan_path.write_text(json.dumps(result["plan"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} ({result['slide_count']} slides) + {wording.name} + {plan_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
