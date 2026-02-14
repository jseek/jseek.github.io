const DEFAULT_LOCATION = { lat: 47.2474269, lon: -122.4639354 };
const REFRESH_MS = 5000;

const locationBanner = document.getElementById('location-banner');
const radiusSlider = document.getElementById('radius-slider');
const radiusNumber = document.getElementById('radius-number');
const refreshButton = document.getElementById('refresh-button');
const statusLine = document.getElementById('status-line');
const errorLine = document.getElementById('error-line');

const map = L.map('map');
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const viewerIcon = L.divIcon({ className: 'viewer-dot', iconSize: [14, 14], iconAnchor: [7, 7] });

let viewer = { ...DEFAULT_LOCATION };
let refreshIntervalId;
let isRefreshing = false;
let hasFittedBounds = false;

const aircraftMarkers = new Map();
const viewerMarker = L.marker([viewer.lat, viewer.lon], { icon: viewerIcon }).addTo(map);
const radiusCircle = L.circle([viewer.lat, viewer.lon], {
    radius: Number(radiusSlider.value) * 1609.34,
    color: '#16a34a',
    fillColor: '#86efac',
    fillOpacity: 0.15
}).addTo(map);

viewerMarker.bindPopup('You are here');
map.setView([viewer.lat, viewer.lon], 10);

function setRadiusValue(nextValue) {
    const parsed = Number(nextValue);
    const clamped = Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.round(parsed))) : 5;
    radiusSlider.value = String(clamped);
    radiusNumber.value = String(clamped);
    radiusCircle.setRadius(clamped * 1609.34);
    return clamped;
}

function formatMaybeNumber(value) {
    return Number.isFinite(value) ? value : 'N/A';
}

function buildPopup(ac) {
    const flight = (ac.flight || 'Unknown').trim();
    const hex = ac.hex || 'Unknown';
    const registration = ac.r || 'Unknown';
    const type = ac.t || 'Unknown';

    return `
        <strong>${flight}</strong> (${hex})<br>
        Tail: ${registration} &bull; Type: ${type}<br>
        Altitude: ${formatMaybeNumber(ac.alt_baro)} ft<br>
        Ground speed: ${formatMaybeNumber(ac.gs)} kt<br>
        Track: ${formatMaybeNumber(ac.track)}&deg;<br>
        Distance/Bearing: ${formatMaybeNumber(ac.dst)} mi / ${formatMaybeNumber(ac.dir)}&deg;
    `;
}

function updateMapBounds() {
    const bounds = L.latLngBounds([[viewer.lat, viewer.lon]]);
    for (const marker of aircraftMarkers.values()) {
        bounds.extend(marker.getLatLng());
    }

    if (!hasFittedBounds || aircraftMarkers.size > 0) {
        map.fitBounds(bounds.pad(0.25), { maxZoom: 11 });
        hasFittedBounds = true;
    }
}

function updateAircraftMarkers(aircraft = []) {
    const seen = new Set();

    for (const ac of aircraft) {
        if (!ac.hex || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) {
            continue;
        }

        seen.add(ac.hex);
        const latlng = [ac.lat, ac.lon];
        let marker = aircraftMarkers.get(ac.hex);

        if (!marker) {
            marker = L.marker(latlng).addTo(map);
            aircraftMarkers.set(ac.hex, marker);
        } else {
            marker.setLatLng(latlng);
        }

        marker.bindPopup(buildPopup(ac));
    }

    for (const [hex, marker] of aircraftMarkers.entries()) {
        if (!seen.has(hex)) {
            map.removeLayer(marker);
            aircraftMarkers.delete(hex);
        }
    }

    updateMapBounds();
}

function setStatus(total, now) {
    const timestamp = now ? new Date(now) : new Date();
    statusLine.textContent = `Last updated: ${timestamp.toLocaleTimeString()} • Aircraft: ${total}`;
}

async function fetchAircraft() {
    if (isRefreshing) {
        return;
    }

    isRefreshing = true;
    const radius = setRadiusValue(radiusSlider.value);
    const url = `https://api.adsb.lol/v2/point/${viewer.lat}/${viewer.lon}/${radius}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (data.msg !== 'No error') {
            errorLine.textContent = `API message: ${data.msg}`;
        } else {
            errorLine.textContent = '';
        }

        updateAircraftMarkers(Array.isArray(data.ac) ? data.ac : []);
        setStatus(Number.isFinite(data.total) ? data.total : aircraftMarkers.size, data.now);
    } catch (error) {
        errorLine.textContent = `Unable to refresh aircraft data: ${error.message}`;
        setStatus(aircraftMarkers.size);
    } finally {
        isRefreshing = false;
    }
}

function refreshImmediately() {
    fetchAircraft();
}

function applyViewerLocation(lat, lon, usingDefault = false) {
    viewer = { lat, lon };
    viewerMarker.setLatLng([lat, lon]);
    radiusCircle.setLatLng([lat, lon]);
    locationBanner.textContent = usingDefault
        ? 'Using default location (permission denied)'
        : 'Using your location';
}

function initLocation() {
    if (!navigator.geolocation) {
        applyViewerLocation(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, true);
        refreshImmediately();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            applyViewerLocation(position.coords.latitude, position.coords.longitude, false);
            refreshImmediately();
        },
        () => {
            applyViewerLocation(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, true);
            refreshImmediately();
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

radiusSlider.addEventListener('input', () => {
    setRadiusValue(radiusSlider.value);
});

radiusSlider.addEventListener('change', refreshImmediately);
radiusNumber.addEventListener('change', () => {
    setRadiusValue(radiusNumber.value);
    refreshImmediately();
});
refreshButton.addEventListener('click', refreshImmediately);

refreshIntervalId = window.setInterval(fetchAircraft, REFRESH_MS);
window.addEventListener('beforeunload', () => {
    window.clearInterval(refreshIntervalId);
});

initLocation();
