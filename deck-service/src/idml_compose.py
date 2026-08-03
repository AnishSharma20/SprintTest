"""Cross-template IDML composition — assemble ONE whitepaper from designed pages that live in
SEVERAL of AKBM's brochures (Sport Performance, Sustainability, Superba Brochure).

Why this exists: `idml.py` fills a single fixed template, so every whitepaper looks the same. The
three standard Superba brochures are a compatible family (all A4, all sharing the brand fonts
Manrope / Exo 2 / Montserrat), so real variation comes from picking PAGES across them: a Sport
cover, the Brochure ingredient page, a Sustainability stats page, a Sport conclusion.

The hard part is that each .idml is a self-contained package: the three files reuse the same object
ids (`ud1` exists in all of them) AND — verified by measurement — define DIFFERENT things under the
same style/colour names (`Title H1`, `C=7 M=0 Y=3 K=0` differ between Sport and Brochure). Naively
merging therefore either corrupts the package (duplicate ids) or silently restyles an imported page
with the host's fonts. So every non-base source is NAMESPACED: its object ids and its own
style/colour names get a per-source prefix, and its resources are imported alongside the base's.
Each page then keeps exactly the styling it was designed with.

Scope note: `$ID/...` built-ins (e.g. `$ID/NormalParagraphStyle`) are intentionally NOT namespaced —
they exist in every InDesign document and are treated as shared. Most visible formatting in these
templates is carried as local overrides on the runs, so this is low risk, but it is the one place an
imported page can pick up the base's defaults. Verify visually in InDesign before trusting a mix.

There is no headless IDML renderer (InDesign Server is paid), so `validate()` checks structural
integrity only — the final gate is opening the result in InDesign.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

_PKG_NS = "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"
ET.register_namespace("idPkg", _PKG_NS)

# An object id: "u" + hex, optionally with a trailing alpha suffix (e.g. u9fBuildingBlock0).
# Document-level ids like "d" / "dTextVariablen..." are deliberately excluded: they are never
# imported per page (the base supplies them), and they are too short to rewrite safely.
_ID_RE = re.compile(r"^u[0-9a-fA-F]+(?:[A-Za-z]\w*)?$")

# Reference types whose leaf name we namespace when it is a document-defined name.
_NAMED_REF_TYPES = ("ParagraphStyle", "CharacterStyle", "ObjectStyle", "TableStyle", "CellStyle",
                    "StrokeStyle", "Color", "Gradient", "Swatch")

# Colours/swatches every InDesign document owns — shared, never namespaced.
_BUILTIN_COLORS = {"Black", "Paper", "None", "Registration", "Cyan", "Magenta", "Yellow",
                   "$ID/Black", "$ID/Paper", "$ID/None", "$ID/Registration"}

# Attribute values that are file paths / font names / user text — never rewritten.
_DENY_ATTRS = {"LinkResourceURI", "LinkResourceFormat", "AppliedFont", "FontFamily",
               "PostScriptName", "src", "href", "StoryTitle"}

# Root containers in Resources/*.xml that we merge child-wise rather than replace.
_MERGE_CONTAINERS = ("RootParagraphStyleGroup", "RootCharacterStyleGroup", "RootObjectStyleGroup",
                     "RootTableStyleGroup", "RootCellStyleGroup", "ColorGroup")


@dataclass
class Source:
    """One template package plus the identifiers it defines (what we must namespace)."""
    key: str
    path: Path
    prefix: str                                   # "" for the base document
    zf: zipfile.ZipFile = field(init=False)
    ids: set[str] = field(init=False)
    names: dict[str, set[str]] = field(init=False)

    def __post_init__(self):
        self.zf = zipfile.ZipFile(io.BytesIO(Path(self.path).read_bytes()))
        self.ids, self.names = _defined(self.zf)

    def read(self, member: str) -> str:
        return self.zf.read(member).decode("utf-8")


def _defined(z: zipfile.ZipFile) -> tuple[set[str], dict[str, set[str]]]:
    """Every object id and every Type/Name this package DEFINES (via Self=...)."""
    ids: set[str] = set()
    names: dict[str, set[str]] = {t: set() for t in _NAMED_REF_TYPES}
    for member in z.namelist():
        if not member.endswith(".xml"):
            continue
        for self_val in re.findall(r'Self="([^"]+)"', z.read(member).decode("utf-8", "replace")):
            if _ID_RE.match(self_val):
                ids.add(self_val)
                continue
            typ, _, leaf = self_val.partition("/")
            if typ in names and leaf and not leaf.startswith("$ID") and leaf not in _BUILTIN_COLORS:
                names[typ].add(leaf)
    return ids, names


def _value_rewriter(src: Source):
    """Build a function that namespaces one attribute value for this source."""
    if not src.prefix:
        return lambda attr, val: val

    # Longest ids first so u12 never shadows u120 (boundary-anchored anyway).
    id_alt = "|".join(re.escape(i) for i in sorted(src.ids, key=len, reverse=True))
    id_re = re.compile(rf"(?<![\w-])({id_alt})(?![\w-])") if id_alt else None
    name_map = {f"{t}/{n}": f"{t}/{src.prefix}{n}"
                for t in _NAMED_REF_TYPES for n in src.names.get(t, ())}

    def rewrite(attr: str, val: str) -> str:
        if attr in _DENY_ATTRS or not val:
            return val
        if val in name_map:                      # whole-value style/colour reference
            return name_map[val]
        if id_re is not None:                    # ids, incl. space separated lists (StoryList)
            return id_re.sub(lambda m: src.prefix + m.group(1), val)
        return val

    return rewrite


_ATTR_RE = re.compile(r'(\s[\w:.\-]+=")([^"]*)(")')


def _namespace_xml(xml: str, src: Source) -> str:
    """Rewrite ATTRIBUTE VALUES only — element text (<Content> = the user's words) is untouched."""
    if not src.prefix:
        return xml
    rewrite = _value_rewriter(src)

    def sub(m):
        head, val, tail = m.group(1), m.group(2), m.group(3)
        attr = head.strip()[:-2]
        return head + _escape(rewrite(attr, _unescape(val))) + tail

    return _ATTR_RE.sub(sub, xml)


def _unescape(v: str) -> str:
    return v.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')


def _escape(v: str) -> str:
    return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _namespace_element(el: ET.Element, src: Source) -> None:
    """In-place namespacing of an ElementTree subtree (used for merged resource files)."""
    if not src.prefix:
        return
    rewrite = _value_rewriter(src)
    for node in el.iter():
        for attr, val in list(node.attrib.items()):
            node.set(attr, rewrite(attr, val))
        # A style's display Name must track its (now namespaced) Self, or InDesign shows duplicates.
        self_val = node.get("Self", "")
        typ, _, leaf = self_val.partition("/")
        if typ in _NAMED_REF_TYPES and leaf.startswith(src.prefix) and node.get("Name"):
            name = node.get("Name")
            if not name.startswith(src.prefix) and not name.startswith("$ID"):
                node.set("Name", src.prefix + name)


# ---------------------------------------------------------------------------
# Page references
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PageRef:
    """One designed spread to place, identified by template key + spread id."""
    template: str
    spread: str


def spread_stories(src: Source, spread_id: str) -> set[str]:
    xml = src.read(f"Spreads/Spread_{spread_id}.xml")
    return {s for s in re.findall(r'ParentStory="([^"]+)"', xml)}


def spread_masters(src: Source, spread_id: str) -> set[str]:
    xml = src.read(f"Spreads/Spread_{spread_id}.xml")
    return {m for m in re.findall(r'AppliedMaster="([^"]+)"', xml) if m and m != "n"}


def spread_images(src: Source, spread_id: str) -> set[str]:
    """Linked image filenames this spread needs (for the delivered Links folder)."""
    xml = src.read(f"Spreads/Spread_{spread_id}.xml")
    out = set()
    for uri in re.findall(r'LinkResourceURI="([^"]+)"', xml):
        name = uri.rsplit("/", 1)[-1]
        out.add(_url_unquote(name))
    return out


def _url_unquote(s: str) -> str:
    from urllib.parse import unquote
    return unquote(s)


def page_size(src: Source, spread_id: str) -> tuple[int, int] | None:
    root = ET.fromstring(src.read(f"Spreads/Spread_{spread_id}.xml"))
    for pg in root.iter("Page"):
        gb = [float(v) for v in pg.get("GeometricBounds").split()]
        return (round(gb[3] - gb[1]), round(gb[2] - gb[0]))
    return None


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------

def compose(pages: list[PageRef], templates: dict[str, Path]) -> tuple[bytes, set[str]]:
    """Assemble the given pages, in order, into one valid .idml package.

    The first page's template is the BASE: it supplies document level settings (preferences,
    tags, backing story) and keeps its own identifiers. Every other template is namespaced.
    Returns (idml_bytes, linked_image_filenames_needed).
    """
    if not pages:
        raise ValueError("compose() needs at least one page.")

    base_key = pages[0].template
    order = [base_key] + [k for k in dict.fromkeys(p.template for p in pages) if k != base_key]
    prefixes = {k: ("" if k == base_key else f"{_short(k)}_") for k in order}
    srcs = {k: Source(k, Path(templates[k]), prefixes[k]) for k in order}
    base = srcs[base_key]

    sizes = {page_size(srcs[p.template], p.spread) for p in pages}
    sizes.discard(None)
    if len(sizes) > 1:
        raise ValueError(f"Pages have different page sizes {sizes}; refusing to mix (would produce "
                         "a document with inconsistent physical pages).")

    members: dict[str, bytes] = {}
    images: set[str] = set()

    # ---- merged resources -------------------------------------------------
    members["Resources/Fonts.xml"] = _merge_fonts(srcs, order)
    members["Resources/Graphic.xml"] = _merge_resource(srcs, order, "Resources/Graphic.xml")
    members["Resources/Styles.xml"] = _merge_resource(srcs, order, "Resources/Styles.xml")
    members["Resources/Preferences.xml"] = base.zf.read("Resources/Preferences.xml")

    # ---- document level members straight from the base --------------------
    for m in ("META-INF/container.xml", "META-INF/metadata.xml", "XML/Tags.xml",
              "XML/BackingStory.xml"):
        if m in base.zf.namelist():
            members[m] = base.zf.read(m)

    # ---- pages: spreads + their stories + their masters -------------------
    spread_members: list[str] = []
    master_members: list[str] = []
    story_members: list[str] = []
    story_ids: list[str] = []

    for page in pages:
        src = srcs[page.template]
        pfx = src.prefix
        sm = f"Spreads/Spread_{pfx}{page.spread}.xml"
        members[sm] = _namespace_xml(src.read(f"Spreads/Spread_{page.spread}.xml"),
                                     src).encode("utf-8")
        spread_members.append(sm)
        images |= spread_images(src, page.spread)

        for mid in sorted(spread_masters(src, page.spread)):
            mm = f"MasterSpreads/MasterSpread_{pfx}{mid}.xml"
            orig = f"MasterSpreads/MasterSpread_{mid}.xml"
            if mm not in members and orig in src.zf.namelist():
                members[mm] = _namespace_xml(src.read(orig), src).encode("utf-8")
                master_members.append(mm)
                # a master can carry its own text frames -> their stories must come along
                for sid in spread_stories(_MasterAsSpread(src, orig), ""):
                    _add_story(members, story_members, story_ids, src, sid)

        for sid in sorted(spread_stories(src, page.spread)):
            _add_story(members, story_members, story_ids, src, sid)

    members["designmap.xml"] = _designmap(base, srcs, order, spread_members, master_members,
                                          story_members, story_ids)

    # ---- repack (mimetype first & stored) --------------------------------
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), base.zf.read("mimetype"),
                   compress_type=zipfile.ZIP_STORED)
        for name, data in members.items():
            z.writestr(name, data)
    return out.getvalue(), images


