
const API_URL = 'https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/TPD_RMS_Crime/FeatureServer/0/query';
const PAGE_SIZE = 100;
const DEFAULT_RANGE_HOURS = 72;

const state = {
    allRecords: [],
    filteredRecords: [],
    offset: 0,
    loading: false,
    selectedFilters: {
    Offense_Category: new Set(),
    Crimes_Against: new Set(),
    Premise_Type: new Set(),
    },
};

const elements = {
    rows: document.getElementById('blotter-rows'),
    resultsCount: document.getElementById('results-count'),
    loadMore: document.getElementById('load-more'),
    loadMoreStatus: document.getElementById('load-more-status'),
    dateRange: document.getElementById('date-range'),
    startDate: document.getElementById('start-date'),
    endDate: document.getElementById('end-date'),
    search: document.getElementById('search'),
    applyFilters: document.getElementById('apply-filters'),
    clearFilters: document.getElementById('clear-filters'),
    filterContainers: document.querySelectorAll('.checkbox-grid'),
};

const formatDate = (date) => date.toISOString().split('T')[0];

const formatDisplayDate = (dateValue) => {
    if (!dateValue) return 'N/A';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    });
};

const formatDisplayTime = (record) => {
    if (record.Approximate_Time) return record.Approximate_Time;
    if (record.DateOccurred) {
    const date = new Date(record.DateOccurred);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    }
    return 'Unknown';
};

const buildQueryUrl = (offset = 0) => {
    const start = new Date(elements.startDate.value);
    const end = new Date(elements.endDate.value);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() + 1);

    const where = `DateOccurred >= DATE '${formatDate(start)}' AND DateOccurred < DATE '${formatDate(endInclusive)}'`;
    const params = new URLSearchParams({
    where,
    outFields: 'CaseNo,Offense_Category,Description,Crimes_Against,Premise_Type,DateOccurred,Approximate_Time,Address,Latitude,Longitude',
    orderByFields: 'DateOccurred DESC',
    resultRecordCount: PAGE_SIZE,
    resultOffset: offset,
    f: 'geojson',
    });

    return `${API_URL}?${params.toString()}`;
};

const updateDateRangeLabel = () => {
    elements.dateRange.textContent = `${formatDisplayDate(elements.startDate.value)} - ${formatDisplayDate(elements.endDate.value)}`;
};

const setDefaultDates = () => {
    const end = new Date();
    const start = new Date(end);
    start.setHours(start.getHours() - DEFAULT_RANGE_HOURS);
    elements.startDate.value = formatDate(start);
    elements.endDate.value = formatDate(end);
    updateDateRangeLabel();
};

const normalizeValue = (value) => (value === null || value === undefined || value === '' ? 'Unknown' : String(value));

const updateFilterOptions = () => {
    const filterValues = {
    Offense_Category: new Set(),
    Crimes_Against: new Set(),
    Premise_Type: new Set(),
    };

    state.allRecords.forEach((record) => {
    filterValues.Offense_Category.add(normalizeValue(record.Offense_Category));
    filterValues.Crimes_Against.add(normalizeValue(record.Crimes_Against));
    filterValues.Premise_Type.add(normalizeValue(record.Premise_Type));
    });

    elements.filterContainers.forEach((container) => {
    const key = container.dataset.filter;
    container.innerHTML = '';
    Array.from(filterValues[key]).sort().forEach((value) => {
        const id = `${key}-${value.replace(/\s+/g, '-').toLowerCase()}`;
        const wrapper = document.createElement('label');
        wrapper.className = 'checkbox-item';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        input.id = id;
        input.checked = state.selectedFilters[key].has(value);
        input.addEventListener('change', () => {
        if (input.checked) {
            state.selectedFilters[key].add(value);
        } else {
            state.selectedFilters[key].delete(value);
        }
        });

        const text = document.createElement('span');
        text.textContent = value;

        wrapper.append(input, text);
        container.appendChild(wrapper);
    });
    });
};

