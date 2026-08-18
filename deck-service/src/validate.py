"""Hard schema validation — the enforcement layer the API's tool-use does NOT give us.

The Anthropic tool `input_schema` guides the model (it reads maxLength / required / the
layout enum), but non-strict tool use does no server-side validation, and strict mode
strips string-length constraints. So the char limits that prevent overflow are enforced
HERE with jsonschema before anything is rendered. A non-empty error list drives the
planner's one self-correction retry (spec Step 5); if it's still non-empty, the pipeline
fails loudly rather than rendering a broken deck.
"""
from __future__ import annotations

import re
import sys

import jsonschema

from . import config

# Fixed-purpose slides: their layout is dictated by their ROLE (cover, contents, divider,
# closing beat), not chosen for the shape of a point, so they don't count toward "use the
# fuller synthetic catalog" variety — including them would let a deck satisfy the minimum
# on structural slides alone while the actual content stayed on text/two_columns throughout.
_STRUCTURAL_LAYOUTS = {"title", "agenda", "section", "highlight", "title_only", "closing", "ingredient",
                       "exec_summary"}


def _coverage_warnings(plan: dict, photo_level: str = "default") -> list[str]:
    """Soft nudges (never block generation) for two house-style preferences that are easy
    for the model to under-deliver on despite prompt guidance: reaching for the 31-layout
    synthetic catalog instead of repeating text/two_columns/key_points, and actually using
    the photo library rather than leaving asset_id off by default. Thresholds scale with the
    plan's OWN slide count (not the requested length) so a shorter-than-asked deck is judged
    fairly. Tagged VARIETY:/PHOTOS: so the pipeline's retry-then-warn split never raises on
    these — a deck that still falls short after one revision ships anyway."""
    slides = plan.get("slides", [])
    total = len(slides)
    if total < 3:
        return []

    warnings: list[str] = []

    content = [s for s in slides if s.get("layout") not in _STRUCTURAL_LAYOUTS]
    distinct = {s.get("layout") for s in content}
    min_layouts = min(len(content), max(3, total // 2))
    if content and len(distinct) < min_layouts:
        warnings.append(
            f"VARIETY: only {len(distinct)} distinct layout(s) used across the {len(content)} content "
            f"slides ({', '.join(sorted(distinct))}) — the catalog has 31 code-built layouts beyond "
            f"text/two_columns/three_columns/four_columns/key_points (chart, matrix, comparison, pillars, "
            f"cycle, roadmap, numbered_cards, icon_grid, cause_effect, breakdown, coverage_matrix, "
            f"metric_bars, takeaways, from_to, org_chart, decision_tree, gantt, team, kpi_dashboard, "
            f"implications, chart_bands, chart_takeaways, serpentine, funnel...). Rework some content "
            f"slides onto a structural layout that matches their shape so at least {min_layouts} distinct "
            f"layouts are used.")

    photo_slides = sum(1 for s in slides if s.get("asset_id"))
    # Scaled by the About page's photo density level — same formula the planner prompt uses.
    from .planner import photo_minimum
    min_photos = photo_minimum(total, photo_level)
    if photo_slides < min_photos:
        warnings.append(
            f"PHOTOS: only {photo_slides} slide(s) use a photo (asset_id) out of {total} — the photo "
            f"library (krill in the wild, Antarctic ocean/ice, product close-ups, lab and sourcing shots, "
            f"the team) is under-used. Add asset_id to at least {min_photos} slides total: use "
            f"text_with_picture or picture_full for a couple of breather beats, and set asset_id on a "
            f"photo_stats slide rather than leaving it off.")

    return warnings


# Slides that are spliced in verbatim (fixed AKBM slides and the team's own uploads) are emitted
# as bare {"layout": key} by contract — they are the only slides allowed to skip speaker notes.
def _needs_notes(slide: dict) -> bool:
    layout = slide.get("layout") or ""
    return layout != "ingredient" and not layout.startswith("custom_")


def _notes_warnings(plan: dict) -> list[str]:
    """Soft nudge: every generated slide must carry presenter-ready speaker_notes (a house
    requirement — the deck doubles as a talk script). Tagged NOTES: so the pipeline's
    retry-then-warn split never hard-fails a deck over it, and pipeline._ensure_notes backstops
    any slide still missing one after the retry."""
    missing = [f"slides/{i} ({s.get('layout')}: \"{(s.get('title') or '')[:60]}\")"
               for i, s in enumerate(plan.get("slides", []))
               if _needs_notes(s) and not (s.get("speaker_notes") or "").strip()]
    if not missing:
        return []
    return [f"NOTES: {len(missing)} slide(s) have no `speaker_notes`. Every slide needs a presenter "
            f"script (3 to 6 spoken sentences: takeaway, walk-through, supporting detail, bridge to "
            f"the next slide). Missing on: " + "; ".join(missing)]


# ---------------------------------------------------------------------------
# Numeric grounding — is every figure on the deck actually IN the source?
#
# CLAIM FIDELITY has always been prompt-only: an instruction, with nothing checking it. Measured on
# a real client deck, the model wrote an age range of "40 to 75" where the paper says 40 to 65, a
# WOMAC pain p value of 0.030 where the paper says 0.04, and a stiffness p value of 0.001 that
# appears nowhere (the paper's table says 0.02). All three were in the source and came out wrong, so
# no amount of better sourcing fixes them — only a check does.
#
# Deliberately SOFT (tagged NUMBERS:, so pipeline's split never hard-fails a deck over it), because
# CLAIM_RULES explicitly PERMITS reframing a true figure into a correct equivalent ("+3.2 points"
# from 4.9% to 8.1%), and a derived figure legitimately appears nowhere in the source. A hard failure
# would ban allowed arithmetic; a warning plus one repair round asks the model to justify or fix it.
#
# Fields whose value is an enum, an id or a tag the model picks rather than prose it wrote — a digit
# inside one of these is a layout name or an asset id, never a claim. `source_quote` is excluded
# because it is checked separately, and verbatim.
_NON_PROSE_KEYS = {"layout", "background", "asset_id", "icon", "icon_generic", "chart_type",
                   "language", "benefit", "source_quote"}

# A bare numeral, with thousands separators tolerated (1,288 / 1 288 / 1288 all read as 1288).
_NUMERAL = re.compile(r"(?<![\w.])(\d{1,3}(?:[,   ]\d{3})+|\d+(?:\.\d+)?)(?![\w])")

# What the numeral is attached to decides whether it is a CLAIM or furniture. A bare small integer
# is almost always structural ("3 reasons", "6 months", "week 12"), so it is only checked when a
# unit or a statistical marker makes it a real measurement.
_UNIT_AFTER = re.compile(r"\A\s*(%|/\s*\d{1,3}\b|mg\b|mcg\b|µg\b|kg\b|g\b|ml\b|points?\b|pp\b|"
                         r"fold\b|x\b)", re.I)
_STAT_BEFORE = re.compile(r"(p\s*[=<>]|n\s*=|d\s*=|r\s*=|ci\b|or\b|rr\b|hr\b|odds ratio|"
                          r"rate ratio|risk ratio|hazard ratio|mean|median|sd\b|se\b)\s*$", re.I)
# "40 to 75", "4 to 8", "6-8", "between 4 and 8" — a range is a single claim, and its ENDPOINTS can
# each appear in the source while the PAIR does not. That is exactly the 40-to-75 case (40 is in the
# paper, 75 is not) and the 4-to-8 case (both are, as a different pair).
_RANGE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:to|and|[–—-])\s*(\d+(?:\.\d+)?)", re.I)

_SMALL_INT_CEILING = 12   # below this, a bare integer needs a unit or a stat marker to be checked

# P values get their own TYPED check, compared only against the p values in the source rather than
# against every numeral in it. The reason is a real dilution effect, measured: a bare numeral scan
# over a 2k-char abstract catches an invented p of 0.030, but over the same paper's 76k-char full
# text the digits 0.03 turn up incidentally somewhere and it stops being flagged. Comparing p
# against p keeps the check just as sharp on a long source, and a p value is both the figure this
# deck type cites most and the one a reader trusts most on sight.
_PVALUE = re.compile(r"\bp\s*[=<>≤≥]\s*(\d*\.\d+)", re.I)


def _canon(raw: str) -> str | None:
    """A numeral's canonical form, so 1,288 == 1288 and 0.030 == 0.03 but 0.030 != 0.04."""
    cleaned = re.sub(r"[,   ]", "", raw)
    try:
        val = float(cleaned)
    except ValueError:
        return None
    return repr(int(val)) if val == int(val) else repr(val)


def _pvalues(text: str) -> set[str]:
    """Canonical p values stated in `text` (see _PVALUE)."""
    return {c for m in _PVALUE.finditer(text) if (c := _canon(m.group(1)))}


# Journals punctuate a confidence interval with a COMMA ("95% CI: 0.41, 0.84") while a deck spells
# it out ("95% CI 0.41 to 0.84"). Accepted on the SOURCE side only, so a correctly quoted CI stops
# being flagged on every deck; the plan side stays strict, since being permissive about what the
# source ALLOWS can only remove false positives.
#
# The second number sits in a LOOKAHEAD so a match does not consume it. Without that, finditer's
# non-overlapping scan over "n = 235, 40-65 y old" pairs (235, 40), swallows the 40, and the real
# (40, 65) range is never formed — which flagged the CORRECT age range as ungrounded. Caught by the
# false-positive regression test, not by reading the regex.
_SOURCE_PAIR = re.compile(r"(\d+(?:\.\d+)?)\s*(?:to|and|[,;–—-])\s*(?=(-?\d+(?:\.\d+)?))", re.I)


_ROUND_MAX_DP = 4       # source values are pre-rounded to 0..4 decimal places


def _decimals(raw: str) -> int:
    return len(raw.split(".")[1]) if "." in raw else 0


def _source_numbers(source_text: str) -> tuple[set[str], set[tuple[str, str]], dict[int, set[str]]]:
    """Source numerals, adjacent numeric PAIRS, and the numerals pre-ROUNDED to 0..4 decimals.

    The rounded sets exist because a deck legitimately rounds what a paper reports to more figures,
    and exact matching called that an invented number. Measured on a real deck: the paper says an
    adipocyte area of 5063.1 and a p value of 0.2690, the deck correctly wrote 5063 and 0.27, and
    all of it was flagged. Rounding is the normal way to put a paper's figure on a slide, so a plan
    number counts as grounded when a source number rounds to it AT THE PLAN'S OWN PRECISION. That
    keeps the real catches: 0.030 against a source 0.04 still fails at 3 decimals, and a 75 that
    appears nowhere still fails at 0."""
    singles: set[str] = set()
    values: list[float] = []
    for m in _NUMERAL.finditer(source_text):
        raw = m.group(1)
        if (c := _canon(raw)) is None:
            continue
        singles.add(c)
        try:
            values.append(float(re.sub(r"[,  ]", "", raw)))
        except ValueError:
            pass
    rounded = {d: {_canon(f"{round(v, d):.{d}f}") for v in values} for d in range(_ROUND_MAX_DP + 1)}
    rounded = {d: {c for c in s if c is not None} for d, s in rounded.items()}
    pairs = set()
    for m in _SOURCE_PAIR.finditer(source_text):
        a, b = _canon(m.group(1).lstrip("-")), _canon(m.group(2).lstrip("-"))
        if a and b:
            pairs.add((a, b))
    return singles, pairs, rounded


def _prose_strings(node, key: str | None = None) -> list[str]:
    """Every model-written string in a slide, enum/id fields excluded."""
    if isinstance(node, str):
        return [] if key in _NON_PROSE_KEYS else [node]
    if isinstance(node, dict):
        out = []
        for k, v in node.items():
            out.extend([] if k in _NON_PROSE_KEYS else _prose_strings(v, k))
        return out
    if isinstance(node, list):
        out = []
        for v in node:
            out.extend(_prose_strings(v, key))
        return out
    return []


def _checkable(text: str) -> list[str]:
    """(as written, canonical) for each numeral in `text` that reads as a real measurement.

    The raw form is carried so a warning names the figure exactly as the slide spells it: a model
    told to fix "0.03" cannot find the "0.030" it actually wrote."""
    found = []
    for m in _NUMERAL.finditer(text):
        raw = m.group(1)
        canon = _canon(raw)
        if canon is None:
            continue
        is_decimal = "." in raw
        big = abs(float(re.sub(r"[,   ]", "", raw))) > _SMALL_INT_CEILING
        united = bool(_UNIT_AFTER.match(text[m.end():m.end() + 12]))
        statted = bool(_STAT_BEFORE.search(text[max(0, m.start() - 14):m.start()]))
        if is_decimal or big or united or statted:
            found.append((raw, canon))
    return found


def _measured_ranges(text: str) -> list[tuple[str, str, str]]:
    """(low, high, as written) for each range in `text` that reads as a measurement.

    A bare small-integer range is furniture ("3 to 6 sentences", "2 to 4 markets"), so a range only
    counts here when a decimal, a trailing unit, or a value above the small-integer ceiling makes it
    a real quantity. Its endpoints are still covered individually by _checkable."""
    out = []
    for m in _RANGE.finditer(text):
        low, high = _canon(m.group(1)), _canon(m.group(2))
        if not (low and high):
            continue
        # "...0, 0.5, 1, 2, 4, 8, 12 and 24 hours" is an ENUMERATION, and its last two items are not
        # a range. Measured on a real deck: that exact blood-sampling schedule was flagged as an
        # ungrounded "12 to 24" range. A comma-separated numeral immediately before the match is the
        # tell, and a genuine range ("between 4 and 8 cm") never has one.
        if re.search(r"\d\s*,\s*$", text[:m.start()]):
            continue
        if not ("." in m.group(1) + m.group(2)
                or max(float(m.group(1)), float(m.group(2))) > _SMALL_INT_CEILING
                or _UNIT_AFTER.match(text[m.end():m.end() + 12])):
            continue
        out.append((low, high, m.group(0).strip()))
    return out


def _number_warnings(plan: dict, source_text: str | None) -> list[str]:
    """Soft nudge: flag figures on the deck that do not appear in the source at all.

    Skipped entirely without a source (build_gallery.py and the design preview validate synthetic
    plans against no source; flagging every number there would be pure noise)."""
    if not (source_text or "").strip():
        return []
    src_singles, src_pairs, src_rounded = _source_numbers(source_text)
    if not src_singles:
        return []      # a source with no numbers at all cannot ground anything; stay quiet
    src_pvalues = _pvalues(source_text)

    def grounded(raw: str, canon: str) -> bool:
        """Exact, or a source value that rounds to it at the plan's own precision."""
        return canon in src_singles or canon in src_rounded.get(
            min(_decimals(raw), _ROUND_MAX_DP), ())

    ungrounded: list[str] = []
    for i, slide in enumerate(plan.get("slides", [])):
        if not isinstance(slide, dict):
            continue
        where = f"slides/{i} ({slide.get('layout')})"
        bad: list[str] = []
        for text in _prose_strings(slide):
            # Ranges first: a flagged range already names both its endpoints, so reporting them
            # again individually would just triple the noise for one mistake.
            spoken_for: set[str] = set()
            for low, high, raw in _measured_ranges(text):
                spoken_for.update((low, high))
                if (low, high) not in src_pairs and f'"{raw}"' not in bad:
                    bad.append(f'"{raw}"')
            # P values, compared against the source's own p values first (see _PVALUE), then
            # falling back to any bare numeral in the source.
            #
            # The fallback is REQUIRED, not a softening. A journal reports exact per-outcome p values
            # as bare TABLE COLUMNS ("-6.45 (-12.1, -0.9) 0.02"), with no "P =" to key on, and those
            # tables are the whole reason full text is sent. Measured on a real generation: without
            # the fallback this flagged the CORRECT stiffness P=0.02 and function P=0.047 straight
            # out of Stonehouse's Table 3 — so the repair round would have been told to delete
            # accurate values, which is worse than the error it was built to catch. Catching a real
            # number attached to the wrong outcome is source_quote's job, not this scan's.
            for m in _PVALUE.finditer(text):
                raw_p = m.group(1)
                canon = _canon(raw_p)
                label = f'"{m.group(0).strip()}"'
                if canon and canon not in src_pvalues and not grounded(raw_p, canon) \
                        and label not in bad:
                    bad.append(label)
                if canon:
                    spoken_for.add(canon)
            for raw, canon in _checkable(text):
                if canon in spoken_for or grounded(raw, canon) or raw in bad:
                    continue
                bad.append(raw)
        if bad:
            ungrounded.append(f"{where}: " + ", ".join(bad))
    if not ungrounded:
        return []
    shown, extra = ungrounded[:8], len(ungrounded) - 8
    return [f"NUMBERS: {len(ungrounded)} slide(s) state a figure that does not appear anywhere in "
            f"the source. Either correct it to the source's own value, or drop it. If it is a "
            f"CORRECT figure you derived from the source (a difference, a relative change), keep it "
            f"and put the numbers it came from in that slide's `source_quote`. "
            + "; ".join(shown) + (f"; and {extra} more slide(s)" if extra > 0 else "")]


# ---------------------------------------------------------------------------
# Claim STRENGTH — is the deck saying something stronger than the source does?
#
# The numeric checks above verify figures. They are blind to the other way a deck goes wrong, and
# every error found in the second real deck was of this second kind, with no figure involved:
#   "No serious adverse events occurred in any of the three trials"  (Stonehouse reports 4 SAEs)
#   "a clinically meaningful incremental benefit"                    (the paper says "modest", and
#                                                                     reports the effect BELOW MCII)
#   "This is the first study to show these benefits"                 (that paper claims no priority;
#                                                                     the word "first" never appears)
# These are safety, efficacy-strength and priority claims — precisely the ones a regulator or a
# competitor challenges, and the ones a reviewer who already believes the deck will read straight
# past. Checkable because each has a small, closed vocabulary.
#
# Same contract as NUMBERS: tagged OVERSTATEMENT:, soft, with its own repair bucket. Verbatim
# slides are exempt (they carry pre-approved AKBM copy the model never wrote).
_SAFETY_ABSOLUTE = re.compile(
    r"\b(no (serious )?(adverse events?|side effects?|safety (concerns?|signals?|issues?))"
    r"|zero adverse|without (any )?side effects?|completely safe|entirely safe"
    r"|no safety (concerns?|signals?|issues?))\b", re.I)
# Reporting adverse-event COUNTS is normal and is NOT a contradiction — measured against the real
# papers: Tamargo reports "controls: 58; the krill oil group: 34" adverse events in the same breath
# as "No serious adverse events occurred in either group". So only a nonzero count of SERIOUS events
# contradicts a no-serious-events claim, and the two must be compared like with like.
_SAE_NONZERO = re.compile(r"\b([1-9]\d*)\s+(SAEs?|serious adverse events?)\b", re.I)
_AE_NONZERO = re.compile(r"\b([1-9]\d*)\s+(AEs?|adverse events?)\b", re.I)
_AE_ABSENT_IN_SOURCE = re.compile(
    r"\bno (serious )?(adverse events?|SAEs?)\b|\b(SAEs?|adverse events?) (were|was) not (reported|observed)",
    re.I)
# A claim spanning every trial is the dangerous shape: one paper's clean safety statement cannot
# carry it, and this is exactly the error that shipped ("in any of the three trials").
_UNIVERSAL_SCOPE = re.compile(
    r"\b(any|all|each|every|none) of the (three|3|studies|trials)\b|\ball (three|3) (trials|studies)\b"
    r"|\bevery (trial|study)\b|\bacross (all|the) (three|3|trials|studies)\b|\bin any trial\b", re.I)

_CLINICAL_STRENGTH = re.compile(r"\bclinical(ly)?\s+(meaningful|significant|important|relevant)\b"
                                r"|\bclinical (significance|importance|relevance)\b", re.I)
# What the source says when it is being modest about the same result.
_MODEST_IN_SOURCE = re.compile(r"\bmodest\b|\bbelow the (suggested )?MCII\b|\bMCII\b"
                               r"|\bunlikely to be of clinical relevance\b|\bsmall (effect|difference)\b",
                               re.I)

# Priority/superlative claims, grouped by meaning: a claim only counts as supported when the SOURCE
# makes a claim from the SAME group. Stonehouse says "largest, longest, and highest-dose study" but
# never "first", so a "first study" claim is unsupported even though the source is full of
# superlatives — which is exactly the error that shipped.
# The SOURCE side must match a priority CLAIM, never the bare superlative. A paper 76k characters
# long contains "first" in a dozen innocent senses ("the first visit", "first 3 months"), so a bare
# word test passes on every source and the check silently never fires — measured: it let the real
# "first study to show" error straight through. Hence the windowed forms below, which require the
# superlative to be attached to a study noun, and which still match a compound claim like
# Stonehouse's "the largest, longest, and highest-dose study".
_PRIORITY_GROUPS: dict[str, tuple[re.Pattern, re.Pattern]] = {
    "first / novel": (
        re.compile(r"\b(the )?first (study|trial|RCT|randomi[sz]ed|to (show|demonstrate|report|prove))"
                   r"|\bfirst[- ]ever\b|\bnovel (finding|study|trial)\b", re.I),
        re.compile(r"\bfirst[^.]{0,60}(study|trial|RCT|to show|to demonstrate|to report)"
                   r"|\bfirst[- ]ever\b|\bto our knowledge\b|\bnot previously\b|\bno previous\b"
                   r"|\bnovel (finding|study|trial)\b", re.I)),
    "largest": (re.compile(r"\b(the )?largest\b|\bbiggest\b", re.I),
                re.compile(r"\b(largest|biggest)[^.]{0,60}(study|trial|RCT|sample|cohort)", re.I)),
    "longest": (re.compile(r"\b(the )?longest\b", re.I),
                re.compile(r"\blongest[^.]{0,60}(study|trial|RCT|duration)", re.I)),
    "highest": (re.compile(r"\bhighest([- ]dose)?\b", re.I),
                re.compile(r"\bhighest[- ]?dos(e|age)|\bhighest[^.]{0,60}(study|trial|dose)", re.I)),
    "only / unique": (re.compile(r"\b(the )?only (study|trial|ingredient|product)\b|\bunique(ly)?\b"
                                 r"|\bunprecedented\b|\bno other (study|trial|ingredient)\b", re.I),
                      re.compile(r"\bonly[^.]{0,40}(study|trial)|\bunique\b|\bunprecedented\b", re.I)),
}

# Multiplier / fold claims, checked the same way as priority claims: the source must state the SAME
# ratio. Added after one shipped in a slide TITLE — "Krill oil nearly tripled the Omega 3 Index gain
# versus placebo", where the slide's own subtitle gave krill 6.0% to 8.9% against placebo 5.5% to
# 5.4%. Krill gained 3.0 points and placebo LOST 0.1, so there is no multiple at all; the paper's
# real figure is a between-group difference of 3.22 percentage POINTS, which is what got read as
# "3x". Invisible to both other checks: the numeric scan only sees numerals, and a multiplier is a
# word, so a deck can restate a difference as a ratio and nothing notices.
#
# A ratio the source really states passes ("more than double the MCII benchmark" is Stonehouse's own
# comparison). Frequencies are excluded — "twice daily" is a dose, not a claim.
_FREQUENCY_AFTER = re.compile(r"\A\s*(daily|a day|per day|weekly|a week|per week|monthly|"
                              r"a month|per month|/d\b|/day\b|in each|per (hand|leg|limb|site))", re.I)

# The source side needs the ratio inside a COMPARISON, never the bare word — the same lesson the
# priority groups taught, and it bit again here. The only "three times" anywhere in these three
# papers is "Grip strength was measured three times in each hand", a measurement repetition, and a
# bare-word test let the fabricated "nearly tripled" through on its strength.
_COMPARATIVE = r"(?:than|versus|vs\.?|compared|relative to|greater|higher|lower|more|increase)"
_MULTIPLIER_GROUPS: dict[str, tuple[re.Pattern, str]] = {
    "double / 2x":    (re.compile(r"\b(doubl(e|ed|ing)|twice|two[- ]fold|2[- ]fold|2x)\b", re.I),
                       r"(?:doubl(?:e|ed)|twice|two[- ]fold|2[- ]fold|2x)"),
    "triple / 3x":    (re.compile(r"\b(tripl(e|ed|ing)|three times|three[- ]fold|3[- ]fold|3x)\b", re.I),
                       r"(?:tripl(?:e|ed)|three times|three[- ]fold|3[- ]fold|3x)"),
    "quadruple / 4x": (re.compile(r"\b(quadrupl(e|ed)|four times|four[- ]fold|4[- ]fold|4x)\b", re.I),
                       r"(?:quadrupl(?:e|ed)|four times|four[- ]fold|4[- ]fold|4x)"),
    "halved":         (re.compile(r"\b(halv(e|ed)|cut in half|by half)\b", re.I),
                       r"(?:halv(?:e|ed)|in half|by half)"),
}


def _ratio_stated_in_source(term: str, source_text: str) -> bool:
    """True only when the source uses that ratio to COMPARE two things.

    "more than double the MCII" counts (Stonehouse's own comparison); "measured three times in each
    hand" does not."""
    return bool(re.search(rf"\b{term}\b[^.]{{0,50}}{_COMPARATIVE}", source_text, re.I)
                or re.search(rf"{_COMPARATIVE}[^.]{{0,50}}\b{term}\b", source_text, re.I))

# Absolute efficacy language. Never appropriate for a supplement deck regardless of the source, so
# these are flagged on sight rather than checked against anything.
_ABSOLUTE_EFFICACY = re.compile(
    r"\b(proven to|clinically proven|proves|guarantees?|guaranteed|cures?|curing"
    r"|eliminates?|eradicates?|reverses (ageing|aging|osteoarthritis)"
    r"|treats (osteoarthritis|pain|disease))\b", re.I)


# A claim is judged on ITS OWN SENTENCE, never on the whole field. Measured on a real generation: a
# slide correctly said "No serious adverse events occurred in either group" (the pilot's own wording,
# properly scoped) and was flagged as an all-trials claim because the speaker note ENDED with the
# unrelated bridge "Now let's zoom out to the shared mechanism behind all three trials' results".
def _sentence_of(text: str, start: int, end: int) -> str:
    left = max(text.rfind(". ", 0, start), text.rfind("; ", 0, start)) + 1
    right = text.find(". ", end)
    return text[max(left, 0):right if right != -1 else len(text)].strip()


# A deck that ATTRIBUTES a strong term to the study is doing exactly the right thing — "The authors
# describe these effects as statistically and clinically significant in their conclusion" is honest
# reporting, and flagging it teaches the model to delete correct attribution.
_ATTRIBUTED = re.compile(
    r"\b(the )?(authors?|paper|study|trial|investigators?|researchers?)\b[^.]{0,40}"
    r"\b(describe|report|conclude|call|state|found|characteris|term)"
    r"|\bin (their|the) conclusion\b|\baccording to the (authors?|paper|study)\b"
    r"|\bthe (authors?|paper|study)'s own\b", re.I)


def _verbatim_slide(slide: dict) -> bool:
    layout = slide.get("layout") or ""
    return layout == "ingredient" or layout.startswith("custom_")


def _overstatement_warnings(plan: dict, source_text: str | None) -> list[str]:
    """Soft nudge: flag claims that are STRONGER than the source supports (see the block above)."""
    if not (source_text or "").strip():
        return []
    # Whitespace-normalised FIRST, and this is load-bearing. The source is PDF-extracted text, so a
    # phrase routinely straddles a line break ("No serious adverse\nevents occurred"), and every
    # multi-word pattern below is written with single spaces. Without this, matching silently fails
    # against exactly the statements that make a claim legitimate — measured: the real Tamargo
    # "No serious adverse events occurred in either group" went unseen, so honest slides were
    # flagged as unsupported. _quote_warnings normalises for the same reason.
    source_text = re.sub(r"\s+", " ", source_text)
    sae_nonzero = _SAE_NONZERO.search(source_text)
    ae_nonzero = _AE_NONZERO.search(source_text)
    ae_absent = bool(_AE_ABSENT_IN_SOURCE.search(source_text))
    modest = _MODEST_IN_SOURCE.search(source_text)
    clinical_in_source = _CLINICAL_STRENGTH.search(source_text)
    findings: list[str] = []
    for i, slide in enumerate(plan.get("slides", [])):
        if not isinstance(slide, dict) or _verbatim_slide(slide):
            continue
        where = f"slides/{i} ({slide.get('layout')})"
        for raw_text in _prose_strings(slide):
            text = re.sub(r"\s+", " ", raw_text)   # a claim can straddle two bullet lines too
            if m := _SAFETY_ABSOLUTE.search(text):
                sentence = _sentence_of(text, m.start(), m.end())
                serious = "serious" in m.group(0).lower()
                counted = sae_nonzero if serious else (sae_nonzero or ae_nonzero)
                if _UNIVERSAL_SCOPE.search(sentence) and counted:
                    findings.append(
                        f'{where}: "{m.group(0)}" is claimed across ALL the trials, but the source '
                        f'reports "{counted.group(0)}". One trial\'s clean safety statement cannot '
                        f'cover the others. Scope the claim to the trial that states it, or say '
                        f'that none were treatment related if that is what the source says.')
                elif not ae_absent:
                    findings.append(
                        f'{where}: "{m.group(0)}" — the source never states that adverse events were '
                        f'absent, and a trial that did not report them is not evidence that there '
                        f'were none. Drop the claim or scope it to a trial that does state it.')
            if (m := _CLINICAL_STRENGTH.search(text)) and \
                    not _ATTRIBUTED.search(_sentence_of(text, m.start(), m.end())):
                # Deliberately a VERIFY item, not a verdict. With several papers in one source the
                # term can be one paper's own conclusion (Alkhedhairi calls its muscle results
                # clinically significant) while another calls its results modest (Stonehouse, below
                # MCII) — and nothing deterministic can tell which paper this slide is citing. So
                # state both facts and make the model confirm, rather than assert an error.
                if clinical_in_source and modest:
                    findings.append(
                        f'{where}: "{m.group(0)}" needs confirming against the SPECIFIC paper this '
                        f'slide cites. The source uses clinical-significance language somewhere, but '
                        f'also describes results as "{modest.group(0)}" elsewhere. Keep the term only '
                        f'if the paper behind THIS slide applies it to THIS outcome.')
                elif not clinical_in_source:
                    findings.append(
                        f'{where}: "{m.group(0)}" — the source never uses clinical-significance '
                        f'language at all. It is a term of art; remove it and state what was measured.'
                        + (f' The source calls this result "{modest.group(0)}".' if modest else ""))
            for label, (in_plan, src_term) in _MULTIPLIER_GROUPS.items():
                m = in_plan.search(text)
                if not m or _FREQUENCY_AFTER.match(text[m.end():m.end() + 14]):
                    continue          # "twice daily" is a dose, not a ratio claim
                if not _ratio_stated_in_source(src_term, source_text):
                    findings.append(
                        f'{where}: "{m.group(0)}" states a RATIO the source never states. Check what '
                        f'you are comparing: a difference in percentage POINTS is not a multiple, and '
                        f'a ratio is undefined when the comparator moved the other way. Give the '
                        f'source\'s own figure instead.')
            for label, (in_plan, in_source) in _PRIORITY_GROUPS.items():
                if (m := in_plan.search(text)) and not in_source.search(source_text):
                    findings.append(
                        f'{where}: "{m.group(0)}" — the source makes no "{label}" claim anywhere, so '
                        f'this priority claim is yours, not the study\'s. Remove it.')
            if m := _ABSOLUTE_EFFICACY.search(text):
                findings.append(
                    f'{where}: "{m.group(0)}" — absolute efficacy language is never usable for a '
                    f'supplement. Restate as what the trial measured.')
    if not findings:
        return []
    # Deduplicated case-insensitively: the same claim in a slide's body and its notes differs only
    # in capitalisation ("No serious adverse events" / "no serious adverse events") and is one
    # mistake, not two.
    seen, unique = set(), []
    for f in findings:
        if (k := f.lower()) not in seen:
            seen.add(k)
            unique.append(f)
    shown, extra = unique[:8], len(unique) - 8
    return [f"OVERSTATEMENT: {len(unique)} statement(s) are stronger than the source supports. "
            + " ".join(shown) + (f" And {extra} more." if extra > 0 else "")]


def _quote_warnings(plan: dict, source_text: str | None) -> list[str]:
    """Soft nudge: a `source_quote` must be VERBATIM from the source.

    This is the check the numeric scan above cannot do. A real number bolted to the wrong metric
    (a stiffness p value of 0.001, where 0.001 is genuinely in the source but belongs to the
    Omega 3 Index) passes a token-level scan and fails here, because no sentence in the source
    carries both. Same deterministic substring test the claims library uses."""
    if not (source_text or "").strip():
        return []
    norm_src = re.sub(r"\s+", " ", source_text).lower()
    bad = []
    for i, slide in enumerate(plan.get("slides", [])):
        if not isinstance(slide, dict):
            continue
        quote = (slide.get("source_quote") or "").strip()
        if not quote:
            continue
        if re.sub(r"\s+", " ", quote).lower() not in norm_src:
            bad.append(f"slides/{i} ({slide.get('layout')}): \"{quote[:80]}\"")
    if not bad:
        return []
    return [f"NUMBERS: {len(bad)} `source_quote` value(s) are not verbatim in the source. A quote "
            f"must be copied EXACTLY from the source text, not paraphrased or reassembled from "
            f"different sentences. Fix the quote, or correct the figure it was meant to support: "
            + "; ".join(bad[:6])]


def _summary_warning(plan: dict, disabled_layouts=None) -> list[str]:
    """Soft nudge: every deck opens with an executive summary as slide 2, right after the cover
    and before the agenda (skipped when the About page turned the exec_summary layout off).
    pipeline._ensure_exec_summary backstops a deck that still lacks one after the retry."""
    if "exec_summary" in (disabled_layouts or ()):
        return []
    slides = plan.get("slides", [])
    if len(slides) < 3 or any(s.get("layout") == "exec_summary" for s in slides):
        return []
    return ["SUMMARY: the deck has no `exec_summary` slide — every deck needs one as slide 2, "
            "right after the cover, with its 5 fields (source, key_finding, supporting_findings, "
            "relevance, contents)."]


_EXEC_SUMMARY_FIELDS = ("source", "key_finding", "supporting_findings", "relevance", "contents")
_EXEC_SUMMARY_WORD_TARGET = 110  # ceiling with headroom over the ~80-word prompt target


def _exec_summary_length_warning(plan: dict) -> list[str]:
    """Soft nudge: the executive summary's 5 rows together should read as ~80 words, a tight
    business-memo summary, not fill every field's generous schema maxLength ceiling. Tagged
    EXEC_LENGTH: so it never blocks generation."""
    for s in plan.get("slides", []):
        if s.get("layout") != "exec_summary":
            continue
        text = " ".join(str(s.get(f) or "") for f in _EXEC_SUMMARY_FIELDS)
        words = len(text.split())
        if words > _EXEC_SUMMARY_WORD_TARGET:
            return [f"EXEC_LENGTH: the executive summary is {words} words across its 5 rows — the "
                    f"target is about 80 words total. Tighten each row to the essential number and "
                    f"sentence; the full detail already lives on the deck's own slides and in "
                    f"speaker_notes."]
        return []
    return []


# Fields that intentionally stay short one-liners even when their maxLength happens to be
# generous (a caption reading a chart, a banner summary, contact details) — never nudged toward
# their limit; doing so would just pad a line that is supposed to stay a line.
_SHORT_BY_DESIGN = {"title", "caption", "note", "tagline", "contact", "bottom_note", "banner"}


def _long_text_paths(props: dict, prefix: tuple[str, ...] = (), min_len: int = 90) -> list[tuple]:
    """Every STRING field long enough to be real prose (or an array-of-objects field's such
    sub-fields), walked from one layout's schema conditional. A "*" in the returned path marks
    where `_read_path` should iterate a list rather than index a key."""
    out = []
    for key, sub in props.items():
        if key in _SHORT_BY_DESIGN:
            continue
        if sub.get("type") == "string" and sub.get("maxLength", 0) >= min_len:
            out.append((prefix + (key,), sub["maxLength"]))
        elif sub.get("type") == "array":
            item = sub.get("items", {})
            if item.get("type") == "object":
                out.extend(_long_text_paths(item.get("properties", {}), prefix + (key, "*"), min_len))
    return out


def _read_path(slide: dict, path: tuple) -> list[tuple[str, str]]:
    """Resolve a schema path (a "*" segment means iterate a list) against one slide instance.
    Returns (concrete_path, text) pairs with REAL indices (e.g. "columns/1/body"), not the
    wildcarded schema path, so a report can point the retry at the exact field."""
    cur = [("", slide)]
    for seg in path:
        nxt = []
        for cp, c in cur:
            if seg == "*":
                if isinstance(c, list):
                    nxt.extend((f"{cp}/{j}" if cp else str(j), v) for j, v in enumerate(c))
            elif isinstance(c, dict) and seg in c:
                nxt.append((f"{cp}/{seg}" if cp else seg, c[seg]))
        cur = nxt
    return [(cp, v) for cp, v in cur if isinstance(v, str) and v.strip()]


def _text_density_warnings(plan: dict, brand: str | None = None) -> list[str]:
    """Soft nudge (never blocks) toward AKBM's own house style of filling a box with real
    supporting substance rather than a short fragment. Compares each long-form text field's
    actual length to its schema maxLength — the true room its box has, already measured from the
    real template geometry — and, if the deck is running noticeably short of that room on
    average, names the worst offenders so the retry knows exactly what to expand. Never fires on
    fewer than 4 qualifying fields (too little signal to judge a whole deck by)."""
    slides = plan.get("slides", [])
    if len(slides) < 3:
        return []

    long_paths_by_layout: dict[str, list[tuple]] = {}
    for cond in config.schema(brand)["properties"]["slides"]["items"].get("allOf", []):
        sem = cond["if"]["properties"]["layout"]["const"]
        long_paths_by_layout[sem] = _long_text_paths(cond["then"].get("properties", {}))

    fields = []  # (path_str, actual_len, max_len)
    for i, slide in enumerate(slides):
        for path, max_len in long_paths_by_layout.get(slide.get("layout"), []):
            for concrete_path, text in _read_path(slide, path):
                fields.append((f"slides/{i}/{concrete_path}", len(text), max_len))

    if len(fields) < 4:
        return []
    avg_fill = sum(a / m for _, a, m in fields) / len(fields)
    if avg_fill >= 0.5:
        return []

    worst = sorted(fields, key=lambda f: f[1] / f[2])[:5]
    examples = "; ".join(f"{p} ({a}/{m} chars, {round(100 * a / m)}%)" for p, a, m in worst)
    return [f"TEXT: body and detail text is running short of the room available — averaging "
            f"{round(100 * avg_fill)}% of each field's actual limit across {len(fields)} fields. "
            f"AKBM's own decks fill these boxes with fuller sentences (a number, a mechanism, a "
            f"comparison, a consequence), not a short fragment. Worst examples: {examples}. Expand "
            f"these, and any similarly thin field elsewhere, toward their bracketed limit with real "
            f"substance — never by padding with filler."]


def _schema_with_extras(extra_layouts: list[str] | None,
                        extra_photo_ids: list[str] | None = None,
                        layout_overrides: list[dict] | None = None,
                        brand: str | None = None) -> dict:
    """The slide schema, with the team's own slide keys (custom_<id>) added to the layout enum,
    the team's photo ids (team_photo_<id>) added to every asset_id enum, and every SLOT-FILLED
    key's conditional demanding per-slot text (planner.apply_slot_layouts — the same mutation
    the tool schema gets, so guidance and enforcement can't drift; covers both a redesigned
    built-in layout and a team-uploaded design). Verbatim slides need no if/then conditional —
    they carry no other fields."""
    if not extra_layouts and not extra_photo_ids and not layout_overrides:
        return config.schema(brand)
    import copy
    s = copy.deepcopy(config.schema(brand))
    if extra_layouts:
        enum = s["properties"]["slides"]["items"]["properties"]["layout"]["enum"]
        s["properties"]["slides"]["items"]["properties"]["layout"]["enum"] = enum + [
            k for k in extra_layouts if k not in enum]
    if extra_photo_ids:
        from .planner import extend_asset_enums
        extend_asset_enums(s, extra_photo_ids)
    if layout_overrides:
        from .planner import apply_slot_layouts
        apply_slot_layouts(s, layout_overrides)
    return s


def prune_unknown(plan: dict, validator: jsonschema.protocols.Validator) -> list[str]:
    """Delete fields the schema does not allow, IN PLACE, and say what went.

    The model occasionally decorates a slide with a field nobody asked for — a real generation died
    on `before_note` inside a `from_to` slide's `before` object. Every object in this schema is
    `additionalProperties: false`, so one invented key is a hard error; worse, it is reported TWICE
    (once against the generic slide schema, once against that layout's own conditional), and the
    self-correction retry kept writing it back, which cost the user the whole deck.

    Deleting it is lossless where it counts: the renderer only ever reads fields it knows, so a
    field the schema has never heard of renders nothing either way. This is the same kind of
    deterministic net as the dash strip and the notes backstop — repair what can be repaired
    mechanically, and let the model's one retry spend itself on what actually needs rewriting.

    Bounded loop because removing a key can reveal the next error underneath it.
    """
    removed: list[str] = []
    for _ in range(4):
        extras = [e for e in validator.iter_errors(plan)
                  if e.validator == "additionalProperties" and isinstance(e.instance, dict)
                  and isinstance(e.schema, dict) and "properties" in e.schema]
        if not extras:
            break
        before = len(removed)
        for e in extras:
            where = "/".join(str(p) for p in e.absolute_path) or "(root)"
            for key in [k for k in e.instance if k not in e.schema["properties"]]:
                del e.instance[key]     # e.instance IS the dict inside `plan`
                removed.append(f"{where}/{key}")
        if len(removed) == before:
            break                        # nothing left this pass could fix
    return removed


def validate_plan(plan: dict, extra_layouts: list[str] | None = None,
                  extra_photo_ids: list[str] | None = None,
                  photo_level: str = "default",
                  disabled_layouts=None,
                  layout_overrides: list[dict] | None = None,
                  brand: str | None = None,
                  source_text: str | None = None) -> list[str]:
    """Return a list of human-readable violations ('' if the plan is valid).

    source_text: the deck's own source material. Supplied by the pipeline so every figure on the
    deck can be checked against it; omitted by callers that validate a synthetic plan (the gallery
    builder, the design preview), which skips the numeric checks rather than flagging everything."""
    errors: list[str] = []
    validator = jsonschema.Draft202012Validator(
        _schema_with_extras(extra_layouts, extra_photo_ids, layout_overrides, brand))
    # Repair before reporting: a field the schema has never heard of is deleted rather than blamed,
    # because no retry can be trusted to stop writing it and nothing renders it anyway.
    for gone in prune_unknown(plan, validator):
        print(f"[validate] dropped {gone}: not in the schema, so nothing would render it",
              file=sys.stderr)
    for e in sorted(validator.iter_errors(plan), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in e.absolute_path) or "(root)"
        # Precise, actionable message for the planner's retry: exact length, limit, and how
        # much to cut. jsonschema's default "'...' is too long" doesn't say by how much.
        if e.validator == "maxLength" and isinstance(e.instance, str):
            errors.append(f"{where}: text is {len(e.instance)} chars but the limit is "
                          f"{e.validator_value} — shorten it by at least {len(e.instance) - e.validator_value}")
        else:
            errors.append(f"{where}: {e.message}")

    # Semantic checks beyond the JSON Schema (asset_id must be a real, selectable photo;
    # the enum already covers this, but a clear message helps the retry).
    ids = {a["id"] for a in config.selectable_photos(brand)} | set(extra_photo_ids or ())
    catalog = config.catalog(brand)
    for i, slide in enumerate(plan.get("slides", []), 1):
        if not isinstance(slide, dict):
            continue   # already reported by the schema's own "items": {"type": "object"}
        aid = slide.get("asset_id")
        if aid and aid not in ids:
            errors.append(f"slides/{i-1}/asset_id: '{aid}' is not a selectable photo id")
        layout = slide.get("layout")
        bg = slide.get("background")
        if layout in catalog and bg and bg not in catalog[layout]["backgrounds"]:
            errors.append(f"slides/{i-1}/background: '{bg}' not available for layout '{layout}'")

    # Always include the coverage nudges, even alongside real schema errors — revise_plan()
    # gives VARIETY:/PHOTOS: their own separate instruction block from schema fixes, so the one
    # retry a plan gets can act on both at once. Gating this behind "only when otherwise clean"
    # meant a plan with even one trivial residual overflow (which ships anyway) never got its
    # coverage checked at all, silently shipping under the photo/variety minimums.
    #
    # These helpers all assume every slide is an object — true for a well-formed plan, but a
    # slide that ISN'T one is already reported above by the schema's own "type": "object" (and,
    # for a plan that still has it after the retry, dropped by the pipeline's slide-drop
    # fallback). Filtered out here too so a malformed slide crashes nothing further down.
    well_formed = {**plan, "slides": [s for s in plan.get("slides", []) if isinstance(s, dict)]}
    errors.extend(_coverage_warnings(well_formed, photo_level))
    errors.extend(_text_density_warnings(well_formed, brand))
    errors.extend(_notes_warnings(well_formed))
    errors.extend(_summary_warning(well_formed, disabled_layouts))
    errors.extend(_exec_summary_length_warning(well_formed))
    errors.extend(_number_warnings(well_formed, source_text))
    errors.extend(_quote_warnings(well_formed, source_text))
    errors.extend(_overstatement_warnings(well_formed, source_text))

    return errors[:25]
