# Lounashyrrä — Render Deployment Guide

## Project structure
```
lounashyrra/
├── server.js        ← Express server + API proxy
├── package.json
├── .gitignore
└── public/
    └── index.html   ← The app
```

## Steps

### 1. Push to GitHub
```bash
cd lounashyrra
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/lounashyrra.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to https://render.com → **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Name:** lounashyrra (or anything)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance type:** Free
4. Click **Deploy**

Render will give you a URL like `https://lounashyrra.onrender.com`

## Notes
- Free tier spins down after 15 min inactivity — first load may take ~30s
- To avoid spin-down, upgrade to Starter ($7/mo) or add a cron ping
- The `/api/restaurants` endpoint proxies Overpass API (no CORS issues)
- The `/api/route` endpoint proxies OSM foot routing
