"""Compare roster enhancement records with the current local faction-pack PDFs."""

from __future__ import annotations

import json
import argparse
import re
import subprocess
import unicodedata
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "downloads" / "warhammer-40000" / "2026-07-22" / "faction-packs"


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def slug(value: str) -> str:
    return normalized(value).replace(" ", "-")


def snapshot() -> list[dict]:
    script = r"""
const { extractNormalizedRuleset } = require("./src/rulesets/sources");
const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
const nameByKey = new Map(ruleset.units.map(unit => [unit.selectionKey, unit.name]));
process.stdout.write(JSON.stringify(ruleset.armies.map(army => ({
  faction: army.faction,
  units: ruleset.units.filter(unit => unit.faction === army.faction).map(unit => ({
    name: unit.name,
    keywords: unit.keywords || []
  })),
  detachments: Object.fromEntries((army.detachments || []).map(item => [item.id, item.name])),
  enhancements: (army.enhancements || []).map(item => ({
    name: item.name,
    kind: item.kind,
    maxSelections: item.maxSelections,
    detachments: (item.detachmentIds || []).map(id => army.detachments.find(detachment => detachment.id === id)?.name || id),
    eligibleNames: (item.eligibleSelectionKeys || []).map(key => nameByKey.get(key)).filter(Boolean),
    description: [
      ...(item.profiles || []).map(profile => profile.characteristics?.Description),
      ...(item.rules || []).map(rule => rule.description)
    ].filter(Boolean).join(" ")
  }))
}))));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def faction_for_pdf(stem: str, factions: list[str]) -> str | None:
    wanted = normalized(stem.removeprefix("Faction Pack - "))
    exact = [faction for faction in factions if normalized(faction.split(" - ")[-1]) == wanted]
    if exact:
        return exact[0]
    aliases = {
        "space marines": "Imperium - Adeptus Astartes - Space Marines",
        "black templars": "Imperium - Adeptus Astartes - Black Templars",
        "blood angels": "Imperium - Adeptus Astartes - Blood Angels",
        "dark angels": "Imperium - Adeptus Astartes - Dark Angels",
        "space wolves": "Imperium - Adeptus Astartes - Space Wolves",
    }
    return aliases.get(wanted)


def page_text(pdf_path: Path) -> list[str]:
    return [
        (page.extract_text(extraction_mode="layout") or "")
        for page in PdfReader(str(pdf_path)).pages
    ]


def title_pattern(name: str) -> re.Pattern[str]:
    words = [re.escape(word) for word in re.findall(r"[A-Za-z0-9]+", name)]
    title = r"[^A-Za-z0-9\r\n]+".join(words)
    return re.compile(
        rf"^[ \t]*{title}(?=[ \t]{{2,}}|[ \t]+UPGRADE\b|[ \t]*$)",
        flags=re.IGNORECASE | re.MULTILINE,
    )


def find_record_window(pages: list[str], name: str, enhancement_names: list[str]) -> tuple[int, str] | None:
    wanted = normalized(name)
    for page_number, text in enumerate(pages, start=1):
        match = title_pattern(name).search(text)
        if match:
            end = len(text)
            for other_name in enhancement_names:
                if normalized(other_name) == wanted:
                    continue
                other = title_pattern(other_name).search(text, match.end())
                if other and other.start() < end:
                    end = other.start()
            return page_number, text[match.start():end]
    return None


LIMIT_RE = re.compile(
    r"(?im)^(?!ENHANCEMENTS\b)([A-Z][A-Z0-9À-ÖØ-Þ'’ /,\-‑]+?\b(?:model|unit)s? only"
    r"(?:\s*\([^.\n]+\))?\.)"
)


def official_limiter(window: str) -> str | None:
    # Upgrade/enhancement flavour precedes the bearer restriction. The first
    # all-caps "model/unit only" sentence is therefore the authoritative limiter.
    match = LIMIT_RE.search(window[:2200])
    if not match:
        return None
    return re.sub(r"\s+", " ", match.group(1)).strip()


def reliable_limiter(limiter: str) -> bool:
    """Reject obvious two-column extraction joins before generating runtime data."""
    subject = re.sub(
        r"\s+(?:model|unit)s?\s+only(?:\s*\([^)]*\))?\.$",
        "",
        limiter,
        flags=re.IGNORECASE,
    )
    words = re.findall(r"[A-Za-z0-9À-ÖØ-öø-ÿ]+", subject)
    return (
        bool(subject)
        and not subject[0].islower()
        and len(words) <= 9
        and not re.search(r"(?:^|\s)['\"]|['\"](?:\s|$)", subject)
    )


def unit_tags(unit: dict) -> set[str]:
    tags = {normalized(unit["name"])}
    for keyword in unit.get("keywords", []):
        tag = normalized(keyword)
        tags.add(tag)
        if tag.startswith("faction "):
            tags.add(tag.removeprefix("faction ").strip())
    return {tag for tag in tags if tag}


def words_segmented_by_tags(phrase: str, tags: set[str]) -> bool:
    words = normalized(phrase).split()
    memo: dict[int, bool] = {}

    def visit(index: int) -> bool:
        if index == len(words):
            return True
        if index in memo:
            return memo[index]
        for end in range(len(words), index, -1):
            if " ".join(words[index:end]) in tags and visit(end):
                memo[index] = True
                return True
        memo[index] = False
        return False

    return visit(0)


def phrase_matches_tags(phrase: str, tags: set[str]) -> bool:
    clean = re.sub(r"\b(?:friendly)\b", "", phrase, flags=re.IGNORECASE).strip()
    if "/" in clean:
        left, right = clean.split("/", 1)
        right_words = right.split()
        # "INFANTRY/MOUNTED THOUSAND SONS PSYKER" means either the
        # left keyword or the first right keyword, plus the shared suffix.
        if len(right_words) > 1:
            suffix = " ".join(right_words[1:])
            return (
                words_segmented_by_tags(f"{left} {suffix}", tags)
                or words_segmented_by_tags(right, tags)
            )
        return words_segmented_by_tags(left, tags) or words_segmented_by_tags(right, tags)
    alternatives = re.split(r"\s+or\s+", clean, flags=re.IGNORECASE)
    return any(words_segmented_by_tags(option, tags) for option in alternatives)


def unit_matches_limiter(unit: dict, limiter: str) -> bool:
    subject_match = re.match(
        r"(.+?)\s+(?:model|unit)s?\s+only(?:\s*\(([^)]*)\))?\.",
        limiter,
        flags=re.IGNORECASE,
    )
    if not subject_match:
        return True
    tags = unit_tags(unit)
    if not phrase_matches_tags(subject_match.group(1), tags):
        return False
    exclusion = subject_match.group(2) or ""
    exclusion = re.sub(r"^excluding\s+", "", exclusion, flags=re.IGNORECASE)
    exclusion = re.sub(r"\s+(?:models|units)$", "", exclusion, flags=re.IGNORECASE)
    return not exclusion or not phrase_matches_tags(exclusion, tags)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["enhancement", "upgrade"])
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--output")
    parser.add_argument("--emit-updates", action="store_true")
    args = parser.parse_args()
    armies = snapshot()
    by_faction = {army["faction"]: army for army in armies}
    findings: list[dict] = []
    verified_records: list[dict] = []
    matched = 0

    for pdf_path in sorted(PDF_DIR.glob("Faction Pack - *.pdf")):
        faction = faction_for_pdf(pdf_path.stem, list(by_faction))
        if not faction:
            continue
        army = by_faction[faction]
        pages = page_text(pdf_path)
        enhancement_names = [item["name"] for item in army["enhancements"]]
        for enhancement in army["enhancements"]:
            if args.kind and enhancement["kind"] != args.kind:
                continue
            located = find_record_window(pages, enhancement["name"], enhancement_names)
            if not located:
                continue
            matched += 1
            page_number, window = located
            limiter = official_limiter(window)
            app_description = enhancement["description"]
            if not limiter or not reliable_limiter(limiter):
                continue
            limiter_present = normalized(limiter) in normalized(app_description)
            eligible_units = [
                unit for unit in army["units"]
                if unit["name"] in enhancement["eligibleNames"]
            ]
            verified_eligible_names = [
                unit["name"] for unit in eligible_units if unit_matches_limiter(unit, limiter)
            ]
            ineligible_names = [
                unit["name"] for unit in eligible_units if not unit_matches_limiter(unit, limiter)
            ]
            verified_records.append({
                "faction": faction,
                "detachment": enhancement["detachments"],
                "name": enhancement["name"],
                "pdf": pdf_path.name,
                "page": page_number,
                "officialLimiter": limiter,
                "verifiedEligibleNames": verified_eligible_names,
                "ineligibleNames": ineligible_names,
            })
            if not limiter_present:
                findings.append({
                    "faction": faction,
                    "detachment": enhancement["detachments"],
                    "name": enhancement["name"],
                    "kind": enhancement["kind"],
                    "maxSelections": enhancement["maxSelections"],
                    "pdf": pdf_path.name,
                    "page": page_number,
                    "officialLimiter": limiter,
                    "appDescription": app_description,
                    "eligibleNames": enhancement["eligibleNames"],
                    "verifiedEligibleNames": verified_eligible_names,
                    "ineligibleNames": ineligible_names,
                    "issue": "limiter-missing-or-different",
                })

    summary = {
        "pdfs": len(list(PDF_DIR.glob("Faction Pack - *.pdf"))),
        "armies": len(armies),
        "enhancements": sum(len(army["enhancements"]) for army in armies),
        "upgrades": sum(
            enhancement["kind"] == "upgrade"
            for army in armies
            for enhancement in army["enhancements"]
        ),
        "matchedToFactionPack": matched,
        "limiterFindings": len(findings),
        "eligibilityFindings": sum(bool(item["ineligibleNames"]) for item in verified_records),
    }
    if args.emit_updates:
        update_records = verified_records
        document = {
            "schemaVersion": 1,
            "source": "Warhammer 40,000 Faction Packs v1.1 - Enhancement Restrictions",
            "version": "1.1",
            "lastUpdated": "2026-07-23",
            "updates": [{
                "id": f"restriction-{slug(item['faction'])}-{slug(item['name'])}",
                "kind": "enhancement-restriction",
                "target": (
                    {"factionPrefix": "Imperium - Adeptus Astartes"}
                    if item["faction"] == "Imperium - Adeptus Astartes - Space Marines"
                    else {"faction": item["faction"]}
                ),
                "detachmentName": item["detachment"][0] if item["detachment"] else None,
                "enhancementName": item["name"],
                "restriction": item["officialLimiter"],
                "source": f"{item['pdf'].removesuffix('.pdf')} v1.1, page {item['page']}",
            } for item in update_records],
        }
    elif args.compact:
        compact = [{
            "faction": item["faction"],
            "detachment": item["detachment"],
            "name": item["name"],
            "officialLimiter": item["officialLimiter"],
            "eligibleNames": item["eligibleNames"],
        } for item in findings]
        document = {
            "summary": summary,
            "findings": compact,
            "eligibilityFindings": [{
                "faction": item["faction"],
                "detachment": item["detachment"],
                "name": item["name"],
                "officialLimiter": item["officialLimiter"],
                "verifiedEligibleNames": item["verifiedEligibleNames"],
                "ineligibleNames": item["ineligibleNames"],
            } for item in verified_records if item["ineligibleNames"]],
        }
    else:
        document = {"summary": summary, "findings": findings}
    rendered = json.dumps(document, indent=2, ensure_ascii=False)
    if args.output:
        output_path = ROOT / args.output
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + "\n", encoding="utf-8")
        print(json.dumps(summary, indent=2))
        print(f"Report: {output_path}")
    else:
        print(rendered)


if __name__ == "__main__":
    main()
