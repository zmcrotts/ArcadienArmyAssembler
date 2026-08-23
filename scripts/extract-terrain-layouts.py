"""Extract Chapter Approved battlefield layouts and build their runtime manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pypdfium2 as pdfium


DPI = 300
CROP_POINTS = (101, 273, 495, 745)
WEBP_QUALITY = 85
WEBP_METHOD = 6
PAIRINGS = (
    (9, "Take and Hold", "Battlefield Dominance", "Take and Hold", "Battlefield Dominance"),
    (12, "Take and Hold", "Immovable Object", "Purge the Foe", "Unstoppable Force"),
    (15, "Take and Hold", "Determined Acquisition", "Disruption", "Death Trap"),
    (18, "Take and Hold", "Purge and Secure", "Reconnaissance", "Reconnaissance Sweep"),
    (21, "Take and Hold", "Inescapable Dominion", "Priority Assets", "Secure Asset"),
    (24, "Purge the Foe", "Meatgrinder", "Purge the Foe", "Meatgrinder"),
    (27, "Purge the Foe", "Punishment", "Disruption", "Delaying Action"),
    (30, "Purge the Foe", "Consecrate", "Reconnaissance", "Triangulation"),
    (33, "Purge the Foe", "Destroyer's Wrath", "Priority Assets", "Vital Link"),
    (36, "Disruption", "Outmanoeuvre", "Disruption", "Outmanoeuvre"),
    (39, "Disruption", "Smoke and Mirrors", "Reconnaissance", "Surveil the Foe"),
    (42, "Disruption", "Locate and Deny", "Priority Assets", "Extract Relic"),
    (45, "Reconnaissance", "Gather Intel", "Reconnaissance", "Gather Intel"),
    (48, "Reconnaissance", "Search and Scour", "Priority Assets", "Vanguard Operation"),
    (51, "Priority Assets", "Sabotage", "Priority Assets", "Sabotage"),
)


def slug(value: str, separator: str = "-") -> str:
    return separator.join("".join(character.lower() if character.isalnum() else " " for character in value).split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "ui" / "assets" / "11th" / "terrain-layouts",
    )
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise FileNotFoundError(args.pdf)
    args.output.mkdir(parents=True, exist_ok=True)

    document = pdfium.PdfDocument(str(args.pdf))
    scale = DPI / 72
    crop = tuple(round(value * scale) for value in CROP_POINTS)
    layouts = []

    for first_page, red_name, red_mission, blue_name, blue_mission in PAIRINGS:
        for option_index, option in enumerate(("a", "b", "c")):
            source_page = first_page + option_index
            file_stem = f"{slug(red_name, '_')}_x_{slug(blue_name, '_')}_option_{option}"
            output_file = args.output / f"{file_stem}.webp"
            page = document[source_page - 1]
            bitmap = page.render(scale=scale, rev_byteorder=True)
            rendered = bitmap.to_pil().convert("RGB")
            image = rendered.crop(crop)
            image.save(
                output_file,
                format="WEBP",
                quality=WEBP_QUALITY,
                method=WEBP_METHOD,
                dpi=(DPI, DPI),
            )
            digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
            layouts.append(
                {
                    "id": file_stem,
                    "redDisposition": {"slug": slug(red_name), "name": red_name, "mission": red_mission},
                    "blueDisposition": {"slug": slug(blue_name), "name": blue_name, "mission": blue_mission},
                    "option": option.upper(),
                    "sourcePage": source_page,
                    "image": f"assets/11th/terrain-layouts/{output_file.name}",
                    "width": image.width,
                    "height": image.height,
                    "sha256": digest,
                }
            )
            image.close()
            rendered.close()
            bitmap.close()
            page.close()

    manifest = {
        "schemaVersion": 1,
        "sourceDocument": args.pdf.name,
        "sourcePageRange": {"first": 9, "last": 53},
        "crop": {"dpi": DPI, "pdfPoints": list(CROP_POINTS)},
        "imageEncoding": {"format": "webp", "quality": WEBP_QUALITY, "method": WEBP_METHOD},
        "layouts": layouts,
    }
    json_text = json.dumps(manifest, indent=2, ensure_ascii=True) + "\n"
    (args.output / "manifest.json").write_text(json_text, encoding="utf-8", newline="\n")
    (args.output / "manifest.js").write_text(
        '"use strict";\nwindow.ArcadienTerrainLayouts = ' + json.dumps(manifest, separators=(",", ":"), ensure_ascii=True) + ";\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Extracted {len(layouts)} terrain layouts to {args.output}")


if __name__ == "__main__":
    main()
