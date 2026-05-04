const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Explicit root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Health check — visit /api/health to verify server is alive ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Overpass proxy ──
app.get('/api/restaurants', async (req, res) => {
  const lat = 60.1709001;
  const lon = 24.946298;
  const radius = 500;

  const query = `[out:json][timeout:25];(node["amenity"="restaurant"](around:${radius},${lat},${lon});way["amenity"="restaurant"](around:${radius},${lat},${lon});node["amenity"="fast_food"](around:${radius},${lat},${lon}););out center;`;

  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const base of mirrors) {
    try {
      console.log(`Trying Overpass mirror: ${base}`);
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeout: 20000,
      });
      if (r.ok) {
        const json = await r.json();
        if (json.elements) {
          console.log(`Success from ${base}, elements: ${json.elements.length}`);
          return res.json(json);
        }
      } else {
        console.log(`Mirror ${base} returned status ${r.status}`);
      }
    } catch (e) {
      console.error(`Mirror ${base} failed:`, e.message);
    }
  }

  res.status(502).json({ error: 'All Overpass mirrors failed' });
});

// ── Walking route proxy ──
app.get('/api/route', async (req, res) => {
  const { fromLat, fromLon, toLat, toLon } = req.query;
  if (!fromLat || !fromLon || !toLat || !toLon) {
    return res.status(400).json({ error: 'Missing params' });
  }

  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;

  try {
    const r = await fetch(url, { timeout: 10000 });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    console.error('Routing failed:', e.message);
    res.status(502).json({ error: 'Routing failed' });
  }
});

app.listen(PORT, () => console.log(`Lounashyrrä running on port ${PORT}`));
