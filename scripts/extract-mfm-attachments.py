#!/usr/bin/env python3
"""Extract the complete MFM leader/support attachment table from saved pages."""

from __future__ import annotations

import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
MFM_ROOT = "https://mfm.warhammer-community.com/en"
FACTION_NAMES = {
    "emperors-children": "Emperor's Children",
    "leagues-of-votann": "Leagues of Votann",
    "tau-empire": "T'au Empire",
}


def load_helpers():
    path = Path(__file__).with_name("scrape-mfm-points.py")
    spec = importlib.util.spec_from_file_location("scrape_mfm_points", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def logical_walk(element, replacements, seen=None):
    seen = set() if seen is None else seen
    yield element
    if element.tag == "template" and (element.get("id") or "").startswith("P:"):
        key = element.get("id")
        replacement = replacements.get(key)
        if replacement is not None and key not in seen:
            yield from logical_walk(replacement, replacements, seen | {key})
        return
    for child in element:
        if child.tag != "script":
            yield from logical_walk(child, replacements, seen)


def split_known_targets(value: str, known_names):
    value = value.strip()
    if value in known_names:
        return [value]
    matches = [name for name in known_names if value.startswith(f"{name} ")]
    for name in sorted(matches, key=len, reverse=True):
        remainder = split_known_targets(value[len(name):].strip(), known_names)
        if remainder:
            return [name, *remainder]
    return []


def extract_page(page_path: Path, helpers):
    document = html.fromstring(page_path.read_bytes())
    replacements = helpers.replacement_map(document)
    records = []
    cards = document.xpath("//div[contains(@class,'print:break-inside-avoid-page')]")
    named_cards = [(helpers.card_title(card, replacements), card) for card in cards if len(card)]
    named_cards = [(name, card) for name, card in named_cards if name]
    known_names = {name for name, _ in named_cards}
    for unit_name, card in named_cards:
        for node in logical_walk(card, replacements):
            if node.tag != "div" or not helpers.class_has(node, "space-y-1"):
                continue
            text = helpers.resolved_text(node, replacements)
            role = next((value for value in ("LEADER", "SUPPORT") if text.startswith(f"{value} ")), None)
            if not role:
                continue
            targets = []
            for value in text[len(role):].strip().split(","):
                value = value.strip()
                if not value:
                    continue
                targets.extend(split_known_targets(value, known_names) or [value])
            if targets:
                records.append({"unitName": unit_name, "role": role, "targets": targets})
    unique = {json.dumps(item, sort_keys=True): item for item in records}
    return list(unique.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default="1.4")
    args = parser.parse_args()
    helpers = load_helpers()
    factions = []
    for page_path in sorted(args.input_dir.glob("*.html")):
        slug = page_path.stem
        name = FACTION_NAMES.get(slug, " ".join(word.capitalize() for word in slug.split("-")))
        attachments = extract_page(page_path, helpers)
        factions.append({"name": name, "slug": slug, "url": f"{MFM_ROOT}/{slug}", "attachments": attachments})
        print(f"{name}: {len(attachments)} attachment records")
    total = sum(len(faction["attachments"]) for faction in factions)
    if total < 100:
        raise RuntimeError(f"Parsed only {total} MFM attachment records; refusing to write incomplete data")
    payload = {
        "schemaVersion": 1,
        "source": MFM_ROOT,
        "version": args.version,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "factions": factions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"version": args.version, "factions": len(factions), "attachments": total}, indent=2))


if __name__ == "__main__":
    main()
