const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_KEY;
const API_SECRET = process.env.API_SECRET;

function generateTransactionId() {
    return 'txn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getCurrentTimestamp() {
    const now = new Date();
    return now.toLocaleString('en-AU', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).replace(',', '');
}

async function getAccessToken() {
    const basicAuth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

    const response = await fetch(
        'https://api.onegov.nsw.gov.au/oauth/client_credential/accesstoken?grant_type=client_credentials',
        {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    const text = await response.text();
    console.log('Token Status:', response.status);

    if (!response.ok) {
        console.error('Token Error Response:', text);
        throw new Error(`Token request failed: ${response.status}`);
    }

    const data = JSON.parse(text);
    return data.access_token;
}

async function fetchAllFuelPrices(token) {
    const transactionId = generateTransactionId();
    const timestamp = getCurrentTimestamp();

    const response = await fetch(
        'https://api.onegov.nsw.gov.au/FuelPriceCheck/v1/fuel/prices',
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=utf-8',
                'apikey': API_KEY,
                'transactionid': transactionId,
                'requesttimestamp': timestamp
            }
        }
    );

    const text = await response.text();
    console.log('Prices Status:', response.status);

    if (!response.ok) {
        console.error('Prices Error Response:', text);
        throw new Error(`Failed to fetch prices: ${response.status}`);
    }

    return JSON.parse(text);
}

async function main() {
    try {
        if (!API_KEY || !API_SECRET) {
            throw new Error('Missing API_KEY or API_SECRET environment variables');
        }

        console.log('Requesting access token...');
        const token = await getAccessToken();
        console.log('Token obtained successfully');

        console.log('Fetching all fuel prices...');
        const data = await fetchAllFuelPrices(token);

        const prices = data.prices || [];
        const stations = data.stations || [];

        console.log(`Received ${prices.length} prices and ${stations.length} stations`);

        // Merge prices with station info if needed
        const outputData = {
            lastUpdated: new Date().toISOString(),
            stations: stations,
            prices: prices
        };

        const outputPath = path.join(__dirname, '../data/fuel-prices.json');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

        console.log('Successfully saved fuel data');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
