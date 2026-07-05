const fs = require("fs");

function cleanTarget(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function extractTargets(leaderText) {
  if (!leaderText) return [];

  const lower = leaderText.toLowerCase();

  const cannotAttachIndex = lower.indexOf(
    "this model cannot be attached"
  );

  const usableText =
    cannotAttachIndex >= 0
      ? leaderText.substring(0, cannotAttachIndex)
      : leaderText;

  const match =
    usableText.match(
      /attached to the following units[:\-]?\s*(.+)$/is
    );

  if (!match) return [];

  const body = match[1];

  const targets = [];

  let current = "";
  let depth = 0;

  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;

    if (ch === "," && depth === 0) {
      if (current.trim()) {
        targets.push(cleanTarget(current));
      }
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    targets.push(cleanTarget(current));
  }

  return targets.filter(Boolean);
}

module.exports = {
  extractTargets
};