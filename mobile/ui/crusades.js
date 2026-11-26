"use strict";

(function installCrusades(global) {
  const M = global.ArcadienCrusadeModel;
  const E = global.ArcadienCrusadeEligibility;
  const W = global.ArcadienCrusadeWeapons;
  const X = global.ArcadienCrusadeBookkeeping;
  const LOCAL_KEY = "arcadienOrdersOfBattleV1";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function formatRules(blocks, fallback = "") {
    const inline = value => esc(value).replace(/\b\d+(?:D\d+)?\s*(?:XP|RP)\b/g, '<strong class="crRuleValue">$&</strong>').replace(/\n/g,"<br>");
    const paragraph = (value,flavour=false) => {
      const label = !flavour && /^([^\n:]{2,65}:)([\s\S]+)$/.exec(value);
      return `<p class="${flavour?"crRuleFlavour":""}">${label?`<b>${inline(label[1])}</b>${inline(label[2])}`:inline(value)}</p>`;
    };
    const render = items => (items || []).map(block=>{
      if(block.type==="heading"){
        const cost=block.cardTitle && /^(.*?)(\d+(?:[–-]\d+)?\s*(?:RP|CP))$/.exec(block.text);
        return `<h4 class="crRuleHeading">${cost?`<span>${inline(cost[1].trim())}</span><span class="crRuleCost">${inline(cost[2])}</span>`:`<span>${inline(block.text)}</span>${block.rolls?.length?`<span class="crRuleCost" aria-label="Table roll: ${esc(block.rolls.join(', '))}">D6 · ${esc(block.rolls.join(' / '))}</span>`:""}`}</h4>`;
      }
      if(block.type==="list")return `<${block.ordered?"ol":"ul"}>${block.items.map(item=>`<li>${inline(item.replace(/^•\s*/,""))}</li>`).join("")}</${block.ordered?"ol":"ul"}>`;
      if(block.type==="table")return `<div class="crRuleTableScroll"><table class="crRuleTable"><tbody>${block.rows.map(row=>`<tr>${row.cells.map(cell=>`<${cell.header?"th":"td"} colspan="${Math.max(1,Math.min(20,Number(cell.colspan)||1))}" rowspan="${Math.max(1,Math.min(30,Number(cell.rowspan)||1))}">${inline(cell.text)}</${cell.header?"th":"td"}>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      if(block.type==="card")return `<article class="crRuleBox">${block.title?`<h4>${inline(block.title)}</h4>`:""}<div class="crRuleBoxBody">${render(block.blocks)}</div></article>`;
      return paragraph(block.text || "",block.flavour);
    }).join("");
    return `<div class="crRuleContent">${blocks?.length?render(blocks):String(fallback).split(/\n{2,}/).filter(Boolean).map(value=>paragraph(value)).join("")}</div>`;
  }
  const icons = {
    unit: '<path d="M7 7h3v10H7zm7 0h3v10h-3zM3 10h2v4H3zm16 0h2v4h-2z"/>',
    honour: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3zm0 2H4v3c0 3 2 5 5 5m7-8h4v3c0 3-2 5-5 5M12 14v6m-4 1h8"/>',
    scar: '<path d="m12 3 10 18H2L12 3zm0 6v5m0 3v1"/>',
    relic: '<path d="m12 2 8 7-8 13L4 9l8-7zM4 9h16M8 9l4 13 4-13"/>',
    star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
    win: '<path d="m5 12 4 4L20 5M4 21h16"/>'
  };
  const icon = (name, label = "") => `<svg viewBox="0 0 24 24" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.unit}</svg>`;
  let library = [], loaded = false, loadError = null, database = null, selectedId = null;
  let context = null, search = "", layout = "list", dialog = null, queue = Promise.resolve();
  let forceTab = "units", trackerUI = null, bookkeepingUI = null;
  function trackerTabs(force) {
    return `<nav class="ctForceTabs" aria-label="Order of Battle tabs"><button data-cr-action="force-units" aria-pressed="${forceTab === "units"}">Units</button><button data-cr-action="force-faction" aria-pressed="${forceTab === "faction"}">${esc(global.ArcadienCrusadeTrackers?.schema(force).name || "Faction progression")}</button></nav>`;
  }

  const ready = (async () => {
    try {
      let stored;
      if (global.indexedDB?.open) {
        try {
          database = await new Promise((resolve, reject) => {
            const request = global.indexedDB.open("arcadien-crusades", 1);
            request.onupgradeneeded = () => request.result.createObjectStore("libraries");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("Close other app tabs and try again."));
          });
        } catch (error) { database?.close(); database = null; }
        if (database) stored = await new Promise((resolve, reject) => {
          const request = database.transaction("libraries", "readonly").objectStore("libraries").get("orders");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Saved Crusades could not be read."));
        });
      }
      if (stored == null) stored = JSON.parse(global.localStorage.getItem(LOCAL_KEY) || "[]");
      if (!Array.isArray(stored)) throw new Error("The saved Crusades library is invalid.");
      const ids = new Set();
      library = stored.map(item => {
        const force = M.validateForce(item);
        if (ids.has(force.id)) throw new Error("The saved Crusades library contains duplicate IDs.");
        ids.add(force.id); return force;
      });
    } catch (error) { loadError = error.message; }
    loaded = true;
  })();

  async function persist(next) {
    if (loadError) throw new Error(`Crusades could not be read, so nothing was overwritten: ${loadError}`);
    const validated = next.map(M.validateForce);
    if (database) await new Promise((resolve, reject) => {
      const tx = database.transaction("libraries", "readwrite");
      tx.objectStore("libraries").put(validated, "orders");
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("The Order of Battle could not be saved."));
    });
    else {
      const value = JSON.stringify(validated);
      global.localStorage.setItem(LOCAL_KEY, value);
      if (global.localStorage.getItem(LOCAL_KEY) !== value) throw new Error("This device did not retain the Order of Battle.");
    }
    library = validated;
  }
  function commit(force) {
    const operation = queue.catch(() => {}).then(() => persist([...library.filter(item => item.id !== force.id), force]));
    queue = operation; return operation;
  }
  const selected = () => library.find(item => item.id === selectedId);
  function radial(unit) {
    const rank = M.rankFor(unit.xp);
    const honours = unit.awards.filter(item => item.kind !== "scar").length;
    const scars = unit.awards.filter(item => item.kind === "scar").length;
    const label = `${rank.name}, ${unit.xp} XP${rank.nextAt ? `, ${rank.nextAt - unit.xp} to ${rank.next}` : ""}, ${honours} honours, ${scars} scars`;
    return `<span class="crRadial" role="img" aria-label="${esc(label)}" style="--cr-rank:${rank.colour};--cr-progress:${Math.round(rank.progress * 360)}deg">
      <span class="crRadialCentre">${icon(unit.roles?.character ? "star" : "unit")}</span>
      ${honours ? `<span class="crOrbit crOrbitHonour">${icon("honour")}</span>` : ""}
      ${scars ? `<span class="crOrbit crOrbitScar">${icon("scar")}</span>` : ""}
      <span class="crOrbit crOrbitRank">${rank.index + 1}</span></span>`;
  }
  const metric = (value, label) => `<div class="crMetric"><strong>${esc(value)}</strong><small>${esc(label)}</small></div>`;
  const rarityLabel = rarity => ({Artificer:"Artificer · any rank",Antiquity:"Antiquity · Heroic+",Legendary:"Legendary · Legendary rank"})[rarity] || "Other relics · check source rank";
  function weaponTable(profiles) {
    if (!profiles.length) return "";
    return `<div class="crWeaponScroll"><table class="crWeaponTable"><thead><tr><th>#</th><th>Weapon</th><th>Range</th><th>A</th><th>BS / WS</th><th>S</th><th>AP</th><th>D</th></tr></thead><tbody>${profiles.map(profile=>{
      const c=profile.characteristics || {};
      return `<tr class="${profile.crusadeModified ? "crModifiedWeapon" : ""}"><td>${profile.count ?? 1}</td><td><b>${esc(profile.name)}</b>${profile.crusadeModified ? `<small class="crWeaponChangeLabel">MODIFIED · ${esc(profile.crusadeChanges.join(" + "))}</small>` : ""}</td>${[c.Range,c.A,c.BS??c.WS,c.S,c.AP,c.D].map(value=>`<td>${esc(value || "-")}</td>`).join("")}</tr>${c.Keywords && c.Keywords !== "-" ? `<tr><td colspan="8" class="crWeaponKeywords">${esc(c.Keywords)}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div>`;
  }
  function awardsForUnit(unit) {
    const catalog = global.ArcadienCrusadeData;
    const labels = {honour:"Battle Honours",scar:"Battle Scars",relic:"Crusade Relics",weapon:"Weapon Modifications"};
    return Object.entries(labels).map(([kind,label])=>{
      const awards=unit.awards.filter(item=>item.kind===kind);
      if(!awards.length)return "";
      const tables=new Map();
      for(const award of awards){
        const metadata=catalog.records.find(item=>item.id===award.id)||award;
        const table=`${metadata.pack || "Custom"} · ${kind==="relic" ? rarityLabel(metadata.rarity)+" · " : ""}${metadata.table || "Custom entries"}`;
        if(!tables.has(table))tables.set(table,[]); tables.get(table).push(award);
      }
      return `<h4>${label}</h4>${[...tables].map(([table,items])=>`<section class="crAwardTableGroup"><h5>${esc(table)}</h5>${items.map(a=>`<details class="crAward ${kind === "scar" ? "scar" : ""}"><summary>${icon(kind === "scar" ? "scar" : kind === "relic" ? "relic" : "honour")} ${esc(a.name)}</summary><p>${esc(a.description)}</p><button data-cr-action="remove-award" data-unit="${esc(unit.id)}" data-award="${esc(a.id)}">Remove from record</button></details>`).join("")}</section>`).join("")}`;
    }).join("");
  }
  function unitDatasheet(unit) {
    const record = unit.record || {}, configured = record.configured || {};
    const profiles = configured.units || [], weapons = W.profiles(unit);
    const abilities = configured.abilities || [], rules = configured.rules || [];
    const models = record.models || [], keywords = unit.keywords || record.keywords || [];
    const columns = ["M", "T", "SV", "W", "LD", "OC", "InSv"];
    const characteristic = (c, key) => c[key] ?? (key === "SV" ? c.Sv : key === "LD" ? c.Ld : key === "InSv" ? c["Invulnerable Save"] : undefined) ?? "–";
    const reference = profile => `<details class="crDatasheetRule"><summary>${esc(profile.name || profile)}</summary>${Object.entries(profile.characteristics || {}).map(([name,value]) => `<p>${name !== "Description" ? `<b>${esc(name)}: </b>` : ""}${esc(value)}</p>`).join("")}${profile.description ? `<p>${esc(profile.description)}</p>` : ""}</details>`;
    const weaponGroups = new Map();
    for (const profile of weapons) {
      const type = profile.typeName || "Weapons";
      if (!weaponGroups.has(type)) weaponGroups.set(type, []);
      weaponGroups.get(type).push(profile);
    }
    return `<details class="crDatasheet" open><summary>Full unit stats &amp; rules</summary>
      ${profiles.length ? `<div class="crWeaponScroll"><table class="crWeaponTable crUnitStats"><caption>Unit profiles</caption><thead><tr><th>Profile</th>${columns.map(key=>`<th>${key}</th>`).join("")}</tr></thead><tbody>${profiles.map(profile=>`<tr><th scope="row">${esc(profile.name)}</th>${columns.map(key=>`<td>${esc(characteristic(profile.characteristics || {},key))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">No unit stat profile is saved. Open Edit unit &amp; equipment and save to refresh this datasheet.</p>`}
      ${models.length ? `<h4>Models &amp; equipment</h4><div class="crDatasheetModels">${models.map(model=>`<p><b>${esc(model.count ?? 1)}× ${esc(model.name)}</b><small>${esc((model.equipment || []).join(", "))}</small></p>`).join("")}</div>` : ""}
      ${[...weaponGroups].map(([type,items])=>`<h4>${esc(type)}</h4>${weaponTable(items)}`).join("")}
      ${abilities.length ? `<h4>Abilities</h4>${abilities.map(reference).join("")}` : ""}
      ${rules.length ? `<h4>Rules</h4>${rules.map(reference).join("")}` : ""}
      ${keywords.length ? `<h4>Keywords</h4><div class="crDatasheetKeywords">${keywords.map(keyword=>`<span>${esc(keyword)}</span>`).join("")}</div>` : ""}
      </details>`;
  }
  function renderLibrary() {
    return `<div class="crSectionHeading"><div><span class="crEyebrow">YOUR FORCES, THEIR HISTORY</span><h1>Crusades</h1><p class="muted">A lasting Order of Battle. Every unit has a story.</p></div><div class="crActions"><button data-cr-action="import">Import backup</button><button data-cr-action="import-list">Import list as OoB</button><button class="primaryAction" data-cr-action="new">+ New Order of Battle</button></div></div>
      ${library.length ? `<div class="crForceGrid">${[...library].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(force => {
        const sum = M.summary(force);
        return `<button class="crForceCard" data-cr-action="open" data-force="${esc(force.id)}"><span class="crEyebrow">${esc(force.faction)}</span><h2>${esc(force.name)}</h2><span class="crForceSub">${force.units.length} units · ${sum.points} / ${force.supplyLimit} pts</span><span class="crSupply ${sum.points > force.supplyLimit ? "over" : ""}"><i style="width:${Math.min(100, sum.points / Math.max(1,force.supplyLimit) * 100)}%"></i></span><span class="crMiniMetrics"><span>${icon("star")} ${sum.xp} XP</span><span>${icon("honour")} ${sum.honours} honours</span><span>${icon("scar")} ${sum.scars} scars</span></span><span class="crForceFooter">${esc(force.packs.join(" · "))}<b>View force →</b></span></button>`;
      }).join("")}</div>` : `<div class="crEmpty">${icon("honour")}<h2>Your story starts here</h2><p>Create an Order of Battle from one of your saved lists, or start with an empty force.</p><p class="muted">Your units keep their names, ranks, honours and scars between games.</p><button class="primaryAction" data-cr-action="new">+ Create your first force</button></div>`}`;
  }
  function unitRow(unit) {
    const rank = M.rankFor(unit.xp);
    return `<details class="crUnit" data-unit="${esc(unit.id)}"><summary>${radial(unit)}<span class="crUnitIdentity"><b>${esc(unit.name)}</b><small>${esc(unit.unitType)} <span>· ${unit.points} pts</span></small><span class="crRankText" style="color:${rank.colour}">${rank.name} <strong>${unit.xp}${rank.nextAt ? ` / ${rank.nextAt}` : ""} XP</strong></span></span><span class="crUnitTallies"><span>${icon("win")} ${unit.wins}<small>victories</small></span><span>${unit.games}<small>games</small></span></span><span class="crAwardCounts">${X?.pending(unit).length?`<span class="crPill honour">${X.pending(unit).length} Honour${X.pending(unit).length===1?"":"s"} unclaimed</span>`:""}${unit.awards.filter(a=>a.kind!=="scar").length ? `<span class="crPill honour">${icon("honour")} ${unit.awards.filter(a=>a.kind!=="scar").length}</span>` : ""}${unit.awards.filter(a=>a.kind==="scar").length ? `<span class="crPill scar">${icon("scar")} ${unit.awards.filter(a=>a.kind==="scar").length}</span>` : ""}</span><span class="crChevron">⌄</span></summary>
      <div class="crUnitBody"><div class="crActions"><button data-cr-action="equipment" data-unit="${esc(unit.id)}">Edit unit &amp; equipment</button><button data-cr-action="edit-unit" data-unit="${esc(unit.id)}">Edit progression</button><button data-cr-action="award" data-unit="${esc(unit.id)}">+ Honour / scar / relic</button></div>
      <div class="crServiceRecord">${metric(unit.games,"Games")}${metric(unit.wins,"Victories")}${metric(unit.survived,"Survived")}${metric(unit.kills,"Units destroyed")}</div>
      ${unitDatasheet(unit)}
      ${trackerUI?.renderUnit(selected(), unit) || ""}
      ${bookkeepingUI?.unit(unit)||""}
      <div class="crUnitRecords"><span class="crEyebrow">CRUSADE RECORD</span>
      ${unit.redemption?.additionalTraitUnclaimed ? `<p class="ctNotice">Glorious Redemption: one additional eligible Battle Trait remains to be chosen. <button data-cr-action="award" data-unit="${esc(unit.id)}">Choose redemption Battle Trait</button></p>` : ""}
      ${unit.deathGuard?.pendingHonours || unit.deathGuard?.pendingScars || unit.deathGuard?.spreadingHonourPending ? `<p class="ctNotice">Death Guard progression: ${unit.deathGuard.pendingHonours || (unit.deathGuard.spreadingHonourPending ? 1 : 0)} Honour(s) and ${unit.deathGuard.pendingScars || 0} Scar(s) remain to be chosen. <button data-cr-action="award" data-unit="${esc(unit.id)}">Choose pending awards</button></p>` : ""}
      ${unit.enhancements.length ? `<h4>Enhancements</h4>${unit.enhancements.map(a=>`<details class="crAward"><summary>${esc(a.name)}</summary><p>${esc(a.description || "Imported enhancement")}</p></details>`).join("")}` : ""}
      ${unit.awards.length ? awardsForUnit(unit) : `<p class="muted">No honours or scars recorded yet.</p>`}
      </div>
      ${(unit.weaponModifications || []).some(item=>!W.baseProfiles(unit).some(profile=>W.key(profile)===item.weaponKey && item.copy<=Number(profile.count??1))) ? `<p class="crWarning">A modified weapon is no longer equipped. Its award remains in the record; no replacement weapon inherits it automatically.</p>` : ""}
      ${unit.notes ? `<p class="crNotes">${esc(unit.notes)}</p>` : ""}
      <details class="crHistory"><summary>Unit history (${unit.history.length})</summary>${unit.history.length ? [...unit.history].reverse().map(event=>`<p><small>${esc(new Date(event.at).toLocaleDateString())}</small> ${esc(event.type === "record" ? `${event.after.xp} XP · ${event.after.games} games · ${event.after.wins} victories` : event.type === "award" ? `Awarded ${event.name}` : `Removed ${event.name}`)}</p>`).join("") : `<p class="muted">New recruit. Games and record changes will appear here.</p>`}</details></div></details>`;
  }
  function renderForce(force) {
    const sum = M.summary(force);
    if (forceTab === "faction" && trackerUI) return `<button class="crBack" data-cr-action="back">← All Crusades</button><section class="crForceHero"><span class="crEyebrow">LOCAL ORDER OF BATTLE · ${esc(force.faction)}</span><div class="crSectionHeading"><h1>${esc(force.name)}</h1><div class="crActions"><button data-cr-action="settings">Force details</button><button data-cr-action="export">Export backup</button></div></div><div class="crMetrics">${metric(sum.points + " / " + force.supplyLimit,"Supply · pts")}${metric(force.requisitionPoints,"Requisition Points")}${metric(force.units.length,"Units")}</div></section>${trackerTabs(force)}${bookkeepingUI?.toolbar(force)||""}${trackerUI.render(force)}`;
    const query = search.trim().toLowerCase();
    const units = force.units.filter(unit => `${unit.name} ${unit.unitType} ${M.rankFor(unit.xp).name}`.toLowerCase().includes(query));
    return `<button class="crBack" data-cr-action="back">← All Crusades</button><section class="crForceHero"><span class="crEyebrow">LOCAL ORDER OF BATTLE · ${esc(force.faction)}</span><div class="crSectionHeading"><div><h1>${esc(force.name)}</h1><p class="muted">${esc(force.packs.join(" · "))}</p></div><div class="crActions"><button data-cr-action="rules">Crusade rules</button><button data-cr-action="settings">Force details</button><button data-cr-action="export">Export backup</button></div></div><div class="crMetrics">${metric(force.units.length,"Units")}${metric(`${sum.points} / ${force.supplyLimit}`,"Supply · pts")}${metric(sum.xp,"Total XP")}${metric(force.requisitionPoints,"Requisition Points")}${metric(sum.honours,"Honours & relics")}${metric(sum.scars,"Battle scars")}</div>${sum.points > force.supplyLimit ? `<p class="crWarning" role="status">Supply limit exceeded by ${sum.points - force.supplyLimit} points.</p>` : ""}</section>
      ${trackerTabs(force)}${bookkeepingUI?.toolbar(force)||""}<div class="crSectionHeading crRosterToolbar"><div><h2>Order of Battle</h2><span class="muted">${force.units.length} persistent unit records</span></div><div class="crActions"><button data-cr-action="add">+ Add units</button><button data-cr-action="game" ${!force.units.length ? "disabled" : ""}>Record game</button><button class="primaryAction" data-cr-action="play" ${!force.units.length ? "disabled" : ""}>${context?.hasActiveBattle?.(force.id) ? "Resume battle" : "Play battle"}</button></div></div>
      <div class="crFilters"><label>Find a unit<input type="search" data-cr-search value="${esc(search)}" placeholder="Name, unit type or rank"></label><div class="segmentedControl"><button data-cr-action="list" aria-pressed="${layout === "list"}" class="${layout === "list" ? "active" : ""}">List</button><button data-cr-action="cards" aria-pressed="${layout === "cards"}" class="${layout === "cards" ? "active" : ""}">Cards</button></div></div>
      <div class="crUnits ${layout === "cards" ? "crCards" : ""}">${units.map(unitRow).join("") || `<div class="crEmpty"><p>${force.units.length ? "No units match your search." : "Add units from the catalogue using the same builder as Lists."}</p><button data-cr-action="add">+ Browse units</button></div>`}</div>
      ${bookkeepingUI?.forceHistory(force)||""}
      ${!bookkeepingUI && (force.retiredUnits || []).length ? `<details class="crBattleHistory"><summary>Retired unit records (${force.retiredUnits.length})</summary>${force.retiredUnits.map(unit=>`<p><b>${esc(unit.name)}</b> · ${esc(unit.unitType)} · ${unit.games} games · ${unit.xp} XP</p>`).join("")}</details>` : ""}
      <p class="crFootnote">Weapon Modifications apply to one weapon each. Other honours, scars and relic effects remain references; review conditions marked for checking.</p>
      ${!bookkeepingUI && (force.battles || []).length ? `<details class="crBattleHistory"><summary>Recorded games (${force.battles.length})</summary>${[...force.battles].reverse().map(game=>`<p><strong>${esc(game.result)}</strong> · ${esc(game.opponent || "Opponent")} · ${esc(game.date)} · ${game.unitIds.length} units</p>`).join("")}</details>` : ""}`;
  }
  function render() {
    if (!loaded) return `<section class="crusades"><p>Loading Orders of Battle…</p></section>`;
    if (loadError) return `<section class="crusades"><p role="alert">Crusades could not be opened: ${esc(loadError)}. Existing data has not been overwritten.</p></section>`;
    return `<section class="crusades">${selected() ? renderForce(selected()) : renderLibrary()}</section>`;
  }
  function refresh() { context?.refresh(); }
  function closeDialog() {
    if (!dialog) return false;
    const previous = dialog.returnFocus; dialog.close(); dialog.remove(); dialog = null;
    previous?.focus?.({preventScroll:true}); return true;
  }
  function modal(title, body, submitLabel, onSubmit) {
    closeDialog();
    const previous = document.activeElement;
    dialog = document.createElement("dialog"); dialog.className = "crDialog";
    dialog.returnFocus = previous;
    dialog.setAttribute("aria-labelledby", "crDialogTitle");
    dialog.innerHTML = `<form><header><span class="crEyebrow">CRUSADES</span><h2 id="crDialogTitle">${esc(title)}</h2></header><div class="crDialogBody">${body}</div><p class="crFormError" role="alert" hidden></p><footer><button type="button" data-cr-cancel>Cancel</button><button type="submit" class="primaryAction">${esc(submitLabel)}</button></footer></form>`;
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
    dialog.querySelector("[data-cr-cancel]").onclick = closeDialog;
    dialog.querySelector("form").onsubmit = async event => {
      event.preventDefault(); const current = dialog;
      const button = current.querySelector('[type="submit"]'); button.disabled = true;
      try { await onSubmit(new FormData(event.target), current); if (dialog === current) closeDialog(); refresh(); }
      catch (error) { const target = current.querySelector(".crFormError"); target.hidden = false; target.textContent = error.message; button.disabled = false; }
    };
    return dialog;
  }
  const field = (name, label, value, type = "text") => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" max="1000000" step="1" required' : ""}></label>`;
  const options = (items, value) => items.map(([id,label])=>`<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(label)}</option>`).join("");
  function startBattle(draft = null) {
    const force = selected();
    if (context.hasActiveBattle(force.id)) return context.openBattle(force.id);
    const current = modal("Muster for battle", `<p>Select the units you are bringing. Their equipment and Crusade upgrades will be copied into this game.</p>${field("pointsLimit","Battle size · pts",draft?.pointsLimit ?? force.supplyLimit,"number")}<fieldset><legend>Participating units</legend>${force.units.map(unit=>`<label class="crCheck"><input type="checkbox" name="unit" value="${esc(unit.id)}" ${!draft || draft.unitIds.includes(unit.id) ? "checked" : ""}><span><b>${esc(unit.name)}</b><small>${esc(unit.unitType)} · ${unit.points} pts · ${M.rankFor(unit.xp).name}</small></span></label>`).join("")}</fieldset><p class="crMusterTotal" role="status"></p>`, "Next: agendas", async data => {
      const unitIds = data.getAll("unit"), pointsLimit = Number(data.get("pointsLimit"));
      M.battleDocument(force, unitIds, [], {pointsLimit});
      chooseBattleAgendas(unitIds, pointsLimit);
    });
    const update = () => {
      const data = new FormData(current.querySelector("form")), ids = new Set(data.getAll("unit"));
      const points = force.units.filter(unit=>ids.has(unit.id)).reduce((sum,unit)=>sum+unit.points,0);
      current.querySelector(".crMusterTotal").textContent = `${ids.size} units · ${points} / ${data.get("pointsLimit")} pts`;
    };
    current.addEventListener("change", update); update();
  }
  function chooseBattleAgendas(unitIds, pointsLimit, chosen = []) {
    const force = selected();
    const pages = [...E.agendaPages(force, unitIds, global.ArcadienCrusadeData),...E.crusadeBooks(force,global.ArcadienCrusadeData,unitIds)];
    const agendas = [...pages.flatMap(page=>page.agendas), ...(force.agendas || [])];
    const grouped = new Map();
    for (const agenda of agendas) { const source = agenda.source || "Custom"; if(!grouped.has(source))grouped.set(source,[]);grouped.get(source).push(agenda); }
    const current = modal("Choose battle agendas", `<div class="crBattleBrief"><div><span class="crEyebrow">02 / BATTLE OBJECTIVES</span><strong>${esc(force.name)}</strong><small>${unitIds.length} units · ${pointsLimit} pt battle</small></div><span class="crSelectionCount" role="status">${chosen.length} selected</span></div>
      <p class="crDialogIntro">Choose what your force will fight for. Review each agenda's conditions and your mission's allowance.</p>
      ${agendas.length ? [...grouped].map(([source,items])=>`<fieldset class="crAgendaGroup"><legend>${esc(source)} <span>${items.length}</span></legend><div class="crAgendaGrid">${items.map(agenda=>`<article class="crAgendaCard"><label class="crAgendaSelect"><input type="checkbox" name="agenda" value="${esc(agenda.id)}" ${chosen.includes(agenda.id)?"checked":""}><span><b>${esc(agenda.name)}</b><small>${agenda.conditional?"Special agenda · check conditions":agenda.edition?`${agenda.edition}th edition · ${agenda.pack ? "Campaign agenda" : "Faction agenda"}`:"Custom agenda"}</small></span>${icon("honour")}</label><details class="crAgendaReference"><summary>Rules &amp; XP <span class="crDisclosureArrow">⌄</span></summary><div class="crAgendaCardBody">${agenda.flavour?`<p class="crRuleFlavour">${esc(agenda.flavour)}</p>`:""}${formatRules(agenda.blocks,agenda.description)}${agenda.sourceUrl?`<a class="crSourceLink" href="${esc(agenda.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source <span>↗</span></a>`:""}</div></details></article>`).join("")}</div></fieldset>`).join("") : `<p class="muted">No imported agenda table matches these units. Add a custom agenda below.</p>`}
      <details class="crCustomAgenda" ${agendas.length ? "" : "open"}><summary>+ Add a custom agenda</summary><div class="crCustomAgendaFields">${field("agendaName","Agenda name","")}<label>Source book / table<input name="agendaSource" placeholder="e.g. Tyrannic War · Agendas"></label><label>Rules / XP conditions<textarea name="agendaRules" rows="5"></textarea></label><button type="button" data-save-agenda>Save agenda &amp; select it</button></div></details>
      <p class="crEditionNote">Faction agendas use 10th-edition rules. Check compatibility with your game.</p><button type="button" class="crTextButton" data-muster-back>← Change participating units</button>`, "Continue to Play Mode", async data => {
      if (String(data.get("agendaName") || "").trim()) throw new Error("Save the new agenda before continuing.");
      const chosenAgendas = agendas.filter(item=>data.getAll("agenda").includes(item.id));
      if (!chosenAgendas.length) throw new Error("Choose at least one agenda for this battle.");
      const document = M.battleDocument(force, unitIds, chosenAgendas, {pointsLimit});
      for (const record of document.rosterEntries) {
        const unit = force.units.find(item=>item.id===record.instanceId);
        record.configured.weapons = W.profiles(unit);
      }
      closeDialog(); refresh(); context.openBattle(force.id, document);
    });
    current.classList.add("crAgendaDialog");
    current.addEventListener("change",()=>{current.querySelector(".crSelectionCount").textContent=`${new FormData(current.querySelector("form")).getAll("agenda").length} selected`;});
    current.querySelector("[data-muster-back]").onclick = () => { closeDialog(); startBattle({unitIds,pointsLimit}); };
    current.querySelector("[data-save-agenda]").onclick = async () => {
      const button = current.querySelector("[data-save-agenda]"); button.disabled = true;
      try {
        const data = new FormData(current.querySelector("form"));
        const name = String(data.get("agendaName") || "").trim(), description = String(data.get("agendaRules") || "").trim();
        if (!name || !description) throw new Error("Give the agenda a name and its rules or XP conditions.");
        const next = M.clone(selected()), agenda = {id:M.uid(),name,description,source:String(data.get("agendaSource") || "Custom").trim() || "Custom"};
        next.agendas = [...(next.agendas || []), agenda]; next.updatedAt = new Date().toISOString();
        await commit(next); chooseBattleAgendas(unitIds, pointsLimit, [...data.getAll("agenda"),agenda.id]); refresh();
      } catch (error) { const target = current.querySelector(".crFormError"); target.hidden=false;target.textContent=error.message; button.disabled=false; }
    };
  }
  function factionCrusadeRules() {
    const force=selected(),data=global.ArcadienCrusadeData;
    const pages=[...E.crusadeBooks(force,data),...E.agendaPages(force,null,data)];
    const entries=[];
    for(const page of pages)for(const section of page.sections){
      let entry=null;
      for(const block of section.blocks || []){
        if(block.type==="heading"&&block.section){entry={title:block.text,faction:page.faction,blocks:[],sourceUrl:section.sourceUrl};entries.push(entry);}
        else {if(!entry){entry={title:section.name,faction:page.faction,blocks:[],sourceUrl:section.sourceUrl};entries.push(entry);}entry.blocks.push(block);}
      }
      if(!section.blocks?.length)entries.push({title:section.name,faction:page.faction,description:section.description,sourceUrl:section.sourceUrl});
    }
    const current=modal("Crusade rules", `<div class="crReader"><aside class="crReaderNav"><span class="crEyebrow">FIELD REFERENCE · 10TH EDITION</span><label class="crReaderSearch">Source book<select data-rule-book>${options([["","All enabled sources"],...pages.map(page=>[page.faction,page.faction])],"")}</select></label><label class="crReaderSearch">Find a rule<input type="search" data-rule-search placeholder="Search rules, agendas, relics…"></label><nav aria-label="Crusade rule sections">${entries.map((entry,index)=>`<button type="button" data-reader-entry="${index}" aria-current="${index===0?"true":"false"}"><span>${esc(entry.title)}</span><small>${esc(entry.faction)}</small><i>›</i></button>`).join("")}</nav><p data-reader-empty hidden>No matching sections.</p></aside><article class="crReaderArticle" data-rule-reader></article></div><details class="crEditionNote"><summary>Edition &amp; available books</summary><p>10th-edition reference. Faction progression and XP are recorded separately.</p><p>${data.localRules?.missing?.length?`Not available offline: ${data.localRules.missing.map(esc).join(" · ")}.`:"Core and enabled Crusade books are available offline. Choose campaign books in Force details."}</p></details>`,"Done",async()=>{});
    current.classList.add("crReferenceDialog");
    current.querySelector('[data-cr-cancel]').hidden=true;
    const show=index=>{
      const entry=entries[index],article=current.querySelector("[data-rule-reader]");
      article.innerHTML=entry?`<header class="crReaderArticleHeader"><span class="crEyebrow">${esc(entry.faction)}</span><h3>${esc(entry.title)}</h3><span class="crEditionBadge">10th edition</span></header>${formatRules(entry.blocks,entry.description)}<a class="crSourceLink" href="${esc(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>`:`<div class="crEmpty"><h3>No faction reference available</h3><p>No Crusade section is included for this force.</p></div>`;
      article.scrollTop=0;
      for(const button of current.querySelectorAll('[data-reader-entry]'))button.setAttribute('aria-current',String(Number(button.dataset.readerEntry)===index));
    };
    current.querySelector(".crReaderNav").onclick=event=>{const button=event.target.closest('[data-reader-entry]');if(button)show(Number(button.dataset.readerEntry));};
    const filter=()=>{
      const query=current.querySelector('[data-rule-search]').value.toLowerCase().trim(),book=current.querySelector('[data-rule-book]').value;let matches=0,firstMatch=null;
      for(const button of current.querySelectorAll('[data-reader-entry]')){const entry=entries[Number(button.dataset.readerEntry)];button.hidden=Boolean(book&&entry.faction!==book)||!`${entry.title} ${entry.faction} ${entry.description||""} ${JSON.stringify(entry.blocks||[])}`.toLowerCase().includes(query);if(!button.hidden){matches++;firstMatch??=Number(button.dataset.readerEntry);}}
      current.querySelector('[data-reader-empty]').hidden=matches>0;
      if(firstMatch!=null)show(firstMatch);
    };
    current.querySelector('[data-rule-search]').oninput=filter;
    current.querySelector('[data-rule-book]').onchange=filter;
    show(0);
  }
  function newForce() {
    const saves = context.rosters();
    const factions = context.factions();
    modal("New Order of Battle", `${field("name","Force name","", "text")}<label>Start from<select name="source">${options([["","Empty force"],...saves.map(item=>[item.id,item.document.name || "Unnamed roster"])])}</select></label><p class="muted">Build your force from the unit catalogue, or copy a complete saved list with its equipment and unit names.</p><label>Faction for an empty force<select name="faction">${options(factions.map(item=>[item.id,item.label]))}</select></label>${field("supply","Supply limit",1000,"number")}`, "Create force", async data => {
      const source = saves.find(item=>item.id===data.get("source"));
      const faction = factions.find(item=>item.id===data.get("faction"));
      const force = M.createForce(source?.document || { faction: faction.faction, subfaction: faction.id }, { name: data.get("name").trim() || source?.document.name || "New Crusade", supplyLimit: data.get("supply") });
      await commit(force); selectedId = force.id;
    });
  }
  function importList() {
    const saves = context.rosters();
    modal("Import list as Order of Battle", `<p class="muted">Import the whole army, including equipment, enhancements and unit names. Each unit starts a new Crusade record. The original list is preserved.</p><label>Saved list<select name="source">${options([["","Choose a saved list…"],...saves.map(item=>[item.id,item.document.name || "Unnamed roster"])])}</select></label><label>Or select a list JSON file<input type="file" name="listFile" accept=".json,application/json"></label><label>Or paste an AAA share code<textarea name="shareCode" rows="3" placeholder="Army list share code"></textarea></label>`, "Import whole list", async (data, element) => {
      const source = saves.find(item=>item.id===data.get("source"));
      const file = element.querySelector('[name="listFile"]').files[0];
      const code = data.get("shareCode").trim();
      if ([Boolean(source),Boolean(file),Boolean(code)].filter(Boolean).length !== 1) throw new Error("Choose one saved list, JSON file, or share code.");
      let documents;
      if (source) documents = [source.document];
      else if (file) {
        if (file.size > 10000000) throw new Error("The list file is too large (maximum 10 MB).");
        documents = await context.importDocuments(await file.text());
      } else documents = [await context.decodeShareCode(code)];
      const forces = documents.map(document=>M.createForce(document));
      await queue.catch(()=>{});
      await persist([...library,...forces]);
      selectedId = forces[0].id;
    });
  }
  function settings() {
    const force = selected();
    const packs = global.ArcadienCrusadeData?.packs || ["Core"];
    modal("Force details", `${field("name","Force name",force.name)}<p class="muted">Faction: ${esc(force.faction)}</p><div class="crFormGrid">${field("supply","Supply limit",force.supplyLimit,"number")}${field("rp","Requisition Points",force.requisitionPoints,"number")}</div><fieldset><legend>Available Crusade books</legend>${packs.map(pack=>`<label class="crCheck"><input type="checkbox" name="pack" value="${esc(pack)}" ${force.packs.includes(pack) ? "checked" : ""} ${pack === "Core" ? "disabled" : ""}>${esc(pack)}</label>`).join("")}</fieldset><label>Force notes<textarea name="notes" rows="3">${esc(force.notes)}</textarea></label>`, "Save details", async data => {
      const next = M.clone(force); next.name = data.get("name").trim();
      if (!next.name) throw new Error("Enter a force name.");
      next.supplyLimit = M.count(data.get("supply"),"Supply limit"); next.requisitionPoints = M.count(data.get("rp"),"Requisition Points");
      next.packs = ["Core",...data.getAll("pack")]; next.notes = data.get("notes"); next.updatedAt = new Date().toISOString(); await commit(next);
    });
  }
  function editUnit(unit) {
    const force = selected();
    modal("Unit record", `<p class="muted">${esc(unit.unitType)} · ${unit.points} pts</p>${field("name","Unit name",unit.name)}<div class="crFormGrid">${field("xp","Experience Points",unit.xp,"number")}${field("games","Games played",unit.games,"number")}${field("wins","Victories",unit.wins,"number")}${field("survived","Games survived",unit.survived,"number")}${field("kills","Units destroyed",unit.kills,"number")}</div><label>Unit notes<textarea name="notes" rows="4">${esc(unit.notes)}</textarea></label><p class="muted">Rank follows XP. Review any book or unit-specific rank restrictions yourself.</p>`, "Save unit", async data => {
      await commit(X?X.transact(force,"Corrected unit record",n=>Object.assign(n,M.updateUnit(n,unit.id,Object.fromEntries(data.entries())))):M.updateUnit(force,unit.id,Object.fromEntries(data.entries())));
    });
  }
  function addUnits() {
    return context.openEditor(selectedId);
  }
  function awardUnit(unit) {
    const force = selected();
    const catalog = global.ArcadienCrusadeData;
    const all = catalog?.records || [];
    let matching = [];
    const candidates = all.map(record=>({...record,eligibility:E.assess(record,unit,force,catalog)})).filter(record=>record.eligibility.status!=="foreign");
    const current = modal("Honours, scars & relics", `<p class="muted">${esc(unit.name)} · ${esc(unit.unitType)} · ${M.rankFor(unit.xp).name}. Entries are scoped to this unit's faction. Keyword and rank restrictions are checked where the source provides them.</p><div class="crFormGrid"><label>Type<select name="kind">${options([["honour","Battle Honours / Traits"],["scar","Battle Scars"],["relic","Crusade Relics"],["weapon","Weapon Modification · pick / roll two"]])}</select></label><label>Source<select name="pack"></select></label></div><label data-cr-rarity hidden>Relic rarity / required rank<select name="rarity">${options([["","All rarities"],["Artificer",rarityLabel("Artificer")],["Antiquity",rarityLabel("Antiquity")],["Legendary",rarityLabel("Legendary")],["Other","Other · check source"]])}</select></label><label>Origin table<select name="table"><option value="">All tables</option></select></label><label class="crCheck"><input type="checkbox" name="restricted">Include restricted entries from this unit's faction</label><label>Search rules<input name="query" type="search" placeholder="Name or source table"></label><p class="muted" data-cr-eligibility-count></p><label>Reference entry<select name="award" size="9" aria-label="Reference entry"></select></label><div class="crRulePreview" aria-live="polite"></div>${bookkeepingUI?.awardOptions(unit)||""}<details><summary>Custom entry</summary>${field("customName","Custom name","")}<label>Rules / description<textarea name="customDescription" rows="3"></textarea></label></details>`, "Add to unit", async data => {
      const customName = data.get("customName").trim();
      const award = customName ? { id: `custom:${M.uid()}`, name: customName, description: data.get("customDescription"), kind: data.get("kind"), pack: "Custom", faction: force.faction, crusadePoints: 0 } : matching.find(item=>item.id===data.get("award"));
      const grantOptions=bookkeepingUI?.readAward(data)||{};
      if(data.has("redemptionBonus")){grantOptions.source="bonus";grantOptions.bonusConfirmed=true;grantOptions.redemptionBonus=true;}
      const next = X ? X.grant(force,unit.id,award,grantOptions,catalog) : M.assignAward(force,unit.id,award);
      if (data.has("redemptionBonus")) {
        if (award.kind !== "honour") throw new Error("The Glorious Redemption bonus must be an eligible Battle Trait.");
        const target = next.units.find(item=>item.id===unit.id);
        if (!target.redemption?.additionalTraitUnclaimed) throw new Error("The redemption Battle Trait was already claimed.");
        target.redemption.additionalTraitUnclaimed = false;
        target.redemption.additionalTraitId = award.id;
      }
      await commit(next);
    });
    if (unit.redemption?.additionalTraitUnclaimed) current.querySelector(".crDialogBody").insertAdjacentHTML("afterbegin", '<label class="crCheck"><input type="checkbox" name="redemptionBonus" checked>Claim as the additional Glorious Redemption Battle Trait</label>');
    const preview = () => {
      const award = matching.find(item=>item.id===current.querySelector('[name="award"]').value);
      current.querySelector(".crRulePreview").innerHTML = award ? `<h3>${esc(award.name)}</h3><small>${esc(award.pack)} · ${esc(award.table)}${award.rarity ? ` · ${esc(rarityLabel(award.rarity))}` : ""}</small><p class="crEligibility ${award.eligibility.status}">${esc(award.eligibility.status === "eligible" ? "Matches encoded restrictions" : award.eligibility.reason)}</p><p>${esc(award.description)}</p>` : `<p>No eligible entries match. Enable another book in Force details, include restricted entries to review them, or add a custom entry.</p>`;
    };
    const filter = () => {
      const kind = current.querySelector('[name="kind"]').value;
      for(const name of ["claimSource","bonusConfirmed","replaceHonour"]){const input=current.querySelector(`[name="${name}"]`);if(input)input.closest("label").hidden=kind==="scar";}
      if(kind==="weapon"){weaponUnit(unit);return;}
      const packSelect=current.querySelector('[name="pack"]'), oldPack=packSelect.value;
      const availableSources=[...force.packs,"Faction"].filter(pack=>candidates.some(record=>record.kind===kind && record.pack===pack));
      packSelect.innerHTML=options(availableSources.map(pack=>[pack,pack==="Faction"?"Unit faction":pack]),oldPack);
      const pack=packSelect.value;
      current.querySelector('[data-cr-rarity]').hidden=kind!=="relic";
      const rarity=current.querySelector('[name="rarity"]').value;
      const includeRestricted=current.querySelector('[name="restricted"]').checked;
      const query = current.querySelector('[name="query"]').value.toLowerCase();
      const scoped=candidates.filter(item=>item.kind===kind && item.pack===pack && (kind!=="relic" || !rarity || item.rarity===rarity));
      const visible=scoped.filter(item=>includeRestricted || item.eligibility.status!=="restricted");
      const tableSelect=current.querySelector('[name="table"]'), oldTable=tableSelect.value;
      const tables=[...new Set(visible.map(item=>E.tableLabel(item,catalog)))].sort();
      tableSelect.innerHTML=options([["","All tables"],...tables.map(table=>[table,table])],oldTable);
      matching=visible.filter(item=>(!tableSelect.value || E.tableLabel(item,catalog)===tableSelect.value) && `${item.name} ${item.table}`.toLowerCase().includes(query))
        .sort((a,b)=>({eligible:0,review:1,restricted:2}[a.eligibility.status]-{eligible:0,review:1,restricted:2}[b.eligibility.status])
          || (({Artificer:0,Antiquity:1,Legendary:2,Other:3}[a.rarity]??0)-({Artificer:0,Antiquity:1,Legendary:2,Other:3}[b.rarity]??0))
          || E.tableLabel(a,catalog).localeCompare(E.tableLabel(b,catalog)) || a.name.localeCompare(b.name));
      const groups=new Map();
      for(const item of matching){const label=`${item.kind==="relic"?rarityLabel(item.rarity)+" · ":""}${E.tableLabel(item,catalog)}${item.eligibility.status==="review"?" · CHECK CONDITIONS":item.eligibility.status==="restricted"?" · RESTRICTED":""}`;if(!groups.has(label))groups.set(label,[]);groups.get(label).push(item);}
      current.querySelector('[name="award"]').innerHTML=[...groups].map(([label,items])=>`<optgroup label="${esc(label)}">${options(items.map(item=>[item.id,item.name]))}</optgroup>`).join("");
      if (matching.length) current.querySelector('[name="award"]').value = matching[0].id;
      current.querySelector('[data-cr-eligibility-count]').textContent=`${matching.length} entries · ${scoped.filter(item=>item.eligibility.status==="restricted").length} restricted${includeRestricted?" shown":" hidden"}. Entries marked CHECK CONDITIONS need review.`;
      preview();
    };
    for (const name of ["kind","pack","table","rarity","restricted"]) current.querySelector(`[name="${name}"]`).onchange = filter;
    current.querySelector('[name="query"]').oninput = filter;
    current.querySelector('[name="award"]').onchange = preview;
    filter();
  }
  function weaponUnit(unit) {
    const force=selected();
    const targets=[];
    const seenKeys=new Set();
    for(const profile of W.baseProfiles(unit)) {
      if(seenKeys.has(W.key(profile)))continue;seenKeys.add(W.key(profile));
      const count=Math.min(...W.baseProfiles(unit).filter(item=>W.key(item)===W.key(profile)).map(item=>Number(item.count??1)));
      for(let copy=1;copy<=count;copy++){
      if(!(unit.weaponModifications||[]).some(item=>item.weaponKey===W.key(profile)&&item.copy===copy)) targets.push({profile,weaponKey:W.key(profile),copy,modeCount:W.baseProfiles(unit).filter(item=>W.key(item)===W.key(profile)).length});
      }
    }
    const seeping=global.ArcadienCrusadeTrackers?.factionKey(force)==="deathGuard"&&global.ArcadienCrusadeTrackers.blessingClaims(force).some(b=>b.id==="seeping-poisons"&&b.claims.length);
    let roll=null;
    const current=modal("Modify one weapon", `<p class="muted">One weapon on one model gains two different modifications. Other copies remain unchanged. Select the Character or unit champion's weapon where required; enhancement/relic replacement weapons cannot be modified.</p><label>Weapon<select name="weapon">${options(targets.map((target,index)=>[String(index),`${W.physicalName(target.profile)} · ${target.modeCount>1?`${target.modeCount} profiles, all modes`:target.profile.typeName} · copy ${target.copy} of ${target.profile.count??1}`]))}</select></label>${field("weaponName","Weapon name (optional)","")}${seeping?`<label class="crCheck"><input name="seeping" type="checkbox">Seeping Poisons: Lethal Hits instead of two modifications</label>`:""}<fieldset class="crWeaponChoices"><legend>Choose two modifications</legend>${W.MODIFICATIONS.map(change=>`<label class="crCheck"><input name="choice" type="checkbox" value="${change.id}"><span><b>${change.roll}. ${esc(change.name)}</b><small>${esc(change.description)}</small></span></label>`).join("")}</fieldset><button type="button" data-cr-roll>Roll two D6</button><p class="muted" data-cr-roll-result aria-live="polite"></p>${bookkeepingUI?.awardOptions(unit)||""}<div data-cr-weapon-preview></div>`,"Apply to this one weapon",async data=>{
      const target=targets[Number(data.get("weapon"))]; if(!target)throw new Error("No unmodified equipped weapons are available.");
      if(X){await commit(X.modifyWeapon(force,unit.id,{...target,name:data.get("weaponName").trim()},data.has("seeping")?["lethal"]:data.getAll("choice"),{seepingPoisons:seeping&&data.has("seeping"),method:roll?"rolled":"chosen",rolls:roll?.rolls,...bookkeepingUI.readAward(data)}));return;}
      const next=M.clone(force), index=next.units.findIndex(item=>item.id===unit.id);
      next.units[index]=W.assign(unit,{...target,name:data.get("weaponName").trim()},data.has("seeping")?["lethal"]:data.getAll("choice"),{seepingPoisons:seeping&&data.has("seeping"),method:roll?"rolled":"chosen",rolls:roll?.rolls});
      next.updatedAt=new Date().toISOString(); await commit(next);
    });
    const checkboxes=[...current.querySelectorAll('[name="choice"]')];
    function preview(){
      const lethal=Boolean(current.querySelector('[name="seeping"]')?.checked),choices=lethal?["lethal"]:checkboxes.filter(box=>box.checked).map(box=>box.value);
      for(const box of checkboxes)box.disabled=lethal||(choices.length===2&&!box.checked);
      const target=targets[Number(current.querySelector('[name="weapon"]').value)];
      const changed=target?W.baseProfiles(unit).filter(profile=>W.key(profile)===target.weaponKey).map(profile=>({...W.modify(profile,choices),count:1,crusadeModified:true,crusadeChanges:choices.map(id=>id==="lethal"?"Seeping Poisons · Lethal Hits":W.MODIFICATIONS.find(item=>item.id===id).name)})):[];
      current.querySelector('[data-cr-weapon-preview]').innerHTML=changed.length?`<p class="muted">Preview: <b>one</b> ${esc(W.physicalName(target.profile))} is modified${target.modeCount>1?" across all its profiles":""}; ${Number(target.profile.count??1)-1} other copies stay unchanged.</p>${weaponTable(changed)}`:"<p>No equipped weapons available. Configure the unit in the catalogue first.</p>";
    }
    const seepingBox=current.querySelector('[name="seeping"]');if(seepingBox)seepingBox.onchange=()=>{roll=null;preview();};
    for(const box of checkboxes)box.onchange=()=>{roll=null;current.querySelector('[data-cr-roll-result]').textContent="";preview();};
    current.querySelector('[name="weapon"]').onchange=preview;
    current.querySelector('[data-cr-roll]').onclick=()=>{roll=W.rollTwo();for(const box of checkboxes)box.checked=roll.choices.includes(box.value);current.querySelector('[data-cr-roll-result]').textContent=`D6: ${roll.rolls.join(" + ")}${roll.attempts.length>1?` · rerolled both dice after ${roll.attempts.length-1} duplicate result(s)`:""}`;preview();};
    preview();
  }
  function recordGame() {
    if(bookkeepingUI)return bookkeepingUI.wrapUp();
    const force = selected();
    modal("Record a game", `${field("opponent","Opponent","")}<div class="crFormGrid"><label>Result<select name="result">${options([["Victory","Victory"],["Defeat","Defeat"],["Draw","Draw"]])}</select></label>${field("date","Date",new Date().toLocaleDateString("en-CA"),"date")}</div><p class="muted">Select the units that fought. Enter the XP and kills to add; include all bonuses in XP. Review honours and injury tests separately.</p><div class="crGameUnits">${force.units.map((unit,index)=>`<div class="crGameUnit"><label class="crCheck"><input type="checkbox" name="played" value="${index}" checked><b>${esc(unit.name)}</b><small>${esc(unit.unitType)}</small></label><div class="crGameNumbers">${field(`xp-${index}`,"XP gained",0,"number")}${field(`kills-${index}`,"Kills",0,"number")}<label class="crCheck"><input name="survived-${index}" type="checkbox" checked>Survived</label></div></div>`).join("")}</div>`, "Save game & progression", async data => {
      const played = data.getAll("played").map(Number);
      if (!played.length) throw new Error("Select at least one unit that fought.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.get("date"))) throw new Error("Choose the date of the game.");
      let next = M.clone(force);
      for (const index of played) {
        const unit = next.units[index];
        next = M.updateUnit(next,unit.id,{ xp: unit.xp + M.count(data.get(`xp-${index}`),"XP gained"), kills: unit.kills + M.count(data.get(`kills-${index}`),"Kills"), games: unit.games + 1, wins: unit.wins + (data.get("result") === "Victory" ? 1 : 0), survived: unit.survived + (data.has(`survived-${index}`) ? 1 : 0) });
      }
      for (const index of played) if (next.units[index].deathGuard) delete next.units[index].deathGuard.temporaryTrait;
      next.battles ||= [];
      next.battles.push({ id: M.uid(), date: data.get("date"), opponent: data.get("opponent"), result: data.get("result"), unitIds: played.map(index=>next.units[index].id), survivedUnitIds: played.filter(index=>data.has(`survived-${index}`)).map(index=>next.units[index].id) });
      await commit(next);
    });
  }
  function exportForce() {
    const force = selected();
    const blob = new Blob([JSON.stringify(force,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `${force.name.replace(/[^a-z0-9_-]/gi,"-")}-order-of-battle.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function importForce() {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const file = input.files[0]; if (!file) return;
        if (file.size > 128000000) throw new Error("This backup is too large (maximum 128 MB).");
        const force = M.validateForce(JSON.parse(await file.text()));
        force.id = M.uid(); force.updatedAt = new Date().toISOString();
        if (library.some(item=>item.name===force.name)) force.name += " (imported)";
        await commit(force); selectedId = force.id; refresh();
      } catch (error) { global.alert(`Order of Battle was not imported: ${error.message}`); }
    };
    input.click();
  }
  function bind(root, handlers) {
    context = handlers;
    bookkeepingUI ||= global.ArcadienCrusadeBookkeepingUI?.create({getForce:selected,commit,refresh,modal,datasheet:unitDatasheet,formatRules,inBattle:()=>Boolean(context.hasActiveBattle?.(selectedId)),openEditor:(...args)=>context.openEditor(...args),getGames:()=>context.listBattles?.()||[]});
    trackerUI ||= global.ArcadienCrusadeTrackerUI?.create({getForce:selected,commit,refresh,modal,closeDialog,openEditor:(...args)=>context.openEditor(...args),inBattle:()=>Boolean(context.hasActiveBattle?.(selectedId)),showRules:factionCrusadeRules,showFaction:()=>{forceTab="faction";refresh();},formatRules});
    if (!loaded) { ready.then(refresh); return; }
    const section = root.querySelector(".crusades");
    if (!section) return;
    section.onclick = async event => {
      const bookkeepingButton=event.target.closest("[data-cb-action]");
      if(bookkeepingButton&&bookkeepingUI){try{await bookkeepingUI.handle(bookkeepingButton);}catch(error){global.alert(error.message);}return;}
      const trackerButton = event.target.closest("[data-ct-action], [data-dg-action]");
      if (trackerButton && trackerUI) { try { await trackerUI.handle(trackerButton); } catch(error) { global.alert(error.message); } return; }
      const button = event.target.closest("[data-cr-action]"); if (!button) return;
      const action = button.dataset.crAction;
      const unit = selected()?.units.find(item=>item.id===button.dataset.unit);
      try {
        if (action === "new") newForce();
        else if (action === "import-list") importList();
        else if (action === "open") { selectedId = button.dataset.force; search = ""; forceTab = "units"; refresh(); }
        else if (action === "force-units" || action === "force-faction") { forceTab = action === "force-units" ? "units" : "faction"; refresh(); }
        else if (action === "back") { selectedId = null; search = ""; refresh(); }
        else if (action === "settings") settings();
        else if (action === "rules") factionCrusadeRules();
        else if (action === "edit-unit" && unit) editUnit(unit);
        else if (action === "add") await addUnits();
        else if (action === "equipment" && unit) await context.openEditor(selectedId, unit.id);
        else if (action === "award" && unit) awardUnit(unit);
        else if (action === "game") recordGame();
        else if (action === "play") startBattle();
        else if (action === "export") exportForce();
        else if (action === "import") importForce();
        else if (action === "cards" || action === "list") { layout = action; refresh(); }
        else if (action === "remove-award" && unit) {
          if(X){await commit(X.remove(selected(),unit.id,button.dataset.award));refresh();return;}
          const next = M.clone(selected()), target = next.units.find(item=>item.id===unit.id);
          const award = target.awards.find(item=>item.id===button.dataset.award);
          target.awards = target.awards.filter(item=>item.id!==button.dataset.award);
          if(award.weaponModificationId)target.weaponModifications=(target.weaponModifications||[]).filter(item=>item.id!==award.weaponModificationId);
          target.history.push({ id:M.uid(),at:new Date().toISOString(),type:"removed",name:award.name });
          next.updatedAt = new Date().toISOString(); await commit(next); refresh();
        }
      } catch (error) { global.alert(error.message); }
    };
    const input = section.querySelector("[data-cr-search]");
    if (input) input.oninput = event => {
      search = event.target.value;
      const units = selected().units.filter(unit=>`${unit.name} ${unit.unitType} ${M.rankFor(unit.xp).name}`.toLowerCase().includes(search.trim().toLowerCase()));
      section.querySelector(".crUnits").innerHTML = units.map(unitRow).join("") || `<p class="muted">No units match your search.</p>`;
    };
  }
  function editorDocument(id) {
    const force = library.find(item=>item.id===id);
    if (!force) throw new Error("This Order of Battle could not be found.");
    return M.toRosterDocument(force);
  }
  async function saveEditorDocument(id, document) {
    const force = library.find(item=>item.id===id);
    if (!force) throw new Error("This Order of Battle could not be found.");
    await commit(M.applyRosterDocument(force, document));
  }
  global.ArcadienCrusades = { render, bind, count:()=>library.length, ready, closeDialog, editorDocument, saveEditorDocument, formatRules, unitRecord:(forceId,unitId)=>library.find(item=>item.id===forceId)?.units.find(item=>item.id===unitId) };
})(window);
