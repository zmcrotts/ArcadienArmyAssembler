const data = window.ARMY_BUILDER_DATA || {};

const factionSelect = document.getElementById("factionSelect");
const unitList = document.getElementById("unitList");
const rosterList = document.getElementById("rosterList");
const pointsTotal = document.getElementById("pointsTotal");
const details = document.getElementById("details");
const validation = document.getElementById("validation");
const pointsLimitInput = document.getElementById("pointsLimit");

let currentFaction = "";
let roster = [];
let searchText = "";
let categoryFilter = "ALL";
let collapsedCategories = new Set();

const SUPER_CATEGORIES = [
  "ALL",
  "Epic Hero",
  "Character",
  "Battleline",
  "Infantry",
  "Mounted",
  "Swarm",
  "Beast",
  "Monster",
  "Vehicle",
  "Dedicated Transport",
  "Fortification",
  "Aircraft",
  "Allied Units",
  "Reference"
];

function init() {
  addControls();

  const factions = Object.keys(data).sort();

  for (const faction of factions) {
    const option = document.createElement("option");
    option.value = faction;
    option.textContent = faction;
    factionSelect.appendChild(option);
  }

  currentFaction =
    factions.find(f => f.toLowerCase().includes("space marines")) ||
    factions[0];

  factionSelect.value = currentFaction;

  factionSelect.addEventListener("change", () => {
    currentFaction = factionSelect.value;
    roster = [];
    categoryFilter = "ALL";
    collapsedCategories = new Set();
    render();
  });

  pointsLimitInput.addEventListener("input", render);

  render();
}

function addControls() {
  const controls = document.createElement("div");
  controls.className = "controls";
  controls.innerHTML = `
    <p>
      <input id="unitSearch" placeholder="Search units">
      <select id="categoryFilter"></select>
      <button id="saveRoster">Save Roster</button>
      <button id="loadRoster">Load Roster</button>
      <button id="exportJson">Export JSON</button>
      <button id="exportText">Export Text</button>
    </p>
  `;

  document.body.insertBefore(controls, document.querySelector(".layout"));

  document.getElementById("unitSearch").addEventListener("input", e => {
    searchText = e.target.value.toLowerCase();
    renderUnits();
  });

  document.getElementById("categoryFilter").addEventListener("change", e => {
    categoryFilter = e.target.value;
    renderUnits();
  });

  document.getElementById("saveRoster").onclick = saveRoster;
  document.getElementById("loadRoster").onclick = loadRoster;
  document.getElementById("exportJson").onclick = exportRosterJson;
  document.getElementById("exportText").onclick = exportRosterText;
}

function render() {
  renderCategoryFilter();
  renderUnits();
  renderRoster();
  renderTotal();
  renderValidation();
}

function getUnitSuperCategory(unit) {
  if (unit.roles?.epicHero) return "Epic Hero";
  if (unit.roles?.character) return "Character";
  if (unit.roles?.battleline) return "Battleline";
  if (unit.roles?.dedicatedTransport) return "Dedicated Transport";
  if (unit.roles?.fortification) return "Fortification";
  if (unit.roles?.mounted) return "Mounted";
  if (unit.roles?.swarm) return "Swarm";
  if (unit.roles?.monster) return "Monster";
  if (unit.roles?.vehicle) return "Vehicle";
  if (unit.roles?.infantry) return "Infantry";

  const cats = unit.categories || [];

  if (cats.includes("Aircraft")) return "Aircraft";
  if (cats.includes("Beast")) return "Beast";
  if (cats.includes("Allied Units")) return "Allied Units";
  if (cats.includes("Reference")) return "Reference";

  return "Other";
}

function renderCategoryFilter() {
  const select = document.getElementById("categoryFilter");
  const old = categoryFilter;

  select.innerHTML = "";

  for (const cat of SUPER_CATEGORIES) {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  }

  select.value = SUPER_CATEGORIES.includes(old) ? old : "ALL";
  categoryFilter = select.value;
}

function unitMatchesCategory(unit) {
  if (categoryFilter === "ALL") return true;
  return getUnitSuperCategory(unit) === categoryFilter;
}

