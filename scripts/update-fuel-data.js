// Fetches all NSW FuelCheck prices and writes data/fuel-prices.json for the static site.
//
// Changes vs the original:
//  - fetch timeouts + retries (the API is occasionally slow / flaky)
//  - output is minified and slimmed to the fields the app uses (≈1.7 MB pretty JSON → much smaller),
//    which makes the page load faster on mobile data and shrinks every hourly commit
//  - refuses to overwrite good data with an empty response

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;
const BASE = 'https://api.onegov.nsw.gov.au';
const OUT = path.join(__dirname, '../data/fuel-prices.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, options, { tries = 3, timeoutMs = 30000 } = {}) {
    let lastErr;
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (res.ok) return res;
            lastErr = new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
            if (res.status < 500 && res.status !== 429) break;    // don't retry auth/4xx errors
        } catch (err) {
            lastErr = err;
        }
        if (i < tries) await sleep(2000 * i);
    }
    throw lastErr;
}

// FuelCheck expects "dd/MM/yyyy hh:mm:ss AM" in UTC
function requestTimestamp() {
    return new Date().toLocaleString('en-AU', {
        timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }).replace(',', '');
}

async function getAccessToken() {
    const basic = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
    const res = await fetchWithRetry(`${BASE}/oauth/client_credential/accesstoken?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Token response missing access_token');
    return data.access_token;
}

async function fetchAllFuelPrices(token) {
    const res = await fetchWithRetry(`${BASE}/FuelPriceCheck/v1/fuel/prices`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
            apikey: API_KEY,
            transactionid: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            requesttimestamp: requestTimestamp(),
        },
    });
    return res.json();
}

function slim(data) {
    const stations = (data.stations || [])
        .filter(s => s && s.code != null && s.location)
        .map(s => ({
            code: String(s.code),
            brand: s.brand,
            name: s.name,
            address: s.address,
            location: { latitude: s.location.latitude, longitude: s.location.longitude },
        }))
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
    const prices = (data.prices || [])
        .filter(p => p && p.stationcode != null && p.price > 0)
        .map(p => ({ stationcode: String(p.stationcode), fueltype: p.fueltype, price: p.price, lastupdated: p.lastupdated }))
        .sort((a, b) => a.stationcode.localeCompare(b.stationcode, 'en', { numeric: true }) || a.fueltype.localeCompare(b.fueltype));
    return { stations, prices };
}

async function main() {
    if (!API_KEY || !API_SECRET) throw new Error('Missing API credentials (NSW_FUEL_API_KEY / NSW_FUEL_API_SECRET secrets)');

    const token = await getAccessToken();
    const { stations, prices } = slim(await fetchAllFuelPrices(token));

    if (stations.length < 100 || prices.length < 100) {
        throw new Error(`Suspiciously small response (${stations.length} stations, ${prices.length} prices) — not overwriting existing data`);
    }

    const out = { lastUpdated: new Date().toISOString(), stations, prices };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`✅ ${prices.length} prices across ${stations.length} stations`);
}

main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
