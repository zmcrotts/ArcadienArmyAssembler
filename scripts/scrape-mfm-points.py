#!/usr/bin/env python3
"""Extract every labelled MFM v1.1 points change from GW's streamed HTML."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "manual-rules" / "wh40k-11e-mfm-points.json"
POINTS_RE = re.compile(r"(\d+)\s*pts\b", re.I)


def clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def class_has(element, token: str) -> bool:
    return token in (element.get("class") or "").split()


def ancestor(element, predicate):
    current = element
    while current is not None:
        if predicate(current):
            return current
        current = current.getparent()
    return None


def replacement_map(document):
    return {
        item.get("id").replace("S:", "P:", 1): item
        for item in document.xpath("//*[@id and starts-with(@id, 'S:')]")
    }


def resolved_text(element, replacements, seen=None) -> str:
    if element is None:
        return ""
    seen = set() if seen is None else seen
    if element.tag == "template" and (element.get("id") or "").startswith("P:"):
        key = element.get("id")
        if key in seen:
            return ""
        replacement = replacements.get(key)
        if replacement is None:
            return ""
        return resolved_text(replacement, replacements, seen | {key})
    parts = [element.text or ""]
    for child in element:
        if child.tag != "script":
            parts.append(resolved_text(child, replacements, seen))
        parts.append(child.tail or "")
    return clean_text(" ".join(parts))


def resolved_class_contains(element, replacements, fragments, seen=None) -> bool:
    if element is None:
        return False
    seen = set() if seen is None else seen
    if element.tag == "template" and (element.get("id") or "").startswith("P:"):
        key = element.get("id")
        if key in seen:
            return False
        replacement = replacements.get(key)
        return replacement is not None and resolved_class_contains(replacement, replacements, fragments, seen | {key})
    if any(fragment in (element.get("class") or "") for fragment in fragments):
        return True
    return any(resolved_class_contains(child, replacements, fragments, seen) for child in element if child.tag != "script")


def logical_price_node(document, span):
    streamed = ancestor(span, lambda item: (item.get("id") or "").startswith("S:"))
    if streamed is None:
        return span
    target_id = streamed.get("id").replace("S:", "P:", 1)
    targets = document.xpath(f"//*[@id='{target_id}']")
    return targets[0] if targets else span


def direct_heading(group, replacements) -> str:
    for child in group:
        if child.tag == "div":
            text = resolved_text(child, replacements)
            if text:
                return text
    return ""


def card_title(card, replacements) -> str:
    if card is None or not len(card):
        return ""
    first = card[0]
    title = resolved_text(first, replacements)
    return re.sub(r"(?:\s*[▲▼]\s*)+$", "", title).strip()


def extract_page(faction: str, url: str):
    request = Request(url, headers={"User-Agent": "ArcadienArmyAssembler-MFM/1.1"})
    document = html.fromstring(urlopen(request, timeout=30).read())
    replacements = replacement_map(document)
    changes = []

    # A coloured unit header means the schedule itself changed. In that case GW
    # can leave some of its current tier totals black, so capture every unit-cost
    # row on the card. Wargear remains opt-in by its own coloured price.
    cards = document.xpath("//div[contains(@class,'print:break-inside-avoid-page')]")
    for card in cards:
        if not len(card):
            continue
        title_node = card[0]
        title = card_title(card, replacements)
        if not title:
            continue
        changed_header = resolved_class_contains(title_node, replacements, ("bg-red", "bg-emerald", "bg-green"))
        for group in card:
            if group.tag != "div" or not class_has(group, "space-y-1"):
                continue
            heading = direct_heading(group, replacements)
            if not (heading.startswith("YOUR ") or heading == "WARGEAR OPTIONS"):
                continue
            for row in group.xpath(".//ul/li"):
                if len(row) < 2:
                    continue
                label = resolved_text(row[0], replacements)
                price_node = row[-1]
                price_text = resolved_text(price_node, replacements)
                points_match = POINTS_RE.search(price_text)
                if not points_match:
                    continue
                changed_price = resolved_class_contains(price_node, replacements, ("text-red", "text-emerald", "text-green"))
                if not changed_price and not changed_header:
                    continue
                changes.append({
                    "kind": "wargear" if heading == "WARGEAR OPTIONS" else "unit",
                    "faction": faction,
                    "sourceUrl": url,
                    "unitName": title,
                    "costBand": heading,
                    "label": label,
                    "points": int(points_match.group(1)),
                })

    # Enhancements are not unit cards; their changed prices are individually
    # coloured and can be read directly from their list rows.
    spans = document.xpath(
        "//span[contains(@class,'text-emerald-600') or contains(@class,'text-red-500')]"
    )
    for span in spans:
        price_text = clean_text(" ".join(span.itertext()))
        points_match = POINTS_RE.search(price_text)
        if not points_match:
            continue
        points = int(points_match.group(1))
        logical = logical_price_node(document, span)
        row = ancestor(logical, lambda item: item.tag == "li")
        group = ancestor(logical, lambda item: item.tag == "div" and class_has(item, "space-y-1"))
        card = ancestor(logical, lambda item: item.tag == "div" and class_has(item, "print:break-inside-avoid-page"))
        heading = direct_heading(group, replacements) if group is not None else ""

        if heading != "ENHANCEMENTS":
            continue
        name_row = ancestor(logical, lambda item: item.tag == "div" and class_has(item, "justify-between"))
        name = resolved_text(name_row[0], replacements) if name_row is not None and len(name_row) else ""
        changes.append({
            "kind": "enhancement",
            "faction": faction,
            "sourceUrl": url,
            "detachmentName": re.sub(r"\s+\d+DP\b.*$", "", card_title(card, replacements)).strip(),
            "enhancementName": name,
            "points": points,
        })
    return changes


def sort_key(change):
    return (
        change["kind"], change["faction"], change.get("detachmentName", ""),
        change.get("unitName", ""), change.get("costBand", ""),
        change.get("enhancementName", ""), change.get("label", ""), change["points"]
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    previous = json.loads(args.output.read_text(encoding="utf-8"))
    pages = {}
    for change in previous.get("changes", []):
        pages.setdefault(change["sourceUrl"], change["faction"])
    changes = []
    for url, faction in sorted(pages.items(), key=lambda item: item[1]):
        changes.extend(extract_page(faction, url))
    payload = {
        "schemaVersion": 1,
        "source": "https://mfm.warhammer-community.com/en",
        "version": "1.1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "changes": sorted(changes, key=sort_key),
    }
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = {kind: sum(item["kind"] == kind for item in changes) for kind in ("unit", "wargear", "enhancement")}
    print(json.dumps({"total": len(changes), **counts}, indent=2))


if __name__ == "__main__":
    main()
