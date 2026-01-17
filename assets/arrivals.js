const refreshIntervalMs = 30000;
const trainsEndpoint = "https://api-v3.amtraker.com/v3/trains";
const staleEndpoint = "https://api-v3.amtraker.com/v3/stale";

const stationCodeEl = document.getElementById("station-code");
const stationInput = document.getElementById("station-input");
const displaySelect = document.getElementById("display-select");
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

const flapAlphabet = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./";
const flapIndex = new Map([...flapAlphabet].map((char, index) => [char, index]));
const flapStepMs = 55;
const flapStaggerMs = 240;
const splitDestinationLength = 15;
const splitTimeLength = 8;
const splitStatusLength = 10;
const flapTimers = new WeakMap();

const urlParams = new URLSearchParams(window.location.search);
let stationCode = (urlParams.get("station") || "FLG").toUpperCase();
let nightMode = urlParams.get("night") === "1" || !urlParams.has("night");
let displayType = urlParams.get("display") || "cards";
if (!["cards", "split"].includes(displayType)) {
  displayType = "cards";
}

function applyNightMode(enabled) {
  document.body.classList.toggle("night", enabled);
  toggleNightBtn.textContent = enabled ? "Day mode" : "Night mode";
}

function applyDisplayType(value) {
  const isSplit = value === "split";
  heroSection.classList.toggle("is-hidden", isSplit);
  upcomingSection.classList.toggle("is-hidden", isSplit);
  splitSection.classList.toggle("is-hidden", !isSplit);
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
  window.history.replaceState({}, "", `?${params.toString()}`);
}

function formatEta(etaMinutes) {
  if (etaMinutes <= 0) {
    return "Arriving now";
  }
  const totalMinutes = Math.round(etaMinutes);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);

  return parts.join(" ");
}

function formatTime(isoString) {
  if (!isoString) {
    return "--";
  }
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatStatus(statusMsg) {
  const status = (statusMsg || "").trim().toLowerCase();
  if (!status) {
    return "ON TIME";
  }
  if (status.includes("board")) {
    return "BOARDING";
  }
  if (status.includes("delay") || status.includes("late")) {
    return "DELAYED";
  }
  if (status.includes("cancel")) {
    return "CANCELED";
  }
  if (status.includes("on time")) {
    return "ON TIME";
  }
  if (status.includes("arriv")) {
    return "ARRIVING";
  }
  if (status.includes("enroute") || status.includes("en route")) {
    return "ON TIME";
  }
  return status.toUpperCase();
}

function normalizeFlapChar(char) {
  const upper = (char || " ").toUpperCase();
  return flapIndex.has(upper) ? upper : " ";
}

function buildFlapChars(text, length) {
  const upper = (text || "").toUpperCase();
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    chars.push(normalizeFlapChar(upper[i]));
  }
  return chars;
}

function setCellChar(cell, char) {
  cell.textContent = char;
  cell.dataset.char = char;
}

function stepCellToward(cell, targetChar) {
  const currentChar = normalizeFlapChar(cell.dataset.char);
  const currentIndex = flapIndex.get(currentChar) ?? 0;
  const nextChar = flapAlphabet[(currentIndex + 1) % flapAlphabet.length];
  setCellChar(cell, nextChar);
  cell.classList.add("is-flipping");
  setTimeout(() => {
    cell.classList.remove("is-flipping");
  }, flapStepMs);
  return nextChar !== targetChar;
}

function animateCellTo(cell, targetChar, force) {
  const normalizedTarget = normalizeFlapChar(targetChar);
  const currentChar = normalizeFlapChar(cell.dataset.char);
  if (!force && currentChar === normalizedTarget) {
    return;
  }

  const existing = flapTimers.get(cell);
  if (existing?.interval) {
    clearInterval(existing.interval);
  }
  if (existing?.delay) {
    clearTimeout(existing.delay);
  }

  if (force && currentChar === normalizedTarget) {
    const targetIndex = flapIndex.get(normalizedTarget) ?? 0;
    const previousChar = flapAlphabet[
      (targetIndex - 1 + flapAlphabet.length) % flapAlphabet.length
    ];
    setCellChar(cell, previousChar);
  }

  const delay = Math.random() * flapStaggerMs;
  const delayId = setTimeout(() => {
    const interval = setInterval(() => {
      const keepGoing = stepCellToward(cell, normalizedTarget);
      if (!keepGoing) {
        clearInterval(interval);
        flapTimers.delete(cell);
      }
    }, flapStepMs);
    flapTimers.set(cell, { interval });
  }, delay);
  flapTimers.set(cell, { delay: delayId });
}

function ensureSplitField(fieldEl) {
  const length = Number(fieldEl.dataset.length);
  if (fieldEl.children.length === length) {
    return;
  }
  fieldEl.innerHTML = "";
  for (let i = 0; i < length; i += 1) {
    const cell = document.createElement("span");
    cell.className = "split-cell";
    setCellChar(cell, " ");
    fieldEl.appendChild(cell);
  }
}