class _MasterAsSpread:
    """Lets spread_stories() read a master spread with the same code path."""

    def __init__(self, src: Source, member: str):
        self._xml = src.read(member)

    def read(self, _member: str) -> str:
        return self._xml


def _add_story(members, story_members, story_ids, src: Source, sid: str) -> None:
    orig = f"Stories/Story_{sid}.xml"
    if orig not in src.zf.namelist():
        return
    name = f"Stories/Story_{src.prefix}{sid}.xml"
    if name in members:
        return
    members[name] = _namespace_xml(src.read(orig), src).encode("utf-8")
    story_members.append(name)
    story_ids.append(f"{src.prefix}{sid}")


def _short(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())[:4] or "t"


def _merge_fonts(srcs: dict[str, Source], order: list[str]) -> bytes:
    """Union of font families, keyed by name. Font references are BY NAME, so never namespaced."""
    root = ET.fromstring(srcs[order[0]].read("Resources/Fonts.xml"))
    seen = {ff.get("Name") for ff in root.findall("FontFamily")}
    for key in order[1:]:
        other = ET.fromstring(srcs[key].read("Resources/Fonts.xml"))
        for ff in other.findall("FontFamily"):
            if ff.get("Name") not in seen:
                seen.add(ff.get("Name"))
                root.append(ff)
    return _ser(root)