function renderUnits() {
  unitList.innerHTML = "";

  const units = (data[currentFaction] || []).filter(unit => {
    const matchesSearch = unit.name.toLowerCase().includes(searchText);
    return matchesSearch && unitMatchesCategory(unit);
  });

  const grouped = {};

  for (const unit of units) {
    const cat = getUnitSuperCategory(unit);
    grouped[cat] = grouped[cat] || [];
    grouped[cat].push(unit);
  }

  const orderedCats = SUPER_CATEGORIES.filter(c => c !== "ALL").concat(["Other"]);

  for (const cat of orderedCats) {
    const group = grouped[cat];
    if (!group || group.length === 0) continue;

    const isCollapsed = collapsedCategories.has(cat);

    const header = document.createElement("h3");
    header.className = "categoryHeader";
    header.textContent = `${isCollapsed ? "▶" : "▼"} ${cat} (${group.length})`;

    header.onclick = () => {
      if (collapsedCategories.has(cat)) {
        collapsedCategories.delete(cat);
      } else {
        collapsedCategories.add(cat);
      }
      renderUnits();
    };

    unitList.appendChild(header);

    if (isCollapsed) continue;

    group.sort((a, b) => a.name.localeCompare(b.name));

    for (const unit of group) {
      const div = document.createElement("div");
      div.className = "unit";

      const label = document.createElement("span");
      label.className = unit.isLeader ? "leader" : "";
      label.textContent = `${unit.name} - ${unit.points} pts`;

      const add = document.createElement("button");
      add.textContent = "Add";
      add.onclick = e => {
        e.stopPropagation();
        const entry = createRosterEntry(unit);
        roster.push(entry);
        render();
        showDetails(entry);
      };

      div.onclick = () => showDetails(unit);

      div.appendChild(label);
      div.appendChild(add);
      unitList.appendChild(div);
    }
  }
}

function createRosterEntry(unit) {
  return {
    instanceId: `${unit.id}-${Date.now()}-${Math.random()}`,
    unit,
    selectedSizeIndex: 0
  };
}

function getEntryPoints(entry) {
  const option = entry.unit.sizeOptions?.[entry.selectedSizeIndex];
  return option?.points ?? entry.unit.points ?? 0;
}

function getEntryLabel(entry) {
  const option = entry.unit.sizeOptions?.[entry.selectedSizeIndex];

  if (option && option.source !== "base") {
    return `${entry.unit.name} (${option.label}) - ${getEntryPoints(entry)} pts`;
  }

  return `${entry.unit.name} - ${getEntryPoints(entry)} pts`;
}

function renderRoster() {
  rosterList.innerHTML = "";

  roster.forEach((entry, index) => {
    const div = document.createElement("div");
    div.className = "unit";

    const label = document.createElement("span");
    label.textContent = getEntryLabel(entry);
    div.appendChild(label);

    if (entry.unit.sizeOptions && entry.unit.sizeOptions.length > 1) {
      const select = document.createElement("select");

      entry.unit.sizeOptions.forEach((option, optionIndex) => {
        const opt = document.createElement("option");
        opt.value = optionIndex;
        opt.textContent = `${option.label} - ${option.points} pts`;
        select.appendChild(opt);
      });

      select.value = entry.selectedSizeIndex;

      select.onchange = e => {
        e.stopPropagation();
        entry.selectedSizeIndex = Number(e.target.value);
        render();
        showDetails(entry);
      };

      div.appendChild(select);
    }

    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.onclick = e => {
      e.stopPropagation();
      roster.splice(index, 1);
      render();
    };

    div.onclick = () => showDetails(entry);

    div.appendChild(remove);
    rosterList.appendChild(div);
  });
}

function getTotalPoints() {
  return roster.reduce((sum, entry) => sum + Number(getEntryPoints(entry) || 0), 0);
}

function renderTotal() {
  pointsTotal.textContent = getTotalPoints();
}

function validateRoster() {
  const messages = [];
  const total = getTotalPoints();
  const armyLimit = Number(pointsLimitInput.value || 0);

  messages.push({
    ok: armyLimit <= 0 || total <= armyLimit,
    text: armyLimit > 0 && total > armyLimit
      ? `Points limit exceeded: ${total}/${armyLimit}`
      : `Points OK: ${total}/${armyLimit}`
  });

  const counts = {};

  for (const entry of roster) {
    const unit = entry.unit;
    counts[unit.name] = counts[unit.name] || { unit, count: 0 };
    counts[unit.name].count++;
  }

  for (const entry of Object.values(counts)) {
    const unit = entry.unit;
    const count = entry.count;

    let limit = 3;
    let ruleName = "Rule of 3";

    if (unit.roles?.battleline) {
      limit = 6;
      ruleName = "Battleline limit";
    }

    if (unit.roles?.epicHero) {
      limit = 1;
      ruleName = "Epic Hero limit";
    }

    messages.push({
      ok: count <= limit,
      text: count > limit
        ? `${unit.name}: ${count}/${limit} — ${ruleName} exceeded`
        : `${unit.name}: ${count}/${limit} — ${ruleName}`
    });
  }

  if (roster.length === 0) {
    messages.push({ ok: true, text: "Roster is empty." });
  }

  return messages;
}

