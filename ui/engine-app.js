"use strict";

const engineData = window.ROSTER_ENGINE_DATA;
const engine = window.RosterEngine;
const armyEngine = window.ArmyEngine;
const rosterDocument = window.RosterDocument;
const rosterSheets = window.RosterSheets;
const catalogueSections = window.CatalogueSections;

const startScreen = document.getElementById("startScreen");
const builderShell = document.getElementById("builderShell");
const newRosterModal = document.getElementById("newRosterModal");
const newRosterForm = document.getElementById("newRosterForm");
const deleteRosterModal = document.getElementById("deleteRosterModal");
const deleteRosterMessage = document.getElementById("deleteRosterMessage");
const discordExportModal = document.getElementById("discordExportModal");
const discordExportPreview = document.getElementById("discordExportPreview");
const discordListStyle = document.getElementById("discordListStyle");
const discordMultilineHeader = document.getElementById("discordMultilineHeader");
const discordCombineIdentical = document.getElementById("discordCombineIdentical");
const discordHideSubunits = document.getElementById("discordHideSubunits");
const discordHideBullets = document.getElementById("discordHideBullets");
const discordHidePoints = document.getElementById("discordHidePoints");
const discordCustomColors = document.getElementById("discordCustomColors");
const discordUnitColor = document.getElementById("discordUnitColor");
const discordPointsColor = document.getElementById("discordPointsColor");
const factionSelect = document.getElementById("factionSelect");
const subfactionSelect = document.getElementById("subfactionSelect");
const subfactionControl = document.getElementById("subfactionControl");
const factionReference = document.getElementById("factionReference");
const subfactionReference = document.getElementById("subfactionReference");
const unitList = document.getElementById("unitList");
const rosterList = document.getElementById("rosterList");
const details = document.getElementById("details");
const pointsTotal = document.getElementById("pointsTotal");
const pointsLimitInput = document.getElementById("pointsLimit");
const unitSearch = document.getElementById("unitSearch");
const rosterNameInput = document.getElementById("rosterName");
const rosterSavesSelect = document.getElementById("rosterSaves");
const importJsonFile = document.getElementById("importJsonFile");
const exportMenuToggle = document.getElementById("exportMenuToggle");
const exportMenuPanel = document.getElementById("exportMenuPanel");

const DEFAULT_CATALOGUE_PREFERENCES = {
  agents: true,
  imperialKnights: false,
  chaosKnights: false,
  chaosDaemons: false,
  astraMilitarum: false,
  titans: false,
  unaligned: false,
  legends: true,
  crucible: false
};

let currentFaction = "";
let currentSubfaction = "";
let roster = [];
let selectedInstanceId = null;
let selectedPanel = "configuration";
let searchText = "";
let armyState = null;
let cataloguePreferences = loadCataloguePreferences();
let currentRosterSaveId = null;
let lastSavedRosterSnapshot = null;
let pendingDeleteRosterId = null;
const sidebarDisclosureState = {};
const unitSectionDisclosureState = {};
let appMode = "library";
let newRosterDraft = null;
let compactorSkippableWargear = {};
let lastDiscordExportText = "";
const factionLoadPromises = {};

