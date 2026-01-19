import { fetchArrivalsData } from "./arrivals-data.js";
import { buildSplitTrains, initArrivalsRenderer } from "./arrivals-render.js";

const refreshIntervalMs = 30000;

const stationCodeEl = document.getElementById("station-code");
const stationInput = document.getElementById("station-input");
const displaySelect = document.getElementById("display-select");
const mapStyleSelect = document.getElementById("map-style");
const applyStationBtn = document.getElementById("apply-station");
const toggleNightBtn = document.getElementById("toggle-night");
const toggleControlsBtn = document.getElementById("toggle-controls");
const showControlsBtn = document.getElementById("show-controls");
const heroSection = document.getElementById("hero-section");
const upcomingSection = document.getElementById("upcoming-section");
const splitSection = document.getElementById("split-section");
const nextTimeEl = document.getElementById("next-time");
const nextRouteEl = document.getElementById("next-route");
const nextStatusEl = document.getElementById("next-status");
const nextOriginEl = document.getElementById("next-origin");
const nextDestEl = document.getElementById("next-destination");
const nextSourceEl = document.getElementById("next-source");
const upcomingListEl = document.getElementById("upcoming-list");
const splitListEl = document.getElementById("split-list");
const refreshTimeEl = document.getElementById("refresh-time");
const staleIndicatorEl = document.getElementById("stale-indicator");

const renderer = initArrivalsRenderer({
  stationCodeEl,
  nextTimeEl,
  nextRouteEl,
  nextStatusEl,
  nextOriginEl,
  nextDestEl,
  nextSourceEl,
  upcomingListEl,
  splitListEl,
  refreshTimeEl,
  staleIndicatorEl,
});

const urlParams = new URLSearchParams(window.location.search);
let stationCode = (urlParams.get("station") || "FLG").toUpperCase();
let nightMode = urlParams.get("night") === "1" || !urlParams.has("night");
let displayType = urlParams.get("display") || "cards";
let mapStyle = urlParams.get("map") || "slate";
if (!["cards", "split"].includes(displayType)) {
  displayType = "cards";
}
if (!["light", "slate", "dark"].includes(mapStyle)) {
  mapStyle = "slate";
}

function applyNightMode(enabled) {
  document.body.classList.toggle("night", enabled);
  toggleNightBtn.textContent = enabled ? "Day mode" : "Night mode";
  renderer.setNightMode(enabled);
}

function applyDisplayType(value) {
  const isSplit = value === "split";
  heroSection.classList.toggle("is-hidden", isSplit);
  upcomingSection.classList.toggle("is-hidden", isSplit);
  splitSection.classList.toggle("is-hidden", !isSplit);
}

function applyMapStyle(value) {
  renderer.setMapStyle(value);
}

function setControlsCollapsed(collapsed) {
  document.body.classList.toggle("controls-collapsed", collapsed);
  showControlsBtn.classList.toggle("is-hidden", !collapsed);
  toggleControlsBtn.textContent = collapsed ? "Show controls" : "Hide controls";
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("station", stationCode);
  if (nightMode) {
    params.set("night", "1");
  }
  params.set("display", displayType);
  params.set("map", mapStyle);
  window.history.replaceState({}, "", `?${params.toString()}`);
}

async function fetchData(options = {}) {
  try {
    const data = await fetchArrivalsData(stationCode);
    renderer.setStationCode(data.station_code || stationCode);
    renderer.renderHero(data.next_train);
    renderer.renderUpcoming(data.upcoming_trains || []);
    renderer.renderSplitFlap(buildSplitTrains(data), options.forceSplit === true);
    renderer.renderRefreshTime(data.now);
    renderer.renderStale(data.stale);
  } catch (error) {
    renderer.renderStale(false, error);
  }
}

applyStationBtn.addEventListener("click", () => {
  const inputValue = stationInput.value.trim().toUpperCase();
  if (inputValue) {
    stationCode = inputValue;
    updateUrl();
    fetchData({ forceSplit: true });
  }
});

stationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    applyStationBtn.click();
  }
});

toggleNightBtn.addEventListener("click", () => {
  nightMode = !nightMode;
  applyNightMode(nightMode);
  updateUrl();
});

displaySelect.addEventListener("change", (event) => {
  displayType = event.target.value;
  applyDisplayType(displayType);
  updateUrl();
});

mapStyleSelect.addEventListener("change", (event) => {
  mapStyle = event.target.value;
  applyMapStyle(mapStyle);
  updateUrl();
});

toggleControlsBtn.addEventListener("click", () => {
  const collapsed = document.body.classList.contains("controls-collapsed");
  setControlsCollapsed(!collapsed);
});

showControlsBtn.addEventListener("click", () => {
  setControlsCollapsed(false);
});

applyNightMode(nightMode);
applyDisplayType(displayType);
applyMapStyle(mapStyle);
renderer.setStationCode(stationCode);
stationInput.value = stationCode;
displaySelect.value = displayType;
mapStyleSelect.value = mapStyle;
setControlsCollapsed(true);
fetchData({ forceSplit: true });
setInterval(fetchData, refreshIntervalMs);