function renderValidation() {
  validation.innerHTML = "";

  for (const result of validateRoster()) {
    const div = document.createElement("div");
    div.className = result.ok ? "valid" : "invalid";
    div.textContent = `${result.ok ? "✓" : "✗"} ${result.text}`;
    validation.appendChild(div);
  }
}

function showDetails(input) {
  const entry = input?.unit ? input : null;
  const unit = entry ? entry.unit : input;

  if (!unit) {
    details.innerHTML = "Click a unit.";
    return;
  }

  details.innerHTML = `
    <h3>${escapeHtml(unit.name)} <span class="pts">${entry ? getEntryPoints(entry) : unit.points} pts</span></h3>

    ${renderSelectedSize(entry)}
    ${renderPointOverrideNotes(unit)}
    ${renderStatsTable(unit)}
    ${renderWeaponsTable("Ranged Weapons", unit.displayWeapons, "Ranged Weapons")}
    ${renderWeaponsTable("Melee Weapons", unit.displayWeapons, "Melee Weapons")}
    ${renderAbilities(unit)}
    ${renderRules(unit)}
    ${renderWargear(unit)}
    ${renderLeaderTargets(unit)}

    <h4>Keywords</h4>
    <div class="chips">${(unit.keywords || unit.categories || []).map(k => `<span>${escapeHtml(k)}</span>`).join("")}</div>

    <p><b>Source:</b> ${escapeHtml(unit.sourceFile || "")}</p>
    <p><b>Datasheet:</b> ${escapeHtml(unit.datasheetSourceFile || "Not matched")}</p>
  `;
}

function renderSelectedSize(entry) {
  if (!entry || !entry.unit.sizeOptions || entry.unit.sizeOptions.length <= 1) return "";

  const option = entry.unit.sizeOptions[entry.selectedSizeIndex];

  return `
    <h4>Selected Size</h4>
    <p><b>${escapeHtml(option.label)}</b> — ${option.points} pts</p>
  `;
}

function renderPointOverrideNotes(unit) {
  const override = unit.pointsOverride;
  if (!override) return "";

  const blocks = [];

  if (override.changes?.length) {
    blocks.push(`
      <h4>Point Change Notes</h4>
      <ul>${override.changes.map(c => `<li>${escapeHtml(c.text || c.type || "")}</li>`).join("")}</ul>
    `);
  }

  if (override.copyRules?.length) {
    blocks.push(`
      <h4>Copy Pricing Notes</h4>
      <ul>${override.copyRules.map(c => `<li>${escapeHtml(c.text || c.type || "")}</li>`).join("")}</ul>
    `);
  }

  if (override.wargear?.length) {
    blocks.push(`
      <h4>Wargear Cost Notes</h4>
      <ul>${override.wargear.map(c => `<li>${escapeHtml(c.text || c.type || "")}</li>`).join("")}</ul>
    `);
  }

  return blocks.join("");
}

