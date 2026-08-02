#!/usr/bin/env python3
"""Extract every current enhancement/upgrade points row from GW's MFM pages."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "reports" / "mfm-current-all-enhancements.json"
POINTS_RE = re.compile(r"(\d+)\s*pts\b", re.I)

spec = importlib.util.spec_from_file_location("mfm_points", ROOT / "scripts" / "scrape-mfm-points.py")
mfm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mfm)


def extract_page(faction: str, url: str):
    request = Request(url, headers={"User-Agent": "ArcadienArmyAssembler-MFM-Audit/1.1"})
    document = html.fromstring(urlopen(request, timeout=30).read())
    replacements = mfm.replacement_map(document)
    rows = {}
    for span in document.xpath("//span"):
        price_text = mfm.resolved_text(span, replacements)
        points_match = POINTS_RE.fullmatch(price_text)
        if not points_match:
            continue
        logical = mfm.logical_price_node(document, span)
        group = mfm.ancestor(logical, lambda item: item.tag == "div" and mfm.class_has(item, "space-y-1"))
        card = mfm.ancestor(
            logical,
            lambda item: item.tag == "div" and mfm.class_has(item, "print:break-inside-avoid-page"),
        )
        if group is None or card is None or mfm.direct_heading(group, replacements) != "ENHANCEMENTS":
            continue
        name_row = mfm.ancestor(logical, lambda item: item.tag == "div" and mfm.class_has(item, "justify-between"))
        if name_row is None or not len(name_row):
            continue
        name = mfm.resolved_text(name_row[0], replacements)
        title = re.sub(r"\s+\d+DP\b.*$", "", mfm.card_title(card, replacements)).strip()
        key = (title, name)
        rows[key] = {
            "faction": faction,
            "sourceUrl": url,
            "detachmentName": title,
            "enhancementName": name,
            "points": int(points_match.group(1)),
        }
    return list(rows.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    points_source = json.loads(
        (ROOT / "data" / "manual-rules" / "wh40k-11e-mfm-points.json").read_text(encoding="utf-8")
    )
    pages = {}
    for change in points_source.get("changes", []):
        pages.setdefault(change["sourceUrl"], change["faction"])
    pages.setdefault("https://mfm.warhammer-community.com/en/imperial-knights", "Imperial Knights")
    enhancements = []
    for url, faction in sorted(pages.items(), key=lambda item: item[1]):
        enhancements.extend(extract_page(faction, url))
    payload = {
        "schemaVersion": 1,
        "source": "https://mfm.warhammer-community.com/en",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "enhancements": sorted(
            enhancements,
            key=lambda item: (item["faction"], item["detachmentName"], item["enhancementName"]),
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"pages": len(pages), "enhancements": len(enhancements), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