function updateSplitField(fieldEl, targetText, force) {
  ensureSplitField(fieldEl);
  const length = Number(fieldEl.dataset.length);
  const targetChars = buildFlapChars(targetText, length);
  const cells = fieldEl.querySelectorAll(".split-cell");
  targetChars.forEach((char, index) => {
    animateCellTo(cells[index], char, force);
  });
}

function ensureSplitRows(count) {
  while (splitListEl.children.length < count) {
    const row = document.createElement("div");
    row.className = "split-row";

    const destination = document.createElement("div");
    destination.className = "split-field split-destination";
    destination.dataset.length = String(splitDestinationLength);

    const time = document.createElement("div");
    time.className = "split-field split-time";
    time.dataset.length = String(splitTimeLength);

    const status = document.createElement("div");
    status.className = "split-field split-status";
    status.dataset.length = String(splitStatusLength);

    row.appendChild(destination);
    row.appendChild(time);
    row.appendChild(status);
    splitListEl.appendChild(row);
  }

  while (splitListEl.children.length > count) {
    splitListEl.removeChild(splitListEl.lastChild);
  }
}

function renderUpcoming(trains) {
  upcomingListEl.innerHTML = "";
  if (!trains.length) {
    upcomingListEl.innerHTML = '<div class="upcoming-card">No upcoming arrivals found.</div>';
    return;
  }

  trains.forEach((train) => {
    const card = document.createElement("div");
    card.className = "upcoming-card";

    const eta = document.createElement("div");
    eta.className = "eta";
    eta.textContent = formatEta(train.etaMinutes);

    const route = document.createElement("div");
    route.className = "route";
    route.innerHTML = `<strong>${train.routeName || "Train"} ${train.trainNum}</strong><div class="source">${formatTime(train.arrivalTime)} • ${train.timeSource}</div>`;

    const origin = document.createElement("div");
    origin.className = "source";
    origin.textContent = `${train.origin.name || ""} → ${train.destination.name || ""}`.trim();

    card.appendChild(eta);
    card.appendChild(route);
    card.appendChild(origin);
    upcomingListEl.appendChild(card);
  });
}

function renderSplitFlap(trains, force) {
  const maxRows = 8;
  const rows = trains.slice(0, maxRows).map((train) => {
    const destinationText = train.destination.name || train.destination.code || "Unknown destination";
    return {
      destination: destinationText.slice(0, splitDestinationLength),
      time: formatTime(train.arrivalTime),
      status: formatStatus(train.statusMsg),
    };
  });

  if (!rows.length) {
    rows.push({ destination: "No arrivals", time: "--", status: "" });
  }

  while (rows.length < maxRows) {
    rows.push({ destination: "", time: "", status: "" });
  }

  ensureSplitRows(rows.length);
  rows.forEach((rowData, index) => {
    const rowEl = splitListEl.children[index];
    const destinationEl = rowEl.querySelector(".split-destination");
    const timeEl = rowEl.querySelector(".split-time");
    const statusEl = rowEl.querySelector(".split-status");
    updateSplitField(destinationEl, rowData.destination, force);
    updateSplitField(timeEl, rowData.time, force);
    updateSplitField(statusEl, rowData.status, force);
  });
}

function buildSplitTrains(data) {
  const combined = [];
  const seen = new Set();

  function track(train) {
    if (!train) {
      return;
    }
    const key = `${train.trainNum || ""}-${train.arrivalTime || ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    combined.push(train);
  }

  track(data.next_train);
  (data.upcoming_trains || []).forEach(track);
  return combined;
}

function normalizeTrainsPayload(data) {
  if (data && Array.isArray(data.trains)) {
    return data.trains.filter((item) => item && typeof item === "object");
  }
  if (data && typeof data === "object") {
    const flattened = [];
    Object.values(data).forEach((value) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((item) => {
        if (item && typeof item === "object") {
          flattened.push(item);
        }
      });
    });
    return flattened;
  }
  return [];
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }
  const hasTimezone = /([+-]\d{2}:\d{2}|Z)$/.test(cleaned);
  const normalized = hasTimezone ? cleaned : `${cleaned}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function computeEtaMinutes(arrivalTime, now) {
  const deltaMinutes = (arrivalTime - now) / 60000;
  if (deltaMinutes <= 1) {
    return 0;
  }
  return Math.ceil(deltaMinutes);
}

function chooseArrivalTime(station) {
  const actual = parseTimestamp(station.arr);
  if (actual) {
    return { time: actual, source: "actual" };
  }
  const scheduled = parseTimestamp(station.schArr);
  if (scheduled) {
    return { time: scheduled, source: "scheduled" };
  }
  return { time: null, source: "unknown" };
}

function selectStationArrivals(trains, station, now) {
  const arrivals = [];
  const graceWindowMs = 15 * 60 * 1000;
  const delayThresholdMs = 5 * 60 * 1000;

  trains.forEach((train) => {
    const stations = Array.isArray(train.stations) ? train.stations : [];
    const stationStop = stations.find((item) => item.code === station);
    if (!stationStop) {
      return;
    }
    const stationStatus = (stationStop.status || "").toLowerCase();
    if (stationStatus.includes("departed")) {
      return;
    }

    const scheduledArrival = parseTimestamp(stationStop.schArr);
    const actualArrival = parseTimestamp(stationStop.arr);
    const { time: arrivalTime, source: timeSource } = chooseArrivalTime(stationStop);
    if (!arrivalTime) {
      return;
    }
    if (arrivalTime.getTime() < now.getTime() - graceWindowMs) {
      return;
    }

    let statusMsg = train.statusMsg || stationStop.status;
    const statusClean = (statusMsg || "").trim();
    if (scheduledArrival) {
      if (actualArrival && actualArrival - scheduledArrival >= delayThresholdMs) {
        statusMsg = "Delayed";
      } else if (!actualArrival && now.getTime() > scheduledArrival.getTime() + delayThresholdMs) {
        statusMsg = "Delayed";
      } else if (!statusClean) {
        const lowerStatus = (stationStop.status || "").toLowerCase();
        if (lowerStatus.includes("station")) {
          statusMsg = "Boarding";
        } else if (lowerStatus.includes("enroute") || lowerStatus.includes("en route")) {
          statusMsg = "On time";
        } else if (lowerStatus.includes("departed")) {
          statusMsg = "Departed";
        } else {
          statusMsg = "On time";
        }
      }
    }

    arrivals.push({
      station_code: station,
      trainNum: String(train.trainNum || train.trainID || ""),
      routeName: train.routeName || train.route || "",
      origin: {
        name: train.origName || train.origin || "",
        code: train.origCode || train.originCode || "",
      },
      destination: {
        name: train.destName || train.destination || "",
        code: train.destCode || train.destinationCode || "",
      },
      arrivalTime: arrivalTime.toISOString(),
      etaMinutes: computeEtaMinutes(arrivalTime, now),
      statusMsg,
      timeSource,
    });
  });

  return arrivals.sort((a, b) => new Date(a.arrivalTime) - new Date(b.arrivalTime));
}

async function fetchStaleFlag() {
  try {
    const response = await fetch(staleEndpoint, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    return Boolean(data.stale);
  } catch (error) {
    return false;
  }
}

async function fetchData(options = {}) {
  try {
    const response = await fetch(trainsEndpoint, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Bad response: ${response.status}`);
    }
    const payload = await response.json();
    const trains = normalizeTrainsPayload(payload);
    const now = new Date();
    const arrivals = selectStationArrivals(trains, stationCode, now);
    const nextTrain = arrivals[0] || null;
    const stale = await fetchStaleFlag();

    const data = {
      station_code: stationCode,
      now_utc: now.toISOString(),
      next_train: nextTrain,
      upcoming_trains: arrivals.slice(0, 8),
      last_updated_utc: now.toISOString(),
      data_source: "amtraker_v3_unofficial",
      stale,
    };

    if (stationCodeEl) {
      stationCodeEl.textContent = data.station_code || stationCode;
    }

    if (data.next_train) {
      nextTimeEl.textContent = formatEta(data.next_train.etaMinutes);
      nextRouteEl.textContent = `${data.next_train.routeName || "Train"} ${data.next_train.trainNum}`;
      nextStatusEl.textContent = data.next_train.statusMsg || "";
      nextOriginEl.textContent = `Origin: ${data.next_train.origin.name || data.next_train.origin.code}`;
      nextDestEl.textContent = `Destination: ${data.next_train.destination.name || data.next_train.destination.code}`;
      nextSourceEl.textContent = `Arrives at ${formatTime(data.next_train.arrivalTime)} (${data.next_train.timeSource})`;
    } else {
      nextTimeEl.textContent = "--";
      nextRouteEl.textContent = "No upcoming arrivals";
      nextStatusEl.textContent = "";
      nextOriginEl.textContent = "";
      nextDestEl.textContent = "";
      nextSourceEl.textContent = "";
    }

    renderUpcoming(data.upcoming_trains || []);
    renderSplitFlap(buildSplitTrains(data), options.forceSplit === true);

    refreshTimeEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;

    if (data.stale) {
      staleIndicatorEl.textContent = "Data may be stale.";
    } else {
      staleIndicatorEl.textContent = "";
    }
  } catch (error) {
    staleIndicatorEl.textContent = "Data temporarily unavailable. Check CORS or use a proxy.";
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

toggleControlsBtn.addEventListener("click", () => {
  const collapsed = document.body.classList.contains("controls-collapsed");
  setControlsCollapsed(!collapsed);
});

showControlsBtn.addEventListener("click", () => {
  setControlsCollapsed(false);
});

applyNightMode(nightMode);
applyDisplayType(displayType);
if (stationCodeEl) {
  stationCodeEl.textContent = stationCode;
}
stationInput.value = stationCode;
displaySelect.value = displayType;
setControlsCollapsed(true);
fetchData({ forceSplit: true });
setInterval(fetchData, refreshIntervalMs);
