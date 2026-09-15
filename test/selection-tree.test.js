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

test("empty profile characteristics normalize to blank text", () => {
  const unit = {
    id: "forgefiend",
    name: "Forgefiend",
    type: "selectionEntry",
    profiles: {
      profile: [{
        id: "claws",
        name: "Forgefiend claws",
        typeName: "Melee Weapons",
        characteristics: {
          characteristic: [
            { name: "A", "#text": "3" },
            { name: "Keywords" }
          ]
        }
      }]
    }
  };

  const tree = buildSelectionTree(unit, treeIndex());

  assert.equal(tree.profiles[0].characteristics.A, "3");
  assert.equal(tree.profiles[0].characteristics.Keywords, "");
});

test("plural psychic ability descriptions normalize to the canonical Description field", () => {
  const unit = {
    id: "kill-rig",
    name: "Kill Rig",
    type: "selectionEntry",
    profiles: {
      profile: [{
        id: "warpath",
        name: "Warpath (psyker level 1)",
        typeName: "Psychic Abilities",
        characteristics: {
          characteristic: [{ name: "Descriptions", "#text": "Warpath rules text." }]
        }
      }]
    }
  };

  const tree = buildSelectionTree(unit, treeIndex());

  assert.equal(tree.profiles[0].characteristics.Descriptions, "Warpath rules text.");
  assert.equal(tree.profiles[0].characteristics.Description, "Warpath rules text.");
});
test("Mark of Chaos becomes a mandatory four-choice God Blessing only for CSM Daemon Princes", () => {
  const markGroup = {
    id: "mark-group",
    name: "Mark of Chaos",
    selectionEntryGroup: {},
    constraints: {
      constraint: [
        { id: "mark-min", type: "min", field: "selections", scope: "parent", value: 0 },
        { id: "mark-max", type: "max", field: "selections", scope: "parent", value: 1 }
      ]
    },
    selectionEntries: {
      selectionEntry: ["Khorne", "Nurgle", "Slaanesh", "Tzeentch", "Chaos Undivided"].map((name, index) => ({
        id: `mark-${index}`,
        name,
        type: "upgrade"
      }))
    },
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
  const blessing = daemonTree.children.find(child => child.name === "God Blessing");
  assert.ok(blessing);
  assert.deepEqual(blessing.children.map(child => child.name), ["Khorne", "Nurgle", "Slaanesh", "Tzeentch"]);
  assert.equal(blessing.constraints.find(item => item.type === "min").value, 1);
  assert.equal(blessing.constraints.find(item => item.type === "max").value, 1);
});
