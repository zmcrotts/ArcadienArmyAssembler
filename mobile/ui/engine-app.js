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
const exportFormatButtons = document.getElementById("exportFormatButtons");
const discordMultilineHeader = document.getElementById("discordMultilineHeader");
const discordCombineIdentical = document.getElementById("discordCombineIdentical");
const discordHideSubunits = document.getElementById("discordHideSubunits");
const discordHideBullets = document.getElementById("discordHideBullets");
const discordHidePoints = document.getElementById("discordHidePoints");
const discordCustomColors = document.getElementById("discordCustomColors");
const discordUnitColor = document.getElementById("discordUnitColor");
const discordPointsColor = document.getElementById("discordPointsColor");
const exportPdfUnits = document.getElementById("exportPdfUnits");
const factionSelect = document.getElementById("factionSelect");
const subfactionSelect = document.getElementById("subfactionSelect");
const subfactionControl = document.getElementById("subfactionControl");
const factionReference = document.getElementById("factionReference");
const subfactionReference = document.getElementById("subfactionReference");
const builderLayout = document.getElementById("builderLayout");
const availableUnitsPanel = document.getElementById("availableUnitsPanel");
const unitList = document.getElementById("unitList");
const mobileUnitAddList = document.getElementById("mobileUnitAddList");
const rosterList = document.getElementById("rosterList");
const details = document.getElementById("details");
const pointsTotal = document.getElementById("pointsTotal");
const pointsLimitInput = document.getElementById("pointsLimit");
const unitSearch = document.getElementById("unitSearch");
const availableUnitsTitle = document.getElementById("availableUnitsTitle");
const toggleAvailableUnits = document.getElementById("toggleAvailableUnits");
const closeMobileDetails = document.getElementById("closeMobileDetails");
const mobileSheetBackdrop = document.getElementById("mobileSheetBackdrop");
const rosterNameInput = document.getElementById("rosterName");
const mobileShell = document.getElementById("mobileShell");
const mobileRosterName = document.getElementById("mobileRosterName");
const mobileFactionLabel = document.getElementById("mobileFactionLabel");
const mobilePointsTotal = document.getElementById("mobilePointsTotal");
const mobileRosterList = document.getElementById("mobileRosterList");
const mobileShowLists = document.getElementById("mobileShowLists");
const mobileOpenMenu = document.getElementById("mobileOpenMenu");
const mobileAddUnit = document.getElementById("mobileAddUnit");
const mobileSaveRoster = document.getElementById("mobileSaveRoster");
const mobileExportRoster = document.getElementById("mobileExportRoster");
const rosterSavesSelect = document.getElementById("rosterSaves");
const importJsonFile = document.getElementById("importJsonFile");
const exportMenuToggle = document.getElementById("exportMenuToggle");
const exportMenuPanel = document.getElementById("exportMenuPanel");
const includeSheetReferences = document.getElementById("includeSheetReferences");
const standardRosterLayout = document.getElementById("standardRosterLayout");
const customRosterLayout = document.getElementById("customRosterLayout");
const lightTheme = document.getElementById("lightTheme");
const darkTheme = document.getElementById("darkTheme");

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
let availableUnitsCollapsed = loadAvailableUnitsCollapsed();
const sidebarDisclosureState = {};
const unitSectionDisclosureState = {};
let appMode = "library";
let newRosterDraft = null;
let compactorSkippableWargear = {};
let lastDiscordExportText = "";
const factionLoadPromises = {};
let rosterDisplay = defaultRosterDisplay();
let pendingRosterSectionFocusKey = null;
let rulePopupCounter = 0;
let transientMessageTimer = null;
let mobileSheet = null;
let mobileAddSectionFilter = null;
let mobileAddKeywordFilter = "";
const mobileRosterSectionDisclosureState = {};
const mobileAddSectionDisclosureState = {};

