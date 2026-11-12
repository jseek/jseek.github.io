const state = { meta: null, counties: [], contests: [], contest: null, filtered: [], displayRows: [], mapRows: [], compareContests: [], compareA: null, compareB: null, geometry: null, comparison: [], countyComparison: [], exploreGeometry: null, precinctGeometry: null, precinctCounty: null, selectedPrecinct: null, classifications: null, patternsCounty: null, patternsContests: [], patternsRows: [], patternsChoices: [], exploreResolution: "county", compareResolution: "county", restoringUrl: false };
const colors = ["#b84c35", "#234b68", "#d69a2d", "#587f62", "#735b8c", "#8b6a4a", "#73808b"];
const partyColors = {
  REP: "#b84c35", REPUBLICAN: "#b84c35",
  DEM: "#234b68", DEMOCRATIC: "#234b68",
  GRN: "#3f7d52", GREEN: "#3f7d52",
  LIB: "#d69a2d", LIBERTARIAN: "#d69a2d",
  IND: "#8b6a4a", INDEPENDENT: "#8b6a4a",
  NOL: "#735b8c", "NO LABELS": "#735b8c", "NO LABELS PARTY": "#735b8c",
  NON: "#73808b", NONPARTISAN: "#73808b"
};
const specialChoiceColors = { "UNASSIGNED WRITE-IN": "#8b6a4a", "UNOFFICIAL WRITE-IN": "#73808b" };
const maps = {};
const geometryCache = new Map();
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-US");
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const shareAndTotal = (share, total) => `${pct(share)} | ${fmt.format(total)} votes`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const comparisonLabel = (contest, choice) => {
  const topic = contest.name.replace(/^PROPOSITION\s+/i, "Prop ").trim();
  return `${topic} — ${choice.name}`;
};
const choiceColor = (choice, index = 0) => partyColors[String(choice?.party || "").trim().toUpperCase()]
  || specialChoiceColors[String(choice?.name || "").trim().toUpperCase()]
  || colors[index % colors.length];

function fitMapToResults(map, layer, hasVotes) {
  const resultBounds = L.latLngBounds([]);
  layer.eachLayer(featureLayer => {
    if (hasVotes(featureLayer.feature) && featureLayer.getBounds) resultBounds.extend(featureLayer.getBounds());
  });
  const bounds = resultBounds.isValid() ? resultBounds : layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, {padding:[12,12]});
}

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function loadGeometry(countyId) {
  if (countyId === "statewide") {
    if (!geometryCache.has(countyId)) geometryCache.set(countyId, getJSON("./data/statewide/counties.geojson"));
    return geometryCache.get(countyId);
  }
  if (!(state.meta.mapCounties || []).includes(countyId)) {
    const statewide = await loadGeometry("statewide");
    return {type:"FeatureCollection",features:statewide.features.filter(feature => feature.properties.countyId === countyId)};
  }
  if (!geometryCache.has(countyId)) geometryCache.set(countyId, getJSON(`./data/counties/${encodeURIComponent(countyId)}/geometry.geojson`));
  return geometryCache.get(countyId);
}

function contestsPath(scope) { return scope === "statewide" ? "./data/statewide/contests.json" : `./data/counties/${encodeURIComponent(scope)}/contests.json`; }
function contestPath(scope, contestId) { return scope === "statewide" ? `./data/statewide/contests/${encodeURIComponent(contestId)}.json` : `./data/counties/${encodeURIComponent(scope)}/contests/${encodeURIComponent(contestId)}.json`; }