function init() {
  loadCompactorData();

  for (const group of engineData.factionNavigation || []) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.allegiance;
    for (const faction of group.factions) {
      const option = document.createElement("option");
      option.value = faction.id;
      option.textContent = faction.label;
      optgroup.appendChild(option);
    }
    factionSelect.appendChild(optgroup);
  }

  factionSelect.addEventListener("change", async () => {
    if (!confirmDiscardUnsavedRoster()) {
      factionSelect.value = currentFaction;
      return;
    }
    currentFaction = factionSelect.value;
    currentSubfaction = currentFactionRecord()?.defaultMode || currentFaction;
    appMode = "builder";
    roster = [];
    selectedInstanceId = null;
    selectedPanel = "configuration";
    renderSubfactionControl();
    await loadSelectedFactionData();
    armyState = armyEngine.createArmyState(currentArmyDefinition());
    render();
  });

  subfactionSelect.addEventListener("change", async () => {
    if (!confirmDiscardUnsavedRoster()) {
      subfactionSelect.value = currentSubfaction;
      return;
    }
    currentSubfaction = subfactionSelect.value;
    appMode = "builder";
    roster = [];
    selectedInstanceId = null;
    selectedPanel = "configuration";
    await loadSelectedFactionData();
    armyState = armyEngine.createArmyState(currentArmyDefinition());
    render();
  });

  unitSearch.addEventListener("input", event => {
    searchText = event.target.value.toLowerCase();
    renderUnits();
  });

  pointsLimitInput.addEventListener("input", render);
  rosterNameInput.addEventListener("input", render);
  rosterSavesSelect.addEventListener("change", event => {
    if (event.target.value) loadRosterById(event.target.value);
  });

  document.getElementById("saveRoster").onclick = saveRoster;
  document.getElementById("deleteRoster").onclick = deleteRoster;
  document.getElementById("importJson").onclick = () => importJsonFile.click();
  importJsonFile.addEventListener("change", importRosterJsonFile);
  document.getElementById("exportJson").onclick = () => {
    setExportMenuOpen(false);
    exportRosterJson();
  };
  document.getElementById("openDiscordExport").onclick = () => {
    setExportMenuOpen(false);
    openDiscordExportModal();
  };
  for (const button of document.querySelectorAll(".exportTextFormat")) {
    button.onclick = () => {
      setExportMenuOpen(false);
      exportRosterText(button.dataset.format || "NR");
    };
  }
  document.getElementById("printUnitSheets").onclick = () => {
    setExportMenuOpen(false);
    openSheetPreview("units");
  };
  document.getElementById("printCrusadeSheets").onclick = () => {
    setExportMenuOpen(false);
    openSheetPreview("crusade");
  };
  document.getElementById("showLibrary").onclick = showLibrary;
  document.getElementById("openNewRoster").onclick = openNewRosterModal;
  document.getElementById("cancelDeleteRoster").onclick = closeDeleteRosterModal;
  document.getElementById("confirmDeleteRoster").onclick = confirmPendingRosterDelete;
  document.getElementById("closeDiscordExport").onclick = closeDiscordExportModal;
  document.getElementById("copyDiscordExport").onclick = copyDiscordExport;
  document.getElementById("downloadDiscordExport").onclick = downloadDiscordExport;
  for (const control of discordExportControls()) {
    control.addEventListener("input", renderDiscordExportPreview);
    control.addEventListener("change", renderDiscordExportPreview);
  }
  exportMenuToggle.onclick = event => {
    event.stopPropagation();
    setExportMenuOpen(exportMenuPanel.hidden);
  };
  exportMenuPanel.onclick = event => event.stopPropagation();
  document.addEventListener("click", () => setExportMenuOpen(false));
  window.addEventListener("beforeunload", event => {
    if (!hasUnsavedRosterChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  newRosterModal.addEventListener("click", event => {
    if (event.target === newRosterModal) closeNewRosterModal();
  });
  deleteRosterModal.addEventListener("click", event => {
    if (event.target === deleteRosterModal) closeDeleteRosterModal();
  });
  discordExportModal.addEventListener("click", event => {
    if (event.target === discordExportModal) closeDiscordExportModal();
  });

  renderRosterSaveBrowser();
  render();
}

function currentFactionRecord() {
  return (engineData.factionNavigation || []).flatMap(group => group.factions).find(item => item.id === currentFaction) || null;
}

function factionRecords() {
  return (engineData.factionNavigation || []).flatMap(group => group.factions || []);
}

function factionLabelFor(id) {
  const record = factionRecords().find(item => item.id === id || (item.modes || []).some(mode => mode.id === id));
  if (!record) return id || "-";
  if (record.id === id) return record.label || record.id;
  return (record.modes || []).find(mode => mode.id === id)?.label || record.label || id || "-";
}

function subfactionLabelFor(id) {
  const record = currentFactionRecord();
  return (record?.modes || []).find(mode => mode.id === id)?.label || id || "-";
}

function shouldShowSubfactionReference(record) {
  if (!record || (record.modes || []).length < 2) return false;
  return /space marines/i.test(`${record.id || ""} ${record.label || ""}`);
}

function factionOptionGroups(selectedFaction) {
  return (engineData.factionNavigation || []).map(group => `
    <optgroup label="${escapeHtml(group.allegiance)}">
      ${(group.factions || []).map(faction => `
        <option value="${escapeHtml(faction.id)}" ${faction.id === selectedFaction ? "selected" : ""}>${escapeHtml(faction.label)}</option>
      `).join("")}
    </optgroup>
  `).join("");
}

function renderSubfactionControl() {
  const record = currentFactionRecord();
  const modes = record?.modes || [];
  if (factionReference) factionReference.textContent = factionLabelFor(currentFaction);
  if (subfactionReference) subfactionReference.textContent = subfactionLabelFor(currentSubfaction);
  subfactionControl.hidden = !shouldShowSubfactionReference(record);
  subfactionSelect.innerHTML = modes.map(mode =>
    `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.label)}</option>`
  ).join("");
  subfactionSelect.value = currentSubfaction;
}

function selectedSourceFactions() {
  return [...new Set([currentFaction, currentSubfaction, ...nativeLibraryFactions()].filter(Boolean))];
}

function factionIsLoaded(faction) {
  return Boolean(!faction || engineData.factions?.[faction]);
}

function loadFactionData(faction) {
  if (!faction || factionIsLoaded(faction)) return Promise.resolve();
  if (factionLoadPromises[faction]) return factionLoadPromises[faction];
  const file = engineData.factionFiles?.[faction];
  if (!file) {
    engineData.factions[faction] = [];
    return Promise.resolve();
  }
  factionLoadPromises[faction] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${file}?v=${encodeURIComponent(engineData.generatedAt || "local")}`;
    script.onload = () => {
      const units = window.ROSTER_ENGINE_FACTIONS?.[faction] || [];
      engineData.factions[faction] = units;
      resolve(units);
    };
    script.onerror = () => {
      delete factionLoadPromises[faction];
      reject(new Error(`Could not load faction data for ${faction}`));
    };
    document.head.appendChild(script);
  });
  return factionLoadPromises[faction];
}

function allySourceFactionsForCurrentSelection() {
  const sources = [];
  for (const ally of currentAllies()) {
    if (cataloguePreferences[ally.type]) sources.push(ally.sourceFaction);
  }
  return sources;
}

function requiredFactionDataForCurrentSelection() {
  return [...new Set([...selectedSourceFactions(), ...allySourceFactionsForCurrentSelection()].filter(Boolean))];
}

function selectedFactionDataLoaded() {
  return requiredFactionDataForCurrentSelection().every(factionIsLoaded);
}

async function loadSelectedFactionData() {
  const required = requiredFactionDataForCurrentSelection();
  await Promise.all(required.map(loadFactionData));
}

function nativeLibraryFactions() {
  if (currentFaction === "Imperium - Imperial Knights") return ["Imperium - Imperial Knights - Library"];
  if (currentFaction === "Chaos - Chaos Knights") return ["Chaos - Chaos Knights Library"];
  return [];
}

function isNativeAllyType(type) {
  return (currentFaction === "Imperium - Imperial Knights" && type === "imperialKnights")
    || (currentFaction === "Chaos - Chaos Knights" && type === "chaosKnights");
}

function loadCataloguePreferences() {
  try {
    return { ...DEFAULT_CATALOGUE_PREFERENCES, ...JSON.parse(localStorage.getItem("engineCataloguePreferences") || "{}") };
  } catch {
    return { ...DEFAULT_CATALOGUE_PREFERENCES };
  }
}

function saveCataloguePreferences() {
  localStorage.setItem("engineCataloguePreferences", JSON.stringify(cataloguePreferences));
}

function currentAllies() {
  const byType = new Map();
  for (const faction of selectedSourceFactions()) {
    for (const ally of engineData.allies?.[faction] || []) {
      if (isNativeAllyType(ally.type)) continue;
      byType.set(ally.type, ally);
    }
  }
  return [...byType.values()];
}

function renderCatalogueOptions() {
  const catalogueOptions = document.getElementById("catalogueOptions");
  if (!catalogueOptions) return;
  const options = [
    ...currentAllies().map(ally => ({ key: ally.type, label: `Show ${ally.label}` })),
    { key: "legends", label: "Show Legends" },
    { key: "crucible", label: "Show Crucible Characters" }
  ];
  catalogueOptions.innerHTML = options.map(option => `
    <label><input class="catalogueToggle" type="checkbox" data-key="${escapeHtml(option.key)}" ${cataloguePreferences[option.key] ? "checked" : ""}> ${escapeHtml(option.label)}</label>
  `).join("");
  for (const input of catalogueOptions.querySelectorAll(".catalogueToggle")) {
    input.onchange = async event => {
      cataloguePreferences[event.target.dataset.key] = event.target.checked;
      saveCataloguePreferences();
      await loadSelectedFactionData();
      renderUnits();
    };
  }
}

function factionUnits() {
  const byName = new Map();
  for (const faction of selectedSourceFactions()) {
    for (const unit of engineData.factions[faction] || []) {
      if (!byName.has(unit.name)) byName.set(unit.name, unit);
    }
  }
  for (const ally of currentAllies()) {
    if (!cataloguePreferences[ally.type]) continue;
    const allowed = new Set(ally.selectionKeys || []);
    for (const unit of engineData.factions[ally.sourceFaction] || []) {
      if (!allowed.has(unit.selectionKey) || byName.has(unit.name)) continue;
      byName.set(unit.name, { ...unit, alliedFor: { type: ally.type, label: ally.label } });
    }
  }
  return [...byName.values()].filter(unit =>
    (cataloguePreferences.legends || !/\[Legends\]/i.test(unit.name))
    && (cataloguePreferences.crucible || !/\[Crucible\]/i.test(unit.name))
  );
}

function currentArmyDefinition() {
  const base = engineData.armies?.[currentFaction] || null;
  const selected = engineData.armies?.[currentSubfaction] || base;
  if (!selected) return null;
  const allies = currentAllies();
  const allyKeys = allies.flatMap(item => item.selectionKeys || []);
  const nativeKeys = nativeLibraryFactions().flatMap(faction => (engineData.factions[faction] || []).map(unit => unit.selectionKey));
  if (!base || base === selected) return {
    ...selected,
    allies,
    allowedSelectionKeys: [...new Set([...(selected.allowedSelectionKeys || []), ...nativeKeys, ...allyKeys])]
  };

  const enhancements = new Map();
  for (const enhancement of [...(base.enhancements || []), ...(selected.enhancements || [])]) {
    const existing = enhancements.get(enhancement.id);
    enhancements.set(enhancement.id, existing ? {
      ...enhancement,
      eligibleSelectionKeys: [...new Set([...(existing.eligibleSelectionKeys || []), ...(enhancement.eligibleSelectionKeys || [])])]
    } : enhancement);
  }
  return {
    ...selected,
    allies,
    allowedSelectionKeys: [...new Set([...(base.allowedSelectionKeys || []), ...(selected.allowedSelectionKeys || []), ...nativeKeys, ...allyKeys])],
    enhancements: [...enhancements.values()]
  };
}

function createRosterEntry(unitPackage) {
  const entry = JSON.parse(JSON.stringify(unitPackage.defaultEntry));
  entry.instanceId = `${unitPackage.id}-${Date.now()}-${Math.random()}`;

  return {
    instanceId: entry.instanceId,
    unitPackage,
    entry
  };
}

function duplicateRosterEntry(sourceEntry) {
  const entry = JSON.parse(JSON.stringify(sourceEntry.entry));
  entry.instanceId = `${sourceEntry.unitPackage.id}-${Date.now()}-${Math.random()}`;
  const duplicate = {
    instanceId: entry.instanceId,
    unitPackage: sourceEntry.unitPackage,
    entry
  };
  const sourceIndex = roster.findIndex(item => item.instanceId === sourceEntry.instanceId);
  roster.splice(sourceIndex >= 0 ? sourceIndex + 1 : roster.length, 0, duplicate);
  selectedInstanceId = duplicate.instanceId;
  selectedPanel = "unit";
  return duplicate;
}

function setExportMenuOpen(open) {
  if (!exportMenuPanel || !exportMenuToggle) return;
  exportMenuPanel.hidden = !open;
  exportMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function currentRosterSnapshot() {
  if (!currentFaction || !armyState) return null;
  return JSON.stringify(currentRosterDocument());
}

function hasUnsavedRosterChanges() {
  if (appMode !== "builder" || !currentFaction || !armyState) return false;
  return currentRosterSnapshot() !== lastSavedRosterSnapshot;
}

function markRosterClean() {
  lastSavedRosterSnapshot = currentRosterSnapshot();
}

function confirmDiscardUnsavedRoster() {
  if (!hasUnsavedRosterChanges()) return true;
  return window.confirm("This list has unsaved changes. Leave it and lose those changes?");
}

function showLibrary() {
  if (!confirmDiscardUnsavedRoster()) return;
  appMode = "library";
  selectedInstanceId = null;
  render();
}

function showBuilder() {
  appMode = "builder";
  render();
}

function render() {
  renderRosterSaveBrowser();
  if (appMode === "library") {
    if (builderShell) builderShell.hidden = true;
    if (startScreen) {
      startScreen.hidden = false;
      renderStartScreen();
    }
    return;
  }
  if (startScreen) startScreen.hidden = true;
  if (builderShell) builderShell.hidden = false;
  renderUnits();
  renderRoster();
  renderTotal();
  renderSelectedDetails();
}

function renderStartScreen() {
  const saves = savedRosterLibrary();
  startScreen.innerHTML = `
    <div class="startHeader">
      <div>
        <h2>Saved Rosters</h2>
        <p class="muted">Load an existing roster or start a new one.</p>
      </div>
      <div class="startHeaderActions">
        <button id="startImportJson">Import JSON</button>
        <button id="startNewRoster">New roster</button>
      </div>
    </div>
    <div class="savedRosterCards">
      ${saves.length ? saves.map(save => `
        <div class="savedRosterCard">
          <div>
            <b>${escapeHtml(save.document?.name || "Unnamed roster")}</b>
            <small>${escapeHtml(rosterSaveLabel(save.document || {}))}</small>
          </div>
          <div class="savedRosterActions">
            <button class="startLoadRoster" data-save-id="${escapeHtml(save.id)}">Load</button>
            <button class="startDeleteRoster" data-save-id="${escapeHtml(save.id)}">Delete</button>
          </div>
        </div>
      `).join("") : `<p class="muted">No saved rosters yet.</p>`}
    </div>
  `;
  document.getElementById("startImportJson").onclick = () => importJsonFile.click();
  document.getElementById("startNewRoster").onclick = openNewRosterModal;
  for (const button of startScreen.querySelectorAll(".startLoadRoster")) {
    button.onclick = () => loadRosterById(button.dataset.saveId);
  }
  for (const button of startScreen.querySelectorAll(".startDeleteRoster")) {
    button.onclick = () => requestDeleteRoster(button.dataset.saveId);
  }
}

function openNewRosterModal() {
  if (!confirmDiscardUnsavedRoster()) return;
  const firstFaction = factionRecords()[0]?.id || "";
  const record = factionRecords().find(item => item.id === (currentFaction || firstFaction));
  newRosterDraft = {
    faction: currentFaction || firstFaction,
    subfaction: currentSubfaction || record?.defaultMode || currentFaction || firstFaction,
    pointsLimit: Number(pointsLimitInput.value || 2000) || 2000,
    detachmentIds: []
  };
  newRosterModal.hidden = false;
  renderNewRosterForm();
}

function closeNewRosterModal() {
  newRosterModal.hidden = true;
  newRosterDraft = null;
}

function draftArmyDefinition() {
  return engineData.armies?.[newRosterDraft?.subfaction] || engineData.armies?.[newRosterDraft?.faction] || null;
}

function renderNewRosterForm() {
  if (!newRosterDraft) return;
  const draftRecord = factionRecords().find(item => item.id === newRosterDraft.faction) || null;
  const draftModes = draftRecord?.modes || [];
  const showDraftSubfaction = shouldShowSubfactionReference(draftRecord);
  const army = draftArmyDefinition();
  const detachments = army?.detachments || [];
  const detachmentGroups = groupDetachmentsForNewRoster(detachments);
  const selectedIds = new Set(newRosterDraft.detachmentIds);
  const selectedDetachments = detachments.filter(detachment => selectedIds.has(detachment.id));
  const detachmentPoints = selectedDetachments.reduce((sum, detachment) => sum + Number(detachment.detachmentPoints || 0), 0);
  const pointLimit = armyEngine.detachmentPointLimitFor(newRosterDraft.pointsLimit);
  const soloIncursionAllowed = newRosterDraft.pointsLimit <= 1000 && selectedDetachments.length === 1 && detachmentPoints <= 3;
  const overLimit = detachmentPoints > pointLimit && !soloIncursionAllowed;
  newRosterForm.innerHTML = `
    <div class="newRosterLayout">
      <div class="newRosterSetup">
        <label class="formRow"><b>Faction</b>
          <select id="newRosterFaction">${factionOptionGroups(newRosterDraft.faction)}</select>
        </label>
        ${showDraftSubfaction ? `<label class="formRow"><b>Chapter / Army</b>
          <select id="newRosterSubfaction">
            ${draftModes.map(mode => `<option value="${escapeHtml(mode.id)}" ${mode.id === newRosterDraft.subfaction ? "selected" : ""}>${escapeHtml(mode.label)}</option>`).join("")}
          </select>
        </label>` : ""}
        <div class="formRow">
          <b>Battle size</b>
          <div class="battleSizeChoices">
            ${[
              { label: "1K", value: 1000 },
              { label: "2K", value: 2000 },
              { label: "3K", value: 3000 }
            ].map(size => `
              <label><input type="radio" name="newRosterPoints" value="${size.value}" ${newRosterDraft.pointsLimit === size.value ? "checked" : ""}> ${size.label}</label>
            `).join("")}
          </div>
        </div>
        <div class="formRow">
          <b>Detachments</b>
          <small>${detachmentPoints}/${pointLimit} DP selected${soloIncursionAllowed ? " - solo 3DP detachment allowed at 1K" : ""}</small>
          <div class="detachmentChoiceList">
            ${detachments.length ? detachmentGroups.map(group => `
              <div class="detachmentChoiceGroup">
                <h3>${escapeHtml(group.label)}</h3>
                ${group.detachments.map(detachment => `
                  <label class="compactOptionRow detachmentOption">
                    <span class="optionName">${escapeHtml(detachment.name)}</span>
                    <span class="optionLimits">${Number(detachment.detachmentPoints || 0)}DP</span>
                    <input class="newRosterDetachment" type="checkbox" data-detachment-id="${escapeHtml(detachment.id)}" ${selectedIds.has(detachment.id) ? "checked" : ""}>
                  </label>
                `).join("")}
              </div>
            `).join("") : `<p class="muted">No detachment data found for this faction.</p>`}
          </div>
          ${overLimit ? `<p class="warning">This is over the Detachment Point limit for this battle size.</p>` : ""}
        </div>
      </div>
      <aside class="newRosterPreview">
        ${renderNewRosterDetachmentPreview(army, selectedDetachments)}
      </aside>
    </div>
    <div class="modalActions">
      <button id="cancelNewRoster">Cancel</button>
      <button id="createNewRoster" ${!newRosterDraft.faction || !selectedDetachments.length ? "disabled" : ""}>Create roster</button>
    </div>
  `;
  document.getElementById("newRosterFaction").onchange = event => {
    newRosterDraft.faction = event.target.value;
    const selectedRecord = factionRecords().find(item => item.id === newRosterDraft.faction) || null;
    newRosterDraft.subfaction = selectedRecord?.defaultMode || newRosterDraft.faction;
    newRosterDraft.detachmentIds = [];
    renderNewRosterForm();
  };
  const newRosterSubfaction = document.getElementById("newRosterSubfaction");
  if (newRosterSubfaction) {
    newRosterSubfaction.onchange = event => {
      newRosterDraft.subfaction = event.target.value;
      newRosterDraft.detachmentIds = [];
      renderNewRosterForm();
    };
  }
  for (const input of newRosterForm.querySelectorAll("input[name='newRosterPoints']")) {
    input.onchange = event => {
      newRosterDraft.pointsLimit = Number(event.target.value || 2000);
      renderNewRosterForm();
    };
  }
  for (const input of newRosterForm.querySelectorAll(".newRosterDetachment")) {
    input.onchange = () => {
      newRosterDraft.detachmentIds = [...newRosterForm.querySelectorAll(".newRosterDetachment:checked")]
        .map(item => item.dataset.detachmentId);
      renderNewRosterForm();
    };
  }
  document.getElementById("cancelNewRoster").onclick = closeNewRosterModal;
  document.getElementById("createNewRoster").onclick = createRosterFromDraft;
}

function groupDetachmentsForNewRoster(detachments) {
  const groups = new Map();
  for (const detachment of detachments || []) {
    const points = Number(detachment.detachmentPoints || 0);
    const key = Number.isFinite(points) && points > 0 ? points : 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(detachment);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([points, items]) => ({
      label: points > 0 ? `${points} DP` : "No DP listed",
      detachments: [...items].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
    }));
}

function renderNewRosterDetachmentPreview(army, detachments) {
  if (!army) {
    return `<p class="muted">Choose a faction to preview detachment rules.</p>`;
  }
  if (!detachments.length) {
    return `
      <details class="previewMaster" open>
        <summary>Detachment Preview</summary>
        <p class="muted">Select one or more detachments to preview their rules, upgrades, and stratagems.</p>
      </details>
    `;
  }
  return `
    <details class="previewMaster" open>
      <summary>Detachment Preview <small>${detachments.length}</small></summary>
      <div class="previewContents">
        ${detachments.map(detachment => renderNewRosterDetachmentCard(army, detachment)).join("")}
      </div>
    </details>
  `;
}

function renderNewRosterDetachmentCard(army, detachment) {
  const enhancements = (army.enhancements || []).filter(item => (item.detachmentIds || []).includes(detachment.id));
  const stratagems = (detachment.stratagems || []).map(stratagem => ({
    ...stratagem,
    detachmentName: detachment.name,
    tone: 0
  }));
  return `
    <details class="previewDetachment" open>
      <summary>
        <span>${escapeHtml(detachment.name)}</span>
        <small>${Number(detachment.detachmentPoints || 0)}DP</small>
      </summary>
      <div class="previewDetachmentBody">
        <details class="previewSection" open>
          <summary>Detachment Rule${(detachment.rules || []).length === 1 ? "" : "s"}</summary>
          ${(detachment.rules || []).length ? (detachment.rules || []).map(rule => `
            <details class="previewItem">
              <summary>${escapeHtml(rule.name)}</summary>
              <p>${formatDescription(rule.description)}</p>
            </details>
          `).join("") : `<p class="muted">No detachment rule text found.</p>`}
        </details>
        <details class="previewSection">
          <summary>Enhancements & Upgrades <small>${enhancements.length}</small></summary>
          ${enhancements.length ? enhancements.map(item => `
            <details class="previewItem">
              <summary>${escapeHtml(item.name)}${item.kind === "upgrade" ? ` <small>Upgrade</small>` : ""}${item.points ? ` <small>${item.points} pts</small>` : ""}</summary>
              ${renderEnhancementDescription(item) || `<p class="muted">No rule text found.</p>`}
            </details>
          `).join("") : `<p class="muted">No enhancements or upgrades found for this detachment.</p>`}
        </details>
        <details class="previewSection">
          <summary>Detachment Stratagems <small>${stratagems.length}</small></summary>
          ${stratagems.length ? stratagems.map(renderStratagemItem).join("") : `<p class="muted">No detachment stratagems found for this detachment.</p>`}
        </details>
      </div>
    </details>
  `;
}

async function createRosterFromDraft() {
  if (!newRosterDraft?.faction || !newRosterDraft.detachmentIds.length) return;
  currentFaction = newRosterDraft.faction;
  currentSubfaction = newRosterDraft.subfaction || currentFactionRecord()?.defaultMode || currentFaction;
  factionSelect.value = currentFaction;
  renderSubfactionControl();
  await loadSelectedFactionData();
  pointsLimitInput.value = newRosterDraft.pointsLimit;
  rosterNameInput.value = "";
  roster = [];
  selectedInstanceId = null;
  selectedPanel = "configuration";
  currentRosterSaveId = null;
  armyState = armyEngine.createArmyState(currentArmyDefinition());
  armyState = armyEngine.setSelectedDetachments(currentArmyDefinition(), armyState, newRosterDraft.detachmentIds);
  closeNewRosterModal();
  appMode = "builder";
  markRosterClean();
  showBuilder();
}

function renderArmyAssignments() {
  const armyAssignments = document.getElementById("armyAssignments");
  if (!armyAssignments) return;
  if (!roster.length) {
    armyAssignments.innerHTML = `<p class="muted">Add units to select a Warlord and attach Leaders.</p>`;
    return;
  }
  const option = item => `<option value="${escapeHtml(item.instanceId)}">${escapeHtml(item.unitPackage.name)}${item.unitPackage.definition.rosterRules?.canBeWarlord ? "" : " ⚠"}</option>`;
  const leaders = roster.filter(item => item.unitPackage.definition.roles?.leader);
  armyAssignments.innerHTML = `
    <label class="optionRow"><b>Warlord</b>
      <select id="warlordSelect"><option value="">Not selected</option>${roster.map(option).join("")}</select>
    </label>
    ${leaders.map(leader => {
      const assignment = (armyState.attachments || []).find(item => item.leaderInstanceId === leader.instanceId);
      return `<label class="optionRow"><b>${escapeHtml(leader.unitPackage.name)} leads</b>
        <select class="leaderTarget" data-leader-id="${escapeHtml(leader.instanceId)}">
          <option value="">Not attached</option>
          ${roster.filter(item => item.instanceId !== leader.instanceId).map(target => {
            const legal = armyEngine.leaderCanTarget(
              { selectionKey: leader.unitPackage.selectionKey, name: leader.unitPackage.name, rosterRules: leader.unitPackage.definition.rosterRules },
              { selectionKey: target.unitPackage.selectionKey, name: target.unitPackage.name }
            );
            return `<option value="${escapeHtml(target.instanceId)}" ${assignment?.targetInstanceId === target.instanceId ? "selected" : ""}>${escapeHtml(target.unitPackage.name)}${legal ? "" : " ⚠"}</option>`;
          }).join("")}
        </select>
      </label>`;
    }).join("") || `<p class="muted">No Leaders in this roster.</p>`}
  `;
  const warlordSelect = document.getElementById("warlordSelect");
  warlordSelect.value = armyState.warlordInstanceId || "";
  warlordSelect.onchange = event => {
    armyState = armyEngine.setWarlord(armyState, event.target.value || null);
    render();
  };
  for (const select of armyAssignments.querySelectorAll(".leaderTarget")) {
    select.onchange = event => {
      armyState = armyEngine.setLeaderAttachment(armyState, event.target.dataset.leaderId, event.target.value || null);
      render();
    };
  }
}

function renderArmyControls() {
  const detachmentSelect = document.getElementById("detachmentSelect");
  const detachmentRules = document.getElementById("detachmentRules");
  const stratagemsElement = document.getElementById("stratagems");
  const enhancementsElement = document.getElementById("enhancements");
  if (!detachmentSelect || !detachmentRules || !stratagemsElement || !enhancementsElement) return;
  const army = currentArmyDefinition();
  detachmentSelect.innerHTML = "";
  if (!army) {
    detachmentSelect.innerHTML = `<p class="muted">No detachments available.</p>`;
    detachmentRules.innerHTML = `<p class="muted">No detachment data in this catalogue.</p>`;
    stratagemsElement.innerHTML = `<p class="muted">No stratagem data in this catalogue.</p>`;
    enhancementsElement.innerHTML = "";
    return;
  }

  const selectedDetachmentIds = new Set(armyEngine.selectedDetachmentIds?.(armyState) || [armyState?.detachmentId].filter(Boolean));
  for (const detachment of army.detachments || []) {
    const label = document.createElement("label");
    label.className = "compactOptionRow detachmentOption";
    label.innerHTML = `
      <span class="optionName">${escapeHtml(detachment.name)}</span>
      <span class="optionLimits">${Number(detachment.detachmentPoints || 0)}DP</span>
      <input class="detachmentToggle" type="checkbox" data-detachment-id="${escapeHtml(detachment.id)}" ${selectedDetachmentIds.has(detachment.id) ? "checked" : ""}>
    `;
    detachmentSelect.appendChild(label);
  }
  for (const input of detachmentSelect.querySelectorAll(".detachmentToggle")) {
    input.onchange = () => {
      const ids = [...detachmentSelect.querySelectorAll(".detachmentToggle:checked")].map(item => item.dataset.detachmentId);
      armyState = armyEngine.setSelectedDetachments(army, armyState, ids);
      selectedPanel = "configuration";
      render();
    };
  }

  const detachments = armyEngine.selectedDetachments?.(army, armyState) || [armyEngine.selectedDetachment(army, armyState)].filter(Boolean);
  if (!detachments.length) {
    detachmentRules.innerHTML = `<p>Select one or more detachments to activate their rules and enhancements.</p>`;
    stratagemsElement.innerHTML = `<p class="muted">Select a detachment first.</p>`;
    enhancementsElement.innerHTML = "";
    return;
  }

  const totalDp = detachments.reduce((sum, item) => sum + Number(item.detachmentPoints || 0), 0);
  detachmentRules.innerHTML = `<p class="muted">${totalDp} Detachment Point${totalDp === 1 ? "" : "s"} selected.</p>` + detachments.flatMap(detachment =>
    (detachment.rules || []).map(rule => `
    <details class="sidebarCard ruleDisclosure">
      <summary>${escapeHtml(detachment.name)} — ${escapeHtml(rule.name)}</summary>
      <p>${formatDescription(rule.description)}</p>
    </details>
  `)).join("") || `<p class="muted">No detachment rule text found.</p>`;
  stratagemsElement.innerHTML = renderStratagems(army, detachments);

  const enhancementStates = armyEngine.getEnhancementStates(army, armyState, roster);
  enhancementsElement.innerHTML = enhancementStates.length
    ? enhancementStates.map(state => `
      <div class="sidebarCard">
        <b>${escapeHtml(state.name)}</b>${state.kind === "upgrade" ? ` <small>Upgrade</small>` : ""}${state.points ? ` — ${state.points} pts` : ""}
        ${renderEnhancementDescription(state)}
      </div>
    `).join("")
    : `<p class="muted">No enhancements or upgrades are available for this detachment.</p>`;
}

function renderEnhancementDescription(enhancement) {
  const descriptions = [
    ...(enhancement.profiles || []).map(profile => profile.characteristics?.Description).filter(Boolean),
    ...(enhancement.rules || []).map(rule => rule.description).filter(Boolean)
  ];
  return descriptions.length ? `<small>${formatDescription(descriptions.join(" "))}</small>` : "";
}

function renderStratagems(army, detachments) {
  const core = army.coreStratagems || [];
  const selected = detachments.flatMap((detachment, detachmentIndex) =>
    (detachment.stratagems || []).map(stratagem => ({
      ...stratagem,
      detachmentName: detachment.name,
      tone: detachmentIndex % 4
    }))
  );

  if (!core.length && !selected.length) {
    return `<p class="muted">No stratagem records found for the selected detachments.</p>`;
  }

  return `
    ${core.length ? renderStratagemList("Core Stratagems", core, "core") : `<p class="muted">No Core stratagem records are present in the current stratagem source.</p>`}
    ${selected.length ? renderStratagemList("Detachment Stratagems", selected, "detachment") : `<p class="muted">Select a detachment with stratagem records.</p>`}
  `;
}

function renderStratagemList(title, stratagems, kind) {
  return `
    <div class="stratagemList ${kind === "core" ? "stratagemListCore" : "stratagemListDetachment"}">
      <h4>${escapeHtml(title)} <small>${stratagems.length}</small></h4>
      ${stratagems.map(renderStratagemItem).join("")}
    </div>
  `;
}

function renderStratagemItem(stratagem) {
  const scopeClass = stratagem.scope === "core" ? "stratagemCore" : `stratagemDetachment stratagemTone${stratagem.tone || 0}`;
  const sourceLabel = stratagem.scope === "core" ? "Core" : stratagem.detachmentName || stratagem.detachment || "Detachment";
  return `
    <details class="stratagemItem ${scopeClass}">
      <summary>
        <span class="stratagemName">${escapeHtml(stratagem.name)}</span>
        <span class="stratagemMeta">
          ${stratagem.cpCost ? `<b>${escapeHtml(stratagem.cpCost)}CP</b>` : ""}
          <small>${escapeHtml(sourceLabel)}</small>
        </span>
      </summary>
      <div class="stratagemBody">
        ${stratagem.type ? `<div><b>Type:</b> ${escapeHtml(stratagem.type)}</div>` : ""}
        ${stratagem.phase ? `<div><b>Phase:</b> ${escapeHtml(stratagem.phase)}</div>` : ""}
        ${stratagem.turn ? `<div><b>Turn:</b> ${escapeHtml(stratagem.turn)}</div>` : ""}
        ${stratagem.legend ? `<p class="stratagemLegend">${escapeHtml(stratagem.legend)}</p>` : ""}
        <p>${formatRichDescription(stratagem.description || "No description provided.")}</p>
      </div>
    </details>
  `;
}

function renderUnits() {
  unitList.innerHTML = "";

  if (!selectedFactionDataLoaded()) {
    unitList.innerHTML = `<p class="muted">Loading ${escapeHtml(factionLabelFor(currentSubfaction || currentFaction))} units...</p>`;
    loadSelectedFactionData()
      .then(renderUnits)
      .catch(error => {
        unitList.innerHTML = `<p class="warning">Could not load faction data: ${escapeHtml(error.message)}</p>`;
      });
    return;
  }

  const units = factionUnits()
    .filter(unitMatchesSearch);

  for (const group of catalogueSections.groupUnits(units)) {
    if (!group.units.length) continue;
    const section = document.createElement("details");
    section.className = "unitSection";
    section.dataset.unitSection = group.section;
    section.open = Boolean(searchText)
      || (Object.prototype.hasOwnProperty.call(unitSectionDisclosureState, group.section)
        ? unitSectionDisclosureState[group.section]
        : false);
    section.ontoggle = event => {
      if (event.target === section && !searchText) unitSectionDisclosureState[group.section] = section.open;
    };
    section.innerHTML = `<summary>${escapeHtml(group.section)} <span>${group.units.length}</span></summary>`;
    const contents = document.createElement("div");
    contents.className = "unitSectionContents";

    for (const unit of group.units) {
      const div = document.createElement("div");
      div.className = "unit";

      const left = document.createElement("span");
      left.innerHTML = `<b>${escapeHtml(unit.name)}</b> — ${unit.defaultSummary.points} pts`;

      const add = document.createElement("button");
      add.textContent = "Add";
      add.onclick = event => {
        event.stopPropagation();
        const rosterEntry = createRosterEntry(unit);
        roster.push(rosterEntry);
        selectedInstanceId = rosterEntry.instanceId;
        selectedPanel = "unit";
        render();
      };

      div.onclick = () => showPreview(unit);

      div.appendChild(left);
      div.appendChild(add);
      contents.appendChild(div);
    }
    section.appendChild(contents);
    unitList.appendChild(section);
  }
}

function unitMatchesSearch(unit) {
  if (!searchText) return true;
  const haystack = [
    unit.name,
    ...(unit.keywords || []),
    ...(unit.definition?.keywords || []),
    ...(unit.definition?.categories || []),
    ...(unit.categories || [])
  ].join(" ").toLowerCase();
  return haystack.includes(searchText);
}

function renderRoster() {
  rosterList.innerHTML = "";

  const configuration = document.createElement("div");
  configuration.className = "rosterConfiguration";
  if (selectedPanel === "configuration") configuration.classList.add("selected");
  const detachments = currentArmyDefinition() ? (armyEngine.selectedDetachments?.(currentArmyDefinition(), armyState) || []) : [];
  const warningCount = validateRoster().filter(item => !item.ok).length;
  configuration.innerHTML = `
    <div><b>Configuration</b>${warningCount ? `<span class="warningBadge">⚠ ${warningCount}</span>` : ""}</div>
    <small>${escapeHtml(detachments.length ? `${detachments.length} detachment${detachments.length === 1 ? "" : "s"}` : "Choose detachments")} · roster options</small>
  `;
  configuration.onclick = () => {
    selectedPanel = "configuration";
    selectedInstanceId = null;
    render();
  };
  rosterList.appendChild(configuration);

  for (const section of groupRosterPresentation(rosterPresentation())) {
    if (!section.groups.length) continue;
    const details = document.createElement("details");
    details.className = "unitSection rosterSection";
    details.open = true;
    details.innerHTML = `<summary>${escapeHtml(section.section)} <span>${section.groups.length}</span></summary>`;
    const contents = document.createElement("div");
    contents.className = "unitSectionContents";

    for (const group of section.groups) {
    const groupEntries = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).filter(Boolean);
    const primary = groupEntries[0];
    if (!primary) continue;

    const div = document.createElement("div");
    div.className = "unit";
    if (group.memberInstanceIds.includes(selectedInstanceId)) div.classList.add("selected");
    if (group.kind === "attached") div.classList.add("attachedUnit");

    const label = document.createElement("span");
    label.innerHTML = group.kind === "attached"
      ? renderRosterGroupLabel(group, groupEntries)
      : renderRosterUnitLabel(primary);

    const actions = document.createElement("span");
    actions.className = "unitActions";

    const duplicate = document.createElement("button");
    duplicate.textContent = "Duplicate";
    duplicate.onclick = event => {
      event.stopPropagation();
      duplicateRosterEntry(primary);
      render();
    };

    const action = document.createElement("button");
    action.textContent = group.kind === "attached" ? "Split" : "Remove";
    action.onclick = event => {
      event.stopPropagation();
      if (group.kind === "attached") {
        armyState = armyEngine.detachBodyguard(armyState, group.bodyguard.instanceId);
        selectedInstanceId = group.bodyguard.instanceId;
        selectedPanel = "unit";
      } else {
        removeRosterEntry(primary.instanceId);
      }
      render();
    };
    actions.appendChild(duplicate);
    actions.appendChild(action);

    div.onclick = () => {
      selectedInstanceId = primary.instanceId;
      selectedPanel = group.kind === "attached" ? "group" : "unit";
      render();
    };

    div.appendChild(label);
    div.appendChild(actions);
    contents.appendChild(div);
    }

    details.appendChild(contents);
    rosterList.appendChild(details);
  }
}

function groupRosterPresentation(presentation) {
  const groupsBySection = new Map(catalogueSections.SECTION_ORDER.map(section => [section, []]));
  for (const group of presentation) {
    const primary = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).find(Boolean);
    const section = catalogueSections.sectionForUnit(primary?.unitPackage || primary || {});
    if (!groupsBySection.has(section)) groupsBySection.set(section, []);
    groupsBySection.get(section).push(group);
  }
  return [...groupsBySection.entries()].map(([section, groups]) => ({ section, groups }));
}

function renderRosterUnitLabel(rosterEntry) {
  const unit = rosterEntry.unitPackage;
  const unitSize = engine.getUnitSizeState(unit.definition, rosterEntry.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  return `<b>${sizePrefix}${escapeHtml(unit.name)}</b> — ${formatEntryPoints(rosterEntry)}`;
}

function renderRosterGroupLabel(group, groupEntries) {
  const bodyguard = groupEntries.find(item => item.instanceId === group.bodyguard?.instanceId) || groupEntries[0];
  const leaders = group.leaders
    .map(leader => groupEntries.find(item => item.instanceId === leader.instanceId))
    .filter(Boolean);
  const unitSize = engine.getUnitSizeState(bodyguard.unitPackage.definition, bodyguard.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  const warning = group.warnings.length ? ` <span class="warningBadge">⚠</span>` : "";
  return `
    <b>${sizePrefix}${escapeHtml(bodyguard.unitPackage.name)}</b>${warning} — ${group.totalPoints} pts
    <small>Led by ${leaders.map(item => escapeHtml(item.unitPackage.name)).join(", ")}</small>
  `;
}

function rosterPresentation() {
  const legalityRoster = rosterWithPoints();
  return currentArmyDefinition()
    ? armyEngine.getRosterPresentation(currentArmyDefinition(), armyState, legalityRoster, { totalPoints: getTotalPoints(), pointsLimit: Number(pointsLimitInput.value || 0) })
    : legalityRoster.map(item => ({
        id: item.instanceId,
        kind: "unit",
        title: item.unitPackage.name,
        totalPoints: item.points,
        memberInstanceIds: [item.instanceId],
        bodyguard: null,
        leaders: [],
        entries: [item],
        warnings: []
      }));
}

function removeRosterEntry(instanceId) {
  roster = roster.filter(item => item.instanceId !== instanceId);
  armyState = armyEngine.pruneArmyStateForRoster(armyState, roster);
  if (selectedInstanceId === instanceId || !roster.some(item => item.instanceId === selectedInstanceId)) {
    selectedInstanceId = null;
    selectedPanel = "configuration";
  }
}

function renderSelectedDetails() {
  if (selectedPanel === "configuration") {
    showConfigurationPanel();
    return;
  }
  if (selectedPanel === "group") {
    const group = rosterPresentation().find(item => item.kind === "attached" && item.memberInstanceIds.includes(selectedInstanceId));
    if (group) {
      showAttachedRosterGroup(group);
      return;
    }
  }
  const rosterEntry = roster.find(item => item.instanceId === selectedInstanceId);
  if (!rosterEntry) {
    details.innerHTML = "Click a roster unit.";
    return;
  }

  showRosterEntry(rosterEntry);
}

function showConfigurationPanel() {
  details.innerHTML = `
    <h3>Roster Configuration</h3>
    <details class="sidebarGroup" data-disclosure-key="detachments" ${disclosureOpenAttribute("detachments", true)}><summary>Detachments</summary><div id="detachmentSelect" class="detachmentList"></div></details>
    <details class="sidebarGroup" data-disclosure-key="detachmentRules" ${disclosureOpenAttribute("detachmentRules", true)}><summary>Detachment Rules</summary><div id="detachmentRules"></div></details>
    <details class="sidebarGroup stratagemsGroup" data-disclosure-key="stratagems" ${disclosureOpenAttribute("stratagems", false)}><summary>Stratagems</summary><div id="stratagems"></div></details>
    <details class="sidebarGroup"><summary>Available Enhancements & Upgrades</summary><div id="enhancements"></div></details>
    <details class="sidebarGroup"><summary>Show/Hide Options</summary><div id="catalogueOptions"></div></details>
    <details class="sidebarGroup"><summary>Army-level Warnings</summary><div id="validation"></div></details>
  `;
  renderArmyControls();
  renderCatalogueOptions();
  renderValidation();
  bindSidebarDisclosureState();
}

function showPreview(unitPackage) {
  const models = engine.getConfiguredModels?.(unitPackage.definition, unitPackage.defaultEntry) || [];
  details.innerHTML = `
    <h3>${escapeHtml(unitPackage.name)} <span class="pts">${unitPackage.defaultSummary.points} pts</span></h3>
    <p><b>Faction:</b> ${escapeHtml(unitPackage.faction)}</p>
    ${renderKeywords(unitPackage.keywords || unitPackage.definition?.keywords || unitPackage.definition?.categories || [])}
    ${renderConfigured(unitPackage.defaultSummary.configured, [], models)}
    <p><b>Source:</b> ${escapeHtml(unitPackage.source?.sourceFile || "")}</p>
  `;
}

function showRosterEntry(rosterEntry) {
  const unit = rosterEntry.unitPackage;
  const configured = engine.getConfiguredProfiles(unit.definition, rosterEntry.entry);
  const models = engine.getConfiguredModels?.(unit.definition, rosterEntry.entry) || [];
  const loadoutErrors = engine.validateLoadout(unit.definition, rosterEntry.entry);
  const pricing = entryPricing(rosterEntry);
  const unitSize = engine.getUnitSizeState(unit.definition, rosterEntry.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  const attachedGroup = attachedGroupForInstance(rosterEntry.instanceId);

  details.innerHTML = `
    <h3>${sizePrefix}${escapeHtml(unit.name)} <span class="pts">${formatEntryPoints(rosterEntry)}</span></h3>
    ${attachedGroup ? `<button id="backToAttachedUnit" class="sidebarBack">Back to attached unit</button>` : ""}
    <p><b>Faction:</b> ${escapeHtml(unit.faction)}</p>
    ${renderKeywords(unit.keywords || unit.definition.keywords || unit.definition.categories || [])}
    ${renderUnitAssignments(rosterEntry)}
    ${renderUnitSizeControl(rosterEntry, unitSize)}
    ${renderOptionControls(rosterEntry)}
    ${renderEntryValidation(loadoutErrors, pricing.validationErrors)}
    ${renderConfigured(configured, assignedEnhancementsForRosterEntry(rosterEntry), models)}
    <p><b>Source:</b> ${escapeHtml(unit.source?.sourceFile || "")}</p>
  `;
  bindUnitSizeInputs();
  bindLoadoutInputs();
  bindSidebarDisclosureState();
  bindUnitAssignmentInputs();
  const backButton = document.getElementById("backToAttachedUnit");
  if (backButton) {
    backButton.onclick = () => {
      selectedPanel = "group";
      render();
    };
  }
}

function attachedGroupForInstance(instanceId) {
  return rosterPresentation().find(item => item.kind === "attached" && item.memberInstanceIds.includes(instanceId)) || null;
}

function showAttachedRosterGroup(group) {
  const groupEntries = group.entries
    .map(item => roster.find(entry => entry.instanceId === item.instanceId))
    .filter(Boolean);
  const bodyguard = groupEntries.find(item => item.instanceId === group.bodyguard?.instanceId) || groupEntries[0];
  const leaders = group.leaders
    .map(leader => groupEntries.find(item => item.instanceId === leader.instanceId))
    .filter(Boolean);

  details.innerHTML = `
    <h3>${escapeHtml(group.title)} <span class="pts">${formatGroupPoints(group)}</span></h3>
    ${renderGroupWarnings(group)}
    <div class="attachedMembers">
      ${[bodyguard, ...leaders].filter(Boolean).map(item => renderAttachedMemberCard(item, item === bodyguard)).join("")}
    </div>
    ${renderAttachedConfigured(groupEntries)}
  `;
  bindAttachedGroupInputs();
}

function renderAttachedMemberCard(rosterEntry, isBodyguard) {
  const unit = rosterEntry.unitPackage;
  const configured = engine.getConfiguredProfiles(unit.definition, rosterEntry.entry);
  const weapons = configured.weapons || [];
  const enhancements = (armyState.enhancements || [])
    .map(assignment => {
      if (assignment.bearerInstanceId !== rosterEntry.instanceId) return null;
      return currentArmyDefinition()?.enhancements.find(item => item.id === assignment.enhancementId) || null;
    })
    .filter(Boolean);
  return `
    <div class="attachedMember">
      <div>
        <b>${escapeHtml(unit.name)}</b>
        <small>${isBodyguard ? "Bodyguard" : "Leader"} · ${formatEntryPoints(rosterEntry)}${armyState.warlordInstanceId === rosterEntry.instanceId ? " · Warlord" : ""}</small>
        ${enhancements.map(item => `<small>${escapeHtml(item.name)} · ${item.points || 0} pts</small>`).join("")}
        ${weapons.length ? `<small>${weapons.map(weapon => `${weapon.count || 1}x ${weapon.name}`).map(escapeHtml).join(", ")}</small>` : ""}
      </div>
      <span>
        <button class="configureMember" data-instance-id="${escapeHtml(rosterEntry.instanceId)}">Configure</button>
        <button class="removeMember" data-instance-id="${escapeHtml(rosterEntry.instanceId)}">Remove</button>
      </span>
    </div>
  `;
}

function renderGroupWarnings(group) {
  if (!group.warnings.length) {
    return `<p class="valid">✓ Attached unit presentation is valid.</p>`;
  }
  return `
    <div class="warningSummary">
      ${group.warnings.map(item => `<div>⚠ ${escapeHtml(item.message)}</div>`).join("")}
    </div>
  `;
}

function renderAttachedConfigured(groupEntries) {
  const merged = { units: [], weapons: [], abilities: [], rules: [] };
  for (const rosterEntry of groupEntries) {
    const configured = engine.getConfiguredProfiles(rosterEntry.unitPackage.definition, rosterEntry.entry);
    const enhancedUnits = unitProfilesWithDerivedInvulnerableSaves(
      configured.units || [],
      configured,
      assignedEnhancementsForRosterEntry(rosterEntry)
    );
    const withUnit = profile => ({ ...profile, name: `${rosterEntry.unitPackage.name}: ${profile.name}` });
    merged.units.push(...enhancedUnits.map(withUnit));
    merged.weapons.push(...(configured.weapons || []).map(withUnit));
    merged.abilities.push(...(configured.abilities || []).map(withUnit));
    merged.rules.push(...(configured.rules || []).map(rule => ({ ...rule, name: `${rosterEntry.unitPackage.name}: ${rule.name || rule}` })));
  }
  return renderConfigured(merged);
}

function assignedEnhancementsForRosterEntry(rosterEntry) {
  const army = currentArmyDefinition();
  return (armyState?.enhancements || [])
    .filter(assignment => assignment.bearerInstanceId === rosterEntry.instanceId)
    .map(assignment => (army?.enhancements || []).find(item => item.id === assignment.enhancementId))
    .filter(Boolean);
}

function bindAttachedGroupInputs() {
  for (const button of document.querySelectorAll(".configureMember")) {
    button.onclick = event => {
      selectedInstanceId = event.target.dataset.instanceId;
      selectedPanel = "unit";
      render();
    };
  }
  for (const button of document.querySelectorAll(".removeMember")) {
    button.onclick = event => {
      removeRosterEntry(event.target.dataset.instanceId);
      render();
    };
  }
}

function renderUnitAssignments(rosterEntry) {
  const unit = rosterEntry.unitPackage;
  const definition = unit.definition;
  const assignment = currentArmyDefinition()
    ? armyEngine.getUnitAssignmentState(currentArmyDefinition(), armyState, roster, rosterEntry)
    : {
        showWarlord: false,
        isWarlord: false,
        leaderAssignment: null,
        leaderTargets: [],
        ledBy: [],
        eligibleLeaders: [],
        enhancements: []
      };
  const hasLeaderControls = Boolean(definition.roles?.leader || assignment.eligibleLeaders.length || assignment.ledBy.length);
  const hasEnhancementControls = assignment.enhancements.length > 0;
  if (!assignment.showWarlord && !hasLeaderControls && !hasEnhancementControls) return "";
  const ledByLabel = leaderAssignmentLabel(unit, assignment);

  return `
    <details class="sidebarGroup unitAssignments" data-disclosure-key="unitAssignments" ${disclosureOpenAttribute("unitAssignments", true)}>
      <summary>Unit Assignments</summary>
      <div>
        ${assignment.showWarlord ? `<label class="assignmentRow">
          <span><b>Warlord</b><small>${armyEngine.canSelectWarlord({ roles: definition.roles, rosterRules: definition.rosterRules, alliedFor: unit.alliedFor }) ? "Eligible" : "Selection will produce a warning"}</small></span>
          <input class="warlordToggle" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" type="checkbox" ${assignment.isWarlord ? "checked" : ""}>
        </label>` : ""}
        ${definition.roles?.leader ? `
          <label class="assignmentSelect"><span><b>Leads</b><small>Bodyguard unit</small></span>
            <select class="leaderTarget" data-leader-id="${escapeHtml(rosterEntry.instanceId)}">
              <option value="">Not attached</option>
              ${assignment.leaderTargets.map(targetState => {
                const target = roster.find(item => item.instanceId === targetState.instanceId);
                if (!target) return "";
                const legal = armyEngine.leaderCanTarget(
                  { selectionKey: unit.selectionKey, name: unit.name, rosterRules: definition.rosterRules },
                  { selectionKey: target.unitPackage.selectionKey, name: target.unitPackage.name }
                );
                return `<option value="${escapeHtml(target.instanceId)}" ${assignment.leaderAssignment?.targetInstanceId === target.instanceId ? "selected" : ""}>${escapeHtml(target.unitPackage.name)}${legal ? "" : " ⚠"}</option>`;
              }).join("")}
            </select>
          </label>
        ` : ""}
        ${assignment.eligibleLeaders.length || assignment.ledBy.length ? `
          <label class="assignmentSelect"><span><b>Led by</b><small>${escapeHtml(ledByLabel)}</small></span>
            <select class="bodyguardLeader" data-target-id="${escapeHtml(rosterEntry.instanceId)}">
              <option value="">Not attached</option>
              ${assignment.eligibleLeaders.map(leaderState => {
                const leader = roster.find(item => item.instanceId === leaderState.instanceId);
                if (!leader) return "";
                const legal = armyEngine.leaderCanTarget(
                  { selectionKey: leader.unitPackage.selectionKey, name: leader.unitPackage.name, rosterRules: leader.unitPackage.definition.rosterRules },
                  { selectionKey: unit.selectionKey, name: unit.name }
                );
                return `<option value="${escapeHtml(leader.instanceId)}" ${assignment.ledBy[0]?.leaderInstanceId === leader.instanceId ? "selected" : ""}>${escapeHtml(leader.unitPackage.name)}${legal ? "" : " ⚠"}</option>`;
              }).join("")}
            </select>
          </label>
        ` : ""}
        ${assignment.enhancements.length ? `
          <div class="enhancementAssignments">
            <b>Enhancements & Upgrades</b>
            ${assignment.enhancements.map(state => {
              const bearer = state.bearerOptions.find(item => item.instanceId === rosterEntry.instanceId);
              const selectedHere = (state.bearerInstanceIds || [state.bearerInstanceId]).includes(rosterEntry.instanceId);
              return `<div class="assignmentRow">
                ${renderEnhancementAssignmentDetails(state, bearer)}
                <input class="enhancementToggle" data-enhancement-id="${escapeHtml(state.id)}" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" type="checkbox" ${selectedHere ? "checked" : ""}>
              </div>`;
            }).join("")}
          </div>
        ` : ""}
      </div>
    </details>
  `;
}

function leaderAssignmentLabel(unit, assignment) {
  const count = assignment.ledBy.length;
  if (count <= 1) return "Leader unit";
  const allowsMultiple = Boolean(unit?.unitPackage?.definition?.rosterRules?.allowsMultipleLeadersAsBodyguard)
    || assignment.ledBy.some(item => {
      const leader = roster.find(entry => entry.instanceId === item.leaderInstanceId);
      const roles = leader?.unitPackage?.definition?.roles || {};
      const rules = leader?.unitPackage?.definition?.rosterRules || {};
      return Boolean(roles.support || rules.allowsAdditionalLeader);
    });
  return allowsMultiple ? `${count} Leaders assigned` : `${count} Leaders assigned - warning`;
}

function renderEnhancementAssignmentDetails(state, bearer) {
  const meta = [
    state.kind === "upgrade" ? "Upgrade" : "Enhancement",
    state.points ? `${state.points} pts` : "",
    bearer?.eligible ? "" : "ineligible"
  ].filter(Boolean).join(" · ");
  const description = renderEnhancementDescription(state);
  if (!description) {
    return `<span><b>${escapeHtml(state.name)}</b>${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</span>`;
  }
  return `
    <details class="assignmentDisclosure">
      <summary><b>${escapeHtml(state.name)}</b>${meta ? ` <small>${escapeHtml(meta)}</small>` : ""}</summary>
      ${description}
    </details>
  `;
}

function disclosureOpenAttribute(key, defaultOpen = false) {
  const open = Object.prototype.hasOwnProperty.call(sidebarDisclosureState, key)
    ? sidebarDisclosureState[key]
    : defaultOpen;
  return open ? "open" : "";
}

function bindSidebarDisclosureState() {
  for (const element of document.querySelectorAll("[data-disclosure-key]")) {
    element.ontoggle = event => {
      if (event.target === element) sidebarDisclosureState[element.dataset.disclosureKey] = element.open;
    };
  }
}

function bindUnitAssignmentInputs() {
  for (const input of document.querySelectorAll(".warlordToggle")) {
    input.onchange = event => {
      armyState = armyEngine.setWarlord(armyState, event.target.checked ? event.target.dataset.instanceId : null);
      render();
    };
  }
  for (const input of document.querySelectorAll(".enhancementToggle")) {
    input.onchange = event => {
      armyState = armyEngine.setEnhancement(
        currentArmyDefinition(), armyState, roster, event.target.dataset.enhancementId,
        event.target.dataset.instanceId,
        event.target.checked
      );
      render();
    };
  }
  for (const select of document.querySelectorAll(".leaderTarget")) {
    select.onchange = event => {
      armyState = armyEngine.setLeaderAttachment(armyState, event.target.dataset.leaderId, event.target.value || null);
      if (event.target.value) {
        selectedInstanceId = event.target.value;
        selectedPanel = "group";
      } else {
        selectedInstanceId = event.target.dataset.leaderId;
        selectedPanel = "unit";
      }
      render();
    };
  }
  for (const select of document.querySelectorAll(".bodyguardLeader")) {
    select.onchange = event => {
      const targetId = event.target.dataset.targetId;
      for (const relationship of (armyState.attachments || []).filter(item => item.targetInstanceId === targetId)) {
        armyState = armyEngine.setLeaderAttachment(armyState, relationship.leaderInstanceId, null);
      }
      if (event.target.value) armyState = armyEngine.setLeaderAttachment(armyState, event.target.value, targetId);
      selectedInstanceId = targetId;
      selectedPanel = event.target.value ? "group" : "unit";
      render();
    };
  }
}

function renderUnitSizeControl(rosterEntry, state) {
  if (!state.editable) return `<p><b>Unit Size:</b> ${state.current}</p>`;
  const presets = unitSizePresets(state);
  return `
    <div class="unitSizeControl">
      <b>Unit Size</b>
      <input class="unitSizeInput" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" type="number"
        value="${state.current}" min="${state.minimum}" max="${state.maximum}">
      ${presets.length ? `<div class="unitSizePresets">${presets.map(size => `
        <button class="unitSizePreset" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" data-size="${size}" ${state.current === size ? "disabled" : ""}>${size}</button>
      `).join("")}</div>` : ""}
      <small>${state.minimum}–${state.maximum} models</small>
    </div>
  `;
}

function unitSizePresets(state) {
  return [...new Set([state.minimum, state.maximum]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
}

function bindUnitSizeInputs() {
  const applyUnitSize = (instanceId, requested) => {
    const rosterEntry = roster.find(item => item.instanceId === instanceId);
    if (!rosterEntry) return;
    const state = engine.getUnitSizeState(rosterEntry.unitPackage.definition, rosterEntry.entry);
    if (!Number.isFinite(requested) || requested < state.minimum || requested > state.maximum) return;
    try {
      rosterEntry.entry = engine.setUnitSize(rosterEntry.unitPackage.definition, rosterEntry.entry, requested);
    } catch (error) {
      alert(error.message);
    }
    selectedPanel = "unit";
    selectedInstanceId = rosterEntry.instanceId;
    render();
  };
  for (const input of document.querySelectorAll(".unitSizeInput")) {
    const applySize = event => {
      applyUnitSize(event.target.dataset.instanceId, Number(event.target.value));
    };
    input.oninput = applySize;
    input.onchange = applySize;
  }
  for (const button of document.querySelectorAll(".unitSizePreset")) {
    button.onclick = event => {
      event.preventDefault();
      applyUnitSize(event.target.dataset.instanceId, Number(event.target.dataset.size));
    };
  }
}

function renderOptionControls(rosterEntry) {
  const unit = rosterEntry.unitPackage;

  const optionStates = engine.getOptionStates(unit.definition, rosterEntry.entry);
  const stateById = new Map(optionStates.map(option => [option.id, option]));
  const rootRows = (unit.definition.selectionTree?.children || [])
    .filter(node => node.kind !== "group")
    .map(node => renderNestedOptionRow(node, rosterEntry, stateById, 0))
    .filter(Boolean);

  const groups = (unit.definition.selectionTree?.children || [])
    .filter(node => node.kind === "group")
    .map(group => renderNestedOptionGroup(group, rosterEntry, stateById, 0))
    .filter(Boolean);

  if (!rootRows.length && !groups.length) {
    return `<p><b>No configurable loadout options.</b></p>`;
  }

  const rootOptions = rootRows.length
    ? `<details class="optionGroup optionGroupDepth0" open>
        <summary><span>Options</span></summary>
        <div class="optionGroupRows">${rootRows.join("")}</div>
      </details>`
    : "";

  return `<h4 class="loadoutHeading">Wargear</h4>${rootOptions}${groups.join("")}`;
}

function renderNestedOptionGroup(group, rosterEntry, stateById, depth) {
  const children = group.children || [];
  const optionChildren = children.filter(child => child.kind !== "group");
  const orderedOptionChildren = orderOptionChildrenForDisplay(optionChildren);
  const optionRows = orderedOptionChildren
    .map(child => renderNestedOptionRow(child, rosterEntry, stateById, depth))
    .filter(Boolean);
  const childGroups = children
    .filter(child => child.kind === "group")
    .map(child => renderNestedOptionGroup(child, rosterEntry, stateById, depth + 1))
    .filter(Boolean);
  const body = [...optionRows, ...childGroups].join("");
  if (!body) return "";

  const representative = children
    .filter(child => child.kind !== "group")
    .map(child => stateById.get(child.id))
    .find(shouldRenderOption)
    || findFirstRenderedState(group, stateById);
  const limits = representative ? renderOptionGroupLimits(representative) : "";
  const required = representative?.groupRequired ? ` <b class="requiredBadge">Required</b>` : "";

  return `
    <details class="optionGroup optionGroupDepth${Math.min(depth, 2)}" open>
      <summary><span>${escapeHtml(group.name || "Options")}${required}</span>${limits ? `<small>${limits}</small>` : ""}</summary>
      <div class="optionGroupRows">${body}</div>
    </details>
  `;
}

function orderOptionChildrenForDisplay(children) {
  if (children.length < 2) return children;
  const counts = children.map(child => fixedDisplayModelCount(child));
  if (!counts.every(count => count > 0)) return children;
  return [...children].sort((a, b) =>
    fixedDisplayModelCount(a) - fixedDisplayModelCount(b)
    || specialistDisplayWeight(a) - specialistDisplayWeight(b)
    || String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function fixedDisplayModelCount(node) {
  if (!node) return 0;
  if (node.kind === "model") {
    return constraintNumber(node, "min", "parent")
      ?? constraintNumber(node, "min")
      ?? constraintNumber(node, "max", "parent")
      ?? constraintNumber(node, "max")
      ?? 0;
  }
  return (node.children || []).reduce((sum, child) => sum + fixedDisplayModelCount(child), 0);
}

function specialistDisplayWeight(node) {
  if (!node) return 0;
  const own = node.kind === "model" && /\bw\//i.test(node.name || "") ? fixedDisplayModelCount(node) || 1 : 0;
  return own + (node.children || []).reduce((sum, child) => sum + specialistDisplayWeight(child), 0);
}

function constraintNumber(node, type, scope = null) {
  const found = (node.constraints || []).find(constraint =>
    constraint.type === type
    && constraint.field === "selections"
    && (!scope || constraint.scope === scope)
  );
  return found ? Number(found.value || 0) : null;
}

function renderNestedOptionRow(node, rosterEntry, stateById, depth) {
  const option = stateById.get(node.id);
  const current = option?.current || 0;
  const childGroups = current > 0
    ? (node.children || [])
      .filter(child => child.kind === "group")
      .map(child => renderNestedOptionGroup(child, rosterEntry, stateById, depth + 1))
      .filter(Boolean)
      .join("")
    : "";
  if (!shouldRenderOption(option)) {
    if (option?.active && option.kind === "model" && childGroups) {
      return `
        <details class="optionGroup optionGroupDepth${Math.min(depth, 2)}" open>
          <summary><span>${escapeHtml(option.name)}</span><small>${current} model${current === 1 ? "" : "s"}</small></summary>
          <div class="nestedOptionGroups">${childGroups}</div>
        </details>
      `;
    }
    return "";
  }

  const max = displayOptionMaximum(option);
  const inputType = max === 1 ? "checkbox" : "number";
  const checked = current > 0 ? "checked" : "";
  const value = inputType === "number" ? `value="${current}" min="0" max="${Number.isFinite(max) ? max : 99}"` : "";

  return `
    <div class="nestedOptionBlock">
      <label class="compactOptionRow ${option.editable ? "" : "lockedOption"}">
        <span class="optionName">${escapeHtml(option.name)}</span>
        <span class="optionLimits">${current} · ${option.minimum}–${formatOptionMaximum(max)}</span>
        <input
          class="loadoutInput"
          data-instance-id="${escapeHtml(rosterEntry.instanceId)}"
          data-option-id="${escapeHtml(option.id)}"
          type="${inputType}"
          ${inputType === "checkbox" ? checked : value}
          ${option.editable ? "" : "disabled"}
        >
      </label>
      ${childGroups ? `<div class="nestedOptionGroups">${childGroups}</div>` : ""}
    </div>
  `;
}

function shouldRenderOption(option) {
  return Boolean(option?.active && (option.editable || (option.current > 0 && option.kind !== "model")));
}

function displayOptionMaximum(option) {
  if (!option) return Infinity;
  if (Number.isFinite(option.maximum)) return option.maximum;
  if (Number.isFinite(option.groupMaximum)) return Math.max(option.current || 0, option.groupMaximum);
  return Infinity;
}

function findFirstRenderedState(node, stateById) {
  for (const child of node.children || []) {
    if (child.kind !== "group") {
      const state = stateById.get(child.id);
      if (shouldRenderOption(state)) return state;
    }
    const nested = findFirstRenderedState(child, stateById);
    if (nested) return nested;
  }
  return null;
}

function renderOptionGroupLimits(group) {
  return group.mutuallyExclusive
    ? "Choose one"
    : `${group.groupCurrent} selected · min ${group.groupMinimum} / max ${formatOptionMaximum(group.groupMaximum)}`;
}

function formatOptionMaximum(value) {
  return Number.isFinite(value) ? String(value) : "any";
}

function bindLoadoutInputs() {
  for (const input of document.querySelectorAll(".loadoutInput")) {
    input.onchange = event => {
      const instanceId = event.target.dataset.instanceId;
      const optionId = event.target.dataset.optionId;
      const rosterEntry = roster.find(item => item.instanceId === instanceId);
      if (!rosterEntry) return;

      const count = event.target.type === "checkbox"
        ? event.target.checked ? 1 : 0
        : Number(event.target.value || 0);

      try {
        rosterEntry.entry = engine.setSelection(rosterEntry.unitPackage.definition, rosterEntry.entry, optionId, count);
      } catch (error) {
        alert(error.message);
      }

      selectedInstanceId = instanceId;
      render();
    };
  }
}

function parentLabel(definition, parentId) {
  const found = findNode(definition.selectionTree, parentId);
  return found?.name || "Options";
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function renderEntryValidation(loadoutErrors, pricingErrors) {
  const all = [
    ...(loadoutErrors || []).map(error => `${error.name}: ${error.actual}/${error.limit} ${error.type}`),
    ...(pricingErrors || [])
  ];

  if (!all.length) return `<p class="valid">✓ Unit loadout valid.</p>`;

  return `
    <div class="invalid">
      ${all.map(error => `<div>✗ ${escapeHtml(error)}</div>`).join("")}
    </div>
  `;
}

function renderConfigured(configured, effects = [], models = []) {
  return `
    ${renderConfiguredModels(models)}
    ${renderUnitProfiles(unitProfilesWithDerivedInvulnerableSaves(configured.units || [], configured, effects))}
    ${renderWeapons("Ranged Weapons", configured.weapons || [], "Ranged Weapons")}
    ${renderWeapons("Melee Weapons", configured.weapons || [], "Melee Weapons")}
    ${renderAbilities(configured.abilities || [])}
    ${renderRules(configured.rules || [])}
  `;
}

function renderConfiguredModels(models) {
  if (!models.length) return "";

  return `
    <details class="configuredSection modelSummary" open>
      <summary>Models</summary>
      <div class="modelRows">
        ${models.map(model => `
          <div class="modelRow">
            <b>${escapeHtml(model.count > 1 ? `${model.count}x ${model.name}` : `1x ${model.name}`)}</b>
            <small>${escapeHtml((model.equipment || []).join(", ") || "No selected equipment")}</small>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderKeywords(keywords) {
  const visible = [...new Set(keywords || [])].filter(Boolean);
  if (!visible.length) return "";
  return `
    <h4>Keywords</h4>
    <div class="chips keywordChips">
      ${visible.map(keyword => `<span>${escapeHtml(keyword)}</span>`).join("")}
    </div>
  `;
}

function renderUnitProfiles(units) {
  if (!units.length) return "";

  return `
    <h4>Unit</h4>
    <table>
      <thead>
        <tr>
          <th>Name</th><th>M</th><th>T</th><th>SV</th><th>W</th><th>LD</th><th>OC</th><th>InSv</th>
        </tr>
      </thead>
      <tbody>
        ${units.map(profile => {
          const c = profile.characteristics || {};
          return `
            <tr>
              <td>${escapeHtml(profile.name)}</td>
              <td>${escapeHtml(c.M ?? "")}</td>
              <td>${escapeHtml(c.T ?? "")}</td>
              <td>${escapeHtml(c.SV ?? "")}</td>
              <td>${escapeHtml(c.W ?? "")}</td>
              <td>${escapeHtml(c.LD ?? "")}</td>
              <td>${escapeHtml(c.OC ?? "")}</td>
              <td>${escapeHtml(displayStatValue(c.InSv ?? c["Invulnerable Save"]))}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function unitProfilesWithDerivedInvulnerableSaves(units, configured = {}, effects = []) {
  const inferredInSv = inferredInvulnerableSave(configured, effects);
  return (units || []).map(profile => {
    const characteristics = { ...(profile.characteristics || {}) };
    const best = bestSave(invulnerableSaveValue(characteristics), inferredInSv);
    if (best) {
      characteristics.InSv = best;
      if (characteristics["Invulnerable Save"] !== undefined) characteristics["Invulnerable Save"] = best;
    }
    return { ...profile, characteristics };
  });
}

function inferredInvulnerableSave(configured = {}, effects = []) {
  const texts = [
    ...(configured.abilities || []).flatMap(effectTextParts),
    ...(configured.rules || []).flatMap(effectTextParts),
    ...(configured.profiles || []).flatMap(effectTextParts),
    ...(effects || []).flatMap(effectTextParts)
  ];
  return bestSave("", ...texts.map(extractInvulnerableSave).filter(Boolean));
}

function effectTextParts(item) {
  return [
    item?.name,
    item?.description,
    item?.characteristics?.Description,
    ...(item?.profiles || []).flatMap(effectTextParts),
    ...(item?.rules || []).flatMap(effectTextParts)
  ].filter(Boolean);
}

function invulnerableSaveValue(characteristics = {}) {
  const value = String(characteristics.InSv || characteristics["Invulnerable Save"] || "").trim();
  return value && value !== "-" ? value : "";
}

function extractInvulnerableSave(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b([2-6]\+)\s*(?:\*\*)?\s*(?:InSv|invulnerable\s+save)\b/i)
    || normalized.match(/\b(?:InSv|invulnerable\s+save)\s*(?:of|:)?\s*(?:\*\*)?\s*([2-6]\+)/i);
  return match ? match[1] : "";
}

function bestSave(...values) {
  return values
    .map(value => String(value || "").trim())
    .filter(value => /^[2-6]\+$/.test(value))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))[0] || "";
}

function displayStatValue(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function renderWeapons(title, weapons, typeName) {
  const rows = weapons.filter(w => w.typeName === typeName);
  if (!rows.length) return "";

  return `
    <h4>${escapeHtml(title)}</h4>
    <table>
      <thead>
        <tr>
          <th>Count</th><th>Weapon</th><th>Range</th><th>A</th><th>BS</th><th>WS</th><th>S</th><th>AP</th><th>D</th><th>Keywords</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(w => {
          const c = w.characteristics || {};
          return `
            <tr>
              <td>${escapeHtml(w.count ?? 1)}</td>
              <td>${escapeHtml(w.name)}</td>
              <td>${escapeHtml(displayWeaponCell(c.Range))}</td>
              <td>${escapeHtml(displayWeaponCell(c.A))}</td>
              <td>${escapeHtml(displayWeaponCell(c.BS))}</td>
              <td>${escapeHtml(displayWeaponCell(c.WS))}</td>
              <td>${escapeHtml(displayWeaponCell(c.S))}</td>
              <td>${escapeHtml(displayWeaponCell(c.AP))}</td>
              <td>${escapeHtml(displayWeaponCell(c.D))}</td>
              <td>${escapeHtml(displayWeaponCell(c.Keywords))}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function displayWeaponCell(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

function renderAbilities(abilities) {
  if (!abilities.length) return "";

  return `
    <details class="configuredSection" open>
      <summary>Abilities</summary>
      ${abilities.map(a => `
        <details class="card ruleDisclosure">
          <summary>${escapeHtml(a.name)}</summary>
          <p>${formatDescription(a.characteristics?.Description || "")}</p>
        </details>
      `).join("")}
    </details>
  `;
}

function renderRules(rules) {
  if (!rules.length) return "";

  return `
    <h4>Rules</h4>
    ${rules.map(rule => {
      const name = rule.name || rule;
      const description = rule.description || "";
      return description
        ? `<details class="card ruleDisclosure"><summary>${escapeHtml(name)}</summary><p>${formatDescription(description)}</p></details>`
        : `<div class="chips"><span>${escapeHtml(name)}</span></div>`;
    }).join("")}
  `;
}

function entryPoints(rosterEntry) {
  return entryPricing(rosterEntry).points;
}

function entryEnhancementPoints(rosterEntry) {
  const army = currentArmyDefinition();
  if (!army || !rosterEntry) return 0;
  const pointsByBearer = armyEngine.enhancementPointsByBearer?.(army, armyState);
  return Number(pointsByBearer?.get(rosterEntry.instanceId) || 0);
}

function entryDisplayPoints(rosterEntry) {
  return entryPoints(rosterEntry) + entryEnhancementPoints(rosterEntry);
}

function formatPointsBreakdown(totalPoints, basePoints, enhancementPoints) {
  const total = Number(totalPoints || 0);
  const base = Number(basePoints || 0);
  const enhancement = Number(enhancementPoints || 0);
  return enhancement
    ? `${total} pts (${base}+${enhancement})`
    : `${total} pts`;
}

function formatEntryPoints(rosterEntry) {
  return formatPointsBreakdown(entryDisplayPoints(rosterEntry), entryPoints(rosterEntry), entryEnhancementPoints(rosterEntry));
}

function formatGroupPoints(group) {
  return formatPointsBreakdown(group?.totalPoints, group?.basePoints ?? group?.totalPoints, group?.enhancementPoints);
}

function formatSheetMemberPoints(member) {
  return formatPointsBreakdown(
    member?.totalPoints ?? member?.points,
    member?.points,
    member?.enhancementPoints
  );
}

function formatSheetTotalPoints(sheet) {
  return formatPointsBreakdown(sheet?.totalPoints, sheet?.basePoints ?? sheet?.totalPoints, sheet?.enhancementPoints);
}

function rosterCopyContexts() {
  const seen = new Map();
  const contexts = new Map();
  for (const item of roster) {
    const key = item.unitPackage?.selectionKey || item.unitPackage?.definition?.selectionKey || item.unitPackage?.definition?.id;
    const previousCopies = seen.get(key) || 0;
    seen.set(key, previousCopies + 1);
    contexts.set(item.instanceId, {
      rosterCopyIndex: previousCopies + 1,
      previousCopies,
      rosterCopyCount: seen.get(key)
    });
  }
  return contexts;
}

function entryWithPricingContext(rosterEntry, contexts = rosterCopyContexts()) {
  const copyContext = contexts.get(rosterEntry.instanceId) || {};
  return {
    ...rosterEntry.entry,
    context: {
      ...(rosterEntry.entry.context || {}),
      ...copyContext
    }
  };
}

function entryPricing(rosterEntry, contexts = rosterCopyContexts()) {
  return engine.calculateEntryPoints(
    rosterEntry.unitPackage.definition,
    entryWithPricingContext(rosterEntry, contexts)
  );
}

function rosterWithPoints() {
  const contexts = rosterCopyContexts();
  return roster.map(item => ({ ...item, points: entryPricing(item, contexts).points }));
}

function getTotalPoints() {
  const unitPoints = rosterWithPoints().reduce((sum, entry) => sum + entry.points, 0);
  const optionPoints = currentArmyDefinition()
    ? armyEngine.calculateArmyOptionPoints(currentArmyDefinition(), armyState)
    : 0;
  return unitPoints + optionPoints;
}

function renderTotal() {
  pointsTotal.textContent = getTotalPoints();
}

function validateRoster() {
  const total = getTotalPoints();
  const limit = Number(pointsLimitInput.value || 0);
  const messages = [];

  if (currentArmyDefinition()) {
    const legalityRoster = rosterWithPoints();
    const result = armyEngine.validateRosterLegality(currentArmyDefinition(), armyState, legalityRoster, { totalPoints: total, pointsLimit: limit });
    for (const item of result.warnings) {
      messages.push({ ok: false, code: item.code, text: item.message });
    }
  }

  if (!roster.length) messages.push({ ok: true, text: "Roster is empty." });

  return messages;
}

function currentRosterDocument() {
  return rosterDocument.createRosterDocument({
    name: rosterNameInput.value.trim() || null,
    engineData,
    faction: currentFaction,
    subfaction: currentSubfaction,
    pointsLimit: Number(pointsLimitInput.value || 0),
    totalPoints: getTotalPoints(),
    armyDefinition: currentArmyDefinition(),
    armyState,
    rosterEntries: roster,
    groupedPresentation: rosterPresentation(),
    validationWarnings: validateRoster().filter(item => !item.ok),
    services: {
      entryPoints,
      configuredProfiles: engine.getConfiguredProfiles,
      configuredModels: engine.getConfiguredModels,
      unitSizeState: engine.getUnitSizeState,
      selectedDetachment: armyEngine.selectedDetachment,
      selectedDetachments: armyEngine.selectedDetachments
    }
  });
}

function savedRosterLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem("engineRosterSaves") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRosterLibrary(saves) {
  localStorage.setItem("engineRosterSaves", JSON.stringify(saves));
}

function normalizeImportedRosterRecord(input) {
  const document = input?.document || input;
  if (!document || typeof document !== "object") return null;
  if (!document.faction || !document.armyState) return null;
  const id = input?.id || `roster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    savedAt: input?.savedAt || new Date().toISOString(),
    document
  };
}

function importedRosterRecords(input) {
  const source = Array.isArray(input)
    ? input
    : Array.isArray(input?.engineRosterSaves)
      ? input.engineRosterSaves
      : Array.isArray(input?.saves)
        ? input.saves
        : [input];
  return source.map(normalizeImportedRosterRecord).filter(Boolean);
}

function mergeRosterSaves(records) {
  const saves = savedRosterLibrary();
  for (const record of records) {
    const name = String(record.document?.name || "").trim().toLowerCase();
    const existingIndex = saves.findIndex(save => save.id === record.id
      || (name && String(save.document?.name || "").trim().toLowerCase() === name));
    if (existingIndex >= 0) saves[existingIndex] = record;
    else saves.push(record);
  }
  saveRosterLibrary(saves);
  renderRosterSaveBrowser();
}

function rosterSaveLabel(document) {
  const name = document.name || "Unnamed roster";
  const detachment = (document.detachments || []).map(item => item.name).join(" + ") || document.detachment?.name || "No detachment";
  const points = `${document.totalPoints || 0}/${document.pointsLimit || 0} pts`;
  return `${name} - ${detachment} - ${points}`;
}

function renderRosterSaveBrowser() {
  if (!rosterSavesSelect) return;
  const saves = savedRosterLibrary();
  rosterSavesSelect.innerHTML = saves.length
    ? `<option value="">Saved rosters...</option>` + saves.map(save => `<option value="${escapeHtml(save.id)}">${escapeHtml(rosterSaveLabel(save.document))}</option>`).join("")
    : `<option value="">No saved rosters</option>`;
  if (currentRosterSaveId && saves.some(save => save.id === currentRosterSaveId)) {
    rosterSavesSelect.value = currentRosterSaveId;
  } else {
    rosterSavesSelect.value = "";
  }
}

function renderValidation() {
  const validation = document.getElementById("validation");
  if (!validation) return;
  const results = validateRoster();
  const warningCount = results.filter(item => !item.ok).length;
  validation.innerHTML = warningCount
    ? `<div class="warningSummary">⚠ ${warningCount} warning${warningCount === 1 ? "" : "s"}. You can keep editing and save this roster.</div>` + results
      .map(result => `<div class="${result.ok ? "valid" : "warning"}">${result.ok ? "✓" : "⚠"} ${escapeHtml(result.text)}</div>`).join("")
    : results.map(result => `<div class="valid">✓ ${escapeHtml(result.text)}</div>`).join("") || `<div class="valid">✓ Roster is legal.</div>`;
}

function saveRoster() {
  const document = currentRosterDocument();
  document.name = document.name || `${currentSubfaction || currentFaction} roster`;
  const saves = savedRosterLibrary();
  const matchingName = saves.find(save => String(save.document?.name || "").toLowerCase() === document.name.toLowerCase());
  const active = saves.find(save => save.id === currentRosterSaveId);
  const id = matchingName?.id
    || (active && String(active.document?.name || "").toLowerCase() === document.name.toLowerCase() ? active.id : null)
    || `roster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const record = { id, savedAt: new Date().toISOString(), document };
  const existingIndex = saves.findIndex(save => save.id === id);
  if (existingIndex >= 0) saves[existingIndex] = record;
  else saves.push(record);
  currentRosterSaveId = id;
  rosterNameInput.value = document.name;
  saveRosterLibrary(saves);
  localStorage.setItem("engineRoster", JSON.stringify(document));
  markRosterClean();
  renderRosterSaveBrowser();
  alert("Saved.");
}

async function loadRoster() {
  if (!confirmDiscardUnsavedRoster()) return;
  const saves = savedRosterLibrary();
  const selected = saves.find(save => save.id === (rosterSavesSelect.value || currentRosterSaveId));
  const raw = selected ? JSON.stringify(selected.document) : localStorage.getItem("engineRoster");
  if (!raw) {
    alert("No saved roster.");
    return;
  }

  const save = JSON.parse(raw);
  if (selected) currentRosterSaveId = selected.id;
  await loadRosterDocument(save);
}

async function loadRosterById(id) {
  if (id !== currentRosterSaveId && !confirmDiscardUnsavedRoster()) {
    renderRosterSaveBrowser();
    return;
  }
  const selected = savedRosterLibrary().find(save => save.id === id);
  if (!selected) {
    alert("Saved roster not found.");
    render();
    return;
  }
  currentRosterSaveId = selected.id;
  await loadRosterDocument(selected.document);
}

async function loadRosterDocument(save) {
  const savedRecord = (engineData.factionNavigation || []).flatMap(group => group.factions)
    .find(item => item.id === save.faction || (item.modes || []).some(mode => mode.id === save.faction));
  currentFaction = savedRecord?.id || save.faction;
  currentSubfaction = save.subfaction || ((savedRecord?.modes || []).some(mode => mode.id === save.faction) ? save.faction : savedRecord?.defaultMode) || currentFaction;
  factionSelect.value = currentFaction;
  renderSubfactionControl();
  await loadSelectedFactionData();
  rosterNameInput.value = save.name || "";
  const loaded = rosterDocument.hydrateRosterDocument(save, {
    unitPackages: factionUnits(),
    createArmyState: () => armyEngine.createArmyState(currentArmyDefinition()),
    pruneArmyStateForRoster: armyEngine.pruneArmyStateForRoster
  });
  pointsLimitInput.value = loaded.pointsLimit || 1000;
  armyState = loaded.armyState;
  roster = loaded.roster;

  selectedInstanceId = roster[0]?.instanceId || null;
  selectedPanel = selectedInstanceId ? "unit" : "configuration";
  appMode = "builder";
  markRosterClean();
  render();
  if (loaded.warnings.length) alert(`Loaded with ${loaded.warnings.length} warning${loaded.warnings.length === 1 ? "" : "s"}. Recoverable choices were preserved where possible.`);
}

async function importRosterJsonFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!confirmDiscardUnsavedRoster()) return;

  try {
    const parsed = JSON.parse(await file.text());
    const records = importedRosterRecords(parsed);
    if (!records.length) {
      alert("No roster records were found in that JSON file.");
      return;
    }
    mergeRosterSaves(records);
    currentRosterSaveId = records[0].id;
    await loadRosterDocument(records[0].document);
    alert(records.length === 1 ? "Imported 1 roster." : `Imported ${records.length} rosters.`);
  } catch (error) {
    alert(`Import failed: ${error.message}`);
  }
}

function deleteRoster() {
  const id = rosterSavesSelect.value || currentRosterSaveId;
  if (!id) return;
  requestDeleteRoster(id);
}

function requestDeleteRoster(id) {
  const savesBefore = savedRosterLibrary();
  const target = savesBefore.find(save => save.id === id);
  if (!target) return;
  pendingDeleteRosterId = id;
  deleteRosterMessage.textContent = `Delete "${target.document?.name || "Unnamed roster"}"? This cannot be undone.`;
  deleteRosterModal.hidden = false;
}

function closeDeleteRosterModal() {
  pendingDeleteRosterId = null;
  deleteRosterModal.hidden = true;
  deleteRosterMessage.textContent = "";
}

function confirmPendingRosterDelete() {
  if (!pendingDeleteRosterId) return;
  const id = pendingDeleteRosterId;
  closeDeleteRosterModal();
  deleteRosterById(id);
}

function deleteRosterById(id) {
  const savesBefore = savedRosterLibrary();
  const target = savesBefore.find(save => save.id === id);
  if (!target) return;
  const saves = savesBefore.filter(save => save.id !== id);
  saveRosterLibrary(saves);
  if (currentRosterSaveId === id) currentRosterSaveId = null;
  renderRosterSaveBrowser();
  if (appMode === "library") renderStartScreen();
}

function fileSafeRosterName(document) {
  const fallback = document.faction || currentFaction || "roster";
  const name = String(document.name || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  return name || "roster";
}

function exportRosterJson() {
  const document = currentRosterDocument();
  downloadFile(`${fileSafeRosterName(document)}.json`, JSON.stringify(document, null, 2));
}

function exportRosterText(format = "NR") {
  const document = currentRosterDocument();
  const suffix = String(format || "NR").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  downloadFile(`${fileSafeRosterName(document)}-${suffix || "text"}.txt`, rosterDocument.exportRosterText(document, {
    format,
    skippableWargear: compactorSkippableWargear
  }));
}

function discordExportControls() {
  return [
    discordListStyle,
    discordMultilineHeader,
    discordCombineIdentical,
    discordHideSubunits,
    discordHideBullets,
    discordHidePoints,
    discordUnitColor,
    discordPointsColor,
    ...document.querySelectorAll("input[name='discordColorMode']")
  ].filter(Boolean);
}

function selectedDiscordColorMode() {
  return document.querySelector("input[name='discordColorMode']:checked")?.value || "faction";
}

function discordExportOptions() {
  const style = discordListStyle?.value || "discord-extended";
  const colorMode = selectedDiscordColorMode();
  const customColorOptions = colorMode === "custom"
    ? {
        unitAnsiCode: Number(discordUnitColor?.value || 37),
        detailAnsiCode: Number(discordUnitColor?.value || 37),
        pointsAnsiCode: Number(discordPointsColor?.value || 33)
      }
    : {};
  return {
    format: "DISCORD",
    compact: style === "discord-compact" || style === "plain-compact",
    ansi: style.startsWith("discord-") && colorMode !== "none",
    multilineHeader: Boolean(discordMultilineHeader?.checked),
    combineIdentical: Boolean(discordCombineIdentical?.checked),
    hideSubunits: Boolean(discordHideSubunits?.checked),
    noBullets: Boolean(discordHideBullets?.checked),
    hidePoints: Boolean(discordHidePoints?.checked),
    colorMode,
    skippableWargear: compactorSkippableWargear,
    ...customColorOptions
  };
}

function discordExportSuffix() {
  const style = discordListStyle?.value || "discord-extended";
  const parts = ["discord", style.replace(/^discord-/, "").replace(/^plain-/, "plain-")];
  if (discordCombineIdentical?.checked) parts.push("combined");
  if (discordHideSubunits?.checked) parts.push("flat");
  if (discordHidePoints?.checked) parts.push("no-points");
  return parts.join("-");
}

function currentDiscordExportText() {
  return rosterDocument.exportRosterText(currentRosterDocument(), discordExportOptions());
}

function openDiscordExportModal() {
  if (!roster.length) {
    alert("Add at least one unit before exporting.");
    return;
  }
  discordExportModal.hidden = false;
  renderDiscordExportPreview();
}

function closeDiscordExportModal() {
  discordExportModal.hidden = true;
}

function renderDiscordExportPreview() {
  if (!discordExportModal || discordExportModal.hidden) return;
  if (discordCustomColors) discordCustomColors.hidden = selectedDiscordColorMode() !== "custom";
  lastDiscordExportText = currentDiscordExportText();
  discordExportPreview.innerHTML = discordPreviewHtml(lastDiscordExportText);
}

function discordPreviewHtml(text) {
  let source = String(text || "").replace(/^```ansi\n?/, "").replace(/\n?```$/, "");
  const output = [];
  let open = false;
  const ansiPattern = /\u001b\[([0-9;]+)m/g;
  let offset = 0;
  let match;
  while ((match = ansiPattern.exec(source))) {
    output.push(escapeHtml(source.slice(offset, match.index)));
    const codes = match[1].split(";").map(Number);
    if (open) {
      output.push("</span>");
      open = false;
    }
    if (!codes.includes(0)) {
      output.push(`<span class="${discordAnsiClass(codes)}">`);
      open = true;
    }
    offset = ansiPattern.lastIndex;
  }
  output.push(escapeHtml(source.slice(offset)));
  if (open) output.push("</span>");
  return output.join("");
}

function discordAnsiClass(codes) {
  const color = [...codes].reverse().find(code => code >= 30 && code <= 37) || 37;
  const classes = [`ansi${color}`];
  if (codes.includes(1)) classes.push("ansiBold");
  return classes.join(" ");
}

async function copyDiscordExport() {
  const text = lastDiscordExportText || currentDiscordExportText();
  try {
    await navigator.clipboard.writeText(text);
    alert("Copied Discord export.");
  } catch {
    alert("Copy failed. The preview text is still selectable.");
  }
}

function downloadDiscordExport() {
  const document = currentRosterDocument();
  const text = lastDiscordExportText || currentDiscordExportText();
  downloadFile(`${fileSafeRosterName(document)}-${discordExportSuffix()}.txt`, text);
}

async function loadCompactorData() {
  for (const url of ["data/40k-compactor-skippable-wargear.json", "../data/manual-rules/40k-compactor-skippable-wargear.json"]) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      compactorSkippableWargear = await response.json();
      return;
    } catch {
      // Optional export helper data; keep exports working without it.
    }
  }
  compactorSkippableWargear = {};
}

function openSheetPreview(kind) {
  if (!roster.length) {
    alert("Add at least one unit before creating sheets.");
    return;
  }
  const sheets = rosterSheets.buildRosterSheets(currentRosterDocument());
  const html = buildSheetPreviewHtml(sheets, kind);
  const previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const preview = window.open(previewUrl, "_blank");
  if (!preview) {
    URL.revokeObjectURL(previewUrl);
    alert("The sheet preview was blocked by the browser.");
    return;
  }
  preview.addEventListener?.("load", () => URL.revokeObjectURL(previewUrl), { once: true });
}

function buildSheetPreviewHtml(sheets, kind) {
  const title = kind === "crusade" ? "Crusade Sheets" : "Unit Sheets";
  const body = kind === "crusade"
    ? sheets.crusadeSheets.map(renderCrusadeSheetPage).join("")
    : [
        renderRulesReferencePage(sheets.referenceSheets?.rules),
        renderCoreStratagemReferencePage(sheets.referenceSheets?.stratagems),
        ...sheets.combinedUnitSheets.map(renderUnitSheetPage)
      ].filter(Boolean).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(sheets.rosterName)} - ${title}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    body { background: #e8e8e8; color: #151515; font-family: Arial, sans-serif; margin: 0; }
    .toolbar { align-items: center; background: #1f2933; color: white; display: flex; gap: 12px; justify-content: space-between; padding: 10px 14px; position: sticky; top: 0; z-index: 2; }
    .toolbar button { margin: 0; }
    .sheet { --sheet-font-size: 14px; background: white; box-sizing: border-box; font-size: var(--sheet-font-size); height: 297mm; margin: 18px auto; overflow: hidden; padding: 10mm; width: 210mm; }
    .sheetHeader { border-bottom: 3px solid #151515; display: grid; gap: 0.55em; grid-template-columns: minmax(0, 1fr) auto; padding-bottom: 0.6em; }
    .sheetHeader h1 { font-size: 1.7em; margin: 0; }
    .sheetHeader small { color: #4b5563; display: block; margin-top: 3px; }
    .pointsBox { border: 2px solid #151515; font-size: 1.3em; font-weight: 700; padding: 0.45em 0.7em; text-align: center; }
    .members { display: grid; gap: 0.4em; margin: 0.7em 0; }
    .memberRow, .blankRow { border: 1px solid #999; display: grid; gap: 0.55em; grid-template-columns: minmax(0, 1fr) auto; padding: 0.42em; }
    .grid2 { display: grid; gap: 0.7em; grid-template-columns: 1fr 1fr; }
    h2 { background: #f1f1f1; border: 1px solid #777; color: #111; font-size: 1.05em; margin: 0.8em 0 0.4em; padding: 0.35em 0.5em; }
    table { border-collapse: collapse; font-size: 0.86em; width: 100%; }
    th, td { border: 1px solid #999; padding: 0.3em; text-align: left; vertical-align: top; }
    th { background: #efefef; }
    .rule { border: 1px solid #999; margin-bottom: 0.35em; padding: 0.35em; }
    .rule b { display: block; }
    .referenceGrid { display: grid; gap: 0.45em; }
    .referenceItem { border: 1px solid #999; padding: 0.42em; }
    .referenceItem h3 { font-size: 0.95em; margin: 0 0 0.25em; }
    .referenceItem small { color: #555; display: block; margin-bottom: 0.2em; }
    .referenceItem p { margin: 0; }
    .stratagemGrid { display: grid; gap: 0.42em; grid-template-columns: 1fr 1fr; }
    .stratagemCard { border: 1px solid #999; padding: 0.35em; }
    .stratagemCard h3 { align-items: baseline; display: flex; font-size: 0.88em; gap: 0.45em; justify-content: space-between; margin: 0 0 0.25em; }
    .stratagemCard small { color: #555; display: block; }
    .stratagemCard p { font-size: 0.8em; margin: 0.25em 0 0; }
    .chips span { border: 1px solid #999; display: inline-block; margin: 0.14em; padding: 0.2em 0.35em; }
    .notesBox { border: 1px solid #999; min-height: 5.1em; padding: 0.42em; }
    .warning { border-color: #a15c00; color: #7a4300; }
    .fitDense { padding: 8mm; }
    .fitDense h2 { margin-top: 0.55em; }
    .fitDense .referenceGrid, .fitDense .stratagemGrid { gap: 0.32em; }
    .fitCompact { padding: 7mm; }
    .fitCompact .stratagemGrid { grid-template-columns: 1fr 1fr; }
    .fitCompact .referenceItem, .fitCompact .stratagemCard, .fitCompact .rule { padding: 0.28em; }
    .fitTiny { padding: 6mm; }
    @media print {
      body { background: white; }
      .toolbar { display: none; }
      .sheet { box-shadow: none; margin: 0; page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div><b>${escapeHtml(title)}</b> <span>${escapeHtml(sheets.rosterName)} - ${sheets.totalPoints}/${sheets.pointsLimit} pts</span></div>
    <button onclick="window.print()">Print</button>
  </div>
  ${body || `<main class="sheet"><p>No sheets available.</p></main>`}
  <script>
    function fitSheetsToA4() {
      document.querySelectorAll(".sheet").forEach(sheet => {
        sheet.classList.remove("fitDense", "fitCompact", "fitTiny");
        let size = 14;
        sheet.style.setProperty("--sheet-font-size", size + "px");
        while (sheet.scrollHeight > sheet.clientHeight + 1 && size > 8.5) {
          size -= 0.5;
          sheet.style.setProperty("--sheet-font-size", size + "px");
          if (size <= 13) sheet.classList.add("fitDense");
          if (size <= 11.5) sheet.classList.add("fitCompact");
          if (size <= 10) sheet.classList.add("fitTiny");
        }
      });
    }
    window.addEventListener("load", () => {
      fitSheetsToA4();
      setTimeout(fitSheetsToA4, 100);
    });
    window.addEventListener("beforeprint", fitSheetsToA4);
  </script>
</body>
</html>`;
}

function renderRulesReferencePage(sheet) {
  if (!sheet) return "";
  const armyRules = sheet.armyRules || [];
  const keywordLegend = sheet.weaponKeywordLegend || [];
  const detachments = (sheet.detachments || []).filter(detachment =>
    (detachment.rules || []).length || (detachment.stratagems || []).length
  );
  if (!armyRules.length && !keywordLegend.length && !detachments.length) return "";
  return `
    <main class="sheet referenceSheet">
      <header class="sheetHeader">
        <div>
          <h1>${escapeHtml(sheet.title || "Army & Detachment Rules")}</h1>
          <small>Reference sheet</small>
        </div>
        <div class="pointsBox">Rules</div>
      </header>
      ${armyRules.length ? `<h2>Army Rules</h2><div class="referenceGrid">${armyRules.map(rule => renderReferenceItem(rule)).join("")}</div>` : ""}
      ${keywordLegend.length ? renderWeaponKeywordLegend(keywordLegend) : ""}
      ${detachments.map(renderDetachmentReferenceBlock).join("")}
    </main>
  `;
}

function renderWeaponKeywordLegend(items) {
  return `
    <h2>Weapon Keyword Abbreviations</h2>
    <div class="chips">${items.map(item => `<span><b>${escapeHtml(item.keyword)}</b> = ${escapeHtml(item.original)}</span>`).join("")}</div>
  `;
}

function renderDetachmentReferenceBlock(detachment) {
  return `
    <section>
      <h2>${escapeHtml(detachment.name || "Detachment")}</h2>
      ${(detachment.rules || []).length ? `<div class="referenceGrid">${detachment.rules.map(rule => renderReferenceItem(rule)).join("")}</div>` : ""}
      ${(detachment.stratagems || []).length ? `<h2>${escapeHtml(detachment.name || "Detachment")} Stratagems</h2><div class="stratagemGrid">${detachment.stratagems.map(renderSheetStratagem).join("")}</div>` : ""}
    </section>
  `;
}

function renderCoreStratagemReferencePage(sheet) {
  if (!sheet) return "";
  const core = sheet.coreStratagems || [];
  if (!core.length) return "";
  return `
    <main class="sheet referenceSheet">
      <header class="sheetHeader">
        <div>
          <h1>${escapeHtml(sheet.title || "Core Stratagems")}</h1>
          <small>${sheet.source?.name ? `Source: ${escapeHtml(sheet.source.name)} v${escapeHtml(sheet.source.nrversion || "?")}` : "Reference sheet"}</small>
        </div>
        <div class="pointsBox">${core.length}</div>
      </header>
      <div class="stratagemGrid">${core.map(renderSheetStratagem).join("")}</div>
    </main>
  `;
}

function renderReferenceItem(item) {
  return `
    <article class="referenceItem">
      <h3>${escapeHtml(item.name || "Rule")}</h3>
      ${item.sourceLabel ? `<small>${escapeHtml(item.sourceLabel)}</small>` : ""}
      ${item.description ? `<p>${formatRichDescription(item.description)}</p>` : ""}
    </article>
  `;
}

function renderSheetStratagem(stratagem) {
  const meta = [
    stratagem.phase || "",
    stratagem.turn || "",
    stratagem.sourceLabel || stratagem.detachment || ""
  ].filter(Boolean).join(" - ");
  return `
    <article class="stratagemCard">
      <h3><span>${escapeHtml(stratagem.name || "Stratagem")}</span>${stratagem.cpCost ? `<b>${escapeHtml(stratagem.cpCost)}CP</b>` : ""}</h3>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
      ${stratagem.legend ? `<small>${escapeHtml(stratagem.legend)}</small>` : ""}
      <p>${formatRichDescription(stratagem.description || "No description provided.")}</p>
    </article>
  `;
}

function renderUnitSheetPage(sheet) {
  return `
    <main class="sheet">
      <header class="sheetHeader">
        <div>
          <h1>${escapeHtml(sheet.title)}</h1>
          <small>${sheet.kind === "combined-unit" ? "Combined unit sheet" : "Unit sheet"}</small>
        </div>
        <div class="pointsBox">${formatSheetTotalPoints(sheet)}</div>
      </header>
      <section class="members">
        ${sheet.members.map(member => `
          <div class="memberRow">
            <b>${escapeHtml(member.unitSize?.current > 1 ? `${member.unitSize.current}x ${member.name}` : member.name)}</b>
            <span>${formatSheetMemberPoints(member)}</span>
          </div>
        `).join("")}
      </section>
      ${renderSheetStatlines(sheet.statlines)}
      ${renderSheetWeaponSections(sheet)}
      ${renderSheetAbilities(sheet.abilities)}
      ${renderSheetRulesTags(sheet.rulesTags)}
      ${renderSheetEnhancements(sheet.enhancements)}
      ${renderSheetKeywords(sheet.keywords)}
    </main>
  `;
}

function renderCrusadeSheetPage(sheet) {
  const c = sheet.statline.characteristics || {};
  return `
    <main class="sheet">
      <header class="sheetHeader">
        <div>
          <h1>${escapeHtml(sheet.unitName)}</h1>
          <small>Crusade unit card</small>
        </div>
        <div class="pointsBox">${sheet.points} pts</div>
      </header>
      <h2>Unit Stats</h2>
      <table>
        <thead><tr><th>M</th><th>T</th><th>SV</th><th>W</th><th>LD</th><th>OC</th><th>InSv</th></tr></thead>
        <tbody><tr><td>${escapeHtml(c.M || "")}</td><td>${escapeHtml(c.T || "")}</td><td>${escapeHtml(c.SV || "")}</td><td>${escapeHtml(c.W || "")}</td><td>${escapeHtml(c.LD || "")}</td><td>${escapeHtml(c.OC || "")}</td><td>${escapeHtml(displayStatValue(c.InSv || c["Invulnerable Save"]))}</td></tr></tbody>
      </table>
      <div class="grid2">
        <div>
          <h2>Crusade Record</h2>
          ${["Crusade Points", "Experience Points", "Rank", "Battles Played", "Battles Survived", "Units Destroyed"].map(label => `
            <div class="blankRow"><b>${escapeHtml(label)}</b><span>&nbsp;</span></div>
          `).join("")}
        </div>
        <div>
          <h2>Equipment</h2>
          <div class="notesBox">${sheet.equipment.map(escapeHtml).join("<br>") || "&nbsp;"}</div>
        </div>
      </div>
      ${renderSheetAbilities(sheet.abilities)}
      ${renderSheetRulesTags(sheet.rulesTags)}
      ${renderSheetKeywords(sheet.keywords)}
      <div class="grid2">
        <div><h2>Battle Honours</h2><div class="notesBox">&nbsp;</div></div>
        <div><h2>Battle Scars</h2><div class="notesBox">&nbsp;</div></div>
      </div>
      <h2>Notes</h2>
      <div class="notesBox">&nbsp;</div>
    </main>
  `;
}

function renderSheetStatlines(statlines) {
  if (!statlines.length) return "";
  return `
    <h2>Unit Profiles</h2>
    <table>
      <thead><tr><th>Name</th><th>Count</th><th>M</th><th>T</th><th>SV</th><th>W</th><th>LD</th><th>OC</th><th>InSv</th></tr></thead>
      <tbody>
        ${statlines.map(profile => {
          const c = profile.characteristics || {};
          return `<tr><td>${escapeHtml(profile.name)}</td><td>${escapeHtml(profile.count || 1)}</td><td>${escapeHtml(c.M || "")}</td><td>${escapeHtml(c.T || "")}</td><td>${escapeHtml(c.SV || "")}</td><td>${escapeHtml(c.W || "")}</td><td>${escapeHtml(c.LD || "")}</td><td>${escapeHtml(c.OC || "")}</td><td>${escapeHtml(displayStatValue(c.InSv || c["Invulnerable Save"]))}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSheetWeaponSections(sheet) {
  const sections = [
    renderSheetWeapons("Ranged Weapons", sheet.rangedWeapons),
    renderSheetWeapons("Melee Weapons", sheet.meleeWeapons)
  ].filter(Boolean);
  if (!sections.length) return "";
  if (sections.length === 1) return sections[0];
  return `<div class="grid2">${sections.map(section => `<div>${section}</div>`).join("")}</div>`;
}

function renderSheetWeapons(title, weapons) {
  if (!weapons.length) return "";
  const hasKeywords = weapons.some(weapon => weapon.keywords);
  const skillLabel = title === "Melee Weapons" ? "WS" : "BS";
  return `
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead><tr><th>Count</th><th>Weapon</th><th>Rng</th><th>A</th><th>${skillLabel}</th><th>S</th><th>AP</th><th>D</th>${hasKeywords ? "<th>Keywords</th>" : ""}</tr></thead>
      <tbody>
        ${weapons.map(weapon => {
          const c = weapon.characteristics || {};
          return `<tr><td>${escapeHtml(weapon.count || 1)}</td><td>${escapeHtml(weapon.name)}</td><td>${escapeHtml(c.Range || "")}</td><td>${escapeHtml(c.A || "")}</td><td>${escapeHtml(c.BS || c.WS || "")}</td><td>${escapeHtml(c.S || "")}</td><td>${escapeHtml(c.AP || "")}</td><td>${escapeHtml(c.D || "")}</td>${hasKeywords ? `<td>${escapeHtml(weapon.keywords || "")}</td>` : ""}</tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSheetAbilities(abilities) {
  if (!abilities.length) return "";
  return `
    <h2>Abilities</h2>
    ${abilities.map(item => `
      <div class="rule"><b>${escapeHtml(item.name)}${item.provider ? ` <small>(${escapeHtml(item.provider)})</small>` : ""}</b>${item.description ? `<span>${formatRichDescription(item.description)}</span>` : ""}</div>
    `).join("")}
  `;
}

function renderSheetEnhancements(enhancements) {
  if (!enhancements.length) return "";
  return `
    <h2>Enhancements & Upgrades</h2>
    ${enhancements.map(item => `
      <div class="rule">
        <b>${escapeHtml(item.name)}${item.points ? ` <small>${item.points} pts</small>` : ""}</b>
        ${item.bearerName ? `<small>${escapeHtml(item.bearerName)}</small>` : ""}
        ${enhancementSheetDescription(item) ? `<span>${formatRichDescription(enhancementSheetDescription(item))}</span>` : ""}
      </div>
    `).join("")}
  `;
}

function enhancementSheetDescription(enhancement) {
  if (enhancement.description) return enhancement.description;
  return [
    ...(enhancement.profiles || []).map(profile => profile.characteristics?.Description).filter(Boolean),
    ...(enhancement.rules || []).map(rule => rule.description).filter(Boolean)
  ].join(" ").trim();
}

function renderSheetRulesTags(tags) {
  return tags?.length
    ? `<h2>Rules</h2><div class="chips">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
}

function renderSheetKeywords(keywords) {
  return keywords.length
    ? `<h2>Keywords</h2><div class="chips">${keywords.map(keyword => `<span>${escapeHtml(keyword)}</span>`).join("")}</div>`
    : "";
}

function downloadFile(fileName, contents) {
  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();

  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDescription(value) {
  const cleaned = String(value || "")
    .replace(/\*\*\^\^(.+?)\^\^\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\^\^(.+?)\^\^/g, "$1");
  return escapeHtml(cleaned).replace(/\r?\n/g, "<br>");
}

function formatRichDescription(value) {
  return formatDescription(value)
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;(\/?)b&gt;/gi, "<$1b>")
    .replace(/&lt;(\/?)strong&gt;/gi, "<$1strong>")
    .replace(/&lt;(\/?)i&gt;/gi, "<$1i>")
    .replace(/&lt;(\/?)em&gt;/gi, "<$1em>")
    .replace(/&lt;span class=&quot;kwb&quot;&gt;/gi, `<span class="kwb">`)
    .replace(/&lt;\/span&gt;/gi, "</span>");
}

init();