function init() {
  applySavedTheme();
  applyAvailableUnitsLayoutState();
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
    rosterDisplay = defaultRosterDisplay();
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
    rosterDisplay = defaultRosterDisplay();
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

  if (standardRosterLayout) {
    standardRosterLayout.onclick = () => {
      rosterDisplay.mode = "standard";
      render();
    };
  }

  if (customRosterLayout) {
    customRosterLayout.onclick = () => {
      rosterDisplay.mode = "custom";
      initializeCustomRosterLayout();
      render();
    };
  }

  if (lightTheme) lightTheme.onclick = () => setTheme("light");
  if (darkTheme) darkTheme.onclick = () => setTheme("dark");
  if (toggleAvailableUnits) {
    toggleAvailableUnits.onclick = event => {
      event.stopPropagation();
      setAvailableUnitsCollapsed(!availableUnitsCollapsed);
    };
  }
  if (availableUnitsPanel) {
    availableUnitsPanel.addEventListener("click", () => {
      if (availableUnitsCollapsed) setAvailableUnitsCollapsed(false);
    });
    availableUnitsPanel.addEventListener("keydown", event => {
      if (!availableUnitsCollapsed || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      setAvailableUnitsCollapsed(false);
    });
  }

  pointsLimitInput.addEventListener("input", render);
  rosterNameInput.addEventListener("input", render);
  if (mobileRosterName) {
    mobileRosterName.addEventListener("input", event => {
      rosterNameInput.value = event.target.value;
      render();
    });
  }
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
  if (mobileShowLists) mobileShowLists.onclick = showLibrary;
  if (mobileAddUnit) {
    mobileAddUnit.onclick = () => {
      if (mobileSheet === "add") closeMobileSheets();
      else openMobileAddSheet(null);
    };
  }
  if (mobileSaveRoster) mobileSaveRoster.onclick = saveRoster;
  if (mobileExportRoster) mobileExportRoster.onclick = openMobileExport;
  if (mobileOpenMenu) mobileOpenMenu.onclick = openNewRosterModal;
  if (closeMobileDetails) closeMobileDetails.onclick = closeMobileSheets;
  if (mobileSheetBackdrop) mobileSheetBackdrop.onclick = closeMobileSheets;
  document.getElementById("cancelDeleteRoster").onclick = closeDeleteRosterModal;
  document.getElementById("confirmDeleteRoster").onclick = confirmPendingRosterDelete;
  document.getElementById("closeDiscordExport").onclick = closeDiscordExportModal;
  document.getElementById("copyDiscordExport").onclick = copyDiscordExport;
  document.getElementById("downloadDiscordExport").onclick = downloadDiscordExport;
  if (exportPdfUnits) exportPdfUnits.onclick = () => openSheetPreview("units");
  for (const control of discordExportControls()) {
    control.addEventListener("input", renderDiscordExportPreview);
    control.addEventListener("change", renderDiscordExportPreview);
  }
  renderExportFormatButtons();
  exportMenuToggle.onclick = event => {
    event.stopPropagation();
    setExportMenuOpen(exportMenuPanel.hidden);
  };
  exportMenuPanel.onclick = event => event.stopPropagation();
  document.addEventListener("click", () => setExportMenuOpen(false));
  document.addEventListener("click", event => {
    if (handleWeaponPreviewClick(event)) return;
    closeOpenWeaponPreview(event.target);
    if (mobileSheet !== "add") return;
    if (availableUnitsPanel?.contains(event.target)) return;
    if (mobileAddUnit?.contains(event.target)) return;
    closeMobileSheets();
  });
  window.addEventListener("beforeunload", event => {
    if (navigator.userAgent.includes("Electron/")) return;
    if (!hasUnsavedRosterChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeOpenWeaponPreview();
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

function loadAvailableUnitsCollapsed() {
  try {
    return localStorage.getItem("engineAvailableUnitsCollapsed") === "true";
  } catch {
    return false;
  }
}

function saveAvailableUnitsCollapsed() {
  try {
    localStorage.setItem("engineAvailableUnitsCollapsed", availableUnitsCollapsed ? "true" : "false");
  } catch {
    // A blocked storage write should not make the layout control unusable.
  }
}

function setAvailableUnitsCollapsed(nextCollapsed) {
  availableUnitsCollapsed = Boolean(nextCollapsed);
  saveAvailableUnitsCollapsed();
  applyAvailableUnitsLayoutState();
}

function applyAvailableUnitsLayoutState() {
  if (builderLayout) builderLayout.classList.toggle("availableUnitsCollapsed", availableUnitsCollapsed);
  if (availableUnitsPanel) {
    availableUnitsPanel.tabIndex = availableUnitsCollapsed ? 0 : -1;
    if (availableUnitsCollapsed) {
      availableUnitsPanel.setAttribute("role", "button");
      availableUnitsPanel.setAttribute("aria-label", "Expand Available Units");
    } else {
      availableUnitsPanel.removeAttribute("role");
      availableUnitsPanel.removeAttribute("aria-label");
    }
  }
  if (availableUnitsTitle) availableUnitsTitle.textContent = availableUnitsCollapsed ? "A.U." : "Available Units";
  if (!toggleAvailableUnits) return;
  toggleAvailableUnits.textContent = availableUnitsCollapsed ? ">" : "<";
  toggleAvailableUnits.setAttribute("aria-expanded", availableUnitsCollapsed ? "false" : "true");
  toggleAvailableUnits.title = availableUnitsCollapsed ? "Expand Available Units" : "Collapse Available Units";
  toggleAvailableUnits.setAttribute("aria-label", toggleAvailableUnits.title);
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
    armyRules: uniqueRules([...(base.armyRules || []), ...(selected.armyRules || [])]),
    allowedSelectionKeys: [...new Set([...(base.allowedSelectionKeys || []), ...(selected.allowedSelectionKeys || []), ...nativeKeys, ...allyKeys])],
    enhancements: [...enhancements.values()]
  };
}

function uniqueRules(rules) {
  const seen = new Set();
  const result = [];
  for (const rule of rules || []) {
    const key = `${String(rule?.name || "").trim().toLowerCase()}:${String(rule?.description || "").trim().toLowerCase()}`;
    if (seen.has(key) || !String(rule?.name || "").trim()) continue;
    seen.add(key);
    result.push(rule);
  }
  return result;
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

function defaultRosterDisplay() {
  return {
    mode: "standard",
    customSections: [],
    sectionLabels: {},
    groupSections: {},
    groupOrder: [],
    unitNicknames: {}
  };
}

function normalizeRosterDisplay(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    mode: source.mode === "custom" ? "custom" : "standard",
    customSections: Array.isArray(source.customSections) ? source.customSections.map(String) : [],
    sectionLabels: source.sectionLabels && typeof source.sectionLabels === "object" ? { ...source.sectionLabels } : {},
    groupSections: source.groupSections && typeof source.groupSections === "object" ? { ...source.groupSections } : {},
    groupOrder: Array.isArray(source.groupOrder) ? source.groupOrder.map(String) : [],
    unitNicknames: source.unitNicknames && typeof source.unitNicknames === "object" ? normalizeUnitNicknames(source.unitNicknames) : {}
  };
}

function normalizeUnitNicknames(source) {
  return Object.fromEntries(Object.entries(source)
    .map(([key, value]) => [String(key), String(value || "").trim()])
    .filter(([key, value]) => key && value));
}

function currentRosterDisplayDocument() {
  reconcileRosterDisplayMetadata();
  return normalizeRosterDisplay(rosterDisplay);
}

function reconcileRosterDisplayMetadata() {
  if (!rosterDisplay.unitNicknames) rosterDisplay.unitNicknames = {};
  const instanceIds = new Set(roster.map(item => item.instanceId));
  for (const instanceId of Object.keys(rosterDisplay.unitNicknames)) {
    if (!instanceIds.has(instanceId)) delete rosterDisplay.unitNicknames[instanceId];
  }
}

function setRosterLayoutModeButtons() {
  if (standardRosterLayout) standardRosterLayout.classList.toggle("active", rosterDisplay.mode !== "custom");
  if (customRosterLayout) customRosterLayout.classList.toggle("active", rosterDisplay.mode === "custom");
}

function applySavedTheme() {
  const installedWebApp = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (Boolean(window.AndroidFiles) || installedWebApp || window.matchMedia("(max-width: 860px)").matches) {
    applyTheme("dark");
    return;
  }
  let theme = "light";
  try {
    theme = localStorage.getItem("engineTheme") === "dark" ? "dark" : "light";
  } catch {
    theme = "light";
  }
  applyTheme(theme);
}

function setTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  try {
    localStorage.setItem("engineTheme", nextTheme);
  } catch {
    // Theme persistence is optional; still apply it for this session.
  }
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  if (lightTheme) lightTheme.classList.toggle("active", nextTheme === "light");
  if (darkTheme) darkTheme.classList.toggle("active", nextTheme === "dark");
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
  setRosterLayoutModeButtons();
  renderRosterSaveBrowser();
  if (appMode === "library") {
    closeMobileSheets();
    if (mobileShell) mobileShell.hidden = true;
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
  renderMobileShell();
  applyMobileSheetState();
}

function openMobileAddSheet(section = null) {
  mobileSheet = "add";
  mobileAddSectionFilter = section || null;
  mobileAddKeywordFilter = "";
  renderUnits();
  applyMobileSheetState();
}

function openMobileDetailsSheet() {
  mobileSheet = "details";
  applyMobileSheetState();
}

function closeMobileSheets() {
  const hadAddFilter = Boolean(mobileAddSectionFilter || mobileAddKeywordFilter);
  mobileSheet = null;
  mobileAddSectionFilter = null;
  mobileAddKeywordFilter = "";
  applyMobileSheetState();
  if (hadAddFilter && appMode === "builder") renderUnits();
}

function applyMobileSheetState() {
  document.body.classList.toggle("mobileAddOpen", mobileSheet === "add");
  document.body.classList.toggle("mobileDetailsOpen", mobileSheet === "details");
  document.body.classList.toggle("mobileSheetOpen", Boolean(mobileSheet));
  if (mobileSheetBackdrop) mobileSheetBackdrop.hidden = mobileSheet !== "details";
  if (mobileAddUnit) mobileAddUnit.textContent = mobileSheet === "add" ? "< Back" : "Add Unit";
  if (availableUnitsTitle) {
    availableUnitsTitle.textContent = mobileAddSectionFilter
      ? `Add ${mobileAddSectionFilter}`
      : (availableUnitsCollapsed ? "A.U." : "Available Units");
  }
  if (unitSearch && mobileSheet === "add") {
    unitSearch.placeholder = mobileAddSectionFilter
      ? `Search ${mobileAddSectionFilter} units`
      : "Search units or keywords";
  }
}

function renderMobileShell() {
  if (!mobileShell || !mobileRosterList) return;
  mobileShell.hidden = false;
  if (mobileRosterName && document.activeElement !== mobileRosterName) {
    mobileRosterName.value = rosterNameInput.value;
  }
  if (mobileFactionLabel) mobileFactionLabel.textContent = factionLabelFor(currentSubfaction || currentFaction);
  if (mobilePointsTotal) mobilePointsTotal.textContent = `${getTotalPoints()}/${Number(pointsLimitInput.value || 0)} pts`;

  const detachments = currentArmyDefinition() ? (armyEngine.selectedDetachments?.(currentArmyDefinition(), armyState) || []) : [];
  const warningCount = validateRoster().filter(item => !item.ok).length;
  const availableSectionKeys = new Set(
    factionUnits().map(unit => catalogueSections.sectionForUnit(unit))
  );
  const sections = groupRosterPresentation(rosterPresentation()).filter(section => (
    section.groups.length || section.custom || availableSectionKeys.has(section.key)
  ));
  mobileRosterList.innerHTML = `
    <button class="mobileConfigCard ${selectedPanel === "configuration" ? "selected" : ""}" type="button">
      <span>
        <b>Configuration</b>
        <small>${escapeHtml(detachments.length ? detachments.map(item => item.name).join(" + ") : "Choose detachments")}</small>
      </span>
      <span>${warningCount ? `⚠ ${warningCount}` : "Open"}</span>
    </button>
    ${sections.map(renderMobileRosterSection).join("")}
  `;

  const configCard = mobileRosterList.querySelector(".mobileConfigCard");
  if (configCard) {
    configCard.onclick = () => {
      selectedPanel = "configuration";
      selectedInstanceId = null;
      render();
      openMobileDetailsSheet();
    };
  }
  for (const button of mobileRosterList.querySelectorAll(".mobileSectionAdd")) {
    button.onclick = event => {
      event.stopPropagation();
      openMobileAddSheet(button.dataset.sectionKey || null);
    };
  }
  for (const header of mobileRosterList.querySelectorAll(".mobileRosterSectionHeader")) {
    header.onclick = event => {
      if (event.target.closest("button")) return;
      const key = header.dataset.sectionKey || "";
      mobileRosterSectionDisclosureState[key] = !mobileRosterSectionDisclosureState[key];
      renderMobileShell();
    };
  }
  for (const card of mobileRosterList.querySelectorAll(".mobileRosterUnit")) {
    card.onclick = () => {
      const primaryId = card.dataset.primaryInstanceId;
      const isAttached = card.dataset.groupKind === "attached";
      selectedInstanceId = primaryId;
      selectedPanel = isAttached ? "group" : "unit";
      render();
      openMobileDetailsSheet();
    };
  }
  for (const button of mobileRosterList.querySelectorAll("[data-mobile-action]")) {
    button.onclick = event => {
      event.stopPropagation();
      handleMobileRosterAction(button);
    };
  }
}

function renderMobileRosterSection(section) {
  const open = Object.prototype.hasOwnProperty.call(mobileRosterSectionDisclosureState, section.key)
    ? mobileRosterSectionDisclosureState[section.key]
    : true;
  return `
    <section class="mobileRosterSection">
      <header class="mobileRosterSectionHeader" data-section-key="${escapeHtml(section.key)}">
        <div>
          <b><span>${open ? "v" : ">"}</span>${escapeHtml(section.section)}</b>
          <small>${section.groups.length} ${section.groups.length === 1 ? "unit" : "units"}</small>
        </div>
        <button class="mobileSectionAdd" type="button" data-section-key="${escapeHtml(section.key)}">+ Add</button>
      </header>
      <div class="mobileRosterSectionContents" ${open ? "" : "hidden"}>
        ${section.groups.map(renderMobileRosterGroup).join("")}
      </div>
    </section>
  `;
}

function renderMobileRosterGroup(group) {
  const groupEntries = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).filter(Boolean);
  const bodyguard = groupEntries.find(item => item.instanceId === group.bodyguard?.instanceId) || groupEntries[0];
  const primary = group.kind === "attached" ? bodyguard : groupEntries[0];
  if (!primary) return "";
  const selected = group.memberInstanceIds.includes(selectedInstanceId) ? " selected" : "";
  const title = group.kind === "attached" ? renderMobileAttachedTitle(group, groupEntries) : renderMobileEntryTitle(primary);
  const points = group.kind === "attached" ? formatGroupPoints(group) : formatEntryPoints(primary);
  const loadout = group.kind === "attached"
    ? groupEntries.map(entry => renderMobileMemberSummary(entry, entry === bodyguard ? "Bodyguard" : "Leader")).join("")
    : renderMobileLoadoutSummary(primary);
  const actionLabel = group.kind === "attached"
    ? `${bodyguard.unitPackage.name} attached unit`
    : primary.unitPackage.name;
  const secondaryAction = group.kind === "attached" ? "split" : "remove";
  const secondaryLabel = group.kind === "attached" ? "Split attached unit" : `Remove ${actionLabel}`;
  const secondaryIcon = group.kind === "attached" ? "Split" : "×";
  return `
    <article class="mobileRosterUnit${selected}${group.kind === "attached" ? " attached" : ""}"
      data-group-kind="${escapeHtml(group.kind)}"
      data-primary-instance-id="${escapeHtml(primary.instanceId)}">
      <div class="mobileUnitTopline">
        <span class="mobileUnitKind">${group.kind === "attached" ? "Attached unit" : mobileUnitRoleLabel(primary)}</span>
        <span>${escapeHtml(points)}</span>
      </div>
      <h3>${title}</h3>
      ${group.kind === "attached" ? `<div class="mobileAttachedBreakdown">${loadout}</div>` : loadout}
      ${group.warnings?.length ? `<div class="mobileWarning">⚠ ${escapeHtml(group.warnings[0].message)}</div>` : ""}
      <div class="mobileUnitActions">
        <button class="mobileUnitPrimaryAction" type="button" data-mobile-action="configure" data-instance-id="${escapeHtml(primary.instanceId)}">Configure</button>
        <button class="mobileUnitIconAction" type="button" data-mobile-action="duplicate" data-instance-id="${escapeHtml(primary.instanceId)}" aria-label="Duplicate ${escapeHtml(actionLabel)}" title="Duplicate"><span aria-hidden="true">⧉</span></button>
        <button class="mobileUnitIconAction ${secondaryAction === "remove" ? "danger" : "split"}" type="button" data-mobile-action="${secondaryAction}" data-instance-id="${escapeHtml(primary.instanceId)}" aria-label="${escapeHtml(secondaryLabel)}" title="${secondaryAction === "remove" ? "Remove" : "Split"}"><span aria-hidden="true">${secondaryIcon}</span></button>
      </div>
    </article>
  `;
}

function renderMobileEntryTitle(rosterEntry) {
  const unit = rosterEntry.unitPackage;
  const unitSize = engine.getUnitSizeState(unit.definition, rosterEntry.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  const nickname = rosterNicknameFor(rosterEntry.instanceId);
  return `${sizePrefix}${escapeHtml(unit.name)}${nickname ? ` <small>"${escapeHtml(nickname)}"</small>` : ""}`;
}

function renderMobileAttachedTitle(group, groupEntries) {
  const bodyguard = groupEntries.find(item => item.instanceId === group.bodyguard?.instanceId) || groupEntries[0];
  const leaders = group.leaders
    .map(leader => groupEntries.find(item => item.instanceId === leader.instanceId))
    .filter(Boolean);
  return `${renderMobileEntryTitle(bodyguard)} <small>with ${leaders.map(item => escapeHtml(item.unitPackage.name)).join(", ")}</small>`;
}

function renderMobileMemberSummary(rosterEntry, label) {
  return `
    <div>
      <b>${escapeHtml(label)} · ${escapeHtml(formatEntryPoints(rosterEntry))}</b>
      <span>${renderMobileLoadoutText(rosterEntry).map(escapeHtml).join(", ") || "No configured wargear"}</span>
    </div>
  `;
}

function renderMobileLoadoutSummary(rosterEntry) {
  const items = renderMobileLoadoutText(rosterEntry);
  if (!items.length) return `<p class="mobileLoadout muted">No configured wargear.</p>`;
  return `<ul class="mobileLoadout">${items.slice(0, 5).map(item => `<li>${escapeHtml(item)}</li>`).join("")}${items.length > 5 ? `<li>+${items.length - 5} more</li>` : ""}</ul>`;
}

function renderMobileLoadoutText(rosterEntry) {
  const configured = engine.getConfiguredProfiles(rosterEntry.unitPackage.definition, rosterEntry.entry);
  return (configured.weapons || [])
    .map(weapon => `${weapon.count || 1}x ${weapon.name}`)
    .filter(Boolean);
}

function mobileUnitRoleLabel(rosterEntry) {
  return catalogueSections.sectionForUnit(rosterEntry.unitPackage || rosterEntry);
}

function handleMobileRosterAction(button) {
  const instanceId = button.dataset.instanceId;
  const rosterEntry = roster.find(item => item.instanceId === instanceId);
  if (!rosterEntry) return;
  if (button.dataset.mobileAction === "duplicate") {
    duplicateRosterEntry(rosterEntry);
    render();
    return;
  }
  if (button.dataset.mobileAction === "remove") {
    removeRosterEntry(instanceId);
    render();
    return;
  }
  if (button.dataset.mobileAction === "split") {
    armyState = armyEngine.detachBodyguard(armyState, instanceId);
    selectedInstanceId = instanceId;
    selectedPanel = "unit";
    render();
    return;
  }
  selectedInstanceId = instanceId;
  selectedPanel = "unit";
  render();
  openMobileDetailsSheet();
}

function renderStartScreen() {
  const saves = savedRosterLibrary();
  startScreen.innerHTML = `
    <div class="startHeader">
      <div class="startBrandRow">
        <span class="startBrand" aria-label="Arcadien Army Assembler"><span>Arcadien</span> <span>Army</span> <span>Assembler</span></span>
        <a class="startSupportLink" href="https://ko-fi.com/thearcadienwargamer">☕ Support development</a>
      </div>
      <div class="startHeaderActions">
        <button id="startImportJson">Import JSON</button>
        <button id="startNewRoster">New roster</button>
      </div>
      <div class="startIntro">
        <h2>Saved Rosters</h2>
        <p class="muted">Load an existing roster or start a new one.</p>
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
        ${renderDetachmentForceDispositionNote(detachment)}
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
  rosterDisplay = defaultRosterDisplay();
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
  const leaders = roster.filter(item => item.unitPackage.definition.roles?.leader);
  armyAssignments.innerHTML = `
    <label class="optionRow"><b>Warlord</b>
      <select id="warlordSelect"><option value="">Not selected</option>${renderRosterUnitOptions(roster, {
        legalFor: item => Boolean(item.unitPackage.definition.rosterRules?.canBeWarlord)
      })}</select>
    </label>
    ${leaders.map(leader => {
      const assignment = (armyState.attachments || []).find(item => item.leaderInstanceId === leader.instanceId);
      return `<label class="optionRow"><b>${renderRosterUnitPlainLabel(leader)} leads</b>
        <select class="leaderTarget" data-leader-id="${escapeHtml(leader.instanceId)}">
          <option value="">Not attached</option>
          ${renderRosterUnitOptions(roster.filter(item => item.instanceId !== leader.instanceId), {
            selectedId: assignment?.targetInstanceId,
            legalFor: target => armyEngine.leaderCanTarget(
              { selectionKey: leader.unitPackage.selectionKey, name: leader.unitPackage.name, rosterRules: leader.unitPackage.definition.rosterRules },
              { selectionKey: target.unitPackage.selectionKey, name: target.unitPackage.name }
            )
          })}
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
  const armyRulesElement = document.getElementById("armyRules");
  const detachmentSelect = document.getElementById("detachmentSelect");
  const detachmentRules = document.getElementById("detachmentRules");
  const forceDispositionsElement = document.getElementById("forceDispositions");
  const stratagemsElement = document.getElementById("stratagems");
  const enhancementsElement = document.getElementById("enhancements");
  if (!detachmentSelect || !detachmentRules || !stratagemsElement || !enhancementsElement) return;
  const army = currentArmyDefinition();
  detachmentSelect.innerHTML = "";
  if (!army) {
    if (armyRulesElement) armyRulesElement.innerHTML = `<p class="muted">No army rule data in this catalogue.</p>`;
    detachmentSelect.innerHTML = `<p class="muted">No detachments available.</p>`;
    detachmentRules.innerHTML = `<p class="muted">No detachment data in this catalogue.</p>`;
    if (forceDispositionsElement) forceDispositionsElement.innerHTML = `<p class="muted">No force disposition data in this catalogue.</p>`;
    stratagemsElement.innerHTML = `<p class="muted">No stratagem data in this catalogue.</p>`;
    enhancementsElement.innerHTML = "";
    return;
  }

  if (armyRulesElement) {
    armyRulesElement.innerHTML = (army.armyRules || []).length
      ? army.armyRules.map(rule => `
        <details class="sidebarCard ruleDisclosure" open>
          <summary>${escapeHtml(rule.name)}</summary>
          <p>${formatDescription(rule.description)}</p>
        </details>
      `).join("")
      : `<p class="muted">No army rule text found in this catalogue.</p>`;
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
    if (forceDispositionsElement) forceDispositionsElement.innerHTML = `<p class="muted">Select a detachment to choose its force disposition and mission.</p>`;
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
  if (forceDispositionsElement) {
    forceDispositionsElement.innerHTML = renderForceDispositionPicker(army, detachments, armyState);
    bindForceDispositionControls(forceDispositionsElement, army);
  }
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

  let renderedSections = 0;
  for (const group of catalogueSections.groupUnits(units)) {
    if (!group.units.length) continue;
    renderedSections += 1;
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
  if (!renderedSections) {
    unitList.innerHTML = `<p class="muted">No units match the current filter.</p>`;
  }
  renderMobileUnitAddList(units);
}

function renderMobileUnitAddList(units) {
  if (!mobileUnitAddList) return;
  const grouped = catalogueSections.groupUnits(units).filter(group => group.units.length);
  mobileUnitAddList.innerHTML = grouped.length
    ? `${renderMobileAddFilterChips()}
      ${grouped.map(group => {
        const open = Boolean(searchText || mobileAddSectionFilter || mobileAddKeywordFilter || mobileAddSectionDisclosureState[group.section]);
        return `
          <section class="mobileAddSection">
            <button type="button" class="mobileAddSectionHeader" data-mobile-add-section="${escapeHtml(group.section)}">
              <span>${open ? "v" : ">"}</span>
              <b>${escapeHtml(group.section)}</b>
              <small>${group.units.length}</small>
            </button>
            <div class="mobileAddSectionContents" ${open ? "" : "hidden"}>
              ${group.units.map(unit => renderMobileAddUnitRow(unit)).join("")}
            </div>
          </section>
        `;
      }).join("")}`
    : `${renderMobileAddFilterChips()}<p class="muted">No units match the current filter.</p>`;
  for (const button of mobileUnitAddList.querySelectorAll("[data-mobile-filter]")) {
    button.onclick = event => {
      event.stopPropagation();
      const nextFilter = button.dataset.mobileFilter || "";
      mobileAddSectionFilter = "";
      mobileAddKeywordFilter = nextFilter === mobileAddKeywordFilter ? "" : nextFilter;
      renderUnits();
      applyMobileSheetState();
    };
  }
  for (const header of mobileUnitAddList.querySelectorAll("[data-mobile-add-section]")) {
    header.onclick = event => {
      event.stopPropagation();
      const section = header.dataset.mobileAddSection || "";
      mobileAddSectionDisclosureState[section] = !mobileAddSectionDisclosureState[section];
      renderUnits();
    };
  }
  for (const button of mobileUnitAddList.querySelectorAll("[data-mobile-add-unit]")) {
    button.onclick = event => {
      event.stopPropagation();
      const unit = findUnitBySelectionKey(button.dataset.mobileAddUnit);
      if (!unit) return;
      const rosterEntry = createRosterEntry(unit);
      roster.push(rosterEntry);
      selectedInstanceId = rosterEntry.instanceId;
      selectedPanel = "unit";
      render();
      showTransientMessage(`✓ Added ${unit.name} to the roster.`);
    };
  }
  for (const button of mobileUnitAddList.querySelectorAll("[data-mobile-preview-unit]")) {
    button.onclick = event => {
      event.stopPropagation();
      const unit = findUnitBySelectionKey(button.dataset.mobilePreviewUnit);
      if (!unit) return;
      showPreview(unit);
      openMobileDetailsSheet();
    };
  }
}

function renderMobileAddFilterChips() {
  const units = factionUnits();
  const chips = [];
  for (const section of catalogueSections.SECTION_ORDER || []) {
    const count = units.filter(unit => catalogueSections.sectionForUnit(unit) === section).length;
    if (count) chips.push({ label: section, count });
  }
  const seen = new Set(chips.map(item => item.label.toLowerCase()));
  const keywordCounts = new Map();
  for (const unit of units) {
    const keywords = [
      ...(unit.keywords || []),
      ...(unit.definition?.keywords || []),
      ...(unit.definition?.categories || []),
      ...(unit.categories || [])
    ].filter(keyword => keyword && !/^Faction:/i.test(keyword));
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase();
      if (seen.has(normalized)) continue;
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
    }
  }
  const extraKeywords = Array.from(keywordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));
  const allChips = chips.concat(extraKeywords);
  return `
    <div class="mobileAddFilters" aria-label="Unit filters">
      <button type="button" class="${mobileAddKeywordFilter ? "" : "selected"}" data-mobile-filter="">All</button>
      ${allChips.map(chip => `
        <button type="button" class="${chip.label === mobileAddKeywordFilter ? "selected" : ""}" data-mobile-filter="${escapeHtml(chip.label)}">
          ${escapeHtml(chip.label)} <span>${chip.count}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderMobileAddUnitRow(unit) {
  const keywords = (unit.keywords || unit.definition?.keywords || unit.definition?.categories || [])
    .filter(keyword => !/^Faction:/i.test(keyword))
    .slice(0, 4);
  const models = engine.getUnitSizeState(unit.definition, unit.defaultEntry);
  return `
    <article class="mobileAddUnitRow">
      <button type="button" class="mobileAddPreview" data-mobile-preview-unit="${escapeHtml(unit.selectionKey)}">View</button>
      <div>
        <b>${escapeHtml(unit.name)}</b>
        <small>${escapeHtml(keywords.join(" · "))}${models.current ? ` · ${models.current} model${models.current === 1 ? "" : "s"}` : ""}</small>
      </div>
      <span>${unit.defaultSummary.points} pts</span>
      <button type="button" class="mobileAddUnitButton" data-mobile-add-unit="${escapeHtml(unit.selectionKey)}">+</button>
    </article>
  `;
}

function findUnitBySelectionKey(selectionKey) {
  return factionUnits().find(unit => unit.selectionKey === selectionKey) || null;
}

function unitMatchesSearch(unit) {
  if (mobileAddSectionFilter && catalogueSections.sectionForUnit(unit) !== mobileAddSectionFilter) return false;
  const haystack = [
    unit.name,
    catalogueSections.sectionForUnit(unit),
    ...(unit.keywords || []),
    ...(unit.definition?.keywords || []),
    ...(unit.definition?.categories || []),
    ...(unit.categories || [])
  ].join(" ").toLowerCase();
  if (mobileAddKeywordFilter && !haystack.includes(mobileAddKeywordFilter.toLowerCase())) return false;
  if (!searchText) return true;
  return haystack.includes(searchText);
}

function renderRoster() {
  reconcileRosterDisplayMetadata();
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

  if (rosterDisplay.mode === "custom") renderCustomRosterLayoutControls();

  for (const section of groupRosterPresentation(rosterPresentation())) {
    if (!section.groups.length && !section.custom) continue;
    const details = document.createElement("details");
    details.className = `unitSection rosterSection${section.custom ? " customRosterSection" : ""}`;
    details.dataset.sectionKey = section.key;
    details.open = true;
    details.innerHTML = rosterDisplay.mode === "custom"
      ? `<summary><input class="rosterSectionName" data-section-key="${escapeHtml(section.key)}" value="${escapeHtml(section.section)}" aria-label="Section name"> <span>${section.groups.length}</span></summary>`
      : `<summary>${escapeHtml(section.section)} <span>${section.groups.length}</span></summary>`;
    const contents = document.createElement("div");
    contents.className = "unitSectionContents";
    contents.dataset.sectionKey = section.key;
    if (rosterDisplay.mode === "custom") bindRosterDropZone(contents, section.key);

    for (const group of section.groups) {
    const groupEntries = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).filter(Boolean);
    const primary = groupEntries[0];
    if (!primary) continue;

    const div = document.createElement("div");
    div.className = "unit";
    div.dataset.groupId = group.id;
    if (rosterDisplay.mode === "custom") bindRosterDragHandle(div, group.id);
    if (group.memberInstanceIds.includes(selectedInstanceId)) div.classList.add("selected");
    if (group.kind === "attached") div.classList.add("attachedUnit");

    const label = document.createElement("span");
    label.className = "rosterUnitLabel";
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

  if (rosterDisplay.mode === "custom") bindRosterSectionNameInputs();
}

function renderCustomRosterLayoutControls() {
  const controls = document.createElement("div");
  controls.className = "customRosterControls";
  const addCategory = document.createElement("button");
  addCategory.type = "button";
  addCategory.textContent = "New Category";
  addCategory.onclick = addCustomRosterSection;
  controls.appendChild(addCategory);
  rosterList.appendChild(controls);
}

function groupRosterPresentation(presentation) {
  const sectionKeys = rosterDisplay.mode === "custom"
    ? [...catalogueSections.SECTION_ORDER, ...rosterDisplay.customSections]
    : [...catalogueSections.SECTION_ORDER];
  const customSectionKeys = new Set(rosterDisplay.customSections);
  const groupsBySection = new Map(sectionKeys.map(section => [section, []]));
  const defaultSections = {};
  for (const group of presentation) {
    const primary = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).find(Boolean);
    const defaultSection = catalogueSections.sectionForUnit(primary?.unitPackage || primary || {});
    defaultSections[group.id] = defaultSection;
    const section = rosterDisplay.mode === "custom" ? rosterDisplay.groupSections[group.id] || defaultSection : defaultSection;
    if (!groupsBySection.has(section)) groupsBySection.set(section, []);
    groupsBySection.get(section).push(group);
  }
  if (rosterDisplay.mode === "custom") {
    reconcileCustomRosterLayout(presentation, defaultSections);
    for (const groups of groupsBySection.values()) groups.sort(compareCustomRosterPresentationGroups);
  } else {
    for (const groups of groupsBySection.values()) groups.sort(compareRosterPresentationGroups);
  }
  return [...groupsBySection.entries()].map(([key, groups]) => ({
    key,
    section: rosterDisplay.mode === "custom" ? rosterDisplay.sectionLabels[key] || key : key,
    custom: customSectionKeys.has(key),
    groups
  }));
}

function rosterPresentationTitle(group) {
  if (group.kind === "attached") return group.bodyguard?.name || group.title || "";
  return group.entries?.[0]?.name || group.title || "";
}

function compareRosterPresentationGroups(left, right) {
  return rosterPresentationTitle(left).localeCompare(rosterPresentationTitle(right), undefined, { sensitivity: "base" })
    || String(left.id).localeCompare(String(right.id));
}

function compareCustomRosterPresentationGroups(left, right) {
  const order = new Map(rosterDisplay.groupOrder.map((id, index) => [id, index]));
  const leftOrder = order.has(left.id) ? order.get(left.id) : Number.MAX_SAFE_INTEGER;
  const rightOrder = order.has(right.id) ? order.get(right.id) : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || compareRosterPresentationGroups(left, right);
}

function initializeCustomRosterLayout() {
  const presentation = rosterPresentation();
  const defaultSections = {};
  for (const group of presentation) {
    const primary = group.entries.map(item => roster.find(entry => entry.instanceId === item.instanceId)).find(Boolean);
    defaultSections[group.id] = catalogueSections.sectionForUnit(primary?.unitPackage || primary || {});
  }
  reconcileCustomRosterLayout(presentation, defaultSections);
}

function addCustomRosterSection() {
  const sectionKey = `custom:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  rosterDisplay.customSections.push(sectionKey);
  rosterDisplay.sectionLabels[sectionKey] = "New Category";
  pendingRosterSectionFocusKey = sectionKey;
  render();
}

function reconcileCustomRosterLayout(presentation, defaultSections) {
  const groupIds = new Set(presentation.map(group => group.id));
  rosterDisplay.groupOrder = [
    ...rosterDisplay.groupOrder.filter(id => groupIds.has(id)),
    ...presentation
      .filter(group => !rosterDisplay.groupOrder.includes(group.id))
      .sort(compareRosterPresentationGroups)
      .map(group => group.id)
  ];
  for (const group of presentation) {
    if (!rosterDisplay.groupSections[group.id]) rosterDisplay.groupSections[group.id] = defaultSections[group.id] || "Infantry";
  }
  for (const groupId of Object.keys(rosterDisplay.groupSections)) {
    if (!groupIds.has(groupId)) delete rosterDisplay.groupSections[groupId];
  }
}

function bindRosterDragHandle(element, groupId) {
  element.draggable = true;
  element.addEventListener("dragstart", event => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    element.classList.add("dragging");
  });
  element.addEventListener("dragend", () => {
    element.classList.remove("dragging");
    rosterList.querySelectorAll(".dragOver").forEach(item => item.classList.remove("dragOver"));
  });
  element.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("dragOver");
  });
  element.addEventListener("dragleave", () => element.classList.remove("dragOver"));
  element.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    const draggedGroupId = event.dataTransfer.getData("text/plain");
    moveRosterPresentationGroup(draggedGroupId, element.closest(".unitSectionContents")?.dataset.sectionKey, groupId);
  });
}

function bindRosterDropZone(element, sectionKey) {
  element.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("dragOver");
  });
  element.addEventListener("dragleave", event => {
    if (!element.contains(event.relatedTarget)) element.classList.remove("dragOver");
  });
  element.addEventListener("drop", event => {
    event.preventDefault();
    element.classList.remove("dragOver");
    const draggedGroupId = event.dataTransfer.getData("text/plain");
    const targetUnit = event.target.closest(".unit");
    moveRosterPresentationGroup(draggedGroupId, sectionKey, targetUnit?.dataset.groupId || null);
  });
}

function moveRosterPresentationGroup(groupId, sectionKey, beforeGroupId = null) {
  if (!groupId || !sectionKey || groupId === beforeGroupId) return;
  rosterDisplay.groupSections[groupId] = sectionKey;
  const order = rosterDisplay.groupOrder.filter(id => id !== groupId);
  const targetIndex = beforeGroupId ? order.indexOf(beforeGroupId) : -1;
  order.splice(targetIndex >= 0 ? targetIndex : order.length, 0, groupId);
  rosterDisplay.groupOrder = order;
  render();
}

function bindRosterSectionNameInputs() {
  rosterList.querySelectorAll(".rosterSectionName").forEach(input => {
    input.addEventListener("click", event => event.stopPropagation());
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("input", event => {
      const key = event.target.dataset.sectionKey;
      rosterDisplay.sectionLabels[key] = event.target.value;
    });
    if (input.dataset.sectionKey === pendingRosterSectionFocusKey) {
      input.focus();
      input.select();
      pendingRosterSectionFocusKey = null;
    }
  });
}

function renderRosterUnitLabel(rosterEntry) {
  const unit = rosterEntry.unitPackage;
  const unitSize = engine.getUnitSizeState(unit.definition, rosterEntry.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  const nickname = rosterNicknameFor(rosterEntry.instanceId);
  return `<b>${sizePrefix}${escapeHtml(unit.name)}</b>${renderRosterNickname(nickname, rosterEntry.instanceId)} — ${formatEntryPoints(rosterEntry)}`;
}

function renderRosterGroupLabel(group, groupEntries) {
  const bodyguard = groupEntries.find(item => item.instanceId === group.bodyguard?.instanceId) || groupEntries[0];
  const leaders = group.leaders
    .map(leader => groupEntries.find(item => item.instanceId === leader.instanceId))
    .filter(Boolean);
  const unitSize = engine.getUnitSizeState(bodyguard.unitPackage.definition, bodyguard.entry);
  const sizePrefix = unitSize.current > 1 ? `${unitSize.current}x ` : "";
  const warning = group.warnings.length ? ` <span class="warningBadge">⚠</span>` : "";
  const nickname = rosterNicknameFor(bodyguard.instanceId);
  return `
    <b>${sizePrefix}${escapeHtml(bodyguard.unitPackage.name)}</b>${renderRosterNickname(nickname, bodyguard.instanceId)}${warning} — ${group.totalPoints} pts
    <small>Led by ${leaders.map(item => escapeHtml(item.unitPackage.name)).join(", ")}</small>
  `;
}

function renderDetachmentForceDispositionNote(detachment) {
  const disposition = detachment.forceDisposition;
  return `
    <div class="previewDispositionNote">
      <span>Force Disposition</span>
      <b>${escapeHtml(disposition?.name || "Not listed")}</b>
    </div>
  `;
}

function renderForceDispositionPicker(army, detachments, state) {
  const available = armyEngine.availableForceDispositions?.(army, state) || [];
  if (!available.length) return `<p class="muted">The selected detachment does not list a force disposition.</p>`;
  const selectedDisposition = armyEngine.selectedForceDisposition?.(army, state) || null;
  const opponentDisposition = armyEngine.selectedOpponentForceDisposition?.(army, state) || null;
  const mission = armyEngine.selectedPrimaryMission?.(army, state) || null;
  const dispositionSources = detachments
    .map(detachment => detachment.forceDisposition ? `${detachment.name}: ${detachment.forceDisposition.name}` : null)
    .filter(Boolean);

  return `
    <div class="missionPicker">
      <div class="missionPickerBlock">
        <b>Your detachment disposition</b>
        ${dispositionSources.length ? `<small>${escapeHtml(dispositionSources.join(" · "))}</small>` : ""}
        <div class="forceDispositionChoices">
          ${available.map(disposition => `
            <label class="forceDispositionChoice ${selectedDisposition?.id === disposition.id ? "selected" : ""}">
              <input type="checkbox" class="forceDispositionToggle" data-force-disposition-id="${escapeHtml(disposition.id)}" ${selectedDisposition?.id === disposition.id ? "checked" : ""}>
              <span class="forceDispositionMark" aria-hidden="true">${escapeHtml(forceDispositionMark(disposition.name))}</span>
              <span>${escapeHtml(disposition.name || "Disposition")}</span>
            </label>
          `).join("")}
        </div>
      </div>
      <label class="missionPickerBlock">
        <b>Opponent disposition</b>
        <select id="opponentForceDisposition">
          <option value="">Choose who you are playing into</option>
          ${(army.forceDispositions || []).map(disposition => `
            <option value="${escapeHtml(disposition.id)}" ${opponentDisposition?.id === disposition.id ? "selected" : ""}>${escapeHtml(disposition.name)}</option>
          `).join("")}
        </select>
      </label>
      ${mission ? renderPrimaryMissionCard(selectedDisposition, opponentDisposition, mission) : `
        <p class="muted">Pick your disposition and your opponent's disposition to show the primary mission.</p>
      `}
    </div>
  `;
}

function renderPrimaryMissionCard(forceDisposition, opponentDisposition, mission) {
  const images = mission.cardImages || {};
  return `
    <article class="primaryMissionCard">
      ${images.front ? `
        <div class="missionCardImageShell" data-mission-card>
          ${images.back ? `<button type="button" class="missionCardToggle" aria-label="Flip mission card">1/2</button>` : ""}
          <img class="missionCardSide missionCardFront" src="${escapeHtml(images.front)}" alt="${escapeHtml(mission.name || "Mission")} scoring side" loading="lazy">
          ${images.back ? `<img class="missionCardSide missionCardBack" src="${escapeHtml(images.back)}" alt="${escapeHtml(mission.name || "Mission")} action side" loading="lazy" hidden>` : ""}
        </div>
      ` : `<p class="muted">Mission card images are not available for this mission.</p>`}
    </article>
  `;
}

function bindForceDispositionControls(root, army) {
  for (const input of root.querySelectorAll(".forceDispositionToggle")) {
    input.onchange = event => {
      armyState = armyEngine.setForceDisposition(army, armyState, event.target.checked ? event.target.dataset.forceDispositionId : null);
      selectedPanel = "configuration";
      render();
    };
  }
  const opponentSelect = root.querySelector("#opponentForceDisposition");
  if (opponentSelect) {
    opponentSelect.onchange = event => {
      armyState = armyEngine.setOpponentForceDisposition(army, armyState, event.target.value || null);
      selectedPanel = "configuration";
      render();
    };
  }
  for (const button of root.querySelectorAll(".missionCardToggle")) {
    button.onclick = () => {
      const shell = button.closest("[data-mission-card]");
      const front = shell?.querySelector(".missionCardFront");
      const back = shell?.querySelector(".missionCardBack");
      if (!front || !back) return;
      const showingBack = back.hidden;
      back.hidden = !showingBack;
      front.hidden = showingBack;
      button.textContent = showingBack ? "2/2" : "1/2";
    };
  }
}

function forceDispositionMark(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("take and hold")) return "TH";
  if (normalized.includes("disruption")) return "D";
  if (normalized.includes("purge")) return "PF";
  if (normalized.includes("priority")) return "PA";
  if (normalized.includes("recon")) return "R";
  return name ? name.slice(0, 2).toUpperCase() : "?";
}

function renderRosterNickname(nickname, instanceId) {
  const value = String(nickname || "").trim();
  return ` <span class="unitNickname" data-nickname-display-for="${escapeHtml(instanceId)}"${value ? "" : " hidden"}>"${escapeHtml(value)}"</span>`;
}

function rosterNicknameFor(instanceId) {
  return String(rosterDisplay.unitNicknames?.[instanceId] || "").trim();
}

function renderRosterUnitPlainLabel(rosterEntry) {
  return escapeHtml(rosterUnitPlainTextLabel(rosterEntry));
}

function rosterUnitPlainTextLabel(rosterEntry) {
  const nickname = rosterNicknameFor(rosterEntry.instanceId);
  return `${rosterEntry.unitPackage.name}${nickname ? ` "${nickname}"` : ""}`;
}

function renderRosterUnitOptions(entries, options = {}) {
  const labels = rosterUnitDropdownLabels(entries);
  const selectedId = options.selectedId || null;
  const legalFor = typeof options.legalFor === "function" ? options.legalFor : () => true;
  return entries.map(entry => renderRosterUnitOption(entry, {
    label: labels.get(entry.instanceId) || rosterUnitPlainTextLabel(entry),
    legal: legalFor(entry),
    selected: selectedId === entry.instanceId
  })).join("");
}

function renderRosterUnitOption(rosterEntry, options = {}) {
  const label = options.label || rosterUnitPlainTextLabel(rosterEntry);
  return `<option value="${escapeHtml(rosterEntry.instanceId)}" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" ${options.selected ? "selected" : ""}>${escapeHtml(label)}${options.legal === false ? " ⚠" : ""}</option>`;
}

function rosterUnitDropdownLabels(entries) {
  const bases = entries.map(entry => [entry.instanceId, rosterUnitDropdownBaseLabel(entry)]);
  const counts = new Map();
  for (const [, label] of bases) counts.set(label, (counts.get(label) || 0) + 1);
  const seen = new Map();
  return new Map(bases.map(([instanceId, label]) => {
    if ((counts.get(label) || 0) <= 1) return [instanceId, label];
    const next = (seen.get(label) || 0) + 1;
    seen.set(label, next);
    return [instanceId, `${label} (${next})`];
  }));
}

function rosterUnitDropdownBaseLabel(rosterEntry) {
  const status = rosterUnitAttachmentStatus(rosterEntry);
  return `${rosterUnitPlainTextLabel(rosterEntry)}${status ? ` - ${status}` : ""}`;
}

function rosterUnitAttachmentStatus(rosterEntry) {
  const attachments = armyState?.attachments || [];
  const ledBy = attachments
    .filter(item => item.targetInstanceId === rosterEntry.instanceId)
    .map(item => roster.find(entry => entry.instanceId === item.leaderInstanceId))
    .filter(Boolean);
  if (ledBy.length) return `led by ${ledBy.map(rosterUnitPlainTextLabel).join(", ")}`;

  const leading = attachments.find(item => item.leaderInstanceId === rosterEntry.instanceId);
  if (leading) {
    const target = roster.find(entry => entry.instanceId === leading.targetInstanceId);
    if (target) return `leading ${rosterUnitPlainTextLabel(target)}`;
  }
  return "";
}

function renderSidebarNicknameControl(rosterEntry) {
  return `
    <label class="sidebarNicknameControl">
      <span>Nickname</span>
      <input id="unitNicknameInput" data-instance-id="${escapeHtml(rosterEntry.instanceId)}" type="text" value="${escapeHtml(rosterNicknameFor(rosterEntry.instanceId))}" placeholder="Optional nickname">
    </label>
  `;
}

function bindSidebarNicknameInput() {
  const input = document.getElementById("unitNicknameInput");
  if (!input) return;
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("input", event => {
    const instanceId = event.target.dataset.instanceId;
    const nickname = event.target.value.trim();
    if (!rosterDisplay.unitNicknames) rosterDisplay.unitNicknames = {};
    if (nickname) {
      rosterDisplay.unitNicknames[instanceId] = nickname;
    } else {
      delete rosterDisplay.unitNicknames[instanceId];
    }
    updateNicknameDisplays(instanceId, nickname);
  });
}

function updateNicknameDisplays(instanceId, nickname) {
  for (const display of document.querySelectorAll("[data-nickname-display-for]")) {
    if (display.dataset.nicknameDisplayFor !== instanceId) continue;
    display.textContent = nickname ? `"${nickname}"` : "";
    display.hidden = !nickname;
  }
  const rosterEntry = roster.find(item => item.instanceId === instanceId);
  if (!rosterEntry) return;
  refreshAssignmentSelectLabels();
}

function refreshAssignmentSelectLabels() {
  for (const select of document.querySelectorAll("select")) {
    const options = [...select.querySelectorAll("option[data-instance-id]")];
    if (!options.length) continue;
    const entries = options
      .map(option => roster.find(entry => entry.instanceId === option.dataset.instanceId))
      .filter(Boolean);
    const labels = rosterUnitDropdownLabels(entries);
    for (const option of options) {
      const entry = roster.find(item => item.instanceId === option.dataset.instanceId);
      if (!entry) continue;
      const warning = option.textContent.includes("⚠") ? " ⚠" : "";
      option.textContent = `${labels.get(entry.instanceId) || rosterUnitPlainTextLabel(entry)}${warning}`;
    }
  }
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
    <details class="sidebarGroup" data-disclosure-key="armyRules" ${disclosureOpenAttribute("armyRules", true)}><summary>Army Rules</summary><div id="armyRules"></div></details>
    <details class="sidebarGroup" data-disclosure-key="detachments" ${disclosureOpenAttribute("detachments", true)}><summary>Detachments</summary><div id="detachmentSelect" class="detachmentList"></div></details>
    <details class="sidebarGroup" data-disclosure-key="detachmentRules" ${disclosureOpenAttribute("detachmentRules", true)}><summary>Detachment Rules</summary><div id="detachmentRules"></div></details>
    <details class="sidebarGroup" data-disclosure-key="forceDispositions" ${disclosureOpenAttribute("forceDispositions", true)}><summary>Force Dispositions</summary><div id="forceDispositions"></div></details>
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
  const ruleLookup = buildRuleLookup(unitPackage.defaultSummary.configured, [], currentArmyDefinition());
  details.innerHTML = `
    <h3>${escapeHtml(unitPackage.name)} <span class="pts">${unitPackage.defaultSummary.points} pts</span></h3>
    <p><b>Faction:</b> ${escapeHtml(unitPackage.faction)}</p>
    ${renderKeywords(unitPackage.keywords || unitPackage.definition?.keywords || unitPackage.definition?.categories || [], ruleLookup)}
    ${renderConfigured(unitPackage.defaultSummary.configured, [], models, { ruleLookup })}
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
  const effects = [
    ...selectedArmyAndDetachmentEffects(),
    ...attachedGroupEffects(attachedGroup),
    ...assignedEnhancementsForRosterEntry(rosterEntry)
  ];
  const ruleLookup = buildRuleLookup(configured, effects, currentArmyDefinition());
  const isBodyguard = Boolean(attachedGroup && (attachedGroup.bodyguard?.instanceId || attachedGroup.memberInstanceIds?.[0]) === rosterEntry.instanceId);

  details.innerHTML = `
    <h3>${sizePrefix}${escapeHtml(unit.name)} <span class="pts">${formatEntryPoints(rosterEntry)}</span></h3>
    ${renderSidebarNicknameControl(rosterEntry)}
    ${attachedGroup ? `<button id="backToAttachedUnit" class="sidebarBack">Back to attached unit</button>` : ""}
    <p><b>Faction:</b> ${escapeHtml(unit.faction)}</p>
    ${renderKeywords(unit.keywords || unit.definition.keywords || unit.definition.categories || [], ruleLookup)}
    ${renderUnitAssignments(rosterEntry)}
    ${renderUnitSizeControl(rosterEntry, unitSize)}
    ${renderOptionControls(rosterEntry)}
    ${renderEntryValidation(loadoutErrors, pricing.validationErrors)}
    ${renderConfigured(configured, effects, models, { isBodyguard, ruleLookup })}
    <p><b>Source:</b> ${escapeHtml(unit.source?.sourceFile || "")}</p>
  `;
  bindUnitSizeInputs();
  bindLoadoutInputs();
  bindSidebarDisclosureState();
  bindSidebarNicknameInput();
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
    ${bodyguard ? renderUnitAssignments(bodyguard) : ""}
    ${renderAttachedConfigured(groupEntries)}
  `;
  bindAttachedGroupInputs();
  bindSidebarDisclosureState();
  bindUnitAssignmentInputs();
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
  const group = groupEntries.length ? attachedGroupForInstance(groupEntries[0].instanceId) : null;
  const bodyguardInstanceId = group?.bodyguard?.instanceId || groupEntries[0]?.instanceId || null;
  const effects = [
    ...selectedArmyAndDetachmentEffects(),
    ...groupEntries.flatMap(rosterEntry => {
      const configured = engine.getConfiguredProfiles(rosterEntry.unitPackage.definition, rosterEntry.entry);
      return [
        ...(configured.abilities || []),
        ...(configured.rules || []),
        ...(configured.profiles || []),
        ...assignedEnhancementsForRosterEntry(rosterEntry)
      ];
    })
  ];
  for (const rosterEntry of groupEntries) {
    const configured = engine.getConfiguredProfiles(rosterEntry.unitPackage.definition, rosterEntry.entry);
    const context = { isBodyguard: rosterEntry.instanceId === bodyguardInstanceId };
    const enhancedUnits = unitProfilesWithDerivedInvulnerableSaves(
      configured.units || [],
      configured,
      [...effects, ...assignedEnhancementsForRosterEntry(rosterEntry)],
      context
    );
    const effectiveConfigured = rosterSheets.applyWeaponEffectsToConfigured
      ? rosterSheets.applyWeaponEffectsToConfigured(configured, effects, context)
      : configured;
    const withUnit = profile => ({ ...profile, name: `${rosterEntry.unitPackage.name}: ${profile.name}` });
    merged.units.push(...enhancedUnits.map(withUnit));
    merged.weapons.push(...(effectiveConfigured.weapons || []).map(withUnit));
    merged.abilities.push(...(configured.abilities || []).map(withUnit));
    merged.rules.push(...(configured.rules || []).map(rule => ({ ...rule, name: `${rosterEntry.unitPackage.name}: ${rule.name || rule}` })));
  }
  return renderConfigured(merged, [], [], { effectsAlreadyApplied: true, ruleLookup: buildRuleLookup(merged, effects, currentArmyDefinition()) });
}

function selectedArmyAndDetachmentEffects() {
  const army = currentArmyDefinition();
  return [
    ...(army?.armyRules || []).map(item => ({ ...item, sourceKind: "army" })),
    ...armyEngine.selectedDetachments(army, armyState).flatMap(detachment =>
      (detachment.rules || []).map(rule => ({ ...rule, sourceKind: "detachment", sourceLabel: detachment.name }))
    )
  ];
}

function attachedGroupEffects(group) {
  if (!group) return [];
  return group.memberInstanceIds
    .map(instanceId => roster.find(item => item.instanceId === instanceId))
    .filter(Boolean)
    .flatMap(rosterEntry => {
      const configured = engine.getConfiguredProfiles(rosterEntry.unitPackage.definition, rosterEntry.entry);
      return [
        ...(configured.abilities || []),
        ...(configured.rules || []),
        ...(configured.profiles || [])
      ];
    });
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
              ${renderRosterUnitOptions(assignment.leaderTargets
                .map(targetState => roster.find(item => item.instanceId === targetState.instanceId))
                .filter(Boolean), {
                selectedId: assignment.leaderAssignment?.targetInstanceId,
                legalFor: target => armyEngine.leaderCanTarget(
                  { selectionKey: unit.selectionKey, name: unit.name, rosterRules: definition.rosterRules },
                  { selectionKey: target.unitPackage.selectionKey, name: target.unitPackage.name }
                )
              })}
            </select>
          </label>
        ` : ""}
        ${assignment.eligibleLeaders.length || assignment.ledBy.length ? `
          <label class="assignmentSelect"><span><b>Led by</b><small>${escapeHtml(ledByLabel)}</small></span>
            <select class="bodyguardLeader" data-target-id="${escapeHtml(rosterEntry.instanceId)}">
              <option value="">${assignment.ledBy.length ? "Add another leader" : "Not attached"}</option>
              ${renderRosterUnitOptions(assignment.eligibleLeaders
                .map(leaderState => roster.find(item => item.instanceId === leaderState.instanceId))
                .filter(Boolean), {
                legalFor: leader => armyEngine.leaderCanTarget(
                  { selectionKey: leader.unitPackage.selectionKey, name: leader.unitPackage.name, rosterRules: leader.unitPackage.definition.rosterRules },
                  { selectionKey: unit.selectionKey, name: unit.name }
                )
              })}
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
      if (!event.target.value) {
        for (const relationship of (armyState.attachments || []).filter(item => item.targetInstanceId === targetId)) {
          armyState = armyEngine.setLeaderAttachment(armyState, relationship.leaderInstanceId, null);
        }
      } else {
        armyState = armyEngine.setLeaderAttachment(armyState, event.target.value, targetId);
      }
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
        <span class="optionName">${renderOptionNameWithPoints(option, node)}</span>
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

function renderOptionNameWithPoints(option, node = null) {
  const points = Number(option?.points || 0);
  const suffix = points
    ? ` <small class="optionPoints">(${points > 0 ? "+" : ""}${points} pts)</small>`
    : "";
  return `${renderWeaponOptionName(option?.name || "Option", weaponProfilesForOptionNode(node))}${suffix}`;
}

function weaponProfilesForOptionNode(node) {
  if (!node) return [];
  return collectWeaponProfilesForNode(node)
    .filter(profile => profile?.name && /Weapons$/i.test(profile.typeName || ""))
    .filter(profile => Number(profile.countMultiplier ?? 1) > 0)
    .filter((profile, index, profiles) =>
      profiles.findIndex(item =>
        String(item.name || "") === String(profile.name || "")
        && String(item.typeName || "") === String(profile.typeName || "")
      ) === index
    );
}

function collectWeaponProfilesForNode(node) {
  return [
    ...(node.profiles || []),
    ...(node.children || []).flatMap(collectWeaponProfilesForNode)
  ];
}

function renderWeaponOptionName(name, profiles = []) {
  if (!profiles.length) return escapeHtml(name);

  const parts = splitWeaponOptionName(name, profiles);
  if (!parts) return renderWeaponOptionPreview(name, profiles);

  return parts.map(part =>
    part.profiles.length
      ? renderWeaponOptionPreview(part.text, part.profiles)
      : escapeHtml(part.text)
  ).join("");
}

function splitWeaponOptionName(name, profiles = []) {
  if (profiles.length < 2 || !/\s+and\s+/i.test(name)) return null;

  const sourceParts = String(name).split(/(\s+and\s+)/i);
  const usedProfiles = new Set();
  const parts = sourceParts.map(text => {
    if (/^\s+and\s+$/i.test(text)) return { text, profiles: [] };

    const label = normalizeWeaponLabel(text);
    const matches = profiles.filter(profile => {
      if (usedProfiles.has(profile)) return false;
      const profileName = normalizeWeaponLabel(profile.name);
      return profileName === label
        || profileName.includes(label)
        || label.includes(profileName);
    });
    matches.forEach(profile => usedProfiles.add(profile));
    return { text, profiles: matches };
  });

  return usedProfiles.size === profiles.length && parts.some(part => part.profiles.length)
    ? parts
    : null;
}

function normalizeWeaponLabel(value) {
  return String(value || "")
    .replace(/^\s*(?:\d+|one|a|an)\s+/i, "")
    .replace(/^➤\s*/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderWeaponOptionPreview(name, profiles = []) {
  if (!profiles.length) return escapeHtml(name);
  const id = `weaponPreview${++rulePopupCounter}`;
  return `
    <span class="weaponPreviewWrap">
      <button type="button" class="weaponPreviewToken" aria-expanded="false" aria-controls="${id}">${escapeHtml(name)}</button>
      <span id="${id}" class="weaponPreviewPopover" role="dialog" aria-label="${escapeHtml(name)} preview">
        <button type="button" class="weaponPreviewClose" aria-label="Close weapon preview">Close</button>
        ${profiles.map(renderWeaponPreviewProfile).join("")}
      </span>
    </span>
  `;
}

function handleWeaponPreviewClick(event) {
  const closeButton = event.target.closest?.(".weaponPreviewClose");
  if (closeButton) {
    event.preventDefault();
    event.stopPropagation();
    setWeaponPreviewOpen(closeButton.closest(".weaponPreviewWrap"), false);
    return true;
  }
  const token = event.target.closest?.(".weaponPreviewToken");
  if (!token) return false;
  event.preventDefault();
  event.stopPropagation();
  const wrap = token.closest(".weaponPreviewWrap");
  const willOpen = !wrap?.classList.contains("active");
  closeOpenWeaponPreview(wrap);
  setWeaponPreviewOpen(wrap, willOpen);
  return true;
}

function closeOpenWeaponPreview(except = null) {
  for (const wrap of document.querySelectorAll(".weaponPreviewWrap.active")) {
    if (except && (wrap === except || wrap.contains(except))) continue;
    setWeaponPreviewOpen(wrap, false);
  }
}

function setWeaponPreviewOpen(wrap, open) {
  if (!wrap) return;
  wrap.classList.toggle("active", open);
  const token = wrap.querySelector(".weaponPreviewToken");
  if (token) token.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderWeaponPreviewProfile(profile) {
  const c = profile.characteristics || {};
  const stats = [
    ["Range", c.Range],
    ["A", c.A],
    ["BS", c.BS],
    ["WS", c.WS],
    ["S", c.S],
    ["AP", c.AP],
    ["D", c.D]
  ];
  return `
    <span class="weaponPreviewProfile">
      <strong>${escapeHtml(profile.name)}</strong>
      <small>${escapeHtml(profile.typeName || "Weapon")}</small>
      <span class="weaponPreviewStats">
        ${stats.map(([label, value]) => `
          <span><b>${label}</b>${escapeHtml(displayWeaponCell(value))}</span>
        `).join("")}
      </span>
      ${displayWeaponCell(c.Keywords) !== "-" ? `<em>Keywords: ${escapeHtml(displayWeaponCell(c.Keywords))}</em>` : ""}
    </span>
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

function renderConfigured(configured, effects = [], models = [], context = {}) {
  const effectiveConfigured = rosterSheets.applyWeaponEffectsToConfigured
    ? rosterSheets.applyWeaponEffectsToConfigured(configured, context.effectsAlreadyApplied ? [] : effects, context)
    : configured;
  const ruleLookup = context.ruleLookup || buildRuleLookup(configured, effects, currentArmyDefinition());
  return `
    ${renderConfiguredModels(models)}
    ${renderUnitProfiles(unitProfilesWithDerivedInvulnerableSaves(configured.units || [], configured, effects, context))}
    ${renderWeapons("Ranged Weapons", effectiveConfigured.weapons || [], "Ranged Weapons", ruleLookup)}
    ${renderWeapons("Melee Weapons", effectiveConfigured.weapons || [], "Melee Weapons", ruleLookup)}
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

function renderKeywords(keywords, ruleLookup = new Map()) {
  const visible = [...new Set(keywords || [])].filter(Boolean);
  if (!visible.length) return "";
  return `
    <h4>Keywords</h4>
    <div class="chips keywordChips">
      ${visible.map(keyword => renderRuleToken(keyword, ruleLookup)).join("")}
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

function unitProfilesWithDerivedInvulnerableSaves(units, configured = {}, effects = [], context = {}) {
  const inferredInSv = inferredInvulnerableSave(configured, effects);
  const effectiveUnits = rosterSheets.applyUnitEffectsToProfiles
    ? rosterSheets.applyUnitEffectsToProfiles(units || [], effects, context)
    : (units || []);
  return effectiveUnits.map(profile => {
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
    ...(configured.abilities || []).flatMap(invulnerableEffectTextParts),
    ...(configured.rules || []).flatMap(invulnerableEffectTextParts),
    ...(configured.profiles || []).flatMap(invulnerableEffectTextParts),
    ...invulnerableEffectTextsFromEffects(effects)
  ];
  return bestSave("", ...texts.map(extractInvulnerableSave).filter(Boolean));
}

function invulnerableEffectTextsFromEffects(effects = []) {
  return (effects || []).flatMap(effect => {
    const source = effect?.sourceKind || effect?.source || "";
    return invulnerableEffectTextParts(effect).filter(text => effectAppliesAutomaticallyForInvulnerableSave(text, source));
  });
}

function effectAppliesAutomaticallyForInvulnerableSave(text, sourceKind = "") {
  if (effectRequiresBattleStateForInvulnerableSave(text)) return false;
  if (sourceKind === "detachment" || sourceKind === "army") return true;
  return /while\s+.*\b(?:is\s+)?leading\b/i.test(text)
    || /\bwhile\s+.*\bunit\s+is\s+led\b/i.test(text)
    || /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\b/i.test(text)
    || /\bmodels?\s+in\s+(?:this|that)\s+unit\b/i.test(text);
}

function effectRequiresBattleStateForInvulnerableSave(text) {
  return /\bAura\b/i.test(text)
    || /\bwithin\s+\d+\s*(?:"|&quot;|inches?\b)/i.test(text)
    || /\bif\s+the\s+Waaagh!?'?s?\s+active\b/i.test(text)
    || /\bif\s+the\s+Waaagh!?\s+is\s+active\b/i.test(text)
    || /\bwhile\s+the\s+Waaagh!?\s+is\s+active\b/i.test(text)
    || /\buntil\s+the\s+end\s+of\s+(?:the\s+)?(?:phase|turn|battle round)\b/i.test(text)
    || /\bbattle\s+rounds?\s+\d/i.test(text)
    || /\bduring\s+the\s+(?:first|second|third|fourth|fifth)[^.]*battle\s+rounds?\b/i.test(text)
    || /\bselect\s+one\b/i.test(text);
}

function effectTextParts(item) {
  const description = item?.description || item?.characteristics?.Description || "";
  return [
    item?.name,
    description,
    ...(item?.profiles || []).flatMap(effectTextParts),
    ...(item?.rules || []).flatMap(effectTextParts)
  ].filter(Boolean);
}

function invulnerableEffectTextParts(item) {
  const description = item?.description || item?.characteristics?.Description || "";
  return [
    ...effectTextParts(item),
    `${item?.name || ""} ${description}`.trim(),
    ...(item?.profiles || []).flatMap(invulnerableEffectTextParts),
    ...(item?.rules || []).flatMap(invulnerableEffectTextParts)
  ].filter(Boolean);
}

function invulnerableSaveValue(characteristics = {}) {
  const value = String(characteristics.InSv || characteristics["Invulnerable Save"] || "").trim();
  return value && value !== "-" ? value : "";
}

function extractInvulnerableSave(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/\b([2-6]\+)\s*(?:\*\*)?\s*(?:InSv|invulnerable\s+save)\b/i)
    || normalized.match(/\b(?:InSv|invulnerable\s+save)\s*(?::|of)?\s*(?:\*\*)?\s*([2-6]\+)/i);
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

function renderWeapons(title, weapons, typeName, ruleLookup = new Map()) {
  const rows = weapons.filter(w => w.typeName === typeName);
  if (!rows.length) return "";
  const skillKey = typeName === "Melee Weapons" ? "WS" : "BS";

  return `
    <h4>${escapeHtml(title)}</h4>
    <table class="weaponTable">
      <thead>
        <tr>
          <th class="weaponCountColumn">Count</th><th class="weaponNameColumn">Weapon</th><th>Range</th><th>A</th><th>${skillKey}</th><th>S</th><th>AP</th><th>D</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(w => {
          const c = w.characteristics || {};
          const keywordCell = renderWeaponKeywordCell(c.Keywords, ruleLookup);
          return `
            <tr class="mobileWeaponNameRow">
              <td colspan="8">${escapeHtml(formatWeaponNameLine(w.count ?? 1, w.name))}</td>
            </tr>
            <tr class="weaponStatsRow">
              <td class="weaponCountColumn">${escapeHtml(w.count ?? 1)}</td>
              <td class="weaponNameColumn">${escapeHtml(w.name)}</td>
              <td>${escapeHtml(displayWeaponCell(c.Range))}</td>
              <td>${escapeHtml(displayWeaponCell(c.A))}</td>
              <td>${escapeHtml(displayWeaponCell(c[skillKey]))}</td>
              <td>${escapeHtml(displayWeaponCell(c.S))}</td>
              <td>${escapeHtml(displayWeaponCell(c.AP))}</td>
              <td>${escapeHtml(displayWeaponCell(c.D))}</td>
            </tr>
            ${keywordCell === "-" ? "" : `
              <tr class="weaponKeywordRow">
                <td colspan="8">${keywordCell}</td>
              </tr>
            `}
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

function formatWeaponNameLine(count, name) {
  const numericCount = Number(count);
  const prefix = Number.isFinite(numericCount) && numericCount > 1 ? `${numericCount}x ` : "";
  return `${prefix}${name}`;
}

function renderWeaponKeywordCell(value, ruleLookup = new Map()) {
  const text = displayWeaponCell(value);
  if (text === "-") return "-";
  return splitKeywordList(text)
    .map(keyword => renderRuleToken(keyword, ruleLookup, { compact: true }))
    .join(" ");
}

function splitKeywordList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function buildRuleLookup(configured = {}, effects = [], army = null) {
  const selectedDetachments = army && armyEngine.selectedDetachments
    ? armyEngine.selectedDetachments(army, armyState)
    : [];
  const lookup = new Map();
  const records = [
    ...(configured?.rules || []),
    ...(configured?.abilities || []),
    ...(configured?.profiles || []),
    ...(effects || []),
    ...(engineData.coreRules || []),
    ...(army?.armyRules || []),
    ...(army?.coreStratagems || []),
    ...selectedDetachments.flatMap(detachment => [
      ...(detachment.rules || []),
      ...(detachment.stratagems || [])
    ])
  ];

  for (const record of records) addRuleRecord(lookup, record);
  addRuleAlias(lookup, "Smoke", "Smokescreen");
  addRuleAlias(lookup, "Grenades", "Explosives");
  addRuleAlias(lookup, "Explosives", "Explosives");
  return lookup;
}

function addRuleRecord(lookup, record, sourceLabel = "") {
  if (!record || typeof record !== "object") return;
  const name = String(record.name || "").trim();
  const description = ruleDescription(record);
  if (name && description) {
    const key = normalizeRuleLookupKey(name);
    const value = {
      name,
      description,
      meta: ruleMeta(record, sourceLabel)
    };
    if (!lookup.has(key)) lookup.set(key, value);
    for (const alias of record.alias || []) {
      const aliasKey = normalizeRuleLookupKey(alias);
      if (aliasKey && !lookup.has(aliasKey)) lookup.set(aliasKey, value);
    }
  }
  for (const child of [
    ...(record.rules || []),
    ...(record.profiles || [])
  ]) addRuleRecord(lookup, child, name);
}

function addRuleAlias(lookup, alias, canonical) {
  const rule = lookup.get(normalizeRuleLookupKey(canonical));
  const key = normalizeRuleLookupKey(alias);
  if (rule && !lookup.has(key)) lookup.set(key, { ...rule, alias });
}

function ruleDescription(record) {
  return record.description
    || record.characteristics?.Description
    || record.effect
    || "";
}

function ruleMeta(record, sourceLabel = "") {
  return [
    record.sourceKind === "core-rule" ? "Core Rule" : "",
    record.type,
    record.cpCost ? `${record.cpCost}CP` : "",
    record.phase,
    record.page ? `p. ${record.page}` : "",
    record.sourceLabel,
    sourceLabel
  ].filter(Boolean).join(" · ");
}

function normalizeRuleLookupKey(value) {
  return String(value || "")
    .replace(/\[[^\]]+\]/g, match => match.slice(1, -1))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function ruleLookupCandidates(value) {
  const text = String(value || "").trim();
  const candidates = [normalizeRuleLookupKey(text)];
  const parameterized = text.match(/^(Rapid Fire|Sustained Hits|Melta|Feel No Pain|Scouts)\b/i);
  if (parameterized) candidates.push(normalizeRuleLookupKey(parameterized[1]));
  const anti = text.match(/^Anti[-\s]/i);
  if (anti) candidates.push(normalizeRuleLookupKey("Anti"));
  return [...new Set(candidates.filter(Boolean))];
}

function renderRuleToken(label, ruleLookup = new Map(), options = {}) {
  const text = String(label || "").trim();
  if (!text) return "";
  const rule = ruleLookupCandidates(text).map(key => ruleLookup.get(key)).find(Boolean);
  if (!rule) return `<span>${escapeHtml(text)}</span>`;
  const id = `rulePopup${++rulePopupCounter}`;
  const title = rule.alias ? `${text} -> ${rule.name}` : rule.name;
  return `
    <span class="ruleTokenWrap">
      <button class="ruleToken ${options.compact ? "ruleTokenCompact" : ""}" type="button" popovertarget="${id}" title="Show ${escapeHtml(rule.name)}">${escapeHtml(text)}</button>
      <div id="${id}" class="rulePopover" popover>
        <strong>${escapeHtml(title)}</strong>
        ${rule.meta ? `<small>${escapeHtml(rule.meta)}</small>` : ""}
        <p>${formatRichDescription(rule.description)}</p>
      </div>
    </span>
  `;
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
    <details class="configuredSection" open>
      <summary>Rules</summary>
      ${rules.map(rule => {
        const name = rule.name || rule;
        const description = rule.description || "";
        return description
          ? `<details class="card ruleDisclosure"><summary>${escapeHtml(name)}</summary><p>${formatDescription(description)}</p></details>`
          : `<div class="chips"><span>${escapeHtml(name)}</span></div>`;
      }).join("")}
    </details>
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
    rosterDisplay: currentRosterDisplayDocument(),
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
  showTransientMessage(`✓ Saved “${document.name}” on this device.`);
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

async function loadRosterDocument(save, options = {}) {
  const savedRecord = (engineData.factionNavigation || []).flatMap(group => group.factions)
    .find(item => item.id === save.faction || (item.modes || []).some(mode => mode.id === save.faction));
  currentFaction = savedRecord?.id || save.faction;
  currentSubfaction = save.subfaction || ((savedRecord?.modes || []).some(mode => mode.id === save.faction) ? save.faction : savedRecord?.defaultMode) || currentFaction;
  factionSelect.value = currentFaction;
  renderSubfactionControl();
  await loadSelectedFactionData();
  rosterNameInput.value = save.name || "";
  rosterDisplay = normalizeRosterDisplay(save.rosterDisplay);
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
  if (loaded.warnings.length && options.showWarnings !== false) {
    alert(`Loaded with ${loaded.warnings.length} warning${loaded.warnings.length === 1 ? "" : "s"}. Recoverable choices were preserved where possible.`);
  }
  return loaded;
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
    const loaded = await loadRosterDocument(records[0].document, { showWarnings: false });
    const warningText = loaded.warnings.length
      ? ` Loaded with ${loaded.warnings.length} warning${loaded.warnings.length === 1 ? "" : "s"}.`
      : "";
    showTransientMessage(`${records.length === 1 ? "Imported 1 roster." : `Imported ${records.length} rosters.`}${warningText}`);
    restoreTypingFocus(unitSearch);
  } catch (error) {
    alert(`Import failed: ${error.message}`);
  }
}

function restoreTypingFocus(element) {
  const target = element && typeof element.focus === "function" ? element : unitSearch;
  window.setTimeout(() => {
    if (!target || target.disabled || target.hidden) return;
    target.focus({ preventScroll: true });
  }, 0);
}

function showTransientMessage(message) {
  let element = document.getElementById("appTransientMessage");
  if (!element) {
    element = document.createElement("div");
    element.id = "appTransientMessage";
    element.className = "appTransientMessage";
    element.setAttribute("role", "status");
    document.body.appendChild(element);
  }
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(transientMessageTimer);
  transientMessageTimer = window.setTimeout(() => {
    element.hidden = true;
  }, 4500);
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

function openMobileExport() {
  if (discordListStyle) discordListStyle.value = "wtc-compact";
  if (discordMultilineHeader) discordMultilineHeader.checked = true;
  if (discordHideSubunits) discordHideSubunits.checked = false;
  if (discordHideBullets) discordHideBullets.checked = false;
  renderExportFormatButtons();
  openDiscordExportModal();
}

function renderExportFormatButtons() {
  if (!exportFormatButtons || !discordListStyle) return;
  const current = discordListStyle.value;
  exportFormatButtons.innerHTML = Array.from(discordListStyle.options).map(option => `
    <button type="button" class="${option.value === current ? "selected" : ""}" data-export-style="${escapeHtml(option.value)}">
      ${escapeHtml(option.textContent || option.value)}
    </button>
  `).join("");
  for (const button of exportFormatButtons.querySelectorAll("[data-export-style]")) {
    button.onclick = () => {
      discordListStyle.value = button.dataset.exportStyle || "wtc-compact";
      renderExportFormatButtons();
      renderDiscordExportPreview();
    };
  }
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
  const directFormat = directExportFormatForStyle(style);
  if (directFormat) {
    return {
      format: directFormat,
      skippableWargear: compactorSkippableWargear
    };
  }
  if (style.startsWith("plain-")) {
    return {
      format: "DISCORD",
      compact: style === "plain-compact",
      ansi: false,
      multilineHeader: false,
      combineIdentical: false,
      hideSubunits: false,
      noBullets: false,
      hidePoints: false,
      colorMode: "none",
      skippableWargear: compactorSkippableWargear
    };
  }
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
  const directFormat = directExportFormatForStyle(style);
  if (directFormat) return directFormat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (style.startsWith("plain-")) return style;
  const parts = ["discord", style.replace(/^discord-/, "").replace(/^plain-/, "plain-")];
  if (discordCombineIdentical?.checked) parts.push("combined");
  if (discordHideSubunits?.checked) parts.push("flat");
  if (discordHidePoints?.checked) parts.push("no-points");
  return parts.join("-");
}

function directExportFormatForStyle(style) {
  const map = {
    nr: "NR",
    wtc: "WTC",
    "wtc-compact": "WTC-Compact",
    gw: "GW",
    "gw-compact": "GW-Compact"
  };
  return map[style] || "";
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
  renderExportFormatButtons();
  const style = discordListStyle?.value || "";
  const discordLike = style.startsWith("discord-");
  for (const element of [
    discordMultilineHeader?.closest("label"),
    discordCombineIdentical?.closest("label"),
    discordHideSubunits?.closest("label"),
    discordHideBullets?.closest("label"),
    discordHidePoints?.closest("label"),
    document.querySelector(".discordColorOptions")
  ].filter(Boolean)) {
    element.hidden = !discordLike;
  }
  const colorControls = document.querySelector(".discordColorOptions");
  if (colorControls) colorControls.hidden = !discordLike;
  if (discordCustomColors) discordCustomColors.hidden = !discordLike || selectedDiscordColorMode() !== "custom";
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
  const copied = await copyTextToClipboard(text);
  if (copied) {
    showTransientMessage("Copied export.");
  } else {
    showTransientMessage("Could not copy automatically. Use Download instead.");
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  try {
    if (window.AndroidFiles?.copyText) return Boolean(window.AndroidFiles.copyText(value));
  } catch {
    // Fall through to browser clipboard support.
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to a DOM-based copy path below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
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
  const html = buildSheetPreviewHtml(sheets, kind, {
    includeReferences: kind === "units" ? Boolean(includeSheetReferences?.checked) : true
  });
  const previewUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const preview = window.open(previewUrl, "_blank");
  if (!preview) {
    URL.revokeObjectURL(previewUrl);
    alert("The sheet preview was blocked by the browser.");
    return;
  }
  preview.addEventListener?.("load", () => URL.revokeObjectURL(previewUrl), { once: true });
}

function buildSheetPreviewHtml(sheets, kind, options = {}) {
  const title = kind === "crusade" ? "Crusade Sheets" : "Unit Sheets";
  const includeReferences = options.includeReferences !== false;
  const body = kind === "crusade"
    ? sheets.crusadeSheets.map(renderCrusadeSheetPage).join("")
    : [
        includeReferences ? renderRulesReferencePage(sheets.referenceSheets?.rules) : "",
        includeReferences ? renderCoreStratagemReferencePage(sheets.referenceSheets?.stratagems) : "",
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
    .forceDispositionGrid { display: grid; gap: 0.45em; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); }
    .forceDispositionCard { align-items: start; display: grid; gap: 0.45em; grid-template-columns: 34px minmax(0, 1fr); }
    .forceDispositionMark { align-items: center; background: #006070; border-radius: 999px; color: white; display: flex; font-weight: 700; height: 34px; justify-content: center; width: 34px; }
    .forceMissionMap { display: grid; gap: 0.22em; list-style: none; margin: 0.25em 0 0; padding: 0; }
    .forceMissionMap li { align-items: baseline; border-top: 1px solid #ccc; display: grid; gap: 0.25em; grid-template-columns: minmax(0, 1fr) auto; padding-top: 0.2em; }
    .forceMissionMap small { white-space: nowrap; }
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
  const forceDispositions = sheet.forceDispositions || [];
  const detachments = (sheet.detachments || []).filter(detachment =>
    (detachment.rules || []).length || (detachment.stratagems || []).length
  );
  if (!armyRules.length && !keywordLegend.length && !detachments.length && !forceDispositions.length) return "";
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
      ${forceDispositions.length ? renderForceDispositionReferenceSection(forceDispositions) : ""}
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

function renderForceDispositionReferenceSection(forceDispositions) {
  return `
    <section>
      <h2>Force Dispositions</h2>
      <div class="forceDispositionGrid referenceGrid">
        ${forceDispositions.map(disposition => `
          <article class="forceDispositionCard referenceItem">
            <div class="forceDispositionMark" aria-hidden="true">${escapeHtml(forceDispositionMark(disposition.name))}</div>
            <div>
              <h3>${escapeHtml(disposition.name || "Disposition")}</h3>
              ${(disposition.missionMap || []).length ? `
                <ol class="forceMissionMap">
                  ${(disposition.missionMap || []).map(mission => `
                    <li>
                      <span>${escapeHtml(mission.name || "Mission")}</span>
                      <small>vs ${escapeHtml(mission.opponentDisposition || "Disposition")}</small>
                    </li>
                  `).join("")}
                </ol>
              ` : `<p>No mission map found.</p>`}
            </div>
          </article>
        `).join("")}
      </div>
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
  const skillLabel = title === "Melee Weapons" ? "WS" : "BS";
  return `
    <h2>${escapeHtml(title)}</h2>
    <table class="weaponTable">
      <thead><tr><th class="weaponCountColumn">Count</th><th class="weaponNameColumn">Weapon</th><th>Rng</th><th>A</th><th>${skillLabel}</th><th>S</th><th>AP</th><th>D</th></tr></thead>
      <tbody>
        ${weapons.map(weapon => {
          const c = weapon.characteristics || {};
          return `
            <tr class="mobileWeaponNameRow">
              <td colspan="8">${escapeHtml(formatWeaponNameLine(weapon.count || 1, weapon.name))}</td>
            </tr>
            <tr class="weaponStatsRow">
              <td class="weaponCountColumn">${escapeHtml(weapon.count || 1)}</td>
              <td class="weaponNameColumn">${escapeHtml(weapon.name)}</td>
              <td>${escapeHtml(c.Range || "")}</td>
              <td>${escapeHtml(c.A || "")}</td>
              <td>${escapeHtml(c[skillLabel] || "")}</td>
              <td>${escapeHtml(c.S || "")}</td>
              <td>${escapeHtml(c.AP || "")}</td>
              <td>${escapeHtml(c.D || "")}</td>
            </tr>
            ${weapon.keywords ? `<tr class="weaponKeywordRow"><td colspan="8">${renderSheetWeaponKeywords(weapon.keywords)}</td></tr>` : ""}
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSheetWeaponKeywords(value) {
  return `<div class="weaponKeywordChips">${splitKeywordList(value).map(keyword => `<span>${escapeHtml(keyword)}</span>`).join("")}</div>`;
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
  try {
    if (window.AndroidFiles?.saveText) {
      window.AndroidFiles.saveText(String(fileName || "roster.txt"), String(contents || ""));
      return;
    }
  } catch {
    // Fall through to browser downloads.
  }
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