function createMap(id) {
  if (maps[id]) maps[id].remove();
  const map = L.map(id, { preferCanvas: true, zoomControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);
  maps[id] = map;
  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

function currentView() {
  return ["explore", "compare", "patterns", "precinct"].find(name => $(`${name}-mode`).classList.contains("active")) || "explore";
}

function syncUrl(replace = false) {
  if (state.restoringUrl) return;
  const url = new URL(window.location.href), keys = ["view", "county", "contest", "q", "level", "aContest", "aChoice", "bContest", "bChoice", "precinct"];
  keys.forEach(key => url.searchParams.delete(key));
  const view = currentView(); url.searchParams.set("view", view);
  if (view === "explore") {
    if ($("county-select").value) url.searchParams.set("county", $("county-select").value);
    if ($("contest-select").value) url.searchParams.set("contest", $("contest-select").value);
    if ($("county-select").value === "statewide") url.searchParams.set("level", state.exploreResolution);
    if ($("search-input").value) url.searchParams.set("q", $("search-input").value);
  } else if (view === "compare") {
    if ($("compare-county").value) url.searchParams.set("county", $("compare-county").value);
    for (const [param,id] of [["aContest","contest-a"],["aChoice","choice-a"],["bContest","contest-b"],["bChoice","choice-b"]]) if ($(id).value) url.searchParams.set(param, $(id).value);
    if ($("compare-county").value === "statewide") url.searchParams.set("level", state.compareResolution);
  } else if (view === "patterns") {
    if ($("patterns-county").value) url.searchParams.set("county", $("patterns-county").value);
  } else {
    if ($("precinct-county").value) url.searchParams.set("county", $("precinct-county").value);
    if (state.selectedPrecinct) url.searchParams.set("precinct", state.selectedPrecinct);
  }
  history[replace ? "replaceState" : "pushState"]({}, "", url);
}

async function init() {
  try {
    [state.meta, state.counties, state.classifications] = await Promise.all([getJSON("./data/meta.json"), getJSON("./data/counties.json"), getJSON("./choice-classifications.json")]);
    $("election-meta").textContent = `${state.meta.electionName || "Election results"} · ${formatDate(state.meta.electionDate)} · ${state.meta.countyCount} counties`;
    const geographyOptions = `<option value="">Choose a geography</option><option value="statewide">Statewide</option>${state.counties.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
    $("county-select").innerHTML = geographyOptions;
    $("compare-county").innerHTML = geographyOptions;
    const mapped = state.counties.filter(county => (state.meta.mapCounties || []).includes(county.id));
    $("precinct-county").innerHTML = `<option value="">Choose a county</option>${mapped.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
    $("patterns-county").innerHTML = `<option value="">Choose a county</option>${mapped.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
    await restoreFromUrl();
  } catch (error) {
    $("election-meta").textContent = `Could not load data: ${error.message}`;
  }
}

$("explore-mode").addEventListener("click", () => setMode("explore"));
$("compare-mode").addEventListener("click", () => setMode("compare"));
$("patterns-mode").addEventListener("click", () => setMode("patterns"));
$("precinct-mode").addEventListener("click", () => setMode("precinct"));
function setMode(mode, updateUrl = true) {
  for (const name of ["explore", "compare", "patterns", "precinct"]) {
    $(`${name}-mode`).classList.toggle("active", mode === name);
    $(`${name}-workspace`).classList.toggle("hidden", mode !== name);
  }
  Object.values(maps).forEach(map => setTimeout(() => map.invalidateSize(), 0));
  if (updateUrl) syncUrl();
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

$("county-select").addEventListener("change", event => loadExploreCounty(event.target.value));
async function loadExploreCounty(countyId) {
  state.contest = null;
  state.exploreGeometry = null;
  $("dashboard").classList.add("hidden");
  $("empty-state").classList.remove("hidden");
  $("contest-map-card").classList.add("hidden");
  $("search-input").disabled = true;
  if (!countyId) { syncUrl(); return; }
  $("contest-select").disabled = true;
  $("contest-select").innerHTML = `<option>Loading contests…</option>`;
  [state.contests, state.exploreGeometry] = await Promise.all([getJSON(contestsPath(countyId)), loadGeometry(countyId)]);
  $("contest-select").innerHTML = `<option value="">Choose a contest</option>${state.contests.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
  $("contest-select").disabled = false;
  syncUrl();
}

$("contest-select").addEventListener("change", event => loadExploreContest(event.target.value));
async function loadExploreContest(contestId) {
  if (!contestId) { syncUrl(); return; }
  const countyId = $("county-select").value;
  state.contest = await getJSON(contestPath(countyId, contestId));
  state.displayRows = state.contest.precincts;
  state.filtered = state.displayRows;
  $("search-input").value = "";
  $("search-input").disabled = false;
  renderDashboard();
  await applyExploreResolution(state.exploreResolution);
  syncUrl();
}

$("search-input").addEventListener("input", event => {
  const query = event.target.value.trim().toLowerCase();
  state.filtered = state.displayRows.filter(row => `${row.name} ${row.id}`.toLowerCase().includes(query));
  renderTable();
  $("filtered-count").textContent = query ? `${state.filtered.length} of ${state.contest.precinctCount} shown` : "Reporting in this contest";
  syncUrl(true);
});

function renderDashboard() {
  const contest = state.contest;
  $("empty-state").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("contest-title").textContent = contest.name;
  $("total-votes").textContent = fmt.format(contest.totalVotes);
  $("precinct-count").textContent = fmt.format(state.displayRows.length);
  $("filtered-count").textContent = contest.isStatewide ? "Counties reporting in this contest" : "Reporting in this contest";
  const leader = [...contest.candidates].sort((a,b) => b.votes - a.votes)[0];
  $("leader-name").textContent = leader?.name || "No result";
  $("leader-share").textContent = leader && contest.totalVotes ? `${pct(leader.votes / contest.totalVotes)} · ${fmt.format(leader.votes)} votes` : "No votes reported";
  $("candidate-bars").innerHTML = contest.candidates.map((candidate, i) => {
    const share = contest.totalVotes ? candidate.votes / contest.totalVotes : 0;
    return `<div class="candidate-row">
      <div class="candidate-label"><strong><span class="party-dot" style="background:${choiceColor(candidate, i)}"></span>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.party || "No party listed")}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${share * 100}%;background:${choiceColor(candidate, i)}"></div></div>
      <div class="candidate-value">${fmt.format(candidate.votes)} <strong>${pct(share)}</strong></div>
    </div>`;
  }).join("");
  renderTable();
}

function renderContestMap() {
  const card = $("contest-map-card");
  if (!state.exploreGeometry || !state.contest) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const candidates = state.contest.candidates, byId = new Map(state.mapRows.map(row => [row.id, row]));
  $("contest-map-legend").innerHTML = candidates.map((candidate,index) => `<span class="legend-item"><span class="legend-swatch" style="background:${choiceColor(candidate, index)}"></span>${escapeHtml(candidate.name)}</span>`).join("");
  const map = createMap("contest-map");
  const layer = L.geoJSON(state.exploreGeometry, {
    style: feature => {
      const precinct = byId.get(feature.properties.precinctId);
      const ranked = candidates.map((candidate,index) => ({candidate,index,votes:precinct?.votes[candidate.id] || 0})).sort((a,b) => b.votes-a.votes);
      return { color:"#ffffff", weight:1, fillColor:precinct ? choiceColor(ranked[0].candidate, ranked[0].index) : "#aeb7b2", fillOpacity:precinct ? .58 : .2 };
    },
    onEachFeature: (feature, featureLayer) => {
      const precinct = byId.get(feature.properties.precinctId);
      if (!precinct) return;
      const ranked = candidates.map((candidate,index) => ({candidate,index,votes:precinct.votes[candidate.id] || 0})).sort((a,b) => b.votes-a.votes);
      const winner = ranked[0], share = precinct.totalVotes ? winner.votes/precinct.totalVotes : 0;
      featureLayer.bindTooltip(`<strong>${escapeHtml(precinct.name)}</strong>${escapeHtml(winner.candidate.name)} · ${shareAndTotal(share, precinct.totalVotes)}`, {sticky:true});
      featureLayer.on("click", () => openDetail(precinct.id));
    }
  }).addTo(map);
  fitMapToResults(map, layer, feature => (byId.get(feature.properties.precinctId)?.totalVotes || 0) > 0);
}

$("explore-counties").addEventListener("click", () => applyExploreResolution("county"));
$("explore-precincts").addEventListener("click", () => applyExploreResolution("precinct"));

async function safeGetJSON(url) { try { return await getJSON(url); } catch { return null; } }
function clonedFeature(feature) { return structuredClone(feature); }

async function buildStatewideExplore(contest) {
  const countyGeometry = await loadGeometry("statewide"), countyFeatures = new Map(countyGeometry.features.map(feature => [feature.properties.countyId,feature]));
  const features = [], rows = [];
  await Promise.all(contest.precincts.map(async countyRow => {
    const countyId = countyRow.id;
    if ((state.meta.mapCounties || []).includes(countyId)) {
      const [countyContest, geometry] = await Promise.all([safeGetJSON(contestPath(countyId, contest.id)), loadGeometry(countyId)]);
      if (countyContest) {
        countyContest.precincts.forEach(row => rows.push({...row,id:`${countyId}:${row.id}`,sourceId:row.id,countyId,name:`${row.name} · ${countyRow.name}`,geographyType:"precinct"}));
        geometry.features.forEach(feature => { const copy=clonedFeature(feature); copy.properties.precinctId=`${countyId}:${copy.properties.precinctId}`; features.push(copy); });
        return;
      }
    }
    rows.push(countyRow); const feature=countyFeatures.get(countyId); if(feature) features.push(clonedFeature(feature));
  }));
  return {rows:rows.sort((a,b)=>a.name.localeCompare(b.name)),geometry:{type:"FeatureCollection",features}};
}

async function applyExploreResolution(resolution) {
  if (!state.contest) return;
  const statewide = state.contest.isStatewide;
  state.exploreResolution = statewide ? resolution : "precinct";
  $("explore-resolution").classList.toggle("hidden", !statewide);
  $("explore-counties").classList.toggle("active", state.exploreResolution === "county");
  $("explore-precincts").classList.toggle("active", state.exploreResolution === "precinct");
  if (statewide && state.exploreResolution === "precinct") {
    const mixed = await buildStatewideExplore(state.contest); state.displayRows=mixed.rows; state.mapRows=mixed.rows; state.exploreGeometry=mixed.geometry;
    $("contest-map-heading").textContent="Statewide precinct winner map"; $("contest-map-note").textContent="Available precinct boundaries are shown in detail; counties without precinct geometry remain whole.";
  } else if (statewide) {
    state.displayRows=state.contest.precincts; state.mapRows=state.contest.precincts; state.exploreGeometry=await loadGeometry("statewide");
    $("contest-map-heading").textContent="Statewide county winner map"; $("contest-map-note").textContent="Each county is colored by its leading candidate or ballot choice.";
  } else {
    state.displayRows=state.contest.precincts;
    const scope=$("county-select").value, hasPrecincts=(state.meta.mapCounties||[]).includes(scope);
    state.mapRows=hasPrecincts ? state.contest.precincts : [{id:scope,name:state.counties.find(c=>c.id===scope)?.name||scope,votes:Object.fromEntries(state.contest.candidates.map(candidate=>[candidate.id,candidate.votes])),totalVotes:state.contest.totalVotes,groups:{},status:"County aggregate"}];
    $("contest-map-heading").textContent=hasPrecincts?"Precinct winner map":"County result map"; $("contest-map-note").textContent=hasPrecincts?"Precinct boundaries are overlaid on a street map. Click a precinct for its detailed result.":"Precinct boundaries are not yet available, so the full county is shown.";
  }
  const countyLevel=statewide&&state.exploreResolution==="county",localPrecincts=!statewide&&(state.meta.mapCounties||[]).includes($("county-select").value);
  $("geography-count-label").textContent=countyLevel?"Counties":localPrecincts?"Precincts":statewide?"Precincts / counties":"Precincts";$("search-label").textContent=countyLevel?"Find a county":statewide?"Find a precinct or county":"Find a precinct";$("results-table-title").textContent=countyLevel?"Results by county":statewide?"Results by precinct and county":"Results by precinct";
  state.filtered=state.displayRows; $("search-input").value=""; $("precinct-count").textContent=fmt.format(state.displayRows.length); $("filtered-count").textContent=statewide?(state.exploreResolution==="county"?"Counties reporting in this contest":"Available precincts plus whole counties"):"Reporting in this contest";
  renderContestMap(); renderTable(); syncUrl();
}

function renderTable() {
  const candidates = state.contest.candidates;
  $("results-head").innerHTML = `<tr><th>Precinct</th><th>Total votes</th>${candidates.map(c => `<th>${escapeHtml(c.name)}</th>`).join("")}<th>Winner / margin</th></tr>`;
  $("results-body").innerHTML = state.filtered.map(precinct => {
    const ranked = candidates.map((candidate, index) => ({ candidate, index, votes: precinct.votes[candidate.id] || 0 })).sort((a,b) => b.votes - a.votes);
    const winner = ranked[0];
    const margin = winner && ranked[1] && precinct.totalVotes ? (winner.votes - ranked[1].votes) / precinct.totalVotes : 0;
    return `<tr data-id="${escapeHtml(precinct.id)}">
      <td><strong>${escapeHtml(precinct.name)}</strong><br><small>ID ${escapeHtml(precinct.id)}</small></td>
      <td>${fmt.format(precinct.totalVotes)}</td>
      ${candidates.map(candidate => {
        const votes = precinct.votes[candidate.id] || 0;
        return `<td class="${winner?.candidate.id === candidate.id ? "winner" : ""}">${fmt.format(votes)}<br><small>${precinct.totalVotes ? pct(votes / precinct.totalVotes) : "—"}</small></td>`;
      }).join("")}
      <td>${winner ? escapeHtml(winner.candidate.name) : "—"}<br><small>${winner && ranked[1] ? `${pct(margin)} margin` : "—"}</small></td>
    </tr>`;
  }).join("") || `<tr><td colspan="${candidates.length + 3}">No precincts match this search.</td></tr>`;
  $("results-body").querySelectorAll("tr[data-id]").forEach(row => row.addEventListener("click", () => openDetail(row.dataset.id)));
}

function openDetail(precinctId) {
  const precinct = state.displayRows.find(row => row.id === precinctId);
  if (!precinct) return;
  $("detail-title").textContent = precinct.name;
  $("detail-status").textContent = `${precinct.status || "Status unavailable"} · ${fmt.format(precinct.totalVotes)} candidate votes · ID ${precinct.id}`;
  $("detail-results").innerHTML = state.contest.candidates.map((candidate, i) => {
    const votes = precinct.votes[candidate.id] || 0;
    const share = precinct.totalVotes ? votes / precinct.totalVotes : 0;
    return `<div class="detail-result"><div><span>${escapeHtml(candidate.name)}</span><strong>${fmt.format(votes)} · ${pct(share)}</strong></div><div class="mini-track"><div class="mini-fill" style="width:${share * 100}%;background:${choiceColor(candidate, i)}"></div></div></div>`;
  }).join("");
  $("method-results").innerHTML = Object.entries(precinct.groups).map(([name, votes]) => {
    const total = Object.values(votes).reduce((sum, value) => sum + value, 0);
    return `<div class="method-row"><span>${escapeHtml(name)}</span><strong>${fmt.format(total)}</strong></div>`;
  }).join("") || `<p>No voting-method data available.</p>`;
  $("detail-panel").classList.add("open");
  $("detail-panel").setAttribute("aria-hidden", "false");
  $("scrim").classList.add("open");
}

function closeDetail() {
  $("detail-panel").classList.remove("open");
  $("detail-panel").setAttribute("aria-hidden", "true");
  $("scrim").classList.remove("open");
}
$("close-panel").addEventListener("click", closeDetail);
$("scrim").addEventListener("click", closeDetail);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeDetail(); });

$("download-button").addEventListener("click", () => {
  const candidates = state.contest.candidates;
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["precinct_id", "precinct_name", "reporting_status", "total_candidate_votes", ...candidates.flatMap(c => [`${c.name} votes`, `${c.name} share`])]];
  state.filtered.forEach(precinct => rows.push([
    precinct.id, precinct.name, precinct.status, precinct.totalVotes,
    ...candidates.flatMap(candidate => {
      const votes = precinct.votes[candidate.id] || 0;
      return [votes, precinct.totalVotes ? (votes / precinct.totalVotes).toFixed(6) : ""];
    })
  ]));
  const blob = new Blob([rows.map(row => row.map(quote).join(",")).join("\n")], {type: "text/csv"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.contest.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-precincts.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

$("compare-county").addEventListener("change", event => loadCompareCounty(event.target.value));
async function loadCompareCounty(countyId) {
  state.compareA = state.compareB = null;
  state.geometry = null;
  $("compare-dashboard").classList.add("hidden");
  $("compare-empty").classList.remove("hidden");
  for (const id of ["contest-a", "contest-b"]) {
    $(id).disabled = true;
    $(id).innerHTML = `<option>Loading contests…</option>`;
  }
  for (const id of ["choice-a", "choice-b"]) {
    $(id).disabled = true;
    $(id).innerHTML = `<option>Select a contest</option>`;
  }
  if (!countyId) { syncUrl(); return; }
  state.compareContests = await getJSON(contestsPath(countyId));
  const options = `<option value="">Choose a contest</option>${state.compareContests.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}`;
  for (const id of ["contest-a", "contest-b"]) {
    $(id).innerHTML = options;
    $(id).disabled = false;
  }
  state.geometry = await loadGeometry(countyId);
  syncUrl();
}

$("contest-a").addEventListener("change", event => loadCompareContest("a", event.target.value));
$("contest-b").addEventListener("change", event => loadCompareContest("b", event.target.value));
$("choice-a").addEventListener("change", () => { renderComparisonIfReady(); syncUrl(); });
$("choice-b").addEventListener("change", () => { renderComparisonIfReady(); syncUrl(); });

async function loadCompareContest(side, contestId) {
  const choice = $(`choice-${side}`);
  choice.disabled = true;
  choice.innerHTML = `<option>Loading choices…</option>`;
  state[`compare${side.toUpperCase()}`] = null;
  if (!contestId) { syncUrl(); return; }
  const countyId = $("compare-county").value;
  const contest = await getJSON(contestPath(countyId, contestId));
  state[`compare${side.toUpperCase()}`] = contest;
  choice.innerHTML = `<option value="">Choose a candidate or option</option>${contest.candidates.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}${c.party ? ` · ${escapeHtml(c.party)}` : ""}</option>`).join("")}`;
  choice.disabled = false;
  syncUrl();
}

async function renderComparisonIfReady() {
  const candidateA = $("choice-a").value;
  const candidateB = $("choice-b").value;
  if (!state.compareA || !state.compareB || !candidateA || !candidateB) return;
  const byB = new Map(state.compareB.precincts.map(row => [row.id, row]));
  state.countyComparison = state.compareA.precincts.flatMap(rowA => {
    const rowB = byB.get(rowA.id);
    if (!rowB || !rowA.totalVotes || !rowB.totalVotes) return [];
    return [{
      id: rowA.id,
      name: rowA.name,
      shareA: (rowA.votes[candidateA] || 0) / rowA.totalVotes,
      shareB: (rowB.votes[candidateB] || 0) / rowB.totalVotes,
      votesA: rowA.votes[candidateA] || 0,
      votesB: rowB.votes[candidateB] || 0,
      totalA: rowA.totalVotes,
      totalB: rowB.totalVotes,
    }];
  });
  await applyCompareResolution(state.compareResolution);
}

$("compare-counties").addEventListener("click", () => applyCompareResolution("county"));
$("compare-precincts").addEventListener("click", () => applyCompareResolution("precinct"));

async function buildStatewideComparison() {
  const countyGeometry=await loadGeometry("statewide"), countyFeatures=new Map(countyGeometry.features.map(feature=>[feature.properties.countyId,feature]));
  const countyRows=new Map(state.countyComparison.map(row=>[row.id,row])), features=[], rows=[];
  const candidateA=$("choice-a").value, candidateB=$("choice-b").value;
  await Promise.all([...countyRows.entries()].map(async ([countyId,countyRow])=>{
    if((state.meta.mapCounties||[]).includes(countyId)){
      const [contestA,contestB,geometry]=await Promise.all([safeGetJSON(contestPath(countyId,state.compareA.id)),safeGetJSON(contestPath(countyId,state.compareB.id)),loadGeometry(countyId)]);
      if(contestA&&contestB){
        const byB=new Map(contestB.precincts.map(row=>[row.id,row]));
        contestA.precincts.forEach(rowA=>{const rowB=byB.get(rowA.id);if(!rowB||!rowA.totalVotes||!rowB.totalVotes)return;rows.push({id:`${countyId}:${rowA.id}`,name:`${rowA.name} · ${countyRow.name}`,shareA:(rowA.votes[candidateA]||0)/rowA.totalVotes,shareB:(rowB.votes[candidateB]||0)/rowB.totalVotes,votesA:rowA.votes[candidateA]||0,votesB:rowB.votes[candidateB]||0,totalA:rowA.totalVotes,totalB:rowB.totalVotes});});
        geometry.features.forEach(feature=>{const copy=clonedFeature(feature);copy.properties.precinctId=`${countyId}:${copy.properties.precinctId}`;features.push(copy);});return;
      }
    }
    rows.push(countyRow);const feature=countyFeatures.get(countyId);if(feature)features.push(clonedFeature(feature));
  }));
  return {rows,geometry:{type:"FeatureCollection",features}};
}

async function applyCompareResolution(resolution){
  if(!state.compareA||!state.compareB)return;
  const statewide=state.compareA.isStatewide&&state.compareB.isStatewide;
  state.compareResolution=statewide?resolution:"precinct";
  $("compare-resolution").classList.toggle("hidden",!statewide);
  $("compare-counties").classList.toggle("active",state.compareResolution==="county");$("compare-precincts").classList.toggle("active",state.compareResolution==="precinct");
  if(statewide&&state.compareResolution==="precinct"){
    const mixed=await buildStatewideComparison();state.comparison=mixed.rows;state.geometry=mixed.geometry;$("compare-map-heading").textContent="Statewide precinct crossover map";$("compare-map-note").textContent="Available precincts are compared individually; counties without precinct geometry remain whole.";
  }else if(statewide){
    state.comparison=state.countyComparison;state.geometry=await loadGeometry("statewide");$("compare-map-heading").textContent="Statewide county crossover map";$("compare-map-note").textContent="Each point and map area represents a county.";
  }else{
    const scope=$("compare-county").value,hasPrecincts=(state.meta.mapCounties||[]).includes(scope);
    if(hasPrecincts){state.comparison=state.countyComparison;$("compare-map-heading").textContent="Precinct crossover map";$("compare-map-note").textContent="Color shows whether each choice is above or below its countywide precinct average.";}
    else{const ca=state.compareA.candidates.find(c=>c.id===$("choice-a").value),cb=state.compareB.candidates.find(c=>c.id===$("choice-b").value);state.comparison=[{id:scope,name:state.counties.find(c=>c.id===scope)?.name||scope,shareA:ca.votes/state.compareA.totalVotes,shareB:cb.votes/state.compareB.totalVotes,votesA:ca.votes,votesB:cb.votes,totalA:state.compareA.totalVotes,totalB:state.compareB.totalVotes}];$("compare-map-heading").textContent="County comparison map";$("compare-map-note").textContent="Precinct boundaries are not yet available, so the full county is shown.";}
  }
  $("scatter-note").textContent=statewide&&state.compareResolution==="county"?"Each dot is a county. Dotted lines mark statewide county averages.":"Each dot is a precinct or whole county. Dotted lines mark the displayed-area averages.";
  renderComparison();syncUrl();
}

function renderComparison() {
  const rows = state.comparison;
  const candidateA = state.compareA.candidates.find(c => c.id === $("choice-a").value);
  const candidateB = state.compareB.candidates.find(c => c.id === $("choice-b").value);
  const avgA = mean(rows.map(row => row.shareA));
  const avgB = mean(rows.map(row => row.shareB));
  const correlation = pearson(rows);
  const highHigh = rows.filter(row => row.shareA >= avgA && row.shareB >= avgB).length;
  const labels = { a: comparisonLabel(state.compareA, candidateA), b: comparisonLabel(state.compareB, candidateB) };

  $("compare-empty").classList.add("hidden");
  $("compare-dashboard").classList.remove("hidden");
  $("compare-count").textContent = fmt.format(rows.length);
  $("correlation").textContent = Number.isFinite(correlation) ? correlation.toFixed(2) : "—";
  $("correlation-label").textContent = correlationLabel(correlation);
  $("high-high-count").textContent = fmt.format(highHigh);
  renderLegend(labels);
  renderScatter(rows, avgA, avgB, labels);
  renderMap(rows, avgA, avgB, labels);
  renderCompareTable(rows, labels);
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function pearson(rows) {
  if (rows.length < 2) return NaN;
  const ax = mean(rows.map(r => r.shareA)), by = mean(rows.map(r => r.shareB));
  let numerator = 0, da = 0, db = 0;
  rows.forEach(row => { const x = row.shareA - ax, y = row.shareB - by; numerator += x * y; da += x * x; db += y * y; });
  return numerator / Math.sqrt(da * db);
}
function correlationLabel(value) {
  if (!Number.isFinite(value)) return "Not enough variation";
  const strength = Math.abs(value) >= .7 ? "Strong" : Math.abs(value) >= .4 ? "Moderate" : Math.abs(value) >= .2 ? "Weak" : "Little";
  return `${strength} ${value >= 0 ? "positive" : "negative"} relationship`;
}

const bivarColors = { highHigh: "#735b8c", highLow: "#b84c35", lowHigh: "#33708e", lowLow: "#d6d1c6" };
function category(row, avgA, avgB) {
  if (row.shareA >= avgA && row.shareB >= avgB) return "highHigh";
  if (row.shareA >= avgA) return "highLow";
  if (row.shareB >= avgB) return "lowHigh";
  return "lowLow";
}
function renderLegend(labels) {
  const items = [
    ["highHigh", `Above: ${labels.a} + ${labels.b}`], ["highLow", `Above: ${labels.a}`],
    ["lowHigh", `Above: ${labels.b}`], ["lowLow", "Below average: both"]
  ];
  $("map-legend").innerHTML = items.map(([key,label]) => `<span class="legend-item"><span class="legend-swatch" style="background:${bivarColors[key]}"></span>${escapeHtml(label)}</span>`).join("");
}

function renderScatter(rows, avgA, avgB, labels) {
  const svg = $("comparison-scatter"), width = 700, height = 520, left = 66, right = 20, top = 20, bottom = 62;
  const x = value => left + value * (width-left-right), y = value => height-bottom-value * (height-top-bottom);
  let markup = `<line class="axis-line" x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}"/><line class="axis-line" x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}"/>`;
  for (let tick=0; tick<=1.001; tick+=.25) {
    markup += `<text class="tick-label" x="${x(tick)}" y="${height-bottom+22}" text-anchor="middle">${Math.round(tick*100)}%</text><text class="tick-label" x="${left-10}" y="${y(tick)+4}" text-anchor="end">${Math.round(tick*100)}%</text>`;
  }
  markup += `<line class="average-line" x1="${x(avgA)}" y1="${top}" x2="${x(avgA)}" y2="${height-bottom}"/><line class="average-line" x1="${left}" y1="${y(avgB)}" x2="${width-right}" y2="${y(avgB)}"/>`;
  markup += rows.map(row => `<circle class="scatter-dot" data-id="${escapeHtml(row.id)}" cx="${x(row.shareA).toFixed(2)}" cy="${y(row.shareB).toFixed(2)}" r="4" fill="${bivarColors[category(row,avgA,avgB)]}"/>`).join("");
  markup += `<text class="axis-label" x="${(left+width-right)/2}" y="${height-15}" text-anchor="middle">${escapeHtml(labels.a)} vote share</text><text class="axis-label" transform="translate(17 ${(top+height-bottom)/2}) rotate(-90)" text-anchor="middle">${escapeHtml(labels.b)} vote share</text>`;
  svg.innerHTML = markup;
  attachPointTooltips(svg, rows, labels);
}

function allCoordinates(geometry) {
  const out = [];
  const visit = value => { if (Array.isArray(value) && typeof value[0] === "number") out.push(value); else if (Array.isArray(value)) value.forEach(visit); };
  visit(geometry.coordinates); return out;
}
function renderMap(rows, avgA, avgB, labels) {
  const card = $("map-card");
  if (!state.geometry) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const map = createMap("comparison-map"), byId = new Map(rows.map(row => [row.id,row]));
  const layer = L.geoJSON(state.geometry, {
    style: feature => {
      const row = byId.get(feature.properties.precinctId), fill = row ? bivarColors[category(row,avgA,avgB)] : "#aeb7b2";
      return {color:"#ffffff",weight:1,fillColor:fill,fillOpacity:row?.7:.15};
    },
    onEachFeature: (feature, featureLayer) => {
      const row = byId.get(feature.properties.precinctId); if (!row) return;
      featureLayer.bindTooltip(`<strong>${escapeHtml(row.name)}</strong>${escapeHtml(labels.a)}: ${shareAndTotal(row.shareA, row.totalA)}<br>${escapeHtml(labels.b)}: ${shareAndTotal(row.shareB, row.totalB)}`, {sticky:true});
    }
  }).addTo(map);
  fitMapToResults(map, layer, feature => {
    const row = byId.get(feature.properties.precinctId);
    return (row?.totalA || 0) > 0 && (row?.totalB || 0) > 0;
  });
}

function attachPointTooltips(container, rows, labels) {
  const byId=new Map(rows.map(row=>[row.id,row])), tooltip=$("map-tooltip");
  container.querySelectorAll("[data-id]").forEach(mark => {
    mark.addEventListener("pointermove", event => {
      const row=byId.get(mark.dataset.id); if(!row)return;
      tooltip.innerHTML=`<strong>${escapeHtml(row.name)}</strong>${escapeHtml(labels.a)}: ${shareAndTotal(row.shareA, row.totalA)}<br>${escapeHtml(labels.b)}: ${shareAndTotal(row.shareB, row.totalB)}`;
      tooltip.style.left=`${Math.min(event.clientX+14,window.innerWidth-275)}px`; tooltip.style.top=`${Math.min(event.clientY+14,window.innerHeight-100)}px`; tooltip.classList.remove("hidden");
    });
    mark.addEventListener("pointerleave",()=>tooltip.classList.add("hidden"));
  });
}

function renderCompareTable(rows, labels) {
  $("compare-head").innerHTML=`<tr><th>Geography</th><th>${escapeHtml(labels.a)}</th><th>${escapeHtml(labels.b)}</th><th>Combined support</th></tr>`;
  const sorted=[...rows].sort((a,b)=>(b.shareA+b.shareB)-(a.shareA+a.shareB));
  $("compare-body").innerHTML=sorted.map(row=>`<tr><td><strong>${escapeHtml(row.name)}</strong><br><small>ID ${escapeHtml(row.id)}</small></td><td>${pct(row.shareA)}<br><small>${fmt.format(row.votesA)} / ${fmt.format(row.totalA)}</small></td><td>${pct(row.shareB)}<br><small>${fmt.format(row.votesB)} / ${fmt.format(row.totalB)}</small></td><td><strong>${pct((row.shareA+row.shareB)/2)}</strong><br><small>average of shares</small></td></tr>`).join("");
}

$("patterns-county").addEventListener("change", event => loadPatternsCounty(event.target.value));
async function loadPatternsCounty(countyId) {
  state.patternsCounty = countyId;
  $("patterns-dashboard").classList.add("hidden");
  $("patterns-empty").classList.remove("hidden");
  if (!countyId) { syncUrl(); return; }
  const summaries = await getJSON(contestsPath(countyId));
  state.patternsContests = (await Promise.all(summaries.map(contest => getJSON(contestPath(countyId, contest.id))))).filter(Boolean);
  $("patterns-empty").classList.add("hidden");
  $("patterns-dashboard").classList.remove("hidden");
  buildPatternsAnalysis();
  syncUrl();
}

function partisanParty(party) {
  const value = String(party || "").toUpperCase();
  if (value === "REP" || value === "REPUBLICAN") return "right";
  if (value === "DEM" || value === "DEMOCRATIC") return "left";
  return null;
}

function buildPatternsAnalysis() {
  const precincts = new Map(), scores = [], choices = [];
  state.patternsContests.forEach(contest => {
    if (contest.contestType === "Candidate") {
      const major = contest.candidates.filter(candidate => partisanParty(candidate.party) && candidate.votes > 0);
      if (!major.length) return;
      major.forEach(candidate => choices.push({contestId:contest.id,choiceId:candidate.id,label:`${contest.name.replace(/^State /, "")} — ${candidate.name}`,shortLabel:candidate.name,side:partisanParty(candidate.party),contest}));
      scores.push({contestId:contest.id,label:contest.name,kind:"candidate",contest,rightIds:major.filter(candidate=>partisanParty(candidate.party)==="right").map(candidate=>candidate.id),leftIds:major.filter(candidate=>partisanParty(candidate.party)==="left").map(candidate=>candidate.id)});
    } else {
      const config = state.classifications.propositions[contest.name];
      if (!config) return;
      const right = contest.candidates.find(candidate => candidate.name.toUpperCase() === config.rightChoice.toUpperCase());
      const left = contest.candidates.find(candidate => candidate.name.toUpperCase() === config.leftChoice.toUpperCase());
      if (!right || !left) return;
      choices.push({contestId:contest.id,choiceId:right.id,label:`${contest.name.replace("PROPOSITION ", "Prop ")} — ${config.topic} (${right.name})`,shortLabel:`Prop ${contest.name.split(" ").pop()} ${right.name}`,side:"right",contest});
      scores.push({contestId:contest.id,label:`${contest.name}: ${config.topic}`,kind:"proposition",contest,rightIds:[right.id],leftIds:[left.id],config});
    }
  });
  scores.forEach(score => score.contest.precincts.forEach(row => {
    if (!precincts.has(row.id)) precincts.set(row.id,{id:row.id,name:row.name,choiceShares:{},scores:[]});
    const target=precincts.get(row.id), rightVotes=score.rightIds.reduce((sum,id)=>sum+(row.votes[id]||0),0), leftVotes=score.leftIds.reduce((sum,id)=>sum+(row.votes[id]||0),0), total=rightVotes+leftVotes;
    if (total) target.scores.push({contestId:score.contestId,label:score.label,kind:score.kind,rightShare:rightVotes/total,total,config:score.config});
  }));
  choices.forEach(choice => choice.contest.precincts.forEach(row => {
    const target=precincts.get(row.id); if (!target || !row.totalVotes) return;
    target.choiceShares[`${choice.contestId}:${choice.choiceId}`]=(row.votes[choice.choiceId]||0)/row.totalVotes;
  }));
  state.patternsRows=[...precincts.values()].map(row => {
    const candidateScores=row.scores.filter(score=>score.kind==="candidate"), candidateBaseline=mean(candidateScores.map(score=>score.rightShare));
    const rightWins=row.scores.filter(score=>score.rightShare>=.5).length, leftWins=row.scores.length-rightWins, consistency=row.scores.length?Math.max(rightWins,leftWins)/row.scores.length:0;
    return {...row,candidateBaseline,averageRight:mean(row.scores.map(score=>score.rightShare)),consistency,rightWins,leftWins};
  }).filter(row=>row.scores.length);
  const minimumCoverage=Math.min(10,Math.max(3,Math.ceil(state.patternsRows.length*.25)));
  state.patternsChoices=choices.filter(choice=>state.patternsRows.filter(row=>Number.isFinite(row.choiceShares[`${choice.contestId}:${choice.choiceId}`])).length>=minimumCoverage);
  renderPatterns(scores);
}

function renderPatterns(scores) {
  const outliers=state.patternsRows.flatMap(row=>row.scores.filter(score=>Number.isFinite(row.candidateBaseline)).map(score=>({...score,precinctId:row.id,precinctName:row.name,baseline:row.candidateBaseline,difference:score.rightShare-row.candidateBaseline}))).sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference));
  $("patterns-count").textContent=fmt.format(state.patternsRows.length);
  $("patterns-choice-count").textContent=fmt.format(state.patternsChoices.length);
  $("patterns-largest").textContent=outliers.length?`${Math.abs(outliers[0].difference*100).toFixed(1)} pts`:"—";
  $("patterns-largest-label").textContent=outliers.length?`${outliers[0].precinctName} · ${outliers[0].label}`:"From the precinct candidate baseline";
  renderCorrelationMatrix(); renderClassificationList(); renderPatternsMap(); renderOutliers(outliers); renderConsistencyTable();
}

function choiceCorrelation(a,b) {
  const keyA=`${a.contestId}:${a.choiceId}`, keyB=`${b.contestId}:${b.choiceId}`;
  const rows=state.patternsRows.flatMap(row=>Number.isFinite(row.choiceShares[keyA])&&Number.isFinite(row.choiceShares[keyB])?[{shareA:row.choiceShares[keyA],shareB:row.choiceShares[keyB]}]:[]);
  return {value:pearson(rows),count:rows.length};
}
function matrixColor(value) {
  if (!Number.isFinite(value)) return "#eeeae1";
  const strength=Math.min(1,Math.abs(value)), base=value>=0?[115,91,140]:[51,112,142], light=[245,242,234];
  return `rgb(${base.map((channel,index)=>Math.round(light[index]+(channel-light[index])*strength)).join(",")})`;
}
function renderCorrelationMatrix() {
  const choices=state.patternsChoices, columns=choices.length+1;
  let html=`<div class="matrix-grid" style="grid-template-columns:150px repeat(${choices.length},58px)"><div class="matrix-label column matrix-corner">Choice</div>`;
  html+=choices.map(choice=>`<div class="matrix-label column" title="${escapeHtml(choice.label)}">${escapeHtml(choice.shortLabel)}</div>`).join("");
  choices.forEach((rowChoice,rowIndex)=>{
    html+=`<div class="matrix-label" title="${escapeHtml(rowChoice.label)}">${escapeHtml(rowChoice.shortLabel)}</div>`;
    choices.forEach((columnChoice,columnIndex)=>{const result=choiceCorrelation(rowChoice,columnChoice),disabled=rowIndex===columnIndex||!Number.isFinite(result.value);html+=`<button class="matrix-cell" style="background:${matrixColor(result.value)}" ${disabled?"disabled":""} data-row="${rowIndex}" data-column="${columnIndex}" title="${escapeHtml(rowChoice.label)} vs ${escapeHtml(columnChoice.label)} · r=${Number.isFinite(result.value)?result.value.toFixed(2):"—"} · n=${result.count}">${Number.isFinite(result.value)?result.value.toFixed(2):"—"}</button>`;});
  });
  $("correlation-matrix").innerHTML=html+"</div>";
  $("correlation-matrix").querySelectorAll(".matrix-cell:not([disabled])").forEach(button=>button.addEventListener("click",()=>openPatternPair(choices[button.dataset.row],choices[button.dataset.column])));
}
async function openPatternPair(a,b) {
  setMode("compare",false); $("compare-county").value=state.patternsCounty; await loadCompareCounty(state.patternsCounty);
  $("contest-a").value=a.contestId; $("contest-b").value=b.contestId; await Promise.all([loadCompareContest("a",a.contestId),loadCompareContest("b",b.contestId)]);
  $("choice-a").value=a.choiceId; $("choice-b").value=b.choiceId; await renderComparisonIfReady(); syncUrl(); window.scrollTo({top:0,behavior:"smooth"});
}

function renderClassificationList() {
  const items=Object.entries(state.classifications.propositions);
  $("classification-list").innerHTML=items.map(([name,item])=>`<article class="classification-item"><header><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.topic)}</small></div><span class="classification-pill">${escapeHtml(item.rightChoice)} = right</span></header><p>${escapeHtml(item.rationale)} Confidence: ${escapeHtml(item.confidence)}.</p></article>`).join("")+`<div class="classification-sources">${state.classifications.sources.map(source=>`<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join(" · ")}</div>`;
}

function consistencyClass(row) {
  if (row.consistency < .7) return {label:"Mixed",color:"#735b8c"};
  return row.averageRight>=.5?{label:"Consistent right",color:"#b84c35"}:{label:"Consistent left",color:"#33708e"};
}
async function renderPatternsMap() {
  const geometry=await loadGeometry(state.patternsCounty), byId=new Map(state.patternsRows.map(row=>[row.id,row])), map=createMap("patterns-map");
  const layer=L.geoJSON(geometry,{style:feature=>{const row=byId.get(feature.properties.precinctId),kind=row?consistencyClass(row):null;return {color:"#fff",weight:1,fillColor:kind?.color||"#aeb7b2",fillOpacity:row?.72:.15};},onEachFeature:(feature,featureLayer)=>{const row=byId.get(feature.properties.precinctId);if(!row)return;const kind=consistencyClass(row);featureLayer.bindTooltip(`<strong>${escapeHtml(row.name)}</strong>${escapeHtml(kind.label)} · ${pct(row.consistency)} same-side<br>Right ${pct(row.averageRight)} · Left ${pct(1-row.averageRight)}`,{sticky:true});}}).addTo(map);
  fitMapToResults(map, layer, feature => (byId.get(feature.properties.precinctId)?.scores.length || 0) > 0);
}
function renderOutliers(outliers) {
  $("outlier-body").innerHTML=outliers.slice(0,100).map(item=>`<tr><td><strong>${escapeHtml(item.precinctName)}</strong><br><small>ID ${escapeHtml(item.precinctId)}</small></td><td>${escapeHtml(item.label)}</td><td>${pct(item.baseline)} right</td><td>${pct(item.rightShare)} right</td><td><strong>${item.difference>=0?"+":""}${(item.difference*100).toFixed(1)} pts</strong></td></tr>`).join("");
}
function renderConsistencyTable() {
  const sorted=[...state.patternsRows].sort((a,b)=>b.consistency-a.consistency||b.averageRight-a.averageRight);
  $("consistency-body").innerHTML=sorted.map(row=>{const kind=consistencyClass(row);return `<tr><td><strong>${escapeHtml(row.name)}</strong><br><small>ID ${escapeHtml(row.id)}</small></td><td>${pct(row.averageRight)}</td><td>${pct(1-row.averageRight)}</td><td>${Math.max(row.rightWins,row.leftWins)} of ${row.scores.length} · ${pct(row.consistency)}</td><td><span class="party-dot" style="background:${kind.color}"></span><strong>${escapeHtml(kind.label)}</strong></td></tr>`;}).join("");
}

$("precinct-county").addEventListener("change", event => loadPrecinctCounty(event.target.value));
async function loadPrecinctCounty(countyId) {
  state.precinctCounty = countyId;
  state.selectedPrecinct = null;
  $("precinct-profile").classList.add("hidden");
  $("precinct-prompt").classList.remove("hidden");
  $("precinct-browser").classList.add("hidden");
  $("precinct-empty").classList.remove("hidden");
  if (!countyId) { syncUrl(); return; }
  state.precinctGeometry = await loadGeometry(countyId);
  const county = state.counties.find(item => item.id === countyId);
  $("precinct-map-title").textContent = `${county?.name || countyId} precincts`;
  renderPrecinctSelectionMap();
  $("precinct-empty").classList.add("hidden");
  $("precinct-browser").classList.remove("hidden");
  syncUrl();
}

function renderPrecinctSelectionMap() {
  const map = createMap("precinct-map");
  state.precinctLayer = L.geoJSON(state.precinctGeometry, {
    style: feature => ({color:"#ffffff",weight:1,fillColor:feature.properties.precinctId === state.selectedPrecinct ? "#b84c35" : "#5d8196",fillOpacity:feature.properties.precinctId === state.selectedPrecinct ? .75 : .28}),
    onEachFeature: (feature, featureLayer) => {
      const props = feature.properties;
      featureLayer.bindTooltip(`<strong>${escapeHtml(props.precinctName || props.precinctId)}</strong>Click to view all results`, {sticky:true});
      featureLayer.on("click", () => selectPrecinct(props.precinctId));
    }
  }).addTo(map);
  map.fitBounds(state.precinctLayer.getBounds(), {padding:[12,12]});
}

async function selectPrecinct(precinctId) {
  state.selectedPrecinct = precinctId;
  state.precinctLayer?.eachLayer(layer => layer.setStyle({fillColor:layer.feature.properties.precinctId === precinctId ? "#b84c35" : "#5d8196",fillOpacity:layer.feature.properties.precinctId === precinctId ? .75 : .28,weight:layer.feature.properties.precinctId === precinctId ? 2 : 1}));
  syncUrl();
  $("precinct-prompt").classList.add("hidden");
  $("precinct-profile").classList.remove("hidden");
  $("precinct-profile-name").textContent = "Loading precinct…";
  $("precinct-profile-summary").textContent = "Loading every contest and ballot measure.";
  $("precinct-contests").innerHTML = "";
  try {
    const profile = await getJSON(`./data/counties/${encodeURIComponent(state.precinctCounty)}/precincts/${encodeURIComponent(precinctId)}.json`);
    if (state.selectedPrecinct !== precinctId) return;
    renderPrecinctProfile(profile);
  } catch (error) {
    $("precinct-profile-name").textContent = "Results unavailable";
    $("precinct-profile-summary").textContent = error.message;
  }
}

function renderPrecinctProfile(profile) {
  const races = profile.contests.filter(contest => contest.contestType === "Candidate").length;
  const measures = profile.contests.length - races;
  $("precinct-profile-name").textContent = profile.name;
  $("precinct-profile-summary").textContent = `${profile.contests.length} contests · ${races} candidate races · ${measures} ballot measures`;
  $("precinct-contests").innerHTML = profile.contests.map(contest => {
    const ranked = [...contest.choices].sort((a,b) => b.votes-a.votes);
    const leaderId = ranked[0]?.id;
    const kind = contest.contestType === "Candidate" ? "Candidate race" : "Ballot measure";
    return `<article class="precinct-contest card">
      <div class="precinct-contest-heading"><div><span>${escapeHtml(kind)}</span><h3>${escapeHtml(contest.name)}</h3></div><strong>${fmt.format(contest.totalVotes)} votes</strong></div>
      <div class="precinct-choice-list">${contest.choices.map((choice,index) => {
        const share = contest.totalVotes ? choice.votes / contest.totalVotes : 0;
        return `<div class="precinct-choice${choice.id === leaderId ? " leading" : ""}"><div><strong>${escapeHtml(choice.name)}</strong><small>${escapeHtml(choice.party || "")}</small></div><div class="precinct-choice-bar"><span style="width:${share*100}%;background:${choiceColor(choice, index)}"></span></div><b>${fmt.format(choice.votes)} · ${pct(share)}</b></div>`;
      }).join("")}</div>
    </article>`;
  }).join("");
}

async function restoreFromUrl() {
  if (!state.meta) return;
  state.restoringUrl = true;
  const params = new URLSearchParams(window.location.search);
  const view = ["explore","compare","patterns","precinct"].includes(params.get("view")) ? params.get("view") : "explore";
  setMode(view, false);
  try {
    if (view === "explore") {
      const county = params.get("county") || "", contest = params.get("contest") || "", query = params.get("q") || "";
      state.exploreResolution = params.get("level") === "precinct" ? "precinct" : "county";
      $("county-select").value = county; await loadExploreCounty(county);
      if (county && contest) { $("contest-select").value = contest; await loadExploreContest(contest); }
      if (state.contest && query) {
        $("search-input").value = query;
        state.filtered = state.displayRows.filter(row => `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase()));
        renderTable(); $("filtered-count").textContent = `${state.filtered.length} of ${state.contest.precinctCount} shown`;
      }
    } else if (view === "compare") {
      const county = params.get("county") || "";
      state.compareResolution = params.get("level") === "precinct" ? "precinct" : "county";
      $("compare-county").value = county; await loadCompareCounty(county);
      if (county) {
        const aContest = params.get("aContest") || "", bContest = params.get("bContest") || "";
        $("contest-a").value = aContest; $("contest-b").value = bContest;
        await Promise.all([aContest ? loadCompareContest("a", aContest) : null, bContest ? loadCompareContest("b", bContest) : null]);
        $("choice-a").value = params.get("aChoice") || ""; $("choice-b").value = params.get("bChoice") || "";
        renderComparisonIfReady();
      }
    } else if (view === "patterns") {
      const county=params.get("county")||""; $("patterns-county").value=county; await loadPatternsCounty(county);
    } else {
      const county = params.get("county") || "", precinct = params.get("precinct") || "";
      $("precinct-county").value = county; await loadPrecinctCounty(county);
      if (county && precinct) await selectPrecinct(precinct);
    }
  } finally {
    state.restoringUrl = false;
    syncUrl(true);
  }
}

window.addEventListener("popstate", restoreFromUrl);

init();
