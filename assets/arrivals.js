import { fetchArrivalsData, fetchStationLocations } from "./arrivals-data.js";
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

function setStation(newCode, options = {}) {
  stationCode = newCode;
  stationInput.value = stationCode;
  renderer.setStationCode(stationCode);
  updateUrl();
  if (options.fetch) {
    fetchData({ forceSplit: true });
  }
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

function computeDistanceKm(a, b) {
  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const haversine =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getCurrentPosition() {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("Geolocation unavailable"));
  }
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Geolocation timeout"));
    }, 8000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timeoutId);
        resolve(position);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 600000 },
    );
  });
}

async function chooseNearestStationFromLocation() {
  if (urlParams.has("station")) {
    return null;
  }
  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    const stations = await fetchStationLocations();
    if (!stations.length) {
      return null;
    }
    let closest = stations[0];
    let closestDistance = Number.POSITIVE_INFINITY;
    stations.forEach((station) => {
      const distance = computeDistanceKm(
        { lat: latitude, lon: longitude },
        station.coords,
      );
      if (distance < closestDistance) {
        closest = station;
        closestDistance = distance;
      }
    });
    return closest.code;
  } catch (error) {
    return null;
  }
}

applyStationBtn.addEventListener("click", () => {
  const inputValue = stationInput.value.trim().toUpperCase();
  if (inputValue) {
    setStation(inputValue, { fetch: true });
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

async function initPage() {
  applyNightMode(nightMode);
  applyDisplayType(displayType);
  applyMapStyle(mapStyle);
  renderer.setStationCode(stationCode);
  stationInput.value = stationCode;
  displaySelect.value = displayType;
  mapStyleSelect.value = mapStyle;
  setControlsCollapsed(true);

  const nearestStation = await chooseNearestStationFromLocation();
  if (nearestStation) {
    setStation(nearestStation);
  }

  fetchData({ forceSplit: true });
  setInterval(fetchData, refreshIntervalMs);
}

initPage();