def _merge_resource(srcs: dict[str, Source], order: list[str], member: str) -> bytes:
    """Merge a resource file: base as-is, other sources' definitions namespaced and appended."""
    root = ET.fromstring(srcs[order[0]].read(member))
    containers = {c.tag: c for c in root if c.tag in _MERGE_CONTAINERS}
    present = {el.get("Self") for el in root.iter() if el.get("Self")}

    for key in order[1:]:
        src = srcs[key]
        other = ET.fromstring(src.read(member))
        _namespace_element(other, src)
        for child in list(other):
            if child.tag in _MERGE_CONTAINERS and child.tag in containers:
                for gchild in list(child):                  # merge group members
                    if gchild.get("Self") not in present:
                        present.add(gchild.get("Self"))
                        containers[child.tag].append(gchild)
            elif child.get("Self") not in present:           # top level definition
                present.add(child.get("Self"))
                root.append(child)
    return _ser(root)


def _designmap(base: Source, srcs: dict[str, Source], order: list[str], spreads: list[str],
               masters: list[str], stories: list[str], story_ids: list[str]) -> bytes:
    """Rebuild designmap.xml: keep every document level element the base declares (Properties,
    Languages and — easy to miss — the <ColorGroup> that DEFINES the swatch group ids referenced
    from Graphic.xml), swap in our own resource/page references."""
    dm = base.read("designmap.xml")

    first = dm.index("<idPkg:")
    head = dm[:first]
    head = re.sub(r'StoryList="[^"]*"', f'StoryList="{" ".join(story_ids)}"', head, count=1)
    # Everything after the references (minus the references themselves) must survive.
    tail = re.sub(r"<idPkg:[^>]*/>\s*", "", dm[first:])

    refs = ['<idPkg:Graphic src="Resources/Graphic.xml" />',
            '<idPkg:Fonts src="Resources/Fonts.xml" />',
            '<idPkg:Styles src="Resources/Styles.xml" />',
            '<idPkg:Preferences src="Resources/Preferences.xml" />']
    if "XML/Tags.xml" in base.zf.namelist():
        refs.append('<idPkg:Tags src="XML/Tags.xml" />')
    refs += [f'<idPkg:MasterSpread src="{m}" />' for m in masters]
    refs += [f'<idPkg:Spread src="{s}" />' for s in spreads]
    if "XML/BackingStory.xml" in base.zf.namelist():
        refs.append('<idPkg:BackingStory src="XML/BackingStory.xml" />')
    refs += [f'<idPkg:Story src="{s}" />' for s in stories]

    # A document has exactly ONE "[Root Color Group]", so fold the other sources' swatch entries
    # (namespaced) INTO the base's group instead of appending rival groups.
    swatches = ""
    for key in order[1:]:
        src = srcs[key]
        for match in re.finditer(r"<ColorGroup\b.*?</ColorGroup>", src.read("designmap.xml"), re.S):
            group = ET.fromstring(match.group(0))
            _namespace_element(group, src)
            for entry in group:
                swatches += "\n\t\t" + ET.tostring(entry, encoding="unicode").strip()
    if swatches and "</ColorGroup>" in tail:
        tail = tail.replace("</ColorGroup>", swatches + "\n\t</ColorGroup>", 1)

    return (head + "\n\t".join(refs) + "\n" + tail.lstrip()).encode("utf-8")


