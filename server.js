const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

function httpsPost(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON')); } });
      }
    );
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(new Error('Timeout')); });
  });
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/restaurants', async (req, res) => {
  const lat = 60.1709001, lon = 24.946298, radius = 500;
  const query = `[out:json][timeout:25];(node["amenity"="restaurant"](around:${radius},${lat},${lon});way["amenity"="restaurant"](around:${radius},${lat},${lon});node["amenity"="fast_food"](around:${radius},${lat},${lon}););out center;`;
  const body = `data=${encodeURIComponent(query)}`;

  const mirrors = [
    { hostname: 'overpass-api.de',      urlPath: '/api/interpreter' },
    { hostname: 'overpass.kumi.systems', urlPath: '/api/interpreter' },
  ];

  for (const m of mirrors) {
    try {
      console.log(`Trying ${m.hostname}`);
      const json = await httpsPost(m.hostname, m.urlPath, body);
      if (json.elements) {
        console.log(`OK: ${json.elements.length} elements`);
        return res.json(json);
      }
    } catch (e) {
      console.error(`${m.hostname} failed:`, e.message);
    }
  }

  res.status(502).json({ error: 'All Overpass mirrors failed' });
});

app.get('/api/route', async (req, res) => {
  const { fromLat, fromLon, toLat, toLon } = req.query;
  if (!fromLat || !fromLon || !toLat || !toLon) return res.status(400).json({ error: 'Missing params' });
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
  try {
    const json = await httpsGet(url);
    res.json(json);
  } catch (e) {
    console.error('Routing failed:', e.message);
    res.status(502).json({ error: 'Routing failed' });
  }
});

app.listen(PORT, () => console.log(`Lounashyrrä running on port ${PORT}`));
