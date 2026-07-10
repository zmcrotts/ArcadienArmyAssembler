"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSelectionTree } = require("../src/bsdata/selection-tree");

function treeIndex(entries = [], groups = []) {
  return {
    entries: new Map(entries.map(item => [item.id, item])),
    groups: new Map(groups.map(item => [item.id, item]))
  };
}

test("Mark of Chaos only survives import on Daemon Prince entries", () => {
  const markGroup = {
    id: "mark-group",
    name: "Mark of Chaos",
    selectionEntryGroup: {},
    selectionEntries: { selectionEntry: [] },
    entryLinks: { entryLink: [] }
  };
  const index = treeIndex([], [markGroup]);

  const standardUnit = {
    id: "legionaries",
    name: "Legionaries",
    type: "selectionEntry",
    entryLinks: { entryLink: [{ id: "mark-link", name: "Mark of Chaos", type: "selectionEntryGroup", targetId: "mark-group" }] }
  };
  const daemonPrince = {
    id: "daemon-prince",
    name: "Heretic Astartes Daemon Prince",
    type: "selectionEntry",
    entryLinks: { entryLink: [{ id: "mark-link", name: "Mark of Chaos", type: "selectionEntryGroup", targetId: "mark-group" }] }
  };

  const standardTree = buildSelectionTree(standardUnit, index);
  const daemonTree = buildSelectionTree(daemonPrince, index);

  assert.equal(standardTree.children.some(child => child.name === "Mark of Chaos"), false);
  assert.equal(daemonTree.children.some(child => child.name === "Mark of Chaos"), true);
});
