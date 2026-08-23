"use strict";

(() => {
  const STORAGE_KEY = "arcadienPlayModeSessionsV1";
  const RESULT_KEY = "arcadienPlayModeResultsV1";
  const TOMBSTONE_KEY = "arcadienPlayModeResultTombstonesV1";
  const PHASES = ["Command", "Movement", "Shooting", "Charge", "Fight"];
  const PLAYERS = ["you", "opponent"];
  const CARD_ROOT = "assets/11th/secondary-missions/defender/";
  const TERRAIN_LAYOUTS = window.ArcadienTerrainLayouts?.layouts || [];
  const FACTIONS = [
    ["Adepta Sororitas", "adepta-sororitas.svg"], ["Adeptus Custodes", "adeptus-custodes.svg"], ["Adeptus Mechanicus", "adeptus-mechanicus.svg"],
    ["Aeldari", "aeldari.svg"], ["Agents of the Imperium", "agents-of-the-imperium.svg"], ["Astra Militarum", "astra-militarum.svg"],
    ["Black Templars", "black-templars.svg"], ["Blood Angels", "blood-angels.svg"], ["Chaos Daemons", "chaos-daemons.svg"],
    ["Chaos Knights", "chaos-knights.svg"], ["Chaos Space Marines", "chaos-space-marines.svg"], ["Dark Angels", "dark-angels.svg"],
    ["Death Guard", "death-guard.svg"], ["Deathwatch", "deathwatch.svg"], ["Drukhari", "drukhari.svg"],
    ["Emperor's Children", "emperors-children.svg"], ["Genestealer Cults", "genestealer-cults.svg"], ["Grey Knights", "grey-knights.svg"],
    ["Imperial Fists", "imperial-fists.svg"], ["Imperial Knights", "imperial-knights.svg"], ["Iron Hands", "iron-hands.svg"],
    ["Leagues of Votann", "leagues-of-votann.svg"], ["Necrons", "necrons.svg"], ["Orks", "orks.svg"],
    ["Raven Guard", "raven-guard.svg"], ["Salamanders", "salamanders.svg"], ["Space Marines", "space-marines.svg"],
    ["Space Wolves", "space-wolves.svg"], ["T'au Empire", "tau-empire.svg"], ["Thousand Sons", "thousand-sons.svg"],
    ["Tyranids", "tyranids.svg"], ["Ultramarines", "ultramarines.svg"], ["White Scars", "white-scars.svg"], ["World Eaters", "world-eaters.svg"]
  ].map(([label, icon]) => ({ label, icon }));
  const CARDS = [
    card("a-grievous-blow", "A Grievous Blow", [5], [4]),
    card("a-tempting-target", "A Tempting Target", [5]),
    card("assassination", "Assassination", [5], [3, 4]),
    card("beacon", "Beacon", [3, 5]),
    card("behind-enemy-lines", "Behind Enemy Lines", [3, 5]),
    card("bring-it-down", "Bring it Down", [5], [4]),
    card("burden-of-trust", "Burden of Trust", [2, 4, 5]),
    card("centre-ground", "Centre Ground", [3, 5]),
    card("cleanse", "Cleanse", [2, 5]),
    card("defend-stronghold", "Defend Stronghold", [3, 5]),
    card("display-of-might", "Display of Might", [2, 5]),
    card("engage-on-all-fronts", "Engage on All Fronts", [3, 5], [2, 4]),
    card("forward-position", "Forward Position", [5]),
    card("no-prisoners", "No Prisoners", [2, 4, 5]),
    card("outflank", "Outflank", [3, 5]),
    card("overwhelming-force", "Overwhelming Force", [3, 5]),
    card("plunder", "Plunder", [5]),
    card("secure-no-man-s-land", "Secure No Man's Land", [5])
  ];
  const PRIMARY_SCORE_HOTSPOTS = {
    "death-trap": [[.238,2],[.329,3],[.495,3],[.683,4]],
    "delaying-action": [[.238,2],[.422,4],[.593,3]],
    "locate-and-deny": [[.311,4],[.400,4],[.600,4],[.748,5]],
    "outmanoeuvre": [[.238,10],[.408,4],[.580,5],[.750,6]],
    "smoke-and-mirrors": [[.238,2],[.329,2],[.505,4],[.637,10]],
    "extract-relic": [[.238,4],[.311,3],[.400,4],[.600,4],[.748,5]],
    "sabotage": [[.238,3],[.329,2],[.505,4]],
    "secure-asset": [[.238,4],[.315,2],[.503,4],[.577,4]],
    "vanguard-operation": [[.238,4],[.311,2],[.496,4],[.629,10]],
    "vital-link": [[.238,2],[.329,1],[.505,4],[.597,4],[.720,10]],
    "consecrate": [[.369,3],[.466,6],[.641,4],[.715,4],[.838,5]],
    "destroyer-s-wrath": [[.238,3],[.422,4],[.496,6],[.667,4]],
    "meatgrinder": [[.238,3],[.422,4],[.593,5],[.667,5]],
    "punishment": [[.350,5],[.534,4],[.608,5],[.741,8]],
    "unstoppable-force": [[.238,3],[.422,4],[.597,3],[.734,5]],
    "gather-intel": [[.238,6],[.422,4],[.593,7],[.726,5],[.800,5]],
    "reconnaissance-sweep": [[.241,3],[.346,6],[.520,1],[.705,3]],
    "search-and-scour": [[.238,3],[.311,2],[.496,4],[.629,5]],
    "surveil-the-foe": [[.326,4],[.527,4],[.600,4],[.771,5]],
    "triangulation": [[.251,4],[.422,3],[.519,6],[.616,10],[.748,10]],
    "battlefield-dominance": [[.238,2],[.422,3],[.514,2]],
    "determined-acquisition": [[.241,2],[.430,3],[.522,3]],
    "immovable-object": [[.238,3],[.408,5],[.580,5]],
    "inescapable-dominion": [[.238,4],[.422,5],[.496,4],[.629,5]],
    "purge-and-secure": [[.241,3],[.346,3],[.534,4],[.709,3]]
  };
  const cardById = new Map(CARDS.map(item => [item.id, item]));
  const shell = document.getElementById("playModeShell");
  const content = document.getElementById("playModeContent");
  const modal = document.getElementById("playModeModal");
  const title = document.getElementById("playModeRosterName");
  const nav = document.getElementById("playModeNav");
  const undoButton = document.getElementById("playModeUndo");
  const MAX_UNDO_ACTIONS = 5;
  const UNDO_FIELDS = ["round", "turn", "phase", "cp", "cpAwarded", "cpHistory", "ledger", "stratagemUses", "abilityUses", "battleShockedGroups", "decks", "modelState", "notes"];
  let session = null;
  let currentView = "battle";
  let missionPlayer = "you";
  let selectedGroupId = null;
  let previousVisibility = null;
  let openedFromHistory = false;

  const FIXED_CARDS = CARDS.filter(item => item.fixedScores.length);

  function card(id, title, tacticalScores, fixedScores = []) {
    return { id, title, scores: tacticalScores, tacticalScores, fixedScores, image: `${CARD_ROOT}${id}.png` };
  }

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function sessions() {
    return readStore(STORAGE_KEY, {});
  }

  function hasActive(rosterId) {
    return sessions()[rosterId]?.status === "active";
  }

  function hasResult(rosterId) {
    return readStore(RESULT_KEY, []).some(item => item.rosterId === rosterId);
  }

  function resultId(result, index = 0) {
    return result.resultId || [result.endedAt, result.startedAt, result.rosterId, index].filter(Boolean).join(":");
  }

  function listResults() {
    return readStore(RESULT_KEY, [])
      .filter(item => item?.status === "final")
      .map((item, index) => ({ ...structuredClone(item), resultId: resultId(item, index) }))
      .sort((left, right) => String(right.endedAt || "").localeCompare(String(left.endedAt || "")));
  }

  function openResult(id) {
    const result = listResults().find(item => item.resultId === id);
    if (!result) return;
    previousVisibility = {
      start: document.getElementById("startScreen")?.hidden,
      builder: document.getElementById("builderShell")?.hidden
    };
    openedFromHistory = true;
    session = result;
    normalizeSession();
    currentView = "ledger";
    openFinalScorecard();
  }

  async function deleteResult(id) {
    const results = readStore(RESULT_KEY, []);
    const index = results.findIndex((item, itemIndex) => resultId(item, itemIndex) === id);
    if (index < 0) return false;
    const game = await prepareGameRecord(results[index]);
    const next = results.filter((_item, itemIndex) => itemIndex !== index);
    if (next.length === results.length) return false;
    writeStore(RESULT_KEY, next);
    const tombstones = readStore(TOMBSTONE_KEY, []);
    const filtered = tombstones.filter(item => item?.resultId !== game.resultId);
    filtered.push({ resultId: game.resultId, gameHash: game.gameHash, deletedAt: new Date().toISOString() });
    writeStore(TOMBSTONE_KEY, filtered);
    return true;
  }

  async function exportSyncState() {
    const games = [];
    for (const value of readStore(RESULT_KEY, [])) games.push(await prepareGameRecord(value));
    const tombstones = readStore(TOMBSTONE_KEY, []).filter(validTombstone);
    const deletedIds = new Set(tombstones.map(item => item.resultId));
    const activeGames = games.filter(item => !deletedIds.has(item.resultId));
    writeStore(RESULT_KEY, activeGames);
    writeStore(TOMBSTONE_KEY, tombstones);
    return { games: structuredClone(activeGames), tombstones: structuredClone(tombstones) };
  }

  async function importSyncState(value = {}) {
    const games = [];
    for (const item of Array.isArray(value.games) ? value.games : []) {
      const prepared = await prepareGameRecord(item, true);
      games.push(prepared);
    }
    const tombstones = (Array.isArray(value.tombstones) ? value.tombstones : []).filter(validTombstone);
    const deletedIds = new Set(tombstones.map(item => item.resultId));
    writeStore(RESULT_KEY, games.filter(item => !deletedIds.has(item.resultId)));
    writeStore(TOMBSTONE_KEY, tombstones);
  }

  function validTombstone(value) {
    return value && typeof value.gameHash === "string" && value.resultId === `game-${value.gameHash}` && Number.isFinite(Date.parse(value.deletedAt || ""));
  }

  function openLatestResult(rosterId) {
    const result = listResults().find(item => item.rosterId === rosterId);
    if (!result) return;
    openStoredResult(result);
  }

  function openStoredResult(result) {
    previousVisibility = {
      start: document.getElementById("startScreen")?.hidden,
      builder: document.getElementById("builderShell")?.hidden
    };
    openedFromHistory = false;
    hideApp();
    session = result;
    normalizeSession();
    currentView = "ledger";
    showShell();
    openFinalScorecard();
  }

  function open(rosterId, rosterDocument) {
    const saved = sessions()[rosterId];
    previousVisibility = {
      start: document.getElementById("startScreen")?.hidden,
      builder: document.getElementById("builderShell")?.hidden
    };
    openedFromHistory = false;
    hideApp();
    if (saved?.status === "active") {
      session = saved;
      normalizeSession();
      persist();
      showShell();
      return;
    }
    openSetup(rosterId, rosterDocument);
  }

  function hideApp() {
    const start = document.getElementById("startScreen");
    const builder = document.getElementById("builderShell");
    if (start) start.hidden = true;
    if (builder) builder.hidden = true;
  }

  function showShell() {
    shell.hidden = false;
    document.body.classList.add("playModeActive");
    title.textContent = session.roster?.name || "Match";
    render();
  }

  function close() {
    closeModal();
    shell.hidden = true;
    document.body.classList.remove("playModeActive");
    const start = document.getElementById("startScreen");
    const builder = document.getElementById("builderShell");
    if (start) start.hidden = previousVisibility?.start ?? false;
    if (builder) builder.hidden = previousVisibility?.builder ?? true;
    session = null;
    openedFromHistory = false;
    document.dispatchEvent(new CustomEvent("arcadien-playmode-close"));
  }

  function openSetup(rosterId, roster) {
    const dispositions = roster.forceDispositions || [];
    const ownDefault = roster.missionSetup?.forceDisposition?.id || roster.detachment?.forceDisposition?.id || dispositions[0]?.id || "";
    const opponentDefault = roster.missionSetup?.opponentForceDisposition?.id || dispositions.find(item => item.id !== ownDefault)?.id || ownDefault;
    modal.hidden = false;
    modal.innerHTML = `
      <form class="playSetupPanel">
        <span class="playModeEyebrow">NEW GAME</span>
        <h2>Select Dispositions</h2>
        <p>Your list is copied and locked for this game.</p>
        <div class="playSetupGrid">
          <label class="playSetupYou">Your player name<input name="yourName" value="${escapeHtml(localStorage.getItem("arcadienPlayerName") || "You")}" required></label>
          <label class="playSetupOpponent">Opponent player name<input name="opponentName" value="Opponent" required></label>
          <label class="playSetupYou">Your faction<select name="yourFaction">${factionOptions(roster.subfaction || roster.faction)}</select></label>
          <label class="playSetupOpponent">Opponent faction<select name="opponentFaction">${factionOptions("")}</select></label>
          <label class="playSetupYou">Your disposition<select name="yourDisposition">${dispositionOptions(dispositions, ownDefault)}</select></label>
          <label class="playSetupOpponent">Opponent disposition<select name="opponentDisposition">${dispositionOptions(dispositions, opponentDefault)}</select></label>
          <label class="playSetupYou">Your secondaries<select name="yourMissionMode"><option value="tactical">Tactical</option><option value="fixed">Fixed</option></select></label>
          <label class="playSetupOpponent">Opponent secondaries<select name="opponentMissionMode"><option value="tactical">Tactical</option><option value="fixed">Fixed</option></select></label>
          <fieldset class="playFixedSetup" data-fixed-setup="you" hidden><legend>Your Fixed missions</legend><label>Mission 1<select name="yourFixedOne">${fixedMissionOptions(0)}</select></label><label>Mission 2<select name="yourFixedTwo">${fixedMissionOptions(1)}</select></label></fieldset>
          <fieldset class="playFixedSetup" data-fixed-setup="opponent" hidden><legend>Opponent Fixed missions</legend><label>Mission 1<select name="opponentFixedOne">${fixedMissionOptions(0)}</select></label><label>Mission 2<select name="opponentFixedTwo">${fixedMissionOptions(1)}</select></label></fieldset>
          <label class="playSetupFirst">First turn<select name="firstTurn"><option value="you">Your turn</option><option value="opponent">Opponent's turn</option></select></label>
        </div>
        <div id="playSetupMissions" class="playSetupMissions"></div>
        <div class="playModalActions"><button type="button" data-close>Cancel</button><button class="playPrimaryButton" type="submit">Start Game</button></div>
      </form>`;
    const form = modal.querySelector("form");
    const updatePreview = () => renderSetupMissions(form, roster);
    form.yourDisposition.onchange = updatePreview;
    form.opponentDisposition.onchange = updatePreview;
    const updateMissionMode = () => {
      modal.querySelector('[data-fixed-setup="you"]').hidden = form.yourMissionMode.value !== "fixed";
      modal.querySelector('[data-fixed-setup="opponent"]').hidden = form.opponentMissionMode.value !== "fixed";
    };
    form.yourMissionMode.onchange = updateMissionMode;
    form.opponentMissionMode.onchange = updateMissionMode;
    modal.querySelector("[data-close]").onclick = close;
    form.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(form);
      if (data.get("yourMissionMode") === "fixed" && data.get("yourFixedOne") === data.get("yourFixedTwo")) return alert("Choose two different Fixed missions for yourself.");
      if (data.get("opponentMissionMode") === "fixed" && data.get("opponentFixedOne") === data.get("opponentFixedTwo")) return alert("Choose two different Fixed missions for your opponent.");
      localStorage.setItem("arcadienPlayerName", String(data.get("yourName")));
      currentView = "battle";
      session = createSession(rosterId, roster, Object.fromEntries(data));
      const ownMission = missionFor(roster, session.setup.yourDispositionId, session.setup.opponentDispositionId);
      const opponentMission = missionFor(roster, session.setup.opponentDispositionId, session.setup.yourDispositionId);
      session.setup.yourPrimary = ownMission;
      session.setup.opponentPrimary = opponentMission;
      openLayoutPicker(rosterId, roster);
    };
    updatePreview();
    updateMissionMode();
  }

  function dispositionOptions(items, selected) {
    return items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  }

  function fixedMissionOptions(selectedIndex) {
    return FIXED_CARDS.map((item, index) => `<option value="${item.id}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(item.title)}</option>`).join("");
  }

  function factionOptions(selected) {
    const selectedFaction = factionRecord(selected);
    return `<option value="">Unknown faction</option>${FACTIONS.map(item => `<option value="${escapeHtml(item.label)}" ${item === selectedFaction ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}`;
  }

  function renderSetupMissions(form, roster) {
    const own = missionFor(roster, form.yourDisposition.value, form.opponentDisposition.value);
    const opponent = missionFor(roster, form.opponentDisposition.value, form.yourDisposition.value);
    const target = modal.querySelector("#playSetupMissions");
    target.innerHTML = `
      <div><small>Your primary</small><b>${escapeHtml(own?.name || "Unavailable")}</b></div>
      <div><small>Opponent primary</small><b>${escapeHtml(opponent?.name || "Unavailable")}</b></div>`;
  }

  function missionFor(roster, dispositionId, opponentId) {
    const dispositions = roster.forceDispositions || [];
    const disposition = dispositions.find(item => item.id === dispositionId);
    const opponent = dispositions.find(item => item.id === opponentId);
    if (!disposition || !opponent) return null;
    return (disposition.missionMap || []).find(item => normalize(item.opponentDisposition) === normalize(opponent.name)) || null;
  }

  function terrainOptionsForSession() {
    const yourDisposition = normalize(session?.setup?.yourDispositionName);
    const opponentDisposition = normalize(session?.setup?.opponentDispositionName);
    return TERRAIN_LAYOUTS.filter(item => {
      const red = normalize(item.redDisposition?.name);
      const blue = normalize(item.blueDisposition?.name);
      return (red === yourDisposition && blue === opponentDisposition)
        || (red === opponentDisposition && blue === yourDisposition);
    }).sort((left, right) => left.option.localeCompare(right.option));
  }

  function terrainPlayerSides(layout) {
    const yourDisposition = normalize(session.setup.yourDispositionName);
    const redDisposition = normalize(layout.redDisposition?.name);
    const sameDisposition = redDisposition === normalize(layout.blueDisposition?.name);
    return {
      you: sameDisposition || redDisposition === yourDisposition ? "red" : "blue",
      opponent: sameDisposition || redDisposition === yourDisposition ? "blue" : "red"
    };
  }

  function bindDoubleTap(target, handler) {
    let previousTap = null;
    target.addEventListener("pointerup", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const currentTap = { time: Date.now(), x: event.clientX, y: event.clientY };
      const isDoubleTap = previousTap
        && currentTap.time - previousTap.time < 350
        && Math.hypot(currentTap.x - previousTap.x, currentTap.y - previousTap.y) < 36;
      previousTap = isDoubleTap ? null : currentTap;
      if (!isDoubleTap) return;
      event.preventDefault();
      handler(event);
    });
  }

  function openLayoutFullscreen(layout, picker) {
    const viewer = picker.querySelector("[data-layout-fullscreen]");
    viewer.innerHTML = `
      <div class="playLayoutFullscreenBar">
        <strong>Layout ${escapeHtml(layout.option)}</strong>
        <span>Double-tap the map to shrink</span>
        <button type="button" data-layout-fullscreen-close aria-label="Close full-screen layout">Close</button>
      </div>
      <img src="${escapeHtml(layout.image)}" alt="Full-screen battlefield layout ${escapeHtml(layout.option)}" data-layout-fullscreen-image>`;
    viewer.hidden = false;
    const closeFullscreen = () => {
      viewer.hidden = true;
      viewer.innerHTML = "";
    };
    viewer.querySelector("[data-layout-fullscreen-close]").onclick = closeFullscreen;
    viewer.onclick = event => { if (event.target === viewer) closeFullscreen(); };
    bindDoubleTap(viewer.querySelector("[data-layout-fullscreen-image]"), closeFullscreen);
    viewer.querySelector("[data-layout-fullscreen-close]").focus();
  }

  function openLayoutPicker(rosterId, roster) {
    const options = terrainOptionsForSession();
    const matchup = `${session.setup.yourDispositionName} × ${session.setup.opponentDispositionName}`;
    if (options.length !== 3) {
      modal.innerHTML = `<div class="playScorePanel"><span class="playModeEyebrow">BATTLEFIELD LAYOUT</span><h2>Layouts unavailable</h2><p>No complete A/B/C layout set was found for ${escapeHtml(matchup)}.</p><div class="playModalActions"><button type="button" data-layout-back>Back to setup</button><button type="button" data-layout-cancel>Cancel</button></div></div>`;
      modal.querySelector("[data-layout-back]").onclick = () => { session = null; openSetup(rosterId, roster); };
      modal.querySelector("[data-layout-cancel]").onclick = close;
      return;
    }
    const sides = terrainPlayerSides(options[0]);
    modal.innerHTML = `
      <form class="playLayoutPanel">
        <header class="playLayoutHeader">
          <div><span class="playModeEyebrow">BATTLEFIELD LAYOUT</span><h2>Choose Layout A, B, or C</h2><p>${escapeHtml(matchup)}</p></div>
          <div class="playLayoutPlayerSides"><b>${escapeHtml(session.setup.yourName)}: ${sides.you} side</b><span>${escapeHtml(session.setup.opponentName)}: ${sides.opponent} side</span></div>
        </header>
        <div class="playLayoutDispositionKey">
          <span class="red"><b>Red · ${escapeHtml(options[0].redDisposition.name)}</b><small>${escapeHtml(options[0].redDisposition.mission)}</small></span>
          <span class="blue"><b>Blue · ${escapeHtml(options[0].blueDisposition.name)}</b><small>${escapeHtml(options[0].blueDisposition.mission)}</small></span>
        </div>
        <div class="playLayoutChoices">
          ${options.map(item => `<button type="button" class="playLayoutChoice" data-layout-id="${escapeHtml(item.id)}" aria-pressed="false"><strong>Layout ${escapeHtml(item.option)}</strong><img src="${escapeHtml(item.image)}" alt="${escapeHtml(matchup)} layout ${escapeHtml(item.option)}"></button>`).join("")}
        </div>
        <p class="playLayoutZoomHint">Double-tap any map to view it full screen.</p>
        <div class="playModalActions"><button type="button" data-layout-back>Back to setup</button><button class="playPrimaryButton" type="submit" data-confirm-layout disabled>Enter Game</button></div>
        <div class="playLayoutFullscreen" data-layout-fullscreen hidden role="dialog" aria-modal="true" aria-label="Full-screen battlefield layout"></div>
      </form>`;
    const form = modal.querySelector("form");
    let selectedId = "";
    for (const button of modal.querySelectorAll("[data-layout-id]")) button.onclick = () => {
      selectedId = button.dataset.layoutId;
      for (const choice of modal.querySelectorAll("[data-layout-id]")) {
        const selected = choice.dataset.layoutId === selectedId;
        choice.classList.toggle("selected", selected);
        choice.setAttribute("aria-pressed", String(selected));
      }
      modal.querySelector("[data-confirm-layout]").disabled = false;
    };
    for (const image of modal.querySelectorAll("[data-layout-id] img")) {
      const layout = options.find(item => item.id === image.closest("[data-layout-id]").dataset.layoutId);
      bindDoubleTap(image, () => openLayoutFullscreen(layout, form));
    }
    modal.querySelector("[data-layout-back]").onclick = () => { session = null; openSetup(rosterId, roster); };
    form.onsubmit = event => {
      event.preventDefault();
      const selected = options.find(item => item.id === selectedId);
      if (!selected) return;
      const selectedSides = terrainPlayerSides(selected);
      session.setup.terrainLayout = {
        id: selected.id,
        option: selected.option,
        image: selected.image,
        sourcePage: selected.sourcePage,
        redDisposition: structuredClone(selected.redDisposition),
        blueDisposition: structuredClone(selected.blueDisposition),
        yourSide: selectedSides.you,
        opponentSide: selectedSides.opponent
      };
      persist();
      closeModal();
      showShell();
    };
  }

  function createSession(rosterId, roster, setup) {
    const yourDisposition = (roster.forceDispositions || []).find(item => item.id === setup.yourDisposition);
    const opponentDisposition = (roster.forceDispositions || []).find(item => item.id === setup.opponentDisposition);
    const state = {
      schemaVersion: 5,
      rosterId,
      status: "active",
      startedAt: new Date().toISOString(),
      roster: structuredClone(roster),
      setup: {
        yourName: setup.yourName || "You",
        opponentName: setup.opponentName || "Opponent",
        yourFaction: setup.yourFaction || factionLabel(roster.subfaction || roster.faction),
        opponentFaction: setup.opponentFaction || "",
        yourDispositionId: yourDisposition?.id || "",
        yourDispositionName: yourDisposition?.name || "",
        opponentDispositionId: opponentDisposition?.id || "",
        opponentDispositionName: opponentDisposition?.name || "",
        missionMode: {
          you: setup.yourMissionMode === "fixed" ? "fixed" : "tactical",
          opponent: setup.opponentMissionMode === "fixed" ? "fixed" : "tactical"
        }
      },
      round: 1,
      turn: setup.firstTurn === "opponent" ? "opponent" : "you",
      phase: "Command",
      cp: { you: 1, opponent: 1 },
      cpAwarded: [`1:${setup.firstTurn === "opponent" ? "opponent" : "you"}`],
      cpHistory: PLAYERS.map(player => ({ id: uid(), round: 1, turn: setup.firstTurn === "opponent" ? "opponent" : "you", player, amount: 1, reason: "Starting CP" })),
      ledger: [],
      stratagemUses: [],
      abilityUses: [],
      battleShockedGroups: {},
      decks: {
        you: createDeck(setup.yourMissionMode, [setup.yourFixedOne, setup.yourFixedTwo]),
        opponent: createDeck(setup.opponentMissionMode, [setup.opponentFixedOne, setup.opponentFixedTwo])
      },
      modelState: createModelState(roster),
      undoHistory: [],
      notes: ""
    };
    return state;
  }

  function createDeck(mode = "tactical", fixedIds = []) {
    if (mode === "fixed") {
      const hand = fixedIds.filter((id, index, values) => FIXED_CARDS.some(item => item.id === id) && values.indexOf(id) === index).slice(0, 2);
      return { mode: "fixed", draw: [], hand, discard: [] };
    }
    return { mode: "tactical", draw: shuffle(CARDS.map(item => item.id)), hand: [], discard: [] };
  }

  function createModelState(roster) {
    const output = {};
    for (const entry of roster.rosterEntries || []) {
      for (const model of trackingModels(entry)) {
        const wounds = modelWounds(entry, model);
        for (let index = 0; index < Number(model.count || 0); index += 1) {
          output[`${entry.instanceId}:${model.id}:${index}`] = wounds;
        }
      }
    }
    return output;
  }

  function trackingModels(entry) {
    const explicit = (entry.models || []).filter(model => Number(model.count || 0) > 0);
    if (explicit.length) return explicit;
    const count = Math.max(1, Number(entry.unitSize?.current || 1) || 1);
    const profile = entry.configured?.units?.[0] || null;
    const equipment = (entry.configured?.weapons || []).map(weapon => String(weapon.name || "")).filter(Boolean);
    return [{ id: "implicit-model", name: entry.name || profile?.name || "Model", count, equipment }];
  }

  function modelWounds(entry, model = null) {
    const profiles = entry.configured?.units || [];
    const modelName = normalize(model?.name);
    const unitProfile = modelName ? [...profiles].sort((a, b) => profileMatchScore(b, modelName) - profileMatchScore(a, modelName))[0] : profiles[0] || null;
    const chars = unitProfile?.characteristics || {};
    return Math.max(1, Number(chars.W || chars.Wounds || chars.wounds || 1) || 1);
  }

  function profileMatchScore(profile, modelName) {
    const profileName = normalize(profile?.name);
    if (!profileName || !modelName) return 0;
    if (profileName === modelName) return 1000 + profileName.length;
    if (modelName.includes(profileName) || profileName.includes(modelName)) return 100 + Math.min(profileName.length, modelName.length);
    return profileName.split(" ").filter(word => modelName.includes(word)).join("").length;
  }

  function normalizeSession() {
    const previousSchema = Number(session.schemaVersion || 1);
    session.ledger ||= [];
    session.cp ||= { you: 0, opponent: 0 };
    session.cpAwarded ||= [];
    session.cpHistory ||= [];
    session.setup.yourFaction ||= factionLabel(session.roster.subfaction || session.roster.faction);
    session.setup.opponentFaction ||= "";
    session.decks ||= { you: createDeck(), opponent: createDeck() };
    session.stratagemUses ||= [];
    session.abilityUses ||= [];
    session.battleShockedGroups ||= {};
    session.undoHistory = Array.isArray(session.undoHistory) ? session.undoHistory : [];
    session.setup.missionMode ||= { you: session.decks.you?.mode || "tactical", opponent: session.decks.opponent?.mode || "tactical" };
    for (const player of PLAYERS) {
      session.decks[player] ||= createDeck();
      session.decks[player].mode ||= session.setup.missionMode[player] || "tactical";
      session.setup.missionMode[player] = session.decks[player].mode;
    }
    session.modelState ||= createModelState(session.roster);
    const untouchedLegacyOpening = session.status === "active"
      && previousSchema < 2
      && session.round === 1
      && session.phase === "Command"
      && session.ledger.length === 0
      && session.cpHistory.length === 0
      && Number(session.cp.you || 0) === 0
      && Number(session.cp.opponent || 0) === 0;
    if (untouchedLegacyOpening) {
      session.cp = { you: 1, opponent: 1 };
      const openingTurn = session.turn === "opponent" ? "opponent" : "you";
      const openingKey = `1:${openingTurn}`;
      if (!session.cpAwarded.includes(openingKey)) session.cpAwarded.push(openingKey);
      session.cpHistory = PLAYERS.map(player => ({ id: uid(), round: 1, turn: openingTurn, player, amount: 1, reason: "Starting CP" }));
    }
    pruneUndoHistory();
    session.schemaVersion = 5;
  }

  function undoStateSnapshot() {
    return Object.fromEntries(UNDO_FIELDS.map(field => [field, structuredClone(session[field])]));
  }

  function pruneUndoHistory() {
    if (!session) return;
    const round = Number(session.round || 1);
    session.undoHistory = (Array.isArray(session.undoHistory) ? session.undoHistory : [])
      .filter(item => item && Number(item.round) === round && item.state && typeof item.state === "object")
      .slice(-MAX_UNDO_ACTIONS);
  }

  function recordUndo(label) {
    if (!session || session.status !== "active") return;
    pruneUndoHistory();
    session.undoHistory.push({ id: uid(), round: session.round, label, state: undoStateSnapshot() });
    session.undoHistory = session.undoHistory.slice(-MAX_UNDO_ACTIONS);
  }

  function undoLastAction() {
    if (!session || session.status !== "active") return;
    pruneUndoHistory();
    const entry = session.undoHistory.pop();
    if (!entry) return;
    const remaining = session.undoHistory;
    for (const field of UNDO_FIELDS) session[field] = structuredClone(entry.state[field]);
    session.undoHistory = remaining;
    persist();
    closeModal();
    render();
  }

  function persist() {
    if (!session) return;
    pruneUndoHistory();
    const all = sessions();
    all[session.rosterId] = session;
    writeStore(STORAGE_KEY, all);
  }

  function render() {
    if (!session) return;
    const endButton = document.getElementById("playModeEnd");
    if (endButton) endButton.textContent = session.status === "final" ? "Scorecard" : "End Game";
    pruneUndoHistory();
    if (undoButton) {
      const latest = session.undoHistory[session.undoHistory.length - 1];
      undoButton.disabled = session.status !== "active" || !latest;
      undoButton.textContent = "Undo";
      undoButton.title = latest ? `Undo: ${latest.label}` : "No actions to undo in this round";
    }
    for (const button of nav.querySelectorAll("button")) button.classList.toggle("active", button.dataset.playView === currentView);
    content.classList.toggle("playOpponentHand", currentView === "missions" && missionPlayer === "opponent");
    if (currentView === "battle") renderBattle();
    if (currentView === "missions") renderMissions();
    if (currentView === "army") renderArmy();
    if (currentView === "ledger") renderLedger();
  }

  function renderBattle() {
    const yourVp = totalVp("you");
    const opponentVp = totalVp("opponent");
    content.innerHTML = `
      <section class="playBattleHero">
        <div class="playRoundControl"><small>BATTLE ROUND</small><select data-state="round">${[1,2,3,4,5].map(n => `<option ${n === session.round ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="playPhaseTitle"><span>${session.turn === "you" ? "YOUR TURN" : `${escapeHtml(session.setup.opponentName.toUpperCase())}'S TURN`}</span><strong>${escapeHtml(session.phase)} Phase</strong></div>
        <button class="playNextButton" type="button" data-next>Next ›</button>
      </section>
      <div class="playStateSelectors">
        <label>Turn<select data-state="turn"><option value="you" ${session.turn === "you" ? "selected" : ""}>Your turn</option><option value="opponent" ${session.turn === "opponent" ? "selected" : ""}>Opponent's turn</option></select></label>
        <label>Phase<select data-state="phase">${PHASES.map(value => `<option ${value === session.phase ? "selected" : ""}>${value}</option>`).join("")}</select></label>
      </div>
      ${renderBattleShockReminder()}
      <section class="playScoreboard">
        ${playerScore("you", yourVp)}
        <div class="playScoreDivider">${yourVp === opponentVp ? "TIED" : yourVp > opponentVp ? "LEADING" : "TRAILING"}</div>
        ${playerScore("opponent", opponentVp)}
      </section>
      <section class="playRoundCaps">
        ${roundCapCard("you")}
        ${roundCapCard("opponent")}
      </section>
      <section class="playPrimaryStrip">
        ${primaryCard("you")}
        ${primaryCard("opponent")}
      </section>
      ${renderTerrainLayoutShortcut()}
      <button class="playScoreShortcut" type="button" data-open-missions>Open secondary hands</button>`;
    bindBattle();
  }

  function playerScore(player, vp) {
    const name = player === "you" ? session.setup.yourName : session.setup.opponentName;
    return `<div class="playPlayerScore ${player}"><small>${escapeHtml(name)}</small><strong>${vp}</strong><span>VP</span><div class="playCpControl"><button data-cp-player="${player}" data-cp-delta="-1">−</button><b>${session.cp[player]} CP</b><button data-cp-player="${player}" data-cp-delta="1">+</button></div></div>`;
  }

  function roundCapCard(player) {
    const primary = roundVp(player, "primary");
    const secondary = roundVp(player, "secondary");
    const name = player === "you" ? session.setup.yourName : session.setup.opponentName;
    return `<div class="playRoundCapPlayer ${player}"><header><b>${escapeHtml(name)}</b><small>ROUND ${session.round}</small></header><span><em style="--fill:${primary / 15}"><b>Primary</b><strong>${primary}/15</strong></em><em style="--fill:${secondary / 15}"><b>Secondary</b><strong>${secondary}/15</strong></em></span></div>`;
  }

  function primaryCard(player) {
    const mission = player === "you" ? session.setup.yourPrimary : session.setup.opponentPrimary;
    return `<article class="playPrimaryMission"><small>${player === "you" ? "YOUR PRIMARY" : "OPPONENT PRIMARY"}</small><b>${escapeHtml(mission?.name || "Primary Mission")}</b><button data-primary-score="${player}">Score</button>${mission?.cardImages?.front ? `<button class="playTextButton" data-view-image="${escapeHtml(mission.cardImages.front)}">View card</button>` : ""}</article>`;
  }

  function renderTerrainLayoutShortcut() {
    const layout = session.setup.terrainLayout;
    if (!layout?.image) return "";
    return `<button class="playTerrainLayoutShortcut" type="button" data-view-layout><span><small>BATTLEFIELD LAYOUT</small><b>Layout ${escapeHtml(layout.option)}</b></span><span>View map ›</span></button>`;
  }

  function bindBattle() {
    content.querySelector("[data-next]").onclick = nextPhase;
    for (const select of content.querySelectorAll("[data-state]")) select.onchange = () => setBattleState(select.dataset.state, select.value);
    for (const button of content.querySelectorAll("[data-cp-player]")) button.onclick = () => changeCp(button.dataset.cpPlayer, Number(button.dataset.cpDelta));
    for (const button of content.querySelectorAll("[data-primary-score]")) button.onclick = () => openPrimaryScoreModal(button.dataset.primaryScore);
    for (const button of content.querySelectorAll("[data-view-image]")) button.onclick = () => openImage(button.dataset.viewImage);
    content.querySelector("[data-view-layout]")?.addEventListener("click", openSelectedTerrainLayout);
    content.querySelector("[data-open-missions]").onclick = () => { currentView = "missions"; render(); };
  }

  function setBattleState(field, value) {
    const nextValue = field === "round" ? Math.max(1, Math.min(5, Number(value))) : value;
    if (session[field] === nextValue) return;
    recordUndo(`Change ${field}`);
    if (field === "round") session.round = nextValue;
    if (field === "turn") session.turn = nextValue;
    if (field === "phase") session.phase = nextValue;
    if (session.phase === "Command") awardCommandCp();
    persist();
    render();
  }

  function nextPhase() {
    recordUndo("Advance phase");
    const index = PHASES.indexOf(session.phase);
    if (index < PHASES.length - 1) session.phase = PHASES[index + 1];
    else {
      session.phase = "Command";
      if (session.turn === "you") session.turn = "opponent";
      else {
        session.turn = "you";
        session.round = Math.min(5, session.round + 1);
      }
      awardCommandCp();
    }
    persist();
    render();
  }

  function awardCommandCp() {
    const key = `${session.round}:${session.turn}`;
    if (session.cpAwarded.includes(key)) return;
    session.cpAwarded.push(key);
    for (const player of PLAYERS) {
      session.cp[player] += 1;
      session.cpHistory.push({ id: uid(), round: session.round, turn: session.turn, player, amount: 1, reason: "Command phase" });
    }
  }

  function changeCp(player, delta) {
    const nextCp = Math.max(0, Number(session.cp[player] || 0) + delta);
    if (nextCp === session.cp[player]) return;
    recordUndo(`${delta > 0 ? "Add" : "Spend"} CP`);
    session.cp[player] = nextCp;
    session.cpHistory.push({ id: uid(), round: session.round, turn: session.turn, player, amount: delta, reason: "Manual adjustment" });
    persist();
    render();
  }

  function renderMissions() {
    const deck = session.decks[missionPlayer];
    const fixed = deck.mode === "fixed";
    content.innerHTML = `
      <div class="playPlayerTabs"><button data-mission-player="you" class="${missionPlayer === "you" ? "active" : ""}">Your hand</button><button data-mission-player="opponent" class="${missionPlayer === "opponent" ? "active" : ""}">${escapeHtml(session.setup.opponentName)}'s hand</button></div>
      <div class="playMissionModeBadge ${fixed ? "fixed" : "tactical"}"><b>${fixed ? "FIXED" : "TACTICAL"} MISSIONS</b><span>${fixed ? "Selected missions remain active after scoring." : "Scored missions are automatically discarded."}</span></div>
      ${fixed ? "" : `<section class="playDeckControls">
        <button class="playDeck" data-draw ${deck.draw.length ? "" : "disabled"}><span>${deck.draw.length}</span><b>Tap to draw</b><small>Random card</small></button>
        <div><button data-select-card>Select a card</button><button data-reshuffle>Reshuffle discards</button><small>${deck.discard.length} discarded</small></div>
      </section>`}
      <section class="playActiveHand">
        <header><div><small>ACTIVE SECONDARIES</small><h2>${deck.hand.length} in hand</h2></div><b>${roundVp(missionPlayer, "secondary")}/15 this round</b></header>
        ${deck.hand.length ? deck.hand.map(id => renderSecondaryCard(missionPlayer, id)).join("") : `<div class="playEmptyHand">${fixed ? "No Fixed missions selected." : "Draw randomly or select a card from a physical hand."}</div>`}
      </section>`;
    for (const button of content.querySelectorAll("[data-mission-player]")) button.onclick = () => { missionPlayer = button.dataset.missionPlayer; render(); };
    if (!fixed) {
      content.querySelector("[data-draw]").onclick = () => drawCard(missionPlayer);
      content.querySelector("[data-select-card]").onclick = () => openCardPicker(missionPlayer);
      content.querySelector("[data-reshuffle]").onclick = () => reshuffle(missionPlayer);
    }
    for (const button of content.querySelectorAll("[data-score-card]")) button.onclick = () => {
      const cardData = cardById.get(button.dataset.scoreCard);
      addScore(missionPlayer, "secondary", cardData.title, Number(button.dataset.scoreValue), { cardId: cardData.id });
    };
    for (const button of content.querySelectorAll("[data-discard-card]")) button.onclick = () => discardCard(missionPlayer, button.dataset.discardCard);
    for (const image of content.querySelectorAll(".playMissionImage")) image.onclick = () => openImage(image.src);
  }

  function renderSecondaryCard(player, id) {
    const item = cardById.get(id);
    if (!item) return "";
    const fixed = session.decks[player].mode === "fixed";
    const scores = fixed ? item.fixedScores : item.tacticalScores;
    return `<article class="playMissionCard ${fixed ? "fixed" : "tactical"}"><img class="playMissionImage" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}"><div><small>${fixed ? "FIXED" : "TACTICAL"} SECONDARY</small><h3>${escapeHtml(item.title)}</h3><div class="playCardScores">${scores.map(score => `<button data-score-card="${item.id}" data-score-value="${score}">+${score} VP</button>`).join("")}</div>${fixed ? `<span class="playFixedActive">Remains active when scored</span>` : `<button class="playDiscardButton" data-discard-card="${item.id}">Discard</button>`}</div></article>`;
  }

  function drawCard(player) {
    const deck = session.decks[player];
    const id = deck.draw[0];
    if (!id) return;
    recordUndo("Draw secondary");
    deck.draw.shift();
    deck.hand.push(id);
    persist(); render();
  }

  function discardCard(player, id) {
    const deck = session.decks[player];
    if (!deck.hand.includes(id)) return;
    recordUndo("Discard secondary");
    deck.hand = deck.hand.filter(item => item !== id);
    if (!deck.discard.includes(id)) deck.discard.push(id);
    persist(); render();
  }

  function reshuffle(player) {
    const deck = session.decks[player];
    if (!deck.discard.length) return;
    recordUndo("Reshuffle secondaries");
    deck.draw.push(...shuffle(deck.discard));
    deck.discard = [];
    persist(); render();
  }

  function openCardPicker(player) {
    const deck = session.decks[player];
    const available = CARDS.filter(item => deck.draw.includes(item.id) || deck.discard.includes(item.id));
    modal.hidden = false;
    modal.innerHTML = `<div class="playPickerPanel"><h2>Select secondary</h2><label>Search<input type="search" data-card-search placeholder="Card name"></label><div class="playCardPickerList">${available.map(item => `<button data-pick-card="${item.id}"><span>${escapeHtml(item.title)}</span><small>${item.scores.join(" / ")} VP</small></button>`).join("")}</div><div class="playModalActions"><button data-close>Cancel</button></div></div>`;
    modal.querySelector("[data-close]").onclick = closeModal;
    modal.querySelector("[data-card-search]").oninput = event => {
      const query = normalize(event.target.value);
      for (const button of modal.querySelectorAll("[data-pick-card]")) button.hidden = !normalize(button.textContent).includes(query);
    };
    for (const button of modal.querySelectorAll("[data-pick-card]")) button.onclick = () => {
      const id = button.dataset.pickCard;
      if (deck.hand.includes(id)) return;
      recordUndo("Select secondary");
      deck.draw = deck.draw.filter(item => item !== id);
      deck.discard = deck.discard.filter(item => item !== id);
      if (!deck.hand.includes(id)) deck.hand.push(id);
      persist(); closeModal(); render();
    };
  }

  function openPrimaryScoreModal(player) {
    const mission = player === "you" ? session.setup.yourPrimary : session.setup.opponentPrimary;
    const source = mission?.name || "Primary Mission";
    const scored = roundVp(player, "primary");
    const remaining = 15 - scored;
    const entries = session.ledger.filter(item => item.player === player && item.round === session.round && item.category === "primary");
    const cardImage = mission?.cardImages?.front || "";
    const cardBack = mission?.cardImages?.back || "";
    const hotspots = PRIMARY_SCORE_HOTSPOTS[primaryScoreKey(source)] || [];
    const hotspotButtons = hotspots.map(([top, value], index) => {
      const optionId = `${primaryScoreKey(source)}-${index}`;
      const count = entries.filter(item => item.scoreOptionId === optionId).length;
      return `<button type="button" class="playPrimaryScoreHotspot ${count ? "scored" : ""}" style="--hotspot-top:${top * 100}%" data-primary-hotspot="${optionId}" data-score-value="${value}" data-base-count="${count}" aria-label="Add ${value} VP to pending score" title="Add ${value} VP" ${remaining <= 0 ? "disabled" : ""}>${count ? `<span class="playPrimaryScoreCount">${count}×</span>` : ""}</button>`;
    }).join("");
    modal.hidden = false;
    modal.innerHTML = `<form class="playScorePanel playPrimaryScorePanel"><header><div><small>PRIMARY · ROUND ${session.round}</small><h2>${escapeHtml(source)}</h2><p>${escapeHtml(player === "you" ? session.setup.yourName : session.setup.opponentName)} · ${scored}/15 VP scored · ${remaining} remaining</p></div></header>${cardImage ? `<p class="playPrimaryScoreHint">Tap printed VP boxes to stage scoring, then confirm below.</p><div class="playPrimaryCardScorer"><img src="${escapeHtml(cardImage)}" alt="${escapeHtml(source)} mission card front">${hotspotButtons}${cardBack ? `<button type="button" class="playPrimaryFlip" data-flip-card>Flip to back</button>` : ""}</div>` : `<div class="playScoreChoices">${[1,2,3,4,5].map((value, index) => `<button type="button" data-primary-hotspot="fallback-${index}" data-score-value="${value}" data-base-count="0" ${remaining <= 0 ? "disabled" : ""}>+${value}<small>VP</small></button>`).join("")}</div>`}<div class="playPrimaryPending" data-primary-pending><b>No pending changes</b><span>Close cancels. Score confirms.</span></div><div class="playPrimaryScoreHistory"><b>This round</b>${entries.length ? entries.map(item => `<span>${escapeHtml(item.source)} <strong>${item.amount > 0 ? "+" : ""}${item.amount} VP</strong></span>`).join("") : `<span>No Primary scored yet.</span>`}</div><div class="playModalActions playPrimaryConfirmActions"><button type="button" data-close>Close</button><button type="submit" class="playPrimaryButton" data-confirm-primary disabled>Score</button></div></form>`;
    const form = modal.querySelector("form");
    const pending = [];
    const refreshPending = () => {
      const requested = pending.reduce((sum, item) => sum + item.value, 0);
      const applied = Math.min(requested, remaining);
      const overflow = Math.max(0, requested - applied);
      for (const button of form.querySelectorAll("[data-primary-hotspot]")) {
        const staged = pending.filter(item => item.optionId === button.dataset.primaryHotspot).length;
        const count = Number(button.dataset.baseCount || 0) + staged;
        button.classList.toggle("pending", staged > 0);
        button.classList.toggle("scored", count > 0);
        button.innerHTML = count ? `<span class="playPrimaryScoreCount">${count}×</span>` : "";
      }
      const pendingPanel = form.querySelector("[data-primary-pending]");
      pendingPanel.innerHTML = pending.length
        ? `<b>${pending.length} card tap${pending.length === 1 ? "" : "s"} pending · ${applied >= 0 ? "+" : ""}${applied} VP</b><span>${overflow ? `${overflow} overflow VP will be discarded. ` : ""}Close still cancels everything.</span>`
        : `<b>No pending changes</b><span>Close cancels. Score confirms.</span>`;
      const confirm = form.querySelector("[data-confirm-primary]");
      confirm.disabled = !pending.length;
      confirm.textContent = applied ? `Score ${applied > 0 ? "+" : ""}${applied} VP` : "Score";
    };
    modal.querySelector("[data-close]").onclick = closeModal;
    for (const button of form.querySelectorAll("[data-primary-hotspot]")) button.onclick = () => {
      pending.push({ optionId: button.dataset.primaryHotspot, value: Number(button.dataset.scoreValue) });
      refreshPending();
    };
    const flip = form.querySelector("[data-flip-card]");
    if (flip) flip.onclick = () => {
      const scorer = form.querySelector(".playPrimaryCardScorer");
      const image = scorer.querySelector("img");
      const showingBack = scorer.classList.toggle("showingBack");
      image.src = showingBack ? cardBack : cardImage;
      image.alt = `${source} mission card ${showingBack ? "back" : "front"}`;
      flip.textContent = showingBack ? "Flip to front" : "Flip to back";
    };
    form.onsubmit = event => {
      event.preventDefault();
      commitPrimaryScoreEdits(player, source, pending);
    };
  }

  function commitPrimaryScoreEdits(player, source, pending) {
    let current = roundVp(player, "primary");
    let appliedTotal = 0;
    let overflow = 0;
    const applicable = pending.some(item => Math.min(item.value, Math.max(0, 15 - current)) > 0);
    if (!applicable) return alert("No Primary score changes can be applied.");
    recordUndo("Score primary");
    for (const item of pending) {
      const amount = Math.min(item.value, Math.max(0, 15 - current));
      overflow += item.value - amount;
      if (!amount) continue;
      session.ledger.push({ id: uid(), player, round: session.round, category: "primary", source, amount, requestedAmount: item.value, scoreOptionId: item.optionId, createdAt: new Date().toISOString() });
      current += amount;
      appliedTotal += amount;
    }
    if (!appliedTotal) return;
    persist(); closeModal(); render();
    showScoreFeedback(player, source, appliedTotal, { overflow });
  }

  function addScore(player, category, source, amount, options = {}) {
    const current = roundVp(player, category);
    if (!amount) return options.reopenPrimary ? openPrimaryScoreModal(player) : closeModal();
    const requestedAmount = amount;
    if (amount > 0) amount = Math.min(amount, Math.max(0, 15 - current));
    if (current + amount < 0) return alert(`${category} scoring cannot fall below 0 VP in a battle round.`);
    if (!amount) return alert(`${category} is already capped at 15 VP this battle round.`);
    recordUndo(`Score ${category}`);
    const overflow = Math.max(0, requestedAmount - amount);
    session.ledger.push({ id: uid(), player, round: session.round, category, source, amount, requestedAmount, scoreOptionId: options.scoreOptionId || "", createdAt: new Date().toISOString() });
    let discarded = false;
    if (category === "secondary" && options.cardId && session.decks[player]?.mode !== "fixed") {
      const deck = session.decks[player];
      deck.hand = deck.hand.filter(id => id !== options.cardId);
      if (!deck.discard.includes(options.cardId)) deck.discard.push(options.cardId);
      discarded = true;
    }
    persist(); closeModal(); render();
    if (options.reopenPrimary) openPrimaryScoreModal(player);
    showScoreFeedback(player, source, amount, { discarded, fixed: category === "secondary" && session.decks[player]?.mode === "fixed", overflow });
  }

  function showScoreFeedback(player, source, amount, options = {}) {
    shell.querySelector(".playScoreToast")?.remove();
    const toast = document.createElement("div");
    toast.className = "playScoreToast";
    toast.setAttribute("role", "status");
    const playerName = player === "you" ? session.setup.yourName : session.setup.opponentName;
    const detail = options.overflow ? `Capped at 15 · ${options.overflow} overflow VP discarded` : options.discarded ? "Scored and discarded" : options.fixed ? "Scored · Fixed mission remains active" : "Score recorded";
    toast.innerHTML = `<span>✓</span><div><strong>${amount > 0 ? "+" : ""}${amount} VP · ${escapeHtml(playerName)}</strong><b>${escapeHtml(source)}</b><small>${detail}</small></div>`;
    shell.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }

  function renderArmy() {
    const groups = playRosterGroups();
    content.innerHTML = `<header class="playSectionHeading"><div><small>LOCKED LOADOUTS</small><h2>Combined Units</h2></div><span>${groups.length} units</span></header><section class="playArmyList">${groups.map(renderArmyGroup).join("")}</section>`;
    for (const button of content.querySelectorAll("[data-group]")) button.onclick = () => openUnit(button.dataset.group);
    for (const button of content.querySelectorAll("[data-summary-model-delta]")) button.onclick = event => {
      event.stopPropagation();
      changeModelWounds(button.dataset.modelId, Number(button.dataset.summaryModelDelta), { groupId: button.dataset.summaryGroup, summary: true });
    };
    for (const button of content.querySelectorAll("[data-summary-model-toggle]")) button.onclick = event => {
      event.stopPropagation();
      toggleModel(button.dataset.summaryModelToggle, Number(button.dataset.maxWounds), { groupId: button.dataset.summaryGroup, summary: true });
    };
    for (const button of content.querySelectorAll("[data-battleshock-toggle]")) button.onclick = event => {
      event.stopPropagation();
      toggleBattleShock(button.dataset.battleshockToggle);
    };
  }

  function renderBattleShockReminder() {
    if (session.turn !== "you" || session.phase !== "Command") return "";
    const affected = playRosterGroups().filter(group => groupStrengthState(group) === "halfStrength");
    if (!affected.length) return "";
    return `<aside class="playBattleShockReminder" role="status"><span aria-hidden="true">!</span><div><small>BATTLE-SHOCK STEP</small><b>${affected.length} ${affected.length === 1 ? "unit is" : "units are"} at or below Half-strength</b><p>${affected.map(group => escapeHtml(group.title)).join(" · ")}</p></div></aside>`;
  }

  function playRosterGroups() {
    const roster = session.roster;
    const entries = roster.rosterEntries || [];
    if (!entries.length) return roster.groupedPresentation || [];
    const byId = new Map(entries.map(entry => [entry.instanceId, entry]));
    const attachments = (roster.armyState?.attachments || []).filter(item => byId.has(item.leaderInstanceId) && byId.has(item.targetInstanceId));
    const presentation = roster.groupedPresentation || [];
    const used = new Set();
    const output = [];
    for (const bodyguard of entries) {
      const leaderIds = attachments.filter(item => item.targetInstanceId === bodyguard.instanceId).map(item => item.leaderInstanceId);
      if (!leaderIds.length) continue;
      const memberIds = [bodyguard.instanceId, ...leaderIds];
      const members = memberIds.map(id => byId.get(id)).filter(Boolean);
      const savedGroup = presentation.find(group => sameMemberSet(group.memberInstanceIds || group.members?.map(item => item.instanceId) || [], memberIds));
      output.push({
        id: savedGroup?.id || `attached:${bodyguard.instanceId}`,
        kind: "attached",
        title: savedGroup?.title || [bodyguard.name, ...members.slice(1).map(item => item.name)].filter(Boolean).join(" + "),
        totalPoints: members.reduce((total, item) => total + Number(item.points || 0), 0),
        memberInstanceIds: memberIds,
        members
      });
      memberIds.forEach(id => used.add(id));
    }
    for (const entry of entries) {
      if (used.has(entry.instanceId)) continue;
      const savedGroup = presentation.find(group => (group.memberInstanceIds || []).length === 1 && (group.memberInstanceIds || [])[0] === entry.instanceId);
      output.push({
        id: savedGroup?.id || `unit:${entry.instanceId}`,
        kind: "unit",
        title: savedGroup?.title || entry.name,
        totalPoints: Number(entry.points || 0),
        memberInstanceIds: [entry.instanceId],
        members: [entry]
      });
      used.add(entry.instanceId);
    }
    return output;
  }

  function sameMemberSet(left, right) {
    if (left.length !== right.length) return false;
    const expected = new Set(right);
    return left.every(id => expected.has(id));
  }

  function renderArmyGroup(group) {
    const models = groupModels(group);
    const alive = models.filter(item => item.current > 0).length;
    const strengthState = groupStrengthState(group, models);
    const battleShocked = isGroupBattleShocked(group.id);
    const profiles = groupDefenseProfiles(group);
    const showProfileNames = profiles.length > 1;
    const stats = profiles.length
      ? profiles.map(profile => `<span class="playArmyStatProfile">${showProfileNames ? `<i>${escapeHtml(profile.name)}</i>` : ""}<span class="playArmyStats"><span><small>M</small><b>${escapeHtml(profile.move)}</b></span><span><small>T</small><b>${escapeHtml(profile.toughness)}</b></span><span><small>SV</small><b>${escapeHtml(profile.save)}</b></span><span><small>OC</small><b>${escapeHtml(profile.objectiveControl)}</b></span><span><small>INV</small><b>${escapeHtml(profile.invulnerable)}</b></span></span></span>`).join("")
      : `<span class="playArmyStats"><span><small>M</small><b>–</b></span><span><small>T</small><b>–</b></span><span><small>SV</small><b>–</b></span><span><small>OC</small><b>–</b></span><span><small>INV</small><b>–</b></span></span>`;
    const editableModel = models.length === 1 && models[0].max > 1 ? models[0] : null;
    const quickWounds = editableModel ? `<div class="playArmyQuickWounds" aria-label="Edit ${escapeHtml(editableModel.name)} wounds"><button type="button" data-summary-model-delta="-1" data-model-id="${escapeHtml(editableModel.id)}" data-summary-group="${escapeHtml(group.id)}" aria-label="Remove one wound">−</button><button type="button" class="playWoundValue" data-summary-model-toggle="${escapeHtml(editableModel.id)}" data-summary-group="${escapeHtml(group.id)}" data-max-wounds="${editableModel.max}" aria-label="Toggle between zero and full wounds">${editableModel.current}<small>/${editableModel.max} W</small></button><button type="button" data-summary-model-delta="1" data-model-id="${escapeHtml(editableModel.id)}" data-summary-group="${escapeHtml(group.id)}" aria-label="Restore one wound">+</button></div>` : "";
    const strengthFlag = strengthState === "halfStrength" ? `<span class="playStrengthFlag">AT OR BELOW HALF STRENGTH</span>` : "";
    const statusBar = strengthState === "destroyed" ? "" : `<div class="playArmyStatusBar"><button type="button" class="playBattleShockToggle ${battleShocked ? "active" : ""}" data-battleshock-toggle="${escapeHtml(group.id)}" aria-pressed="${battleShocked}" aria-label="${battleShocked ? "Clear Battleshocked" : "Mark Battleshocked"}"><span aria-hidden="true">ϟ</span>${battleShocked ? `<b>BATTLESHOCKED</b>` : ""}</button>${quickWounds}</div>`;
    return `<article class="playArmyUnit ${strengthState} ${battleShocked ? "battleShocked" : ""}"><button type="button" class="playArmyUnitOpen" data-group="${escapeHtml(group.id)}"><span class="playArmyIdentity"><small>${group.kind === "attached" ? "COMBINED UNIT" : "UNIT"}</small><b>${escapeHtml(group.title)}</b><em>${models.length ? `${alive}/${models.length} models` : "Profile ready"}</em>${strengthFlag}</span><span class="playArmyReference">${stats}<span class="playArmyWounds"><small>W</small><b>${escapeHtml(groupWoundSummary(group, models))}</b></span></span><strong class="playArmyPoints">${group.totalPoints || 0}<small>PTS</small></strong></button>${statusBar}</article>`;
  }

  function isGroupBattleShocked(groupId) {
    return session.battleShockedGroups?.[groupId] === true;
  }

  function toggleBattleShock(groupId) {
    const group = playRosterGroups().find(item => item.id === groupId);
    if (!group || groupStrengthState(group) === "destroyed") return;
    recordUndo(`${isGroupBattleShocked(groupId) ? "Clear" : "Mark"} Battle-shock`);
    session.battleShockedGroups ||= {};
    if (isGroupBattleShocked(groupId)) delete session.battleShockedGroups[groupId];
    else session.battleShockedGroups[groupId] = true;
    persist();
    renderArmy();
  }

  function groupStrengthState(group, models = groupModels(group)) {
    return strengthStateForModels(models);
  }

  function strengthStateForModels(models) {
    if (!models.length) return "normal";
    const alive = models.filter(model => model.current > 0);
    if (!alive.length) return "destroyed";
    if (models.length === 1) return models[0].current <= Math.floor(models[0].max / 2) ? "halfStrength" : "normal";
    return alive.length <= Math.floor(models.length / 2) ? "halfStrength" : "normal";
  }

  function groupDefenseProfiles(group) {
    const output = [];
    for (const member of group.members || []) {
      for (const profile of member.configured?.units || []) {
        const chars = profile.characteristics || {};
        const record = {
          name: profile.name || member.name || group.title,
          move: unitStat(chars, ["M", "Move", "Movement"]),
          toughness: unitStat(chars, ["T", "Toughness"]),
          save: unitStat(chars, ["SV", "Save"]),
          wounds: unitStat(chars, ["W", "Wounds"]),
          leadership: unitStat(chars, ["LD", "Leadership"]),
          objectiveControl: unitStat(chars, ["OC", "Objective Control", "Objective control"]),
          invulnerable: unitStat(chars, ["InSv", "Invulnerable Save", "Invulnerable save", "Invulnerable"])
        };
        const signature = [record.move, record.toughness, record.save, record.wounds, record.leadership, record.objectiveControl, record.invulnerable].join("|");
        if (!output.some(item => item.signature === signature)) output.push({ ...record, signature });
      }
    }
    return output;
  }

  function unitStat(characteristics, keys) {
    for (const key of keys) {
      const exact = characteristics[key];
      if (exact !== undefined && exact !== null && String(exact).trim()) return String(exact).trim();
      const matchedKey = Object.keys(characteristics).find(candidate => normalize(candidate) === normalize(key));
      const matched = matchedKey ? characteristics[matchedKey] : null;
      if (matched !== undefined && matched !== null && String(matched).trim()) return String(matched).trim();
    }
    return "–";
  }

  function groupWoundSummary(group, models = groupModels(group)) {
    if (models.length === 1) return models[0].max > 1 ? `${models[0].current}/${models[0].max}` : "1";
    const types = [];
    for (const member of group.members || []) {
      for (const profile of member.configured?.units || []) {
        const name = profile.name || member.name || "Model";
        const max = unitStat(profile.characteristics || {}, ["W", "Wounds"]);
        if (max === "–") continue;
        if (!types.some(item => normalize(item.name) === normalize(name) && item.max === max)) types.push({ name, max });
      }
    }
    if (!types.length) {
      for (const member of group.members || []) {
        for (const model of trackingModels(member)) {
          const name = model.name || member.name || "Model";
          const max = String(modelWounds(member, model));
          if (!types.some(item => normalize(item.name) === normalize(name) && item.max === max)) types.push({ name, max });
        }
      }
    }
    return types.map(item => `${item.name}: ${item.max}`).join(" · ") || "–";
  }

  function openUnit(groupId) {
    const previousPanel = selectedGroupId === groupId ? modal.querySelector(".playUnitPanel") : null;
    const previousScrollTop = previousPanel?.scrollTop || 0;
    selectedGroupId = groupId;
    const group = playRosterGroups().find(item => item.id === groupId);
    if (!group) return;
    const models = groupModels(group);
    const weapons = group.members.flatMap(member => member.configured?.weapons || []);
    const rangedWeapons = weapons.filter(weapon => !isMeleeWeapon(weapon));
    const meleeWeapons = weapons.filter(isMeleeWeapon);
    const rules = unitRules(group);
    const stratagems = eligibleStratagems(group);
    const battleShocked = isGroupBattleShocked(group.id);
    modal.hidden = false;
    modal.innerHTML = `<div class="playUnitPanel ${battleShocked ? "battleShocked" : ""}"><header><div><small>${group.kind === "attached" ? "COMBINED UNIT · LOADOUT LOCKED" : "LOADOUT LOCKED"}</small><h2>${escapeHtml(group.title)}</h2></div><button data-close>Close</button></header>${battleShocked ? `<aside class="playUnitBattleShockNotice"><span aria-hidden="true">ϟ</span><div><b>BATTLESHOCKED</b><small>This unit cannot be targeted with Stratagems until the condition is cleared.</small></div></aside>` : ""}<section class="playUnitStatlines"><h3>Full statline</h3>${renderUnitStatlines(group)}</section><section class="playModelTracker"><h3>Models & wounds</h3>${models.length ? models.map(renderModel).join("") : `<p>No individual model records are available for this unit.</p>`}</section><section class="playWeapons"><h3>Weapons</h3>${weapons.length ? `${renderWeaponGroup("Ranged Weapons", rangedWeapons, models, "ranged")}${renderWeaponGroup("Melee Weapons", meleeWeapons, models, "melee")}` : `<p>No weapon profiles.</p>`}</section><section class="playUnitRules"><h3>Rules & abilities</h3>${rules.map(item => renderUnitRule(item, group)).join("") || `<p>No rule text is available for this unit.</p>`}</section><section class="playUnitStratagems"><h3>${escapeHtml(session.phase)} phase stratagems</h3>${stratagems.map(item => renderStratagem(item, group)).join("") || `<p>No eligible stratagems for this unit in the current phase and turn.</p>`}</section></div>`;
    modal.querySelector(".playUnitPanel").scrollTop = previousScrollTop;
    modal.querySelector("[data-close]").onclick = closeModal;
    for (const button of modal.querySelectorAll("[data-model-delta]")) button.onclick = () => changeModelWounds(button.dataset.modelId, Number(button.dataset.modelDelta));
    for (const button of modal.querySelectorAll("[data-model-toggle]")) button.onclick = () => toggleModel(button.dataset.modelToggle, Number(button.dataset.maxWounds));
    for (const button of modal.querySelectorAll("[data-use-ability]")) button.onclick = () => useAbility(group, rules.find(item => item.key === button.dataset.useAbility));
    for (const button of modal.querySelectorAll("[data-restore-ability]")) button.onclick = () => restoreAbility(group, rules.find(item => item.key === button.dataset.restoreAbility));
    for (const button of modal.querySelectorAll("[data-use-stratagem]")) button.onclick = () => {
      const item = stratagems.find(candidate => stratagemKey(candidate) === button.dataset.useStratagem);
      if (item) useStratagem(group, item, Number(button.dataset.paidCost));
    };
  }

  function renderUnitStatlines(group) {
    const profiles = groupDefenseProfiles(group);
    if (!profiles.length) return `<p>No model statlines are available for this unit.</p>`;
    return `<div class="playUnitStatlineTable"><div class="playUnitStatlineHeader"><span>Model</span><span>M</span><span>T</span><span>SV</span><span>W</span><span>LD</span><span>OC</span><span>INV</span></div>${profiles.map(profile => `<div class="playUnitStatlineRow"><b>${escapeHtml(profile.name)}</b><span>${escapeHtml(profile.move)}</span><span>${escapeHtml(profile.toughness)}</span><span>${escapeHtml(profile.save)}</span><span>${escapeHtml(profile.wounds)}</span><span>${escapeHtml(profile.leadership)}</span><span>${escapeHtml(profile.objectiveControl)}</span><span>${escapeHtml(profile.invulnerable)}</span></div>`).join("")}</div>`;
  }

  function groupModels(group) {
    const output = [];
    for (const member of group.members || []) {
      for (const model of trackingModels(member)) {
        const max = modelWounds(member, model);
        const count = Number(model.count || 0);
        const equipmentByModel = distributeEquipment(model.equipment || [], count);
        for (let index = 0; index < count; index += 1) {
          const id = `${member.instanceId}:${model.id}:${index}`;
          output.push({ id, name: count > 1 ? `${model.name} ${index + 1}` : model.name, equipment: equipmentByModel[index] || [], max, current: Math.max(0, Math.min(max, Number(session.modelState[id] ?? max))) });
        }
      }
    }
    return output;
  }

  function distributeEquipment(labels, modelCount) {
    const output = Array.from({ length: modelCount }, () => []);
    const records = labels.map(label => {
      const match = String(label).match(/^(\d+)x\s+(.+)$/i);
      return { count: Math.min(modelCount, match ? Number(match[1]) : modelCount), name: match ? match[2] : String(label) };
    }).sort((a, b) => b.count - a.count);
    for (const record of records) {
      if (record.count === modelCount) {
        for (const equipment of output) equipment.push(record.name);
        continue;
      }
      const occupied = output.map((equipment, index) => ({ equipment, index })).sort((a, b) => a.equipment.length - b.equipment.length || b.index - a.index);
      for (const target of occupied.slice(0, record.count)) target.equipment.push(record.name);
    }
    return output;
  }

  function renderModel(model) {
    const dead = model.current <= 0;
    return `<div class="playModel ${dead ? "dead" : ""}"><div><b>${escapeHtml(model.name)}</b><small>${escapeHtml(model.equipment.join(", ") || "Standard loadout")}</small></div>${model.max <= 1 ? `<button data-model-toggle="${escapeHtml(model.id)}" data-max-wounds="1">${dead ? "Restore" : "Alive ✓"}</button>` : `<div class="playWounds"><button data-model-delta="-1" data-model-id="${escapeHtml(model.id)}">−</button><button class="playWoundValue" data-model-toggle="${escapeHtml(model.id)}" data-max-wounds="${model.max}">${model.current}<small>/${model.max} W</small></button><button data-model-delta="1" data-model-id="${escapeHtml(model.id)}">+</button></div>`}</div>`;
  }

  function changeModelWounds(id, delta, options = {}) {
    const groupId = options.groupId || selectedGroupId;
    const group = playRosterGroups().find(item => item.id === groupId);
    if (!group) return;
    const model = groupModels(group).find(item => item.id === id);
    if (!model) return;
    const nextWounds = Math.max(0, Math.min(model.max, model.current + delta));
    if (nextWounds === model.current) return;
    recordUndo(`${delta < 0 ? "Remove" : "Restore"} wound`);
    session.modelState[id] = nextWounds;
    persist();
    if (currentView === "army") renderArmy();
    if (!options.summary) openUnit(groupId);
  }

  function toggleModel(id, max, options = {}) {
    recordUndo("Toggle model wounds");
    session.modelState[id] = Number(session.modelState[id] ?? max) > 0 ? 0 : max;
    persist();
    if (currentView === "army") renderArmy();
    if (!options.summary) openUnit(options.groupId || selectedGroupId);
  }

  function renderWeapon(weapon, models) {
    const name = String(weapon.name || "Weapon");
    const weaponKey = normalize(name.split(/[–—]/)[0]);
    const originalCount = Math.max(1, Number(weapon.count || 1));
    const bearers = models.filter(model => model.equipment.some(label => equipmentMatchesWeapon(label, weaponKey)));
    const livingBearers = bearers.filter(model => model.current > 0).length;
    const displayedCount = bearers.length ? Math.round(originalCount * livingBearers / bearers.length) : originalCount;
    const dead = models.length > 0 && displayedCount <= 0;
    const stats = Object.entries(weapon.characteristics || {}).map(([key, value]) => `<span><small>${escapeHtml(key)}</small><b>${escapeHtml(value)}</b></span>`).join("");
    return `<article class="playWeapon ${dead ? "dead" : ""}"><header><b>${displayedCount}× ${escapeHtml(name)}</b>${displayedCount !== originalCount && !dead ? `<em>${originalCount - displayedCount} LOST</em>` : dead ? `<em>MODEL DESTROYED</em>` : ""}</header><div>${stats}</div></article>`;
  }

  function equipmentMatchesWeapon(label, weaponKey) {
    const equipmentKey = normalize(String(label).split(/[–—]/)[0]);
    return Boolean(equipmentKey && weaponKey && (equipmentKey.includes(weaponKey) || weaponKey.includes(equipmentKey)));
  }

  function unitRules(group) {
    const output = [];
    for (const member of group.members || []) {
      const configured = member.configured || {};
      for (const item of [...(configured.abilities || []), ...(configured.rules || [])]) {
        const name = String(item?.name || (typeof item === "string" ? item : "Rule")).trim();
        const description = ruleDescription(item);
        if (!name || !description) continue;
        const sourceId = String(item?.id || `${normalize(name)}:${normalize(description).slice(0, 48)}`);
        const key = `${member.instanceId}:${sourceId}`;
        if (output.some(existing => existing.key === key)) continue;
        output.push({ key, name, description, memberName: member.name || group.title, tracker: abilityTracker(name, description) });
      }
    }
    return output;
  }

  function ruleDescription(item) {
    if (typeof item === "string") return item.trim();
    const characteristics = item?.characteristics || {};
    return String(item?.description || characteristics.Description || characteristics.description || item?.text || "").trim();
  }

  function abilityTracker(name, description) {
    const text = normalize(`${name} ${description}`);
    if (/once per battle for each|once per game for each/.test(text) || text.includes("ammo runt")) return { max: null, scope: "game", label: "Per token" };
    if (/once per battle round|once per round/.test(text)) return { max: 1, scope: "round", label: "Once per round" };
    if (/once per turn/.test(text)) return { max: 1, scope: "turn", label: "Once per turn" };
    if (/once per phase/.test(text)) return { max: 1, scope: "phase", label: "Once per phase" };
    const times = text.match(/(?:up to )?(one|two|three|four|once|twice|thrice|\d+) times? per (?:battle|game)/);
    if (times) return { max: usageNumber(times[1]), scope: "game", label: `${usageNumber(times[1])}× per battle` };
    if (/twice per (?:battle|game)/.test(text)) return { max: 2, scope: "game", label: "2× per battle" };
    if (/once per (?:battle|game)/.test(text)) return { max: 1, scope: "game", label: "Once per battle" };
    return null;
  }

  function usageNumber(value) {
    return ({ one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4 })[value] || Math.max(1, Number(value) || 1);
  }

  function abilityScopeKey(tracker) {
    if (tracker.scope === "phase") return `${session.round}:${session.turn}:${session.phase}`;
    if (tracker.scope === "turn") return `${session.round}:${session.turn}`;
    if (tracker.scope === "round") return String(session.round);
    return "game";
  }

  function abilityUseCount(group, item) {
    const scopeKey = abilityScopeKey(item.tracker);
    return session.abilityUses.filter(use => use.groupId === group.id && use.abilityKey === item.key && use.scopeKey === scopeKey).length;
  }

  function renderUnitRule(item, group) {
    const tracker = item.tracker;
    const used = tracker ? abilityUseCount(group, item) : 0;
    const exhausted = tracker?.max != null && used >= tracker.max;
    const status = tracker ? `${used}${tracker.max == null ? " used" : `/${tracker.max}`} · ${tracker.label}` : "Always available";
    return `<details class="playUnitRule ${exhausted ? "exhausted" : ""}"><summary><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.memberName)}</small></span><strong>${escapeHtml(status)}</strong></summary><div class="playUnitRuleBody"><p>${formatRuleDescription(item.description)}</p>${tracker ? `<div class="playAbilityActions">${used ? `<button data-restore-ability="${escapeHtml(item.key)}">Restore use</button>` : ""}<button class="playPrimaryButton" data-use-ability="${escapeHtml(item.key)}" ${exhausted ? "disabled" : ""}>${exhausted ? "Fully used ✓" : "Use ability"}</button></div>` : ""}</div></details>`;
  }

  function formatRuleDescription(description) {
    return escapeHtml(String(description || "").replace(/\*\*|\^\^/g, "").trim()).replace(/\n+/g, "<br><br>");
  }

  function useAbility(group, item) {
    if (!item?.tracker) return;
    const used = abilityUseCount(group, item);
    if (item.tracker.max != null && used >= item.tracker.max) return;
    recordUndo(`Use ${item.name}`);
    session.abilityUses.push({ id: uid(), groupId: group.id, unitName: group.title, abilityKey: item.key, abilityName: item.name, scope: item.tracker.scope, scopeKey: abilityScopeKey(item.tracker), round: session.round, turn: session.turn, phase: session.phase, createdAt: new Date().toISOString() });
    persist();
    openUnit(group.id);
    showAbilityFeedback(group, item);
  }

  function restoreAbility(group, item) {
    if (!item?.tracker) return;
    const scopeKey = abilityScopeKey(item.tracker);
    const index = session.abilityUses.findLastIndex(use => use.groupId === group.id && use.abilityKey === item.key && use.scopeKey === scopeKey);
    if (index < 0) return;
    recordUndo(`Restore ${item.name}`);
    session.abilityUses.splice(index, 1);
    persist();
    openUnit(group.id);
  }

  function showAbilityFeedback(group, item) {
    shell.querySelector(".playScoreToast")?.remove();
    const toast = document.createElement("div");
    toast.className = "playScoreToast playAbilityToast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span>✓</span><div><strong>Ability used</strong><b>${escapeHtml(item.name)}</b><small>${escapeHtml(group.title)} · ${escapeHtml(item.tracker.label)}</small></div>`;
    shell.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 220); }, 2600);
  }

  function eligibleStratagems(group) {
    const document = session.roster;
    const army = { coreStratagems: document.coreStratagems || [], detachments: document.detachments || (document.detachment ? [document.detachment] : []) };
    const state = document.armyState || {};
    const entry = {
      keywords: [...new Set((group.members || []).flatMap(item => item.keywords || []))],
      targetUnitNames: (group.members || []).map(item => item.name),
      name: group.title
    };
    const candidates = window.ArmyEngine?.eligibleStratagemsForEntry?.(army, state, entry) || [...army.coreStratagems, ...army.detachments.flatMap(item => item.stratagems || [])];
    return candidates.filter(stratagem => stratagemMatchesWindow(stratagem));
  }

  function stratagemMatchesWindow(stratagem) {
    const phase = normalize(stratagem.phase || stratagem.description);
    const current = normalize(session.phase);
    const phaseMatch = phase.includes("any phase") || phase.includes(current);
    const turn = normalize(stratagem.turn || stratagem.description);
    const turnMatch = !turn.includes("your turn") && !turn.includes("opponent")
      || (session.turn === "you" && turn.includes("your"))
      || (session.turn === "opponent" && turn.includes("opponent"));
    return phaseMatch && turnMatch;
  }

  function renderStratagem(item, group) {
    const cost = stratagemCost(item);
    const discountedCost = Math.max(0, cost - 1);
    const used = stratagemUsedThisPhase(group.id, item);
    const battleShocked = isGroupBattleShocked(group.id);
    const unavailable = session.cp.you < cost;
    const discountUnavailable = session.cp.you < discountedCost;
    const actions = battleShocked
      ? `<div class="playStratagemBlockedFlag"><span aria-hidden="true">ϟ</span> Unavailable while Battleshocked</div>`
      : used
      ? `<div class="playStratagemUsedFlag">Used this phase ✓</div>`
      : `<div class="playStratagemButtons"><button data-use-stratagem="${escapeHtml(stratagemKey(item))}" data-paid-cost="${cost}" ${unavailable ? "disabled" : ""}>${unavailable ? `Need ${cost} CP` : `Use for ${cost} CP`}</button>${cost ? `<button class="playDiscountStratagem" data-use-stratagem="${escapeHtml(stratagemKey(item))}" data-paid-cost="${discountedCost}" ${discountUnavailable ? "disabled" : ""}>${discountUnavailable ? `Need ${discountedCost} CP` : `Use reduced for ${discountedCost} CP`}</button>` : ""}</div>`;
    const actionNote = battleShocked
      ? `<small>Clear Battleshocked on the Army screen to restore Stratagem access.</small>`
      : used
        ? `<small>Applied to ${escapeHtml(group.title)} in this ${escapeHtml(session.phase)} phase.</small>`
        : `<small>You have ${session.cp.you} CP. Reduced use costs 1 CP less than the printed cost.</small>`;
    return `<details class="playStratagem ${used ? "used" : ""} ${battleShocked ? "blocked" : ""}" ${used ? "open" : ""}><summary><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.turn || "Any turn")} · ${escapeHtml(item.phase || session.phase)}</small></span><strong>${cost} CP</strong></summary><div class="playStratagemText">${formatStratagemDescription(item.description)}</div><div class="playStratagemAction">${actions}${actionNote}</div></details>`;
  }

  function formatStratagemDescription(description) {
    const clean = String(description || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim()
      .replace(/\s*\b(WHEN|TARGET|EFFECT):\s*/gi, "\n$1:");
    return clean.split(/\n+/).filter(Boolean).map(part => {
      const match = part.match(/^(WHEN|TARGET|EFFECT):\s*(.*)$/i);
      return match
        ? `<section><b>${escapeHtml(match[1].toUpperCase())}</b><span>${escapeHtml(match[2])}</span></section>`
        : `<section><span>${escapeHtml(part)}</span></section>`;
    }).join("");
  }

  function stratagemKey(item) {
    return String(item.id || `${normalize(item.name)}:${normalize(item.phase)}:${normalize(item.turn)}`);
  }

  function stratagemCost(item) {
    return Math.max(0, Number.parseInt(String(item.cpCost || "0"), 10) || 0);
  }

  function stratagemUsedThisPhase(groupId, item) {
    const key = stratagemKey(item);
    return session.stratagemUses.some(use => use.groupId === groupId && use.stratagemKey === key && use.round === session.round && use.turn === session.turn && use.phase === session.phase);
  }

  function useStratagem(group, item, paidCost = stratagemCost(item)) {
    const printedCost = stratagemCost(item);
    const cost = Math.max(0, Math.min(printedCost, Number.isFinite(paidCost) ? paidCost : printedCost));
    if (isGroupBattleShocked(group.id) || stratagemUsedThisPhase(group.id, item) || session.cp.you < cost) return;
    recordUndo(`Use ${item.name}`);
    session.cp.you -= cost;
    session.stratagemUses.push({ id: uid(), groupId: group.id, unitName: group.title, stratagemKey: stratagemKey(item), stratagemName: item.name, cost, printedCost, discount: printedCost - cost, round: session.round, turn: session.turn, phase: session.phase, createdAt: new Date().toISOString() });
    if (cost) session.cpHistory.push({ id: uid(), round: session.round, turn: session.turn, player: "you", amount: -cost, reason: `${item.name} · ${group.title}${printedCost > cost ? " · discounted" : ""}` });
    persist();
    if (currentView === "army") renderArmy();
    openUnit(group.id);
    showStratagemFeedback(group, item, cost, printedCost);
  }

  function showStratagemFeedback(group, item, cost, printedCost = cost) {
    shell.querySelector(".playScoreToast")?.remove();
    const toast = document.createElement("div");
    toast.className = "playScoreToast playStratagemToast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span>✓</span><div><strong>${cost ? `−${cost} CP` : "FREE"} · ${session.cp.you} remaining</strong><b>${escapeHtml(item.name)}</b><small>Used on ${escapeHtml(group.title)} · ${escapeHtml(session.phase)} phase${printedCost > cost ? ` · ${printedCost - cost} CP discount` : ""}</small></div>`;
    shell.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 220); }, 2600);
  }

  function renderLedger() {
    const isFinal = session.status === "final";
    content.innerHTML = `<header class="playSectionHeading"><div><small>EXACT MATCH SCORE</small><h2>${totalVp("you")} – ${totalVp("opponent")}</h2></div><span>Round ${session.round}</span></header>${[1,2,3,4,5].map(renderRoundLedger).join("")}<div class="playLedgerActions ${isFinal ? "final" : ""}">${isFinal ? "" : `<button data-manual-score>Manual score correction</button>`}<button class="playPrimaryButton" data-finish>${isFinal ? "View Final Scorecard" : "End Game & Scorecard"}</button></div>`;
    for (const button of content.querySelectorAll("[data-undo-score]")) button.onclick = () => undoScore(button.dataset.undoScore);
    const manualScore = content.querySelector("[data-manual-score]");
    if (manualScore) manualScore.onclick = openManualScore;
    content.querySelector("[data-finish]").onclick = isFinal ? openFinalScorecard : confirmEndGame;
  }

  function renderRoundLedger(round) {
    const entries = session.ledger.filter(item => item.round === round);
    const undo = item => session.status === "final" ? "" : `<button data-undo-score="${item.id}" aria-label="Undo score">Undo</button>`;
    return `<section class="playLedgerRound"><header><b>Battle Round ${round}</b><span>${sum(entries.filter(item => item.player === "you"))} – ${sum(entries.filter(item => item.player === "opponent"))}</span></header>${entries.length ? entries.map(item => `<div><span><small>${item.player === "you" ? session.setup.yourName : session.setup.opponentName} · ${item.category}</small>${escapeHtml(item.source)}</span><b>${item.amount > 0 ? "+" : ""}${item.amount}</b>${undo(item)}</div>`).join("") : `<p>No scoring recorded.</p>`}</section>`;
  }

  function undoScore(id) {
    if (!session.ledger.some(item => item.id === id)) return;
    recordUndo("Remove score entry");
    session.ledger = session.ledger.filter(item => item.id !== id);
    persist(); render();
  }

  function openManualScore() {
    modal.hidden = false;
    modal.innerHTML = `<form class="playScorePanel"><small>SCORE CORRECTION</small><h2>Add ledger entry</h2><label>Player<select name="player"><option value="you">${escapeHtml(session.setup.yourName)}</option><option value="opponent">${escapeHtml(session.setup.opponentName)}</option></select></label><label>Category<select name="category"><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label><label>Reason<input name="source" value="Manual correction" required></label><label>VP<input type="number" name="amount" value="1" required></label><div class="playModalActions"><button type="button" data-close>Cancel</button><button class="playPrimaryButton" type="submit">Record</button></div></form>`;
    const form = modal.querySelector("form");
    modal.querySelector("[data-close]").onclick = closeModal;
    form.onsubmit = event => { event.preventDefault(); addScore(form.player.value, form.category.value, form.source.value, Number(form.amount.value)); };
  }

  function confirmEndGame() {
    modal.hidden = false;
    modal.innerHTML = `<div class="playScorePanel"><small>END GAME</small><h2>Final score: ${totalVp("you")}–${totalVp("opponent")}</h2><p>This locks the score ledger and replaces Resume with a saved final scorecard.</p><div class="playModalActions"><button data-close>Keep playing</button><button class="playPrimaryButton" data-confirm-end>End Game</button></div></div>`;
    modal.querySelector("[data-close]").onclick = closeModal;
    modal.querySelector("[data-confirm-end]").onclick = finalizeGame;
  }

  async function finalizeGame() {
    openedFromHistory = false;
    session.status = "final";
    session.endedAt = new Date().toISOString();
    const finalResult = await prepareGameRecord(session);
    session.resultId = finalResult.resultId;
    session.gameHash = finalResult.gameHash;
    const all = sessions();
    delete all[session.rosterId];
    writeStore(STORAGE_KEY, all);
    const results = [];
    for (const item of readStore(RESULT_KEY, [])) results.push(await prepareGameRecord(item));
    results.unshift(finalResult);
    writeStore(RESULT_KEY, results);
    openFinalScorecard();
  }

  async function prepareGameRecord(value, requireIntegrity = false) {
    const compact = compactFinalResult(value);
    const gameHash = await hashGameRecord(compact);
    if (requireIntegrity && (value.gameHash !== gameHash || value.resultId !== `game-${gameHash}`)) throw new Error("A synced game failed its integrity check and was not imported.");
    return { ...compact, resultId: `game-${gameHash}`, gameHash };
  }

  async function hashGameRecord(value) {
    const canonical = compactFinalResult(value);
    delete canonical.resultId;
    delete canonical.gameHash;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function compactFinalResult(value) {
    return {
      schemaVersion: value.schemaVersion,
      resultId: value.resultId,
      rosterId: value.rosterId,
      status: "final",
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      roster: {
        name: value.roster?.name || "Match",
        faction: value.roster?.faction || "",
        subfaction: value.roster?.subfaction || "",
        rosterEntries: []
      },
      setup: structuredClone(value.setup || {}),
      round: value.round,
      turn: value.turn,
      phase: value.phase,
      cp: structuredClone(value.cp || { you: 0, opponent: 0 }),
      cpAwarded: structuredClone(value.cpAwarded || []),
      cpHistory: structuredClone(value.cpHistory || []),
      ledger: structuredClone(value.ledger || []),
      notes: value.notes || ""
    };
  }

  async function openFinalScorecard() {
    modal.hidden = false;
    modal.innerHTML = `<div class="playScorePanel"><small>FINAL SCORECARD</small><h2>Preparing scorecard…</h2></div>`;
    const canvas = await buildScorecardCanvas();
    modal.innerHTML = `<div class="playFinalPanel"><header><div><small>FINAL SCORECARD</small><h2>${totalVp("you")} – ${totalVp("opponent")}</h2></div><button data-close>Review game</button></header><div class="playScorecardPreview"></div><p class="playGalleryHint" data-gallery-status>Save exports only the scorecard image. On iPhone or iPad, choose Save Image in the share sheet.</p><div class="playModalActions playFinalActions"><button type="button" data-save-gallery>Save to Gallery</button><button class="playPrimaryButton" data-return-lists>${openedFromHistory ? "Return to Games" : "Return to Lists"}</button></div></div>`;
    modal.querySelector(".playScorecardPreview").appendChild(canvas);
    modal.querySelector("[data-close]").onclick = openedFromHistory ? reviewHistoryGame : closeModal;
    modal.querySelector("[data-save-gallery]").onclick = () => saveScorecardToGallery(canvas);
    modal.querySelector("[data-return-lists]").onclick = returnToListsAfterGame;
  }

  function reviewHistoryGame() {
    closeModal();
    hideApp();
    showShell();
  }

  function closeHistoryScorecard() {
    closeModal();
    session = null;
    openedFromHistory = false;
  }

  function isMeleeWeapon(weapon) {
    const range = Object.entries(weapon?.characteristics || {})
      .find(([key]) => normalize(key) === "range")?.[1];
    return normalize(range) === "melee";
  }

  function renderWeaponGroup(title, weapons, models, type) {
    return `<div class="playWeaponGroup ${type}"><h4>${escapeHtml(title)}</h4>${weapons.length ? weapons.map(weapon => renderWeapon(weapon, models)).join("") : `<p>No ${type} weapons.</p>`}</div>`;
  }

  async function saveScorecardToGallery(canvas) {
    const button = modal.querySelector("[data-save-gallery]");
    const status = modal.querySelector("[data-gallery-status]");
    const originalLabel = button?.textContent || "Save to Gallery";
    if (button) { button.disabled = true; button.textContent = "Preparing PNG…"; }
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("The scorecard image could not be created.")), "image/png"));
      const fileName = scorecardFileName();
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        if (status) status.textContent = "Choose Save Image in the share sheet to add this scorecard to Photos.";
        await navigator.share({ files: [file], title: "Arcadien Army Assembler final scorecard" });
        if (status) status.textContent = "Scorecard sent to the iPadOS share sheet.";
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (status) status.textContent = "Scorecard PNG saved to your downloads.";
      }
    } catch (error) {
      if (error?.name !== "AbortError" && status) status.textContent = error?.message || "The scorecard could not be saved.";
    } finally {
      if (button) { button.disabled = false; button.textContent = originalLabel; }
    }
  }

  function scorecardFileName() {
    const date = String(session.endedAt || new Date().toISOString()).slice(0, 10);
    const matchup = `${session.setup.yourName || "Player"}-vs-${session.setup.opponentName || "Opponent"}`.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-");
    return `Arcadien-Scorecard-${date}-${matchup}.png`;
  }

  async function buildScorecardCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    const [yourIcon, opponentIcon] = await Promise.all([
      loadImageAsset(factionIconPath(session.setup.yourFaction || session.roster.faction)),
      loadImageAsset(factionIconPath(session.setup.opponentFaction))
    ]);
    ctx.fillStyle = "#151b21"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const accent = "#e5aa35", white = "#f5f1e8", muted = "#9ca5ad", line = "#313a43";
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 20, canvas.height);
    text(ctx, formatDate(session.endedAt || new Date().toISOString()), 70, 90, 34, muted);
    text(ctx, session.setup.yourName, 70, 175, 48, white, "left", "600");
    text(ctx, session.setup.opponentName, 1010, 175, 48, white, "right", "600");
    const you = totalVp("you"), opponent = totalVp("opponent");
    text(ctx, `${you} – ${opponent}`, 540, 285, 112, white, "center", "700");
    text(ctx, you === opponent ? "DRAW" : you > opponent ? "VICTORY" : "DEFEAT", 540, 350, 36, you >= opponent ? accent : "#ef9a9a", "center", "700");
    text(ctx, session.setup.yourFaction || factionLabel(session.roster.faction), 70, 235, 28, muted);
    text(ctx, session.setup.opponentFaction || "Opponent army", 1010, 235, 28, muted, "right");
    drawFactionBadge(ctx, yourIcon, 70, 265, 110, line);
    drawFactionBadge(ctx, opponentIcon, 900, 265, 110, line);
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, 405); ctx.lineTo(1010, 405); ctx.stroke();
    drawPlayerScorecard(ctx, "you", 70, 475, white, muted, line);
    drawPlayerScorecard(ctx, "opponent", 70, 970, white, muted, line);
    text(ctx, "Arcadien Army Assembler · Chapter Approved Play Mode", 70, 1540, 25, muted);
    return canvas;
  }

  function drawFactionBadge(ctx, image, x, y, size, line) {
    ctx.save();
    ctx.fillStyle = "#202830"; ctx.strokeStyle = line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (image) {
      const inner = size - 28;
      const tint = document.createElement("canvas"); tint.width = inner; tint.height = inner;
      const tintCtx = tint.getContext("2d");
      const scale = Math.min(inner / image.naturalWidth, inner / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      tintCtx.drawImage(image, (inner - width) / 2, (inner - height) / 2, width, height);
      tintCtx.globalCompositeOperation = "source-in"; tintCtx.fillStyle = "#f5f1e8"; tintCtx.fillRect(0, 0, inner, inner);
      ctx.drawImage(tint, x + 14, y + 14);
    }
    ctx.restore();
  }

  function loadImageAsset(src) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }

  function returnToListsAfterGame() {
    closeModal();
    shell.hidden = true;
    document.body.classList.remove("playModeActive");
    const start = document.getElementById("startScreen");
    const builder = document.getElementById("builderShell");
    if (start) start.hidden = false;
    if (builder) builder.hidden = true;
    session = null;
    openedFromHistory = false;
    document.dispatchEvent(new CustomEvent("arcadien-playmode-close"));
  }

  function drawPlayerScorecard(ctx, player, x, y, white, muted, line) {
    const name = player === "you" ? session.setup.yourName : session.setup.opponentName;
    text(ctx, name, x, y, 42, white, "left", "700");
    text(ctx, "R1", 520, y, 24, muted, "center"); text(ctx, "R2", 620, y, 24, muted, "center"); text(ctx, "R3", 720, y, 24, muted, "center"); text(ctx, "R4", 820, y, 24, muted, "center"); text(ctx, "R5", 920, y, 24, muted, "center");
    const rows = [
      ["Primary", "primary"], ["Secondaries", "secondary"], ["Total", "total"], ["CP remaining", "cp"]
    ];
    rows.forEach(([label, type], index) => {
      const rowY = y + 75 + index * 82;
      text(ctx, label, x, rowY, 30, index === 2 ? white : muted, "left", index === 2 ? "700" : "400");
      for (let round = 1; round <= 5; round += 1) {
        let value = type === "total" ? roundVp(player, "primary", round) + roundVp(player, "secondary", round) : type === "cp" ? cpAtRound(player, round) : roundVp(player, type, round);
        text(ctx, String(value), 420 + round * 100, rowY, 30, white, "center", type === "total" ? "700" : "400");
      }
      ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(x, rowY + 30); ctx.lineTo(1010, rowY + 30); ctx.stroke();
    });
    text(ctx, `${totalVp(player)} VP`, 1010, y + 405, 38, white, "right", "700");
  }

  function openSelectedTerrainLayout() {
    const layout = session.setup.terrainLayout;
    if (!layout?.image) return;
    modal.hidden = false;
    modal.innerHTML = `<div class="playTerrainLayoutViewer"><header><div><span class="playModeEyebrow">BATTLEFIELD LAYOUT</span><h2>Layout ${escapeHtml(layout.option)}</h2><p><b class="red">Red · ${escapeHtml(layout.redDisposition?.name || "")}</b> · ${escapeHtml(layout.redDisposition?.mission || "")}</p><p><b class="blue">Blue · ${escapeHtml(layout.blueDisposition?.name || "")}</b> · ${escapeHtml(layout.blueDisposition?.mission || "")}</p></div><button data-close>Close</button></header><img src="${escapeHtml(layout.image)}" alt="Selected battlefield layout ${escapeHtml(layout.option)}"></div>`;
    modal.querySelector("[data-close]").onclick = closeModal;
  }

  function openImage(src) {
    modal.hidden = false;
    modal.innerHTML = `<div class="playImagePanel"><button data-close>Close</button><img src="${escapeHtml(src)}" alt="Mission card"></div>`;
    modal.querySelector("[data-close]").onclick = closeModal;
  }

  function closeModal() {
    modal.hidden = true; modal.innerHTML = "";
  }

  function totalVp(player) { return sum(session.ledger.filter(item => item.player === player)); }
  function roundVp(player, category, round = session.round) { return sum(session.ledger.filter(item => item.player === player && item.round === round && item.category === category)); }
  function sum(items) { return items.reduce((total, item) => total + Number(item.amount || 0), 0); }
  function primaryName(player) { return (player === "you" ? session.setup.yourPrimary : session.setup.opponentPrimary)?.name || "Primary Mission"; }
  function cpAtRound(player, round) { const rows = session.cpHistory.filter(item => item.player === player && item.round <= round); return Math.max(0, rows.reduce((total, item) => total + Number(item.amount || 0), 0)); }
  function normalize(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function primaryScoreKey(value) { return normalize(value).replace(/\s+/g, "-"); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char])); }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function shuffle(items) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
  function factionRecord(value) {
    const key = normalize(value);
    const compact = key.replace(/\s+/g, "");
    if (!key) return null;
    return [...FACTIONS].sort((a, b) => normalize(b.label).length - normalize(a.label).length).find(item => {
      const label = normalize(item.label);
      return key === label || compact === label.replace(/\s+/g, "") || key.endsWith(label);
    }) || null;
  }
  function factionIconPath(value) { return `assets/factions/${factionRecord(value)?.icon || "unknown.svg"}`; }
  function factionLabel(value) { return String(value || "Your army").split(" - ").slice(-1)[0]; }
  function formatDate(value) { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(new Date(value)); }
  function text(ctx, value, x, y, size, color, align = "left", weight = "400") { ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(String(value), x, y); }

  nav?.addEventListener("click", event => {
    const button = event.target.closest("[data-play-view]");
    if (!button) return;
    currentView = button.dataset.playView;
    render();
  });
  document.getElementById("playModeExit")?.addEventListener("click", close);
  undoButton?.addEventListener("click", undoLastAction);
  document.getElementById("playModeEnd")?.addEventListener("click", () => {
    if (session?.status === "final") openFinalScorecard();
    else confirmEndGame();
  });
  modal?.addEventListener("click", event => {
    if (event.target !== modal) return;
    if (modal.querySelector(".playSetupPanel, .playLayoutPanel")) return;
    if (openedFromHistory && shell.hidden) closeHistoryScorecard();
    else closeModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const fullscreenClose = modal?.querySelector("[data-layout-fullscreen-close]");
    if (fullscreenClose) fullscreenClose.click();
  });

  window.ArcadienPlayMode = { open, close, hasActive, hasResult, listResults, openResult, deleteResult, exportSyncState, importSyncState, openLatestResult };
})();