def _ser(root: ET.Element) -> bytes:
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            + ET.tostring(root, encoding="unicode")).encode("utf-8")


# ---------------------------------------------------------------------------
# Structural validation (the only automated gate available — no IDML renderer exists)
# ---------------------------------------------------------------------------

def validate(data: bytes) -> dict:
    """Check the package is internally consistent. Returns a report; empty 'errors' == sound."""
    z = zipfile.ZipFile(io.BytesIO(data))
    report: dict = {"errors": [], "warnings": {}}

    if z.testzip() is not None:
        report["errors"].append("corrupt zip")
    if z.namelist()[0] != "mimetype":
        report["errors"].append("mimetype must be the first member")

    defined: dict[str, int] = {}
    referenced: set[str] = set()
    for member in z.namelist():
        if not member.endswith(".xml"):
            continue
        raw = z.read(member).decode("utf-8", "replace")
        try:
            ET.fromstring(raw)
        except Exception as exc:                              # noqa: BLE001
            report["errors"].append(f"{member} does not parse: {exc}")
            continue
        for sid in re.findall(r'Self="([^"]+)"', raw):
            defined[sid] = defined.get(sid, 0) + 1
        for attr, val in re.findall(r'([\w:.\-]+)="([^"]*)"', raw):
            if attr in _DENY_ATTRS or attr == "Self" or not val:
                continue
            # A Type/Name reference is the WHOLE value (names legitimately contain spaces, e.g.
            # "Color/C=0 M=100 Y=100 K=0") — only id lists are whitespace separated.
            if val.partition("/")[0] in _NAMED_REF_TYPES:
                referenced.add(_unescape(val))
                continue
            for tok in val.split():
                if _ID_RE.match(tok):
                    referenced.add(tok)

    dupes = sorted(k for k, n in defined.items() if n > 1)
    if dupes:
        report["errors"].append(f"duplicate Self ids: {dupes[:6]} ({len(dupes)} total)")

    dm = z.read("designmap.xml").decode("utf-8")
    missing_files = [s for s in re.findall(r'src="([^"]+)"', dm) if s not in z.namelist()]
    if missing_files:
        report["errors"].append(f"designmap points at missing files: {missing_files[:5]}")

    # Dangling references: exclude $ID built-ins (shared) and ids the base owns document-wide.
    dangling = sorted(r for r in referenced
                      if r not in defined
                      and "$ID" not in r
                      and r.partition("/")[2] not in _BUILTIN_COLORS
                      and not r.startswith(("Language/", "NumberingList/", "NamedGrid/",
                                            "TrapPreset/", "Ink/", "MixedInkGroup/")))
    if dangling:
        report["warnings"]["dangling_refs"] = dangling[:12]
        report["warnings"]["dangling_count"] = len(dangling)

    spreads = re.findall(r'<idPkg:Spread src="([^"]+)"', dm)
    pages = 0
    for sm in spreads:
        pages += len(list(ET.fromstring(z.read(sm)).iter("Page")))
    report["spreads"] = len(spreads)
    report["pages"] = pages
    report["members"] = len(z.namelist())
    return report
