const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const BS_DATA_DIR = path.join(
  ROOT,
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

const OUT_DIR = path.join(ROOT, "data", "builder-rules");
const OUT_FILE = path.join(OUT_DIR, "leader-attachments-raw.json");

function decodeXmlText(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\^\^/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function getFiles(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...getFiles(fullPath));
    } else if (entry.name.endsWith(".cat") || entry.name.endsWith(".gst")) {
      out.push(fullPath);
    }
  }

  return out;
}

function attr(block, name) {
  const match = block.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXmlText(match[1]) : null;
}

function cleanTarget(text) {
  return decodeXmlText(text)
    .replace(/^[-■•]\s*/, "")
    .replace(/[.;]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitOutsideParens(text) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);

    if ((ch === "," || ch === ";") && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());

  return parts;
}

function isIntroLine(line) {
  const lower = line.toLowerCase();

  return (
    lower.startsWith("this model can be attached") ||
    lower.startsWith("this unit can be attached") ||
    lower.startsWith("this model must be attached") ||
    lower.startsWith("this unit must be attached") ||
    lower.startsWith("this model can lead") ||
    lower.startsWith("this unit can join")
  );
}

function isReminderLine(line) {
  const lower = line.toLowerCase();

  return (
    lower.startsWith("you can attach") ||
    lower.startsWith("you must attach") ||
    lower.startsWith("at the start of") ||
    lower.startsWith("if it does") ||
    lower.startsWith("until the end") ||
    lower.includes("bodyguard unit is destroyed") ||
    lower.includes("leader units attached") ||
    lower.includes("cannot be deployed") ||
    lower.includes("does not take part")
  );
}

function isRestrictionLine(line) {
  const lower = line.toLowerCase();

  return (
    lower.includes("cannot be attached") ||
    lower.includes("unless it is equipped") ||
    lower.includes("unless equipped")
  );
}

function parseRestrictions(rawText) {
  const text = decodeXmlText(rawText)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const restrictions = [];

  const cannotMatch = text.match(/this model cannot be attached.+$/i);
  if (cannotMatch) {
    restrictions.push(cannotMatch[0].trim());
  }

  return restrictions;
}

function parseTargets(rawText) {
  const text = decodeXmlText(rawText);

  const targets = [];

  const lines = text
    .split(/\r?\n/)
    .map(line => cleanTarget(line))
    .filter(Boolean);

  for (const line of lines) {
    if (isIntroLine(line)) {
      const afterColon = line.split(":").slice(1).join(":").trim();

      if (afterColon && !isRestrictionLine(afterColon) && !isReminderLine(afterColon)) {
        targets.push(...splitOutsideParens(afterColon).map(cleanTarget).filter(Boolean));
      }

      continue;
    }

    if (isRestrictionLine(line)) continue;
    if (isReminderLine(line)) continue;

    targets.push(...splitOutsideParens(line).map(cleanTarget).filter(Boolean));
  }

  const seen = new Set();

  return targets.filter(target => {
    const key = target.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findOwnerSelectionEntry(text, profileStart) {
  let search = profileStart;

  while (search > 0) {
    const start = text.lastIndexOf("<selectionEntry", search);
    if (start === -1) return null;

    const openEnd = text.indexOf(">", start);
    if (openEnd === -1 || openEnd > profileStart) {
      search = start - 1;
      continue;
    }

    const openTag = text.slice(start, openEnd + 1);
    const type = attr(openTag, "type");

    if (type === "model" || type === "unit") {
      return openTag;
    }

    search = start - 1;
  }

  return null;
}

function guessOwnerName(text, profileStart) {
  const ownerTag = findOwnerSelectionEntry(text, profileStart);
  if (!ownerTag) return null;
  return attr(ownerTag, "name");
}

function extractLeaderProfilesFromText(text, sourceFile) {
  const records = [];

  const profileRegex =
    /<profile\b[^>]*name="Leader"[^>]*typeName="Abilities"[^>]*>[\s\S]*?<\/profile>/g;

  let match;

  while ((match = profileRegex.exec(text)) !== null) {
    const profileBlock = match[0];

    const descMatch = profileBlock.match(
      /<characteristic\b[^>]*name="Description"[^>]*>([\s\S]*?)<\/characteristic>/
    );

    if (!descMatch) continue;

    const rawText = decodeXmlText(descMatch[1]);
    if (!rawText) continue;

    records.push({
      unitName: guessOwnerName(text, match.index),
      sourceFile,
      profileId: attr(profileBlock, "id"),
      rawText,
      parsedTargets: parseTargets(rawText),
      restrictionsRaw: parseRestrictions(rawText)
    });
  }

  return records;
}

function main() {
  if (!fs.existsSync(BS_DATA_DIR)) {
    throw new Error(`BSData directory not found: ${BS_DATA_DIR}`);
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const files = getFiles(BS_DATA_DIR);
  const all = [];

  for (const file of files) {
    const relFile = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    all.push(...extractLeaderProfilesFromText(text, relFile));
  }

  const deduped = [];
  const seen = new Set();

  for (const item of all) {
    const key = [
      item.sourceFile,
      item.unitName,
      item.profileId,
      item.rawText
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => {
    const fileCompare = String(a.sourceFile).localeCompare(String(b.sourceFile));
    if (fileCompare !== 0) return fileCompare;
    return String(a.unitName).localeCompare(String(b.unitName));
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(deduped, null, 2), "utf8");

  const nullOwners = deduped.filter(x => !x.unitName).length;
  const emptyTargets = deduped.filter(x => x.parsedTargets.length === 0).length;
  const withRestrictions = deduped.filter(x => x.restrictionsRaw.length > 0).length;

  console.log(`BSData files scanned: ${files.length}`);
  console.log(`Leader attachment records found: ${deduped.length}`);
  console.log(`Records with null unitName: ${nullOwners}`);
  console.log(`Records with empty parsedTargets: ${emptyTargets}`);
  console.log(`Records with restrictionsRaw: ${withRestrictions}`);
  console.log(`Wrote: ${path.relative(ROOT, OUT_FILE)}`);
}

main();