function renderStatsTable(unit) {
  if (!unit.stats) return `<p><b>No stats found.</b></p>`;

  const s = unit.stats;

  return `
    <h4>Unit</h4>
    <table>
      <thead>
        <tr>
          <th>M</th>
          <th>T</th>
          <th>SV</th>
          <th>W</th>
          <th>LD</th>
          <th>OC</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(s.M ?? "")}</td>
          <td>${escapeHtml(s.T ?? "")}</td>
          <td>${escapeHtml(s.SV ?? "")}</td>
          <td>${escapeHtml(s.W ?? "")}</td>
          <td>${escapeHtml(s.LD ?? "")}</td>
          <td>${escapeHtml(s.OC ?? "")}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderWeaponsTable(title, weapons, type) {
  const rows = (weapons || []).filter(w => w.type === type);
  if (rows.length === 0) return "";

  return `
    <h4>${title}</h4>
    <table>
      <thead>
        <tr>
          <th>Weapon</th>
          <th>Range</th>
          <th>A</th>
          <th>BS</th>
          <th>WS</th>
          <th>S</th>
          <th>AP</th>
          <th>D</th>
          <th>Keywords</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(w => `
          <tr>
            <td>${escapeHtml(w.name ?? "")}</td>
            <td>${escapeHtml(w.range ?? "")}</td>
            <td>${escapeHtml(w.A ?? "")}</td>
            <td>${escapeHtml(w.BS ?? "")}</td>
            <td>${escapeHtml(w.WS ?? "")}</td>
            <td>${escapeHtml(w.S ?? "")}</td>
            <td>${escapeHtml(w.AP ?? "")}</td>
            <td>${escapeHtml(w.D ?? "")}</td>
            <td>${escapeHtml(w.keywords ?? "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAbilities(unit) {
  const abilities = unit.displayAbilities || [];
  if (abilities.length === 0) return "";

  return `
    <h4>Abilities</h4>
    ${abilities.map(a => `
      <div class="card">
        <b>${escapeHtml(a.name)}</b>
        <p>${escapeHtml(a.text || "")}</p>
      </div>
    `).join("")}
  `;
}

function renderRules(unit) {
  const rules = unit.displayRules || [];
  if (rules.length === 0) return "";

  return `
    <h4>Rules</h4>
    <div class="chips">${rules.map(r => `<span>${escapeHtml(r)}</span>`).join("")}</div>
  `;
}

function renderWargear(unit) {
  const weapons = unit.displayWeapons || [];
  if (weapons.length === 0) return "";

  return `
    <h4>Wargear</h4>
    <ul>
      ${weapons.map(w => `<li>${escapeHtml(w.name)}</li>`).join("")}
    </ul>
  `;
}

function renderLeaderTargets(unit) {
  if (!unit.leaderTargets || unit.leaderTargets.length === 0) return "";

  return `
    <h4>Leader Targets</h4>
    <ul>
      ${unit.leaderTargets.map(t => {
        if (typeof t === "string") return `<li>${escapeHtml(t)}</li>`;
        return `<li>${escapeHtml(t.name || t.targetName || t.resolvedName || JSON.stringify(t))}</li>`;
      }).join("")}
    </ul>
  `;
}

function saveRoster() {
  const save = {
    faction: currentFaction,
    pointsLimit: pointsLimitInput.value,
    rosterEntries: roster.map(entry => ({
      unitId: entry.unit.id,
      selectedSizeIndex: entry.selectedSizeIndex
    }))
  };

  localStorage.setItem("uglyArmyBuilderRoster", JSON.stringify(save));
  alert("Roster saved.");
}

function loadRoster() {
  const raw = localStorage.getItem("uglyArmyBuilderRoster");

  if (!raw) {
    alert("No saved roster found.");
    return;
  }

  const save = JSON.parse(raw);
  currentFaction = save.faction;
  factionSelect.value = currentFaction;
  pointsLimitInput.value = save.pointsLimit || 1000;

  const units = data[currentFaction] || [];

  roster = (save.rosterEntries || save.rosterIds || [])
    .map(saved => {
      const unitId = typeof saved === "string" ? saved : saved.unitId;
      const unit = units.find(u => u.id === unitId);
      if (!unit) return null;

      return {
        instanceId: `${unit.id}-${Date.now()}-${Math.random()}`,
        unit,
        selectedSizeIndex: typeof saved === "string" ? 0 : saved.selectedSizeIndex || 0
      };
    })
    .filter(Boolean);

  render();
}

function exportRosterJson() {
  const exportData = {
    faction: currentFaction,
    pointsLimit: Number(pointsLimitInput.value || 0),
    totalPoints: getTotalPoints(),
    units: roster.map(entry => ({
      id: entry.unit.id,
      name: entry.unit.name,
      points: getEntryPoints(entry),
      selectedSize: entry.unit.sizeOptions?.[entry.selectedSizeIndex] || null,
      categories: entry.unit.categories,
      roles: entry.unit.roles,
      sourceFile: entry.unit.sourceFile
    })),
    validation: validateRoster()
  };

  downloadFile("roster.json", JSON.stringify(exportData, null, 2));
}

function exportRosterText() {
  const counts = {};

  for (const entry of roster) {
    const key = getEntryLabel(entry);
    counts[key] = counts[key] || { label: key, count: 0 };
    counts[key].count++;
  }

  const lines = [];
  lines.push(currentFaction);
  lines.push(`${getTotalPoints()} / ${pointsLimitInput.value} pts`);
  lines.push("");

  for (const entry of Object.values(counts).sort((a, b) => a.label.localeCompare(b.label))) {
    lines.push(`${entry.count}x ${entry.label}`);
  }

  lines.push("");
  lines.push("Validation:");
  for (const result of validateRoster()) {
    lines.push(`${result.ok ? "OK" : "ERROR"} - ${result.text}`);
  }

  downloadFile("roster.txt", lines.join("\n"));
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();