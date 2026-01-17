const flapAlphabet = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-./";
const flapIndex = new Map([...flapAlphabet].map((char, index) => [char, index]));
const flapStepMs = 55;
const flapStaggerMs = 240;
const splitDestinationLength = 15;
const splitTimeLength = 8;
const splitStatusLength = 10;

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

export function buildSplitTrains(data) {
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

export function initArrivalsRenderer(elements) {
  const {
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
  } = elements;
  const flapTimers = new WeakMap();

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

  function renderSplitFlap(trains, force) {
    if (!splitListEl) {
      return;
    }
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

  function renderUpcoming(trains) {
    if (!upcomingListEl) {
      return;
    }
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

  function renderHero(nextTrain) {
    if (!nextTimeEl) {
      return;
    }
    if (nextTrain) {
      nextTimeEl.textContent = formatEta(nextTrain.etaMinutes);
      nextRouteEl.textContent = `${nextTrain.routeName || "Train"} ${nextTrain.trainNum}`;
      nextStatusEl.textContent = nextTrain.statusMsg || "";
      nextOriginEl.textContent = `Origin: ${nextTrain.origin.name || nextTrain.origin.code}`;
      nextDestEl.textContent = `Destination: ${nextTrain.destination.name || nextTrain.destination.code}`;
      nextSourceEl.textContent = `Arrives at ${formatTime(nextTrain.arrivalTime)} (${nextTrain.timeSource})`;
      return;
    }

    nextTimeEl.textContent = "--";
    nextRouteEl.textContent = "No upcoming arrivals";
    nextStatusEl.textContent = "";
    nextOriginEl.textContent = "";
    nextDestEl.textContent = "";
    nextSourceEl.textContent = "";
  }

  function renderRefreshTime(date) {
    if (!refreshTimeEl) {
      return;
    }
    refreshTimeEl.textContent = `Last updated: ${date.toLocaleTimeString()}`;
  }

  function renderStale(isStale, error) {
    if (!staleIndicatorEl) {
      return;
    }
    if (error) {
      staleIndicatorEl.textContent = "Data temporarily unavailable. Check CORS or use a proxy.";
      return;
    }
    staleIndicatorEl.textContent = isStale ? "Data may be stale." : "";
  }

  function setStationCode(value) {
    if (!stationCodeEl) {
      return;
    }
    stationCodeEl.textContent = value;
  }

  return {
    renderHero,
    renderUpcoming,
    renderSplitFlap,
    renderRefreshTime,
    renderStale,
    setStationCode,
  };
}
