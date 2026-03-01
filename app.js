/* ============================================
   YATRA PATH — App Logic
   Geocoding, Routing, Journey Planning, Map
   ============================================ */

(function () {
    'use strict';

    // --- DOM References ---
    const fromInput = document.getElementById('from-input');
    const toInput = document.getElementById('to-input');
    const fromDropdown = document.getElementById('from-dropdown');
    const toDropdown = document.getElementById('to-dropdown');
    const journeyForm = document.getElementById('journey-form');
    const searchBtn = document.getElementById('search-btn');
    const searchSection = document.getElementById('search-section');
    const loadingSection = document.getElementById('loading-section');
    const resultsSection = document.getElementById('results-section');
    const errorSection = document.getElementById('error-section');
    const errorText = document.getElementById('error-text');
    const retryBtn = document.getElementById('retry-btn');
    const newSearchBtn = document.getElementById('new-search-btn');

    // Result containers
    const overviewGrid = document.getElementById('overview-grid');
    const transportGrid = document.getElementById('transport-grid');
    const budgetContent = document.getElementById('budget-content');
    const tipsContent = document.getElementById('tips-content');
    const gmapsLink = document.getElementById('gmaps-link');

    let map = null;
    let routeLayer = null;
    let markersLayer = null;

    // --- Geocoding (Nominatim) ---
    let debounceTimer = null;

    function debounce(fn, delay) {
        return function (...args) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    async function geocodeSearch(query) {
        if (!query || query.length < 2) return [];
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1&dedupe=1`;
        try {
            const res = await fetch(url, {
                headers: { 'Accept-Language': 'en' }
            });
            if (!res.ok) return [];
            return await res.json();
        } catch (e) {
            console.error('Geocoding error:', e);
            return [];
        }
    }

    function getPlaceIcon(type) {
        const icons = {
            city: '🏙️', town: '🏘️', village: '🏡', hamlet: '🏡',
            road: '🛣️', street: '🛣️', building: '🏢', house: '🏠',
            place_of_worship: '🛕', temple: '🛕', church: '⛪', mosque: '🕌',
            station: '🚉', airport: '✈️', park: '🌳', hospital: '🏥',
            school: '🏫', university: '🎓', restaurant: '🍽️', hotel: '🏨',
            museum: '🏛️', monument: '🗿', default: '📍'
        };
        const t = (type || '').toLowerCase();
        for (const [key, icon] of Object.entries(icons)) {
            if (t.includes(key)) return icon;
        }
        return icons.default;
    }

    function renderDropdown(results, dropdown, input) {
        dropdown.innerHTML = '';
        if (results.length === 0) {
            dropdown.classList.remove('visible');
            return;
        }
        results.forEach(place => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `
                <span class="autocomplete-item-icon">${getPlaceIcon(place.type)}</span>
                <span class="autocomplete-item-text">${place.display_name}</span>
            `;
            item.addEventListener('click', () => {
                input.value = place.display_name;
                input.dataset.lat = place.lat;
                input.dataset.lon = place.lon;
                dropdown.classList.remove('visible');
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
    }

    const handleAutocomplete = debounce(async function (input, dropdown) {
        const query = input.value.trim();
        if (query.length < 2) {
            dropdown.classList.remove('visible');
            return;
        }
        const results = await geocodeSearch(query);
        renderDropdown(results, dropdown, input);
    }, 350);

    fromInput.addEventListener('input', () => {
        fromInput.dataset.lat = '';
        fromInput.dataset.lon = '';
        handleAutocomplete(fromInput, fromDropdown);
    });

    toInput.addEventListener('input', () => {
        toInput.dataset.lat = '';
        toInput.dataset.lon = '';
        handleAutocomplete(toInput, toDropdown);
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#from-wrapper')) fromDropdown.classList.remove('visible');
        if (!e.target.closest('#to-wrapper')) toDropdown.classList.remove('visible');
    });

    // Keyboard nav for dropdowns
    [fromInput, toInput].forEach((input) => {
        const dropdown = input === fromInput ? fromDropdown : toDropdown;
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            if (!items.length) return;
            let activeIdx = [...items].findIndex(el => el.classList.contains('active'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (activeIdx >= 0) items[activeIdx].classList.remove('active');
                activeIdx = (activeIdx + 1) % items.length;
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeIdx >= 0) items[activeIdx].classList.remove('active');
                activeIdx = (activeIdx - 1 + items.length) % items.length;
                items[activeIdx].classList.add('active');
                items[activeIdx].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault();
                items[activeIdx].click();
            }
        });
    });

    // --- Routing (OSRM) ---
    async function getRoute(fromLat, fromLon, toLat, toLon) {
        const url = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson&steps=true`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Routing failed');
        const data = await res.json();
        if (!data.routes || data.routes.length === 0) throw new Error('No route found');
        return data.routes[0];
    }

    // --- Journey Planner (algorithmic) ---
    function generateJourneyPlan(route, fromName, toName) {
        const distKm = (route.distance / 1000).toFixed(1);
        const durationHrs = route.duration / 3600;
        const durationStr = formatDuration(route.duration);

        // Transport modes
        const transports = getTransportModes(parseFloat(distKm), durationHrs);

        // Budget
        const budget = estimateBudget(parseFloat(distKm), transports);

        // Tips
        const tips = generateTips(parseFloat(distKm), fromName, toName);

        return { distKm, durationStr, durationHrs, transports, budget, tips, fromName, toName };
    }

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h === 0) return `${m} min`;
        if (m === 0) return `${h} hr`;
        return `${h} hr ${m} min`;
    }

    function getTransportModes(distKm, driveDurationHrs) {
        const modes = [];

        // Car
        modes.push({
            icon: '🚗',
            name: 'Car / Cab',
            duration: formatDuration(driveDurationHrs * 3600),
            cost: `₹${Math.round(distKm * 12)}–₹${Math.round(distKm * 18)}`,
            info: `Via road · ${distKm} km`,
            recommended: distKm >= 10 && distKm <= 300
        });

        // Bike / Two-wheeler
        if (distKm <= 150) {
            modes.push({
                icon: '🏍️',
                name: 'Bike / Scooter',
                duration: formatDuration(driveDurationHrs * 1.1 * 3600),
                cost: `₹${Math.round(distKm * 3)}–₹${Math.round(distKm * 5)}`,
                info: `Fuel cost · ${distKm} km`,
                recommended: distKm >= 2 && distKm <= 50
            });
        }

        // Bus
        if (distKm >= 5) {
            const busDuration = driveDurationHrs * 1.4;
            modes.push({
                icon: '🚌',
                name: 'Bus',
                duration: formatDuration(busDuration * 3600),
                cost: `₹${Math.round(distKm * 1.2)}–₹${Math.round(distKm * 3)}`,
                info: distKm > 100 ? 'AC / Sleeper available' : 'Local / Express bus',
                recommended: distKm >= 30 && distKm <= 600
            });
        }

        // Train
        if (distKm >= 20) {
            const trainDuration = distKm / 55;
            modes.push({
                icon: '🚆',
                name: 'Train',
                duration: formatDuration(trainDuration * 3600),
                cost: `₹${Math.round(distKm * 0.8)}–₹${Math.round(distKm * 3.5)}`,
                info: distKm > 300 ? 'Rajdhani / Shatabdi / Express' : 'Local / Express',
                recommended: distKm >= 100 && distKm <= 2000
            });
        }

        // Flight
        if (distKm >= 300) {
            modes.push({
                icon: '✈️',
                name: 'Flight',
                duration: formatDuration((distKm / 700 + 1.5) * 3600),
                cost: `₹${Math.round(2500 + distKm * 3)}–₹${Math.round(4000 + distKm * 6)}`,
                info: 'Includes ~1.5 hr airport time',
                recommended: distKm >= 800
            });
        }

        // Walking
        if (distKm <= 10) {
            modes.push({
                icon: '🚶',
                name: 'Walking',
                duration: formatDuration((distKm / 5) * 3600),
                cost: 'Free',
                info: `${distKm} km walk`,
                recommended: distKm <= 3
            });
        }

        // Auto-rickshaw
        if (distKm <= 30) {
            modes.push({
                icon: '🛺',
                name: 'Auto Rickshaw',
                duration: formatDuration(driveDurationHrs * 1.2 * 3600),
                cost: `₹${Math.round(30 + distKm * 12)}–₹${Math.round(50 + distKm * 16)}`,
                info: 'Negotiate fare beforehand',
                recommended: distKm >= 1 && distKm <= 15
            });
        }

        // Mark the best recommended
        const hasRec = modes.some(m => m.recommended);
        if (!hasRec && modes.length > 0) modes[0].recommended = true;

        return modes;
    }

    function estimateBudget(distKm, transports) {
        const recommended = transports.find(t => t.recommended) || transports[0];
        const costStr = recommended.cost;
        const match = costStr.match(/[\d,]+/g);
        const avgTransportCost = match ? (parseInt(match[0].replace(/,/g, '')) + parseInt(match[match.length - 1].replace(/,/g, ''))) / 2 : 500;

        const items = [
            { icon: '🚗', label: `Transport (${recommended.name})`, value: `₹${Math.round(avgTransportCost)}` },
        ];

        if (distKm > 100) {
            const foodCost = Math.round(200 + distKm * 0.3);
            items.push({ icon: '🍽️', label: 'Food & Drinks', value: `₹${foodCost}` });
        }

        if (distKm > 200) {
            const stayCost = Math.round(800 + distKm * 0.5);
            items.push({ icon: '🏨', label: 'Accommodation (1 night)', value: `₹${stayCost}` });
        }

        if (distKm > 50) {
            items.push({ icon: '🎒', label: 'Miscellaneous', value: `₹${Math.round(100 + distKm * 0.2)}` });
        }

        const total = items.reduce((sum, item) => {
            const m = item.value.match(/[\d,]+/);
            return sum + (m ? parseInt(m[0].replace(/,/g, '')) : 0);
        }, 0);

        items.push({ icon: '💎', label: 'Estimated Total', value: `₹${total.toLocaleString('en-IN')}`, isTotal: true });

        return items;
    }

    function generateTips(distKm, fromName, toName) {
        const tips = [];

        tips.push({
            icon: '📱',
            text: `Save offline maps for "${shortenName(fromName)}" and "${shortenName(toName)}" before starting your journey.`
        });

        if (distKm > 100) {
            tips.push({
                icon: '⏰',
                text: 'Start early in the morning (5–6 AM) to avoid traffic and make the most of your day.'
            });
        }

        if (distKm > 50) {
            tips.push({
                icon: '🧴',
                text: 'Carry water, snacks, and a basic first-aid kit for the journey.'
            });
        }

        if (distKm > 200) {
            tips.push({
                icon: '🔋',
                text: 'Keep a portable power bank handy. Long journeys can drain your phone quickly.'
            });
        }

        if (distKm <= 20) {
            tips.push({
                icon: '🌿',
                text: 'This is a short trip — consider walking or cycling for a healthier, eco-friendly option!'
            });
        }

        tips.push({
            icon: '💳',
            text: 'Keep both cash and a UPI-enabled app ready. Not all places accept digital payments.'
        });

        if (distKm > 500) {
            tips.push({
                icon: '🧳',
                text: 'Pack light but smart. Carry essentials and book accommodation in advance.'
            });
            tips.push({
                icon: '🌤️',
                text: 'Check the weather forecast at your destination before packing.'
            });
        }

        tips.push({
            icon: '📋',
            text: 'Share your live location with a trusted contact during the journey.'
        });

        return tips;
    }

    function shortenName(name) {
        if (!name) return 'your destination';
        const parts = name.split(',');
        return parts.length > 2 ? parts.slice(0, 2).join(',').trim() : parts[0].trim();
    }

    // --- Render Results ---
    function renderResults(plan) {
        // Overview
        overviewGrid.innerHTML = `
            <div class="overview-item">
                <div class="overview-item-icon">📏</div>
                <div class="overview-item-value">${plan.distKm} km</div>
                <div class="overview-item-label">Distance</div>
            </div>
            <div class="overview-item">
                <div class="overview-item-icon">⏱️</div>
                <div class="overview-item-value">${plan.durationStr}</div>
                <div class="overview-item-label">Drive Time</div>
            </div>
            <div class="overview-item">
                <div class="overview-item-icon">📍</div>
                <div class="overview-item-value">${shortenName(plan.fromName)}</div>
                <div class="overview-item-label">Origin</div>
            </div>
            <div class="overview-item">
                <div class="overview-item-icon">🎯</div>
                <div class="overview-item-value">${shortenName(plan.toName)}</div>
                <div class="overview-item-label">Destination</div>
            </div>
        `;

        // Transport
        transportGrid.innerHTML = plan.transports.map(t => `
            <div class="transport-item${t.recommended ? ' recommended' : ''}">
                <div class="transport-icon">${t.icon}</div>
                <div class="transport-details">
                    <div class="transport-name">${t.name}</div>
                    <div class="transport-info">${t.duration} · ${t.cost}<br>${t.info}</div>
                </div>
            </div>
        `).join('');

        // Budget
        budgetContent.innerHTML = plan.budget.map(b => `
            <div class="budget-row${b.isTotal ? ' budget-total' : ''}">
                <div class="budget-label">
                    <span class="budget-icon">${b.icon}</span>
                    <span>${b.label}</span>
                </div>
                <div class="budget-value">${b.value}</div>
            </div>
        `).join('');

        // Tips
        tipsContent.innerHTML = plan.tips.map(t => `
            <div class="tip-item">
                <span class="tip-icon">${t.icon}</span>
                <span>${t.text}</span>
            </div>
        `).join('');

        // Google Maps link
        const fromCoords = `${fromInput.dataset.lat},${fromInput.dataset.lon}`;
        const toCoords = `${toInput.dataset.lat},${toInput.dataset.lon}`;
        gmapsLink.href = `https://www.google.com/maps/dir/${fromCoords}/${toCoords}`;
    }

    // --- Map ---
    function renderMap(route, fromLat, fromLon, toLat, toLon, fromName, toName) {
        if (!map) {
            map = L.map('map', {
                zoomControl: true,
                attributionControl: true
            });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(map);
        }

        // Clear old layers
        if (routeLayer) map.removeLayer(routeLayer);
        if (markersLayer) map.removeLayer(markersLayer);

        markersLayer = L.layerGroup().addTo(map);

        // Custom markers
        const blueIcon = L.divIcon({
            className: '',
            html: `<div style="
                width:18px;height:18px;
                background:#4f8fff;
                border:3px solid #fff;
                border-radius:50%;
                box-shadow:0 0 12px rgba(79,143,255,0.6);
            "></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            popupAnchor: [0, -12]
        });

        const redIcon = L.divIcon({
            className: '',
            html: `<div style="
                width:18px;height:18px;
                background:#ff4f6e;
                border:3px solid #fff;
                border-radius:50%;
                box-shadow:0 0 12px rgba(255,79,110,0.6);
            "></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            popupAnchor: [0, -12]
        });

        L.marker([fromLat, fromLon], { icon: blueIcon })
            .addTo(markersLayer)
            .bindPopup(`<b style="color:#333;">📍 From:</b><br><span style="color:#555;">${shortenName(fromName)}</span>`);

        L.marker([toLat, toLon], { icon: redIcon })
            .addTo(markersLayer)
            .bindPopup(`<b style="color:#333;">🎯 To:</b><br><span style="color:#555;">${shortenName(toName)}</span>`);

        // Route polyline
        if (route.geometry && route.geometry.coordinates) {
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            routeLayer = L.polyline(coords, {
                color: '#4f8fff',
                weight: 4,
                opacity: 0.85,
                smoothFactor: 1,
                dashArray: null
            }).addTo(map);

            // Animated glow line behind
            L.polyline(coords, {
                color: '#4f8fff',
                weight: 10,
                opacity: 0.15,
                smoothFactor: 1
            }).addTo(markersLayer);

            map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
        } else {
            map.fitBounds([[fromLat, fromLon], [toLat, toLon]], { padding: [50, 50] });
        }
    }

    // --- Section Visibility ---
    function showSection(section) {
        [searchSection, loadingSection, resultsSection, errorSection].forEach(s => {
            s.classList.add('hidden');
        });
        section.classList.remove('hidden');
        if (section !== loadingSection) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // --- Resolve Coordinates ---
    async function resolveCoordinates(input) {
        // If already selected from autocomplete
        if (input.dataset.lat && input.dataset.lon && input.dataset.lat !== '') {
            return {
                lat: parseFloat(input.dataset.lat),
                lon: parseFloat(input.dataset.lon),
                name: input.value
            };
        }
        // Otherwise geocode the typed text
        const results = await geocodeSearch(input.value.trim());
        if (results.length === 0) return null;
        return {
            lat: parseFloat(results[0].lat),
            lon: parseFloat(results[0].lon),
            name: results[0].display_name
        };
    }

    // --- Form Submit ---
    journeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fromVal = fromInput.value.trim();
        const toVal = toInput.value.trim();

        if (!fromVal || !toVal) return;

        // Close any open dropdowns
        fromDropdown.classList.remove('visible');
        toDropdown.classList.remove('visible');

        // Show loading
        showSection(loadingSection);
        searchBtn.disabled = true;

        try {
            // Resolve coordinates
            const [fromCoord, toCoord] = await Promise.all([
                resolveCoordinates(fromInput),
                resolveCoordinates(toInput)
            ]);

            if (!fromCoord) {
                throw new Error(`Could not find location: "${fromVal}". Try being more specific, e.g. add a city or state name.`);
            }
            if (!toCoord) {
                throw new Error(`Could not find location: "${toVal}". Try being more specific, e.g. add a city or state name.`);
            }

            // Store resolved coords
            fromInput.dataset.lat = fromCoord.lat;
            fromInput.dataset.lon = fromCoord.lon;
            toInput.dataset.lat = toCoord.lat;
            toInput.dataset.lon = toCoord.lon;

            // Get route
            const route = await getRoute(fromCoord.lat, fromCoord.lon, toCoord.lat, toCoord.lon);

            // Generate plan
            const plan = generateJourneyPlan(route, fromCoord.name, toCoord.name);

            // Render results
            renderResults(plan);
            showSection(resultsSection);

            // Render map (after section is visible)
            setTimeout(() => {
                renderMap(route, fromCoord.lat, fromCoord.lon, toCoord.lat, toCoord.lon, fromCoord.name, toCoord.name);
                map.invalidateSize();
            }, 100);

        } catch (err) {
            console.error('Journey error:', err);
            errorText.textContent = err.message || 'Something went wrong. Please check your locations and try again.';
            showSection(errorSection);
        } finally {
            searchBtn.disabled = false;
        }
    });

    // --- New Search / Retry ---
    newSearchBtn.addEventListener('click', () => {
        showSection(searchSection);
        fromInput.value = '';
        toInput.value = '';
        fromInput.dataset.lat = '';
        fromInput.dataset.lon = '';
        toInput.dataset.lat = '';
        toInput.dataset.lon = '';
        fromInput.focus();
    });

    retryBtn.addEventListener('click', () => {
        showSection(searchSection);
        fromInput.focus();
    });

})();
