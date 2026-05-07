const express = require('express');
const path = require('path');
const https = require('https');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database (Turso or local SQLite) ──
let db;

if (process.env.TURSO_URL && process.env.TURSO_TOKEN) {
console.log('Using turso')
  db = createClient ({
    url:process.env.TURSO_URL,
    authToken:process.env.TURSO_TOKEN,
  });
} else {
  console.log('no turso env variables se - reverting to local SQLite');
  db = createClient({
    url: 'file:./data/lounashyrra.db',
  });
}

async function initDb() {
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]'
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`, args: [] },
  ]);
  console.log('DB ready');
}

// ── In-memory restaurant cache (survives multiple requests, resets on redeploy) ──
let restaurantCache = null;

async function fetchFromOverpass() {
  const lat = 60.1709001, lon = 24.946298, radius = 500;
  const query = `[out:json][timeout:25];(node["amenity"="restaurant"](around:${radius},${lat},${lon});way["amenity"="restaurant"](around:${radius},${lat},${lon});node["amenity"="fast_food"](around:${radius},${lat},${lon}););out center;`;
  const body = `data=${encodeURIComponent(query)}`;
  const mirrors = [
    { hostname: 'overpass-api.de',           urlPath: '/api/interpreter' },
    { hostname: 'overpass.kumi.systems',      urlPath: '/api/interpreter' },
    { hostname: 'overpass.private.coffee',    urlPath: '/api/interpreter' },
    { hostname: 'maps.mail.ru',               urlPath: '/osm/tools/overpass/api/interpreter' },
  ];
  for (const m of mirrors) {
    try {
      console.log(`Trying ${m.hostname}...`);
      const json = await httpsPost(m.hostname, m.urlPath, body);
      if (json.elements && json.elements.length > 0) {
        console.log(`Success: ${json.elements.length} elements from ${m.hostname}`);
        return json;
      }
    } catch(e) { console.error(`${m.hostname} failed:`, e.message); }
  }
  return null;
}

// ── HTTPS helpers ──
function httpsPost(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'POST', headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'lounashyrra/1.0 (lunch roulette app; contact via github.com/KuiluTrolli780)',
        'Accept': 'application/json',
      }},
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`${hostname} status=${res.statusCode} body_start=${data.slice(0,120)}`);
          try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(`Invalid JSON (status ${res.statusCode})`)); }
        });
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Folders API ──
app.get('/api/folders', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, name, icon, items FROM folders ORDER BY rowid ASC');
    const folders = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      items: JSON.parse(r.items),
    }));
    res.json(folders);
  } catch(e) {
    console.error('GET /api/folders failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/folders', async (req, res) => {
  const folders = req.body;
  if (!Array.isArray(folders)) return res.status(400).json({ error: 'Expected array' });
  try {
    // Replace all folders atomically
    await db.batch([
      { sql: 'DELETE FROM folders', args: [] },
      ...folders.map(f => ({
        sql: 'INSERT INTO folders (id, name, icon, items) VALUES (?, ?, ?, ?)',
        args: [f.id, f.name, f.icon, JSON.stringify(f.items || [])]
      }))
    ]);
    res.json({ ok: true });
  } catch(e) {
    console.error('POST /api/folders failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Overpass proxy with DB cache fallback ──
app.get('/api/restaurants', async (req, res) => {
  // 1. Return in-memory cache if available
  if (restaurantCache) {
    console.log('Serving from memory cache');
    return res.json(restaurantCache);
  }

  // 2. Try to fetch live from Overpass
  const fresh = await fetchFromOverpass();
  if (fresh) {
    restaurantCache = fresh;
    // Save to DB cache for future cold starts
    try {
      await db.execute({
        sql: `INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES ('restaurants', ?, ?)`,
        args: [JSON.stringify(fresh), new Date().toISOString()]
      });
    } catch(e) { console.error('Cache save failed:', e.message); }
    return res.json(fresh);
  }

  // 3. Fall back to DB cache
  try {
    const row = await db.execute({ sql: `SELECT value, updated_at FROM cache WHERE key = 'restaurants'`, args: [] });
    if (row.rows.length > 0) {
      console.log(`Serving DB cache from ${row.rows[0].updated_at}`);
      return res.json(JSON.parse(row.rows[0].value));
    }
  } catch(e) { console.error('DB cache read failed:', e.message); }

  res.status(502).json({ error: 'All Overpass mirrors failed and no cache available' });
});

// Manual refresh endpoint — call this once to populate the cache
app.get('/api/restaurants/refresh', async (req, res) => {
  restaurantCache = null;
  const fresh = await fetchFromOverpass();
  if (fresh) {
    restaurantCache = fresh;
    try {
      await db.execute({
        sql: `INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES ('restaurants', ?, ?)`,
        args: [JSON.stringify(fresh), new Date().toISOString()]
      });
      return res.json({ ok: true, elements: fresh.elements.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  res.status(502).json({ error: 'All mirrors failed' });
});

// ── Walking route proxy ──
app.get('/api/route', async (req, res) => {
  const { fromLat, fromLon, toLat, toLon } = req.query;
  if (!fromLat || !fromLon || !toLat || !toLon) return res.status(400).json({ error: 'Missing params' });
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
  try {
    const json = await httpsGet(url);
    res.json(json);
  } catch(e) {
    console.error('Routing failed:', e.message);
    res.status(502).json({ error: 'Routing failed' });
  }
});

// ── Start ──
initDb().then(() => {
  app.listen(PORT, () => console.log(`Lounashyrrä running on port ${PORT}`));
}).catch(e => {
  console.error('DB init failed:', e.message);
  process.exit(1);
});
