const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ── Overpass proxy — avoids CORS issues from browser ──
app.get('/api/restaurants', async (req, res) => {
  const lat = 60.1709001;
  const lon = 24.946298;
  const radius = 500;

  const query = `
[out:json][timeout:20];
(
  node["amenity"="restaurant"](around:${radius},${lat},${lon});
  way["amenity"="restaurant"](around:${radius},${lat},${lon});
  node["amenity"="fast_food"](around:${radius},${lat},${lon});
);
out center;
`.trim();

  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];

  const encoded = encodeURIComponent(query);

  for (const base of mirrors) {
    // try POST
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encoded}`,
        signal: AbortSignal.timeout(18000),
      });
      if (r.ok) {
        const json = await r.json();
        if (json.elements) return res.json(json);
      }
    } catch (e) {}
    // try GET
    try {
      const r = await fetch(`${base}?data=${encoded}`, {
        signal: AbortSignal.timeout(18000),
      });
      if (r.ok) {
        const json = await r.json();
        if (json.elements) return res.json(json);
      }
    } catch (e) {}
  }

  res.status(502).json({ error: 'All Overpass mirrors failed' });
});

// ── Walking route proxy — avoids mixed-content issues ──
app.get('/api/route', async (req, res) => {
  const { fromLat, fromLon, toLat, toLon } = req.query;
  if (!fromLat || !fromLon || !toLat || !toLon) {
    return res.status(400).json({ error: 'Missing params' });
  }

  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    res.status(502).json({ error: 'Routing failed' });
  }
});

app.listen(PORT, () => console.log(`Lounashyrrä running on port ${PORT}`));
