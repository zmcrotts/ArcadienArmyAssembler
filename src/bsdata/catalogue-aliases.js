"use strict";

const GENERIC_SUBJECT_WORDS = new Set([
  "chaos",
  "imperium",
  "xenos",
  "library",
  "index"
]);

function subjectTokens(name) {
  return String(name || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token && !GENERIC_SUBJECT_WORDS.has(token));
}

function sameSubject(left, right) {
  const leftTokens = subjectTokens(left);
  const rightTokens = subjectTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  return leftTokens.join(" ") === rightTokens.join(" ");
}

function isAstartesChapterImport(catalogueName, linkName) {
  return /^imperium - adeptus astartes - /i.test(String(catalogueName || ""))
    && /^imperium - space marines$/i.test(String(linkName || ""));
}

function importsRootEntries(link) {
  return link?.importRootEntries === true || String(link?.importRootEntries).toLowerCase() === "true";
}

function nativeImportedCatalogueLinks(catalogue) {
  const links = catalogue?.catalogueLinks?.catalogueLink;
  const asArray = value => !value ? [] : Array.isArray(value) ? value : [value];
  return asArray(links).filter(link =>
    importsRootEntries(link) && (sameSubject(catalogue?.name, link.name) || isAstartesChapterImport(catalogue?.name, link.name))
  );
}

module.exports = {
  nativeImportedCatalogueLinks,
  sameSubject,
  subjectTokens
};
