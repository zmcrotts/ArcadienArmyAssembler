#!/usr/bin/env python3
"""Extract every current price row from saved MFM faction pages."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "scripts" / "scrape-mfm-points.py"
POINTS_RE = re.compile(r"([\d,]+)\s*pts\b", re.I)
FACTIONS = {
    "adepta-sororitas": "Adepta Sororitas",
    "adeptus-custodes": "Adeptus Custodes",
    "adeptus-mechanicus": "Adeptus Mechanicus",
    "aeldari": "Aeldari",
    "astra-militarum": "Astra Militarum",
    "black-templars": "Black Templars",
    "blood-angels": "Blood Angels",
    "chaos-daemons": "Chaos Daemons",
    "chaos-knights": "Chaos Knights",
    "chaos-space-marines": "Chaos Space Marines",
    "chaos-titan-legions": "Chaos Titan Legions",
    "dark-angels": "Dark Angels",
    "death-guard": "Death Guard",
    "deathwatch": "Deathwatch",
    "drukhari": "Drukhari",
    "emperors-children": "Emperor's Children",
    "genestealer-cults": "Genestealer Cults",
    "grey-knights": "Grey Knights",
    "imperial-agents": "Imperial Agents",
    "imperial-knights": "Imperial Knights",
    "leagues-of-votann": "Leagues of Votann",
    "necrons": "Necrons",
    "orks": "Orks",
    "space-marines": "Space Marines",
    "space-wolves": "Space Wolves",
    "tau-empire": "T'au Empire",
    "thousand-sons": "Thousand Sons",
    "titan-legions": "Titan Legions",
    "tyranids": "Tyranids",
    "world-eaters": "World Eaters",
}


def load_helpers():
    spec = importlib.util.spec_from_file_location("mfm_scrape_helpers", HELPER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def preceding_section(card, helpers, replacements):
    current = card
    while current is not None:
        headings = current.xpath("preceding-sibling::h3[1]")
        if headings:
            value = helpers.resolved_text(headings[0], replacements)
            return value if value and value != "UNITS" else None
        current = current.getparent()
    return None


def global_preceding_section(card, helpers, replacements):
    headings = card.xpath("preceding::h3")
    if not headings:
        return None
    value = helpers.resolved_text(headings[-1], replacements)
    return value if value and value != "UNITS" else None


def row_parts(row, helpers, replacements):
    container = row
    if len(container) < 2:
        candidates = row.xpath(".//div[contains(concat(' ',normalize-space(@class),' '),' justify-between ')]")
        container = candidates[0] if candidates else row
    if len(container) < 2:
        return None
    label = helpers.resolved_text(container[0], replacements)
    price_text = helpers.resolved_text(container[-1], replacements)
    match = POINTS_RE.search(price_text)
    return (label, int(match.group(1).replace(",", ""))) if label and match else None


def extract_page(path: Path, slug: str, helpers):
    document = html.fromstring(path.read_bytes())
    replacements = helpers.replacement_map(document)
    faction = FACTIONS[slug]
    source_url = f"https://mfm.warhammer-community.com/en/{slug}"
    rows = []

    for card in document.xpath("//div[contains(@class,'print:break-inside-avoid-page')]"):
        title = helpers.card_title(card, replacements)
        if not title:
            continue
        section = global_preceding_section(card, helpers, replacements) if slug == "imperial-agents" else preceding_section(card, helpers, replacements)
        context = None
        if slug == "imperial-agents":
            context = "Every model has the Imperium keyword" if section == "EVERY MODEL HAS THE IMPERIUM KEYWORD" else "Imperial Agents army"

        for group in card:
            if group.tag != "div" or not helpers.class_has(group, "space-y-1"):
                continue
            heading = helpers.direct_heading(group, replacements)
            if not (heading.startswith("YOUR ") or heading in {"WARGEAR OPTIONS", "ENHANCEMENTS"}):
                continue
            for item in group.xpath(".//ul//li"):
                parsed = row_parts(item, helpers, replacements)
                if parsed is None:
                    continue
                label, points = parsed
                common = {
                    "faction": faction,
                    "factionSlug": slug,
                    "sourceUrl": source_url,
                    "section": section,
                    "context": context,
                    "points": points,
                }
                if heading == "ENHANCEMENTS":
                    rows.append({
                        **common,
                        "kind": "enhancement",
                        "detachmentName": re.sub(r"\s+\d+DP\b.*$", "", title).strip(),
                        "enhancementName": label,
                    })
                else:
                    rows.append({
                        **common,
                        "kind": "wargear" if heading == "WARGEAR OPTIONS" or label.startswith("+") else "unit",
                        "unitName": title,
                        "costBand": heading,
                        "label": label,
                    })
    return rows


def row_key(row):
    return tuple(str(row.get(key, "")) for key in (
        "kind", "factionSlug", "section", "context", "detachmentName",
        "enhancementName", "unitName", "costBand", "label", "points"
    ))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default="1.3")
    args = parser.parse_args()

    helpers = load_helpers()
    rows = []
    missing = []
    for slug in FACTIONS:
        page = args.input_dir / f"{slug}.html"
        if not page.exists():
            missing.append(str(page))
            continue
        rows.extend(extract_page(page, slug, helpers))
    if missing:
        raise FileNotFoundError("Missing MFM snapshots:\n" + "\n".join(missing))

    unique = {row_key(row): row for row in rows}
    ordered = [unique[key] for key in sorted(unique)]
    payload = {
        "schemaVersion": 1,
        "source": "https://mfm.warhammer-community.com/en",
        "version": args.version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "pages": len(FACTIONS),
        "rows": ordered,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = {kind: sum(row["kind"] == kind for row in ordered) for kind in ("unit", "wargear", "enhancement")}
    print(json.dumps({"pages": len(FACTIONS), "rows": len(ordered), **counts}, indent=2))


if __name__ == "__main__":
    main()
