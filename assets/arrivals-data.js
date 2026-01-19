const trainsEndpoint = "https://api-v3.amtraker.com/v3/trains";
const staleEndpoint = "https://api-v3.amtraker.com/v3/stale";
const stationsEndpoint = "https://api-v3.amtraker.com/v3/stations";

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

function normalizeStationsPayload(data) {
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data.filter((item) => item && typeof item === "object");
  }
  if (typeof data === "object") {
    if (Array.isArray(data.stations)) {
      return data.stations.filter((item) => item && typeof item === "object");
    }
    return Object.values(data).filter((item) => item && typeof item === "object");
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

function readNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function getCoordinates(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  const lat = readNumber(entity.lat ?? entity.latitude ?? entity.latit);
  const lon = readNumber(entity.lon ?? entity.lng ?? entity.long ?? entity.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { lat, lon };
}

function buildStationLookup(stations) {
  const lookup = new Map();
  stations.forEach((station) => {
    const code = (station.code || station.station_code || station.stationCode || "").trim();
    if (!code) {
      return;
    }
    const coords = getCoordinates(station);
    if (!coords) {
      return;
    }
    lookup.set(code.toUpperCase(), {
      coords,
      name: station.name || station.stationName || "",
    });
  });
  return lookup;
}

function selectStationArrivals(trains, station, now, stationLookup) {
  const arrivals = [];
  const graceWindowMs = 15 * 60 * 1000;
  const delayThresholdMs = 5 * 60 * 1000;
  const normalizedStation = station.toUpperCase();

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

    const trainLocation = getCoordinates(train);
    const lookupEntry = stationLookup?.get(normalizedStation);
    const stationLocation = lookupEntry?.coords || getCoordinates(stationStop);
    const stationName = lookupEntry?.name || stationStop.name || "";

    arrivals.push({
      station_code: station,
      station_name: stationName,
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
      trainLocation,
      stationLocation,
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

async function fetchTrainsPayload() {
  const response = await fetch(trainsEndpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Bad response: ${response.status}`);
  }
  return response.json();
}

async function fetchStationsPayload() {
  const response = await fetch(stationsEndpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Bad response: ${response.status}`);
  }
  return response.json();
}

export async function fetchArrivalsData(stationCode) {
  const [payload, stale, stationsPayload] = await Promise.all([
    fetchTrainsPayload(),
    fetchStaleFlag(),
    fetchStationsPayload().catch(() => null),
  ]);
  const trains = normalizeTrainsPayload(payload);
  const stations = normalizeStationsPayload(stationsPayload);
  const stationLookup = buildStationLookup(stations);
  const now = new Date();
  const arrivals = selectStationArrivals(trains, stationCode, now, stationLookup);
  const nextTrain = arrivals[0] || null;

  return {
    station_code: stationCode,
    now_utc: now.toISOString(),
    next_train: nextTrain,
    upcoming_trains: arrivals.slice(0, 8),
    last_updated_utc: now.toISOString(),
    data_source: "amtraker_v3_unofficial",
    stale,
    now,
  };
}