const applyFilters = () => {
    const searchTerm = elements.search.value.trim().toLowerCase();

    state.filteredRecords = state.allRecords.filter((record) => {
    const matchesSearch = !searchTerm ||
        normalizeValue(record.Address).toLowerCase().includes(searchTerm) ||
        normalizeValue(record.Description).toLowerCase().includes(searchTerm);

    const matchesCategory = state.selectedFilters.Offense_Category.size === 0 ||
        state.selectedFilters.Offense_Category.has(normalizeValue(record.Offense_Category));

    const matchesCrimes = state.selectedFilters.Crimes_Against.size === 0 ||
        state.selectedFilters.Crimes_Against.has(normalizeValue(record.Crimes_Against));

    const matchesPremise = state.selectedFilters.Premise_Type.size === 0 ||
        state.selectedFilters.Premise_Type.has(normalizeValue(record.Premise_Type));

    return matchesSearch && matchesCategory && matchesCrimes && matchesPremise;
    });

    renderRows();
};

const renderRows = () => {
    if (state.filteredRecords.length === 0) {
    elements.rows.innerHTML = '<tr><td colspan="7" class="loading">No incidents match these filters.</td></tr>';
    elements.resultsCount.textContent = '0 incidents shown.';
    return;
    }

    elements.rows.innerHTML = state.filteredRecords.map((record) => {
    const dateTime = `${formatDisplayDate(record.DateOccurred)} ${formatDisplayTime(record)}`;
    return `
        <tr>
        <td>${normalizeValue(record.CaseNo)}</td>
        <td>${dateTime}</td>
        <td>${normalizeValue(record.Address)}</td>
        <td>${normalizeValue(record.Offense_Category)}</td>
        <td>${normalizeValue(record.Description)}</td>
        <td>${normalizeValue(record.Premise_Type)}</td>
        <td>${normalizeValue(record.Crimes_Against)}</td>
        </tr>
    `;
    }).join('');

    elements.resultsCount.textContent = `${state.filteredRecords.length} incidents shown.`;
};

const fetchRecords = async () => {
    if (state.loading) return;
    state.loading = true;
    elements.loadMore.disabled = true;
    elements.loadMoreStatus.textContent = 'Loading more incidents...';

    try {
    const response = await fetch(buildQueryUrl(state.offset));
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    const data = await response.json();
    const records = (data.features || []).map((feature) => feature.properties);

    if (records.length === 0 && state.offset === 0) {
        elements.rows.innerHTML = '<tr><td colspan="7" class="loading">No incidents found for this date range.</td></tr>';
        elements.resultsCount.textContent = '0 incidents shown.';
    }

    state.allRecords = state.allRecords.concat(records);
    state.offset += records.length;

    updateFilterOptions();
    applyFilters();

    if (records.length < PAGE_SIZE) {
        elements.loadMoreStatus.textContent = 'No more incidents to load.';
        elements.loadMore.disabled = true;
    } else {
        elements.loadMoreStatus.textContent = '';
        elements.loadMore.disabled = false;
    }
    } catch (error) {
    elements.loadMoreStatus.textContent = 'Unable to load incidents. Please try again.';
    } finally {
    state.loading = false;
    }
};

const resetData = () => {
    state.allRecords = [];
    state.filteredRecords = [];
    state.offset = 0;
    elements.rows.innerHTML = '<tr><td colspan="7" class="loading">Loading incidents...</td></tr>';
    elements.resultsCount.textContent = 'Loading incidents...';
    elements.loadMore.disabled = false;
    elements.loadMoreStatus.textContent = '';
};

elements.applyFilters.addEventListener('click', () => {
    updateDateRangeLabel();
    resetData();
    fetchRecords();
});

elements.clearFilters.addEventListener('click', () => {
    state.selectedFilters.Offense_Category.clear();
    state.selectedFilters.Crimes_Against.clear();
    state.selectedFilters.Premise_Type.clear();
    elements.search.value = '';
    updateFilterOptions();
    applyFilters();
});

elements.loadMore.addEventListener('click', () => {
    fetchRecords();
});

setDefaultDates();
fetchRecords();