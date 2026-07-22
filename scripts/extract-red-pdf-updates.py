#!/usr/bin/env python3
"""Inventory red revision text in GW PDF update packs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pdfplumber
from pdfplumber.utils import extract_text


def is_red(color: Any) -> bool:
    if not isinstance(color, (tuple, list)):
        return False

    values = tuple(float(value) for value in color)
    if len(values) == 4:
        cyan, magenta, yellow, black = values
        return cyan <= 0.25 and magenta >= 0.8 and yellow >= 0.8 and black <= 0.5

    if len(values) == 3:
        red, green, blue = values
        scale = 255.0 if max(values) > 1.0 else 1.0
        return red >= 0.55 * scale and red >= green * 1.5 and red >= blue * 1.5

    return False


def inspect_pdf(path: Path, root: Path) -> dict[str, Any]:
    candidate_pages: list[dict[str, Any]] = []
    revision_start_page: int | None = None

    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            if revision_start_page is None and "highlighted in red" in page_text.lower():
                revision_start_page = page_number

            red_characters = [
                character
                for character in page.chars
                if is_red(character.get("non_stroking_color"))
            ]
            if not red_characters:
                continue

            red_text = extract_text(
                red_characters,
                x_tolerance=2,
                y_tolerance=3,
                layout=False,
            ).strip()
            if not red_text:
                continue

            red_text = "\n".join(
                line
                for line in red_text.splitlines()
                if line.strip().lower() != "highlighted in red"
            ).strip()
            if not red_text:
                continue

            candidate_pages.append(
                {
                    "page": page_number,
                    "redCharacterCount": len(red_characters),
                    "redText": red_text,
                }
            )

    changed_pages = [
        page
        for page in candidate_pages
        if revision_start_page is None or page["page"] >= revision_start_page
    ]
    total_red_characters = sum(page["redCharacterCount"] for page in changed_pages)

    return {
        "file": str(path.relative_to(root)),
        "revisionStartPage": revision_start_page,
        "redCharacterCount": total_red_characters,
        "changedPageCount": len(changed_pages),
        "changedPages": changed_pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, help="Directory containing PDF files")
    parser.add_argument("--json", type=Path, help="Optional JSON report path")
    args = parser.parse_args()

    root = args.root.resolve()
    pdf_paths = sorted(root.rglob("*.pdf"))
    results = [inspect_pdf(path, root) for path in pdf_paths]
    payload = {
        "sourceRoot": str(root),
        "pdfCount": len(results),
        "redCharacterCount": sum(item["redCharacterCount"] for item in results),
        "changedPageCount": sum(item["changedPageCount"] for item in results),
        "documents": results,
    }

    for item in results:
        print(
            f'{item["redCharacterCount"]:6} chars | '
            f'{item["changedPageCount"]:3} pages | {item["file"]}'
        )

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
