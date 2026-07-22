#!/usr/bin/env python3
"""Extract the complete MFM v1.1 detachment DP/disposition schedule."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
MFM_ROOT = "https://mfm.warhammer-community.com/en"
DEFAULT_OUTPUT = ROOT / "data" / "manual-rules" / "wh40k-11e-mfm-detachments.json"
DP_RE = re.compile(r"(\d+)\s*DP\b", re.I)
DISPOSITION_NAMES = {
    "DISRUPTION": "Disruption",
    "PRIORITY ASSETS": "Priority Assets",
    "PURGE THE FOE": "Purge the Foe",
    "RECONNAISSANCE": "Reconnaissance",
    "TAKE AND HOLD": "Take and Hold",
}


def load_points_helpers():
    path = Path(__file__).with_name("scrape-mfm-points.py")
    spec = importlib.util.spec_from_file_location("scrape_mfm_points", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch_document(url: str):
    request = Request(url, headers={"User-Agent": "ArcadienArmyAssembler-MFM/1.1"})
    return html.fromstring(urlopen(request, timeout=30).read())


def faction_pages():
    document = fetch_document(MFM_ROOT)
    urls = {
        urljoin(MFM_ROOT, href)
        for href in document.xpath("//a/@href")
        if re.fullmatch(r"/en/[a-z0-9-]+", href or "")
    }
    return sorted(urls)


def extract_page(url: str, helpers):
    document = fetch_document(url)
    replacements = helpers.replacement_map(document)
    faction_slug = urlparse(url).path.rstrip("/").split("/")[-1]
    rows = []
    for card in document.xpath("//div[contains(@class,'print:break-inside-avoid-page')]"):
        if len(card) < 2 or len(card[0]) < 2:
            continue
        header = card[0]
        dp_text = helpers.resolved_text(header[-1], replacements)
        dp_match = DP_RE.search(dp_text)
        if not dp_match:
            continue
        name = helpers.resolved_text(header[0], replacements)
        disposition = helpers.resolved_text(card[1], replacements)
        if not name or not disposition:
            continue
        card_text = helpers.resolved_text(card, replacements)
        rows.append({
            "factionSlug": faction_slug,
            "sourceUrl": url,
            "detachmentName": name,
            "detachmentPoints": int(dp_match.group(1)),
            "forceDisposition": DISPOSITION_NAMES.get(disposition.upper(), disposition),
            "dispositionChanged": "FORCE DISPOSITION(S) CHANGED" in card_text,
            "detachmentPointsChanged": "▲" in dp_text or "▼" in dp_text,
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    helpers = load_points_helpers()
    rows = []
    for url in faction_pages():
        rows.extend(extract_page(url, helpers))
    rows.sort(key=lambda item: (item["factionSlug"], item["detachmentName"]))
    payload = {
        "schemaVersion": 1,
        "source": MFM_ROOT,
        "version": "1.1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "detachments": rows,
    }
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "total": len(rows),
        "factions": len({item["factionSlug"] for item in rows}),
        "dispositionChanges": sum(item["dispositionChanged"] for item in rows),
        "detachmentPointChanges": sum(item["detachmentPointsChanged"] for item in rows),
    }, indent=2))


if __name__ == "__main__":
    main()
