const statusMessage = document.getElementById("status-message");
const statusUrl = document.getElementById("status-url");
const statusFilters = document.querySelectorAll(
  'input[name="status-filter"]'
);
const issueList = document.getElementById("issue-list");

const DEFAULT_LOCATION = {
  lat: 47.2529,
  lng: -122.4443,
  label: "Tacoma, WA (default)"
};
let currentCoords = null;
let mapInstance = null;

const STATUS_COLORS = {
  open: "#d64545",
  acknowledged: "#f4a640",
  closed: "#3e9b5f",
  archived: "#7a828c",
  other: "#4e79a7"
};

const getIssueId = (issue) => {
  if (!issue) return null;
  return issue.id || issue.issue_id || issue.issueId || null;
};

const buildIssueLink = (issue) => {
  const issueId = getIssueId(issue);
  if (!issueId) return null;
  return `issue.html?id=${encodeURIComponent(issueId)}`;
};

const statusToClass = (status) => {
  if (!status) return "other";
  const key = status.toLowerCase();
  if (key.includes("open")) return "open";
  if (key.includes("ack")) return "acknowledged";
  if (key.includes("closed")) return "closed";
  if (key.includes("arch")) return "archived";
  return "other";
};

const buildMap = (coords) => {
  const map = L.map("map").setView([coords.lat, coords.lng], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  L.marker([coords.lat, coords.lng])
    .addTo(map)
    .bindPopup(`You are here: ${coords.label}`)
    .openPopup();

  const radiusFeet = 2000;
  const radiusMeters = radiusFeet * 0.3048;
  L.circle([coords.lat, coords.lng], {
    radius: radiusMeters,
    color: "#1f3b57",
    fillColor: "#1f3b57",
    fillOpacity: 0.08
  }).addTo(map);

  return map;
};

const renderIssues = (issues) => {
  issueList.innerHTML = "";

  if (!issues.length) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No issues found within 2,000 feet.";
    issueList.appendChild(emptyItem);
    return;
  }

  issues.forEach((issue) => {
    const item = document.createElement("li");
    const statusClass = statusToClass(issue.status);
    item.className = `issue-item ${statusClass}`;

    const title = document.createElement("h3");
    const issueLink = buildIssueLink(issue);
    if (issueLink) {
      const link = document.createElement("a");
      link.href = issueLink;
      link.className = "issue-title-link";
      link.textContent = issue.summary || "Untitled issue";
      title.appendChild(link);
    } else {
      title.textContent = issue.summary || "Untitled issue";
    }

    const status = document.createElement("p");
    status.textContent = `Status: ${issue.status || "Unknown"}`;

    const address = document.createElement("p");
    address.textContent = issue.address || "Address unavailable";

    const meta = document.createElement("p");
    meta.className = "meta";
    const createdAt = issue.created_at
      ? new Date(issue.created_at).toLocaleString()
      : "Unknown date";
    meta.textContent = `Created: ${createdAt}`;

    item.append(title, status, address, meta);
    issueList.appendChild(item);
  });
};

const addIssueMarkers = (map, issues) => {
  issues.forEach((issue) => {
    if (!issue.lat || !issue.lng) return;

    const statusClass = statusToClass(issue.status);
    const color = STATUS_COLORS[statusClass] || STATUS_COLORS.other;
    const issueLink = buildIssueLink(issue);
    const issueLinkHtml = issueLink
      ? `<br><a class="issue-link" href="${issueLink}">See Issue</a>`
      : "";

    L.circleMarker([issue.lat, issue.lng], {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 1
    })
      .addTo(map)
      .bindPopup(
        `<strong>${issue.summary || "Untitled"}</strong><br>` +
          `${issue.status || "Unknown status"}${issueLinkHtml}`
      );
  });
};

const buildBoundingBox = (coords, radiusFeet) => {
  const radiusMiles = radiusFeet / 5280;
  const milesPerDegreeLat = 69;
  const milesPerDegreeLng = 69 * Math.cos((coords.lat * Math.PI) / 180);

  const latDelta = radiusMiles / milesPerDegreeLat;
  const lngDelta = radiusMiles / milesPerDegreeLng;

  const minLat = coords.lat - latDelta;
  const maxLat = coords.lat + latDelta;
  const minLng = coords.lng - lngDelta;
  const maxLng = coords.lng + lngDelta;

  return {
    min_lat: minLat,
    min_lng: minLng,
    max_lat: maxLat,
    max_lng: maxLng
  };
};

const getSelectedStatuses = () => {
  if (!statusFilters.length) return "open";
  const values = Array.from(statusFilters)
    .filter((input) => input.checked)
    .map((input) => input.value);
  return values.length ? values.join(",") : "open";
};

const fetchIssues = async (coords) => {
  const bbox = buildBoundingBox(coords, 2000);
  const params = new URLSearchParams({
    min_lat: bbox.min_lat,
    min_lng: bbox.min_lng,
    max_lat: bbox.max_lat,
    max_lng: bbox.max_lng,
    status: getSelectedStatuses(),
    per_page: 100
  });

  const url = `https://seeclickfix.com/api/v2/issues?${params.toString()}`;
  if (statusUrl) {
    statusUrl.textContent = `Query URL: ${url}`;
  }
  console.info("Fetching issues:", url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Unable to load issues from SeeClickFix.");
  }

  const data = await response.json();
  return data.issues || [];
};

const loadIssuesForLocation = async (coords) => {
  currentCoords = coords;
  statusMessage.textContent = `Finding issues within 2,000 feet of ${coords.label}…`;

  if (mapInstance) {
    mapInstance.remove();
  }
  mapInstance = buildMap(coords);

  try {
    const issues = await fetchIssues(coords);
    renderIssues(issues);
    addIssueMarkers(mapInstance, issues);
    statusMessage.textContent = `Loaded ${issues.length} nearby issues.`;
  } catch (error) {
    statusMessage.textContent = error.message;
    renderIssues([]);
  }
};

const handleGeolocationSuccess = (position) => {
  const coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    label: "your current location"
  };
  loadIssuesForLocation(coords);
};

const handleGeolocationError = () => {
  statusMessage.textContent =
    "Location access denied. Showing issues near Tacoma, WA instead.";
  loadIssuesForLocation(DEFAULT_LOCATION);
};

if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition(
    handleGeolocationSuccess,
    handleGeolocationError,
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
} else {
  statusMessage.textContent =
    "Geolocation is not supported in this browser. Showing default location.";
  loadIssuesForLocation(DEFAULT_LOCATION);
}

if (statusFilters.length) {
  statusFilters.forEach((input) => {
    input.addEventListener("change", () => {
      loadIssuesForLocation(currentCoords || DEFAULT_LOCATION);
    });
  });
}
