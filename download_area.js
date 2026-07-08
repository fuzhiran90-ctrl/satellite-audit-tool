const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BASE = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/area';
const OUT_DIR = __dirname;

// User-selected area in WGS-84
const BOUNDS_WGS = {
    sw: { lng: 120.582022, lat: 31.985061 },
    ne: { lng: 120.585115, lat: 31.987594 },
    center: { lng: 120.583568, lat: 31.986328 }
};

// WGS-84 to GCJ-02
const PI = Math.PI, A = 6378245.0, EE = 0.00669342162296594323;
function tLat(x, y) {
    let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
    r += (20*Math.sin(y*PI) + 40*Math.sin(y/3*PI))*2/3;
    r += (160*Math.sin(y/12*PI) + 320*Math.sin(y*PI/30))*2/3;
    return r;
}
function tLon(x, y) {
    let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
    r += (20*Math.sin(6*x*PI) + 20*Math.sin(2*x*PI))*2/3;
    r += (20*Math.sin(x*PI) + 40*Math.sin(x/3*PI))*2/3;
    r += (150*Math.sin(x/12*PI) + 300*Math.sin(x/30*PI))*2/3;
    return r;
}
function wgs2gcj(lng, lat) {
    const dLat = tLat(lng - 105, lat - 35);
    const dLon = tLon(lng - 105, lat - 35);
    const r = lat / 180 * PI;
    const m = 1 - EE * Math.sin(r) * Math.sin(r);
    const s = Math.sqrt(m);
    return {
        lng: lng + (dLon*180) / (A/s*Math.cos(r)*PI),
        lat: lat + (dLat*180) / ((A*(1-EE))/(m*s)*PI)
    };
}

function lon2tile(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function lat2tile(lat, z) {
    return (1 - Math.log(Math.tan(lat * PI / 180) + 1 / Math.cos(lat * PI / 180)) / PI) / 2 * Math.pow(2, z);
}
function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
    const n = PI - 2 * PI * y / Math.pow(2, z);
    return (180 / PI) * Math.atan(Math.sinh(n));
}

async function downloadAndCompose() {
    // Convert bounds to GCJ-02
    const swGcj = wgs2gcj(BOUNDS_WGS.sw.lng, BOUNDS_WGS.sw.lat);
    const neGcj = wgs2gcj(BOUNDS_WGS.ne.lng, BOUNDS_WGS.ne.lat);
    console.log('WGS-84 bounds: [' + BOUNDS_WGS.sw.lng + ',' + BOUNDS_WGS.ne.lng + '] x [' + BOUNDS_WGS.sw.lat + ',' + BOUNDS_WGS.ne.lat + ']');
    console.log('GCJ-02 bounds: [' + swGcj.lng.toFixed(6) + ',' + neGcj.lng.toFixed(6) + '] x [' + swGcj.lat.toFixed(6) + ',' + neGcj.lat.toFixed(6) + ']');

    // Area size in meters
    const midLatRad = BOUNDS_WGS.center.lat * PI / 180;
    const areaWM = (BOUNDS_WGS.ne.lng - BOUNDS_WGS.sw.lng) * 111320 * Math.cos(midLatRad);
    const areaHM = (BOUNDS_WGS.ne.lat - BOUNDS_WGS.sw.lat) * 111320;
    console.log('Area: ' + areaWM.toFixed(0) + 'm x ' + areaHM.toFixed(0) + 'm = ' + (areaWM * areaHM / 10000).toFixed(2) + ' ha\n');

    const results = [];

    for (const z of [18, 19]) {
        const res = 156543.03 / Math.pow(2, z) * Math.cos(midLatRad);
        const tileMinX = Math.floor(lon2tile(swGcj.lng, z));
        const tileMaxX = Math.floor(lon2tile(neGcj.lng, z));
        const tileMinY = Math.floor(lat2tile(neGcj.lat, z));  // min lat = max tile y
        const tileMaxY = Math.floor(lat2tile(swGcj.lat, z));  // max lat = min tile y

        const cols = tileMaxX - tileMinX + 1;
        const rows = tileMaxY - tileMinY + 1;
        console.log('z' + z + ': tiles ' + rows + 'x' + cols + ' = ' + (rows*cols) + ' tiles, ~' + res.toFixed(3) + 'm/px');

        // Download tiles
        const zDir = path.join(BASE, 'z' + z);
        fs.mkdirSync(zDir, { recursive: true });

        const tasks = [];
        for (let row = tileMinY; row <= tileMaxY; row++) {
            for (let col = tileMinX; col <= tileMaxX; col++) {
                const file = path.join(zDir, row + '_' + col + '.jpg');
                if (fs.existsSync(file) && fs.statSync(file).size > 500) continue;
                const sub = ((row + col) % 4) + 1;
                const url = 'https://webst0' + sub + '.is.autonavi.com/appmaptile?style=6&x=' + col + '&y=' + row + '&z=' + z;
                tasks.push(
                    fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
                    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                    .then(buf => fs.writeFileSync(file, Buffer.from(buf)))
                    .catch(e => console.log('  FAIL ' + row + '_' + col + ': ' + e.message))
                );
            }
        }
        await Promise.all(tasks);

        // Verify and composite
        const composites = [];
        let missing = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const f = path.join(zDir, (tileMinY + r) + '_' + (tileMinX + c) + '.jpg');
                if (!fs.existsSync(f) || fs.statSync(f).size < 500) { missing++; continue; }
                composites.push({ input: f, top: r * 256, left: c * 256 });
            }
        }

        if (composites.length === 0) { console.log('  No tiles!'); continue; }

        const fullW = cols * 256, fullH = rows * 256;
        console.log('  Compositing ' + composites.length + '/' + (rows*cols) + ' tiles into ' + fullW + 'x' + fullH);

        // Calculate crop region to match the exact GCJ-02 bounds
        const imgMinLon = tile2lon(tileMinX, z);
        const imgMaxLon = tile2lon(tileMaxX + 1, z);
        const imgMaxLat = tile2lat(tileMinY, z);
        const imgMinLat = tile2lat(tileMaxY + 1, z);

        // Where the requested bounds fall within the image
        const cropLeft = Math.max(0, Math.floor((swGcj.lng - imgMinLon) / (imgMaxLon - imgMinLon) * fullW));
        const cropTop = Math.max(0, Math.floor((imgMaxLat - neGcj.lat) / (imgMaxLat - imgMinLat) * fullH));
        const cropRight = Math.min(fullW, Math.ceil((neGcj.lng - imgMinLon) / (imgMaxLon - imgMinLon) * fullW));
        const cropBottom = Math.min(fullH, Math.ceil((imgMaxLat - swGcj.lat) / (imgMaxLat - imgMinLat) * fullH));

        const cropW = cropRight - cropLeft;
        const cropH = cropBottom - cropTop;
        console.log('  Crop: left=' + cropLeft + ' top=' + cropTop + ' w=' + cropW + ' h=' + cropH);

        // Center of the selected area in pixel coords
        const centerGcj = wgs2gcj(BOUNDS_WGS.center.lng, BOUNDS_WGS.center.lat);
        const centerPx = ((centerGcj.lng - imgMinLon) / (imgMaxLon - imgMinLon)) * fullW - cropLeft;
        const centerPy = ((imgMaxLat - centerGcj.lat) / (imgMaxLat - imgMinLat)) * fullH - cropTop;

        // Scale bar
        const scalePx = 100 / res;
        const radiusPx = 100 / res; // 100m radius

        const svg = Buffer.from(`<svg width="${cropW}" height="${cropH}">
  <defs><filter id="s"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="black" flood-opacity="0.6"/></filter></defs>
  <!-- 100m radius circle -->
  <circle cx="${centerPx}" cy="${centerPy}" r="${radiusPx}" fill="none" stroke="#00ff88" stroke-width="2" stroke-dasharray="8,4" opacity="0.7" filter="url(#s)"/>
  <!-- Center crosshair -->
  <line x1="${centerPx-40}" y1="${centerPy}" x2="${centerPx+40}" y2="${centerPy}" stroke="#ff0000" stroke-width="2" opacity="0.9" filter="url(#s)"/>
  <line x1="${centerPx}" y1="${centerPy-40}" x2="${centerPx}" y2="${centerPy+40}" stroke="#ff0000" stroke-width="2" opacity="0.9" filter="url(#s)"/>
  <circle cx="${centerPx}" cy="${centerPy}" r="15" fill="none" stroke="#ff0000" stroke-width="2" opacity="0.9"/>
  <circle cx="${centerPx}" cy="${centerPy}" r="2" fill="#ff0000" opacity="0.9"/>
  <!-- Info box -->
  <rect x="6" y="6" width="460" height="46" rx="3" fill="rgba(0,0,0,0.55)"/>
  <text x="12" y="24" fill="#00ff88" font-size="12" font-family="monospace" font-weight="bold">${BOUNDS_WGS.center.lng}°E, ${BOUNDS_WGS.center.lat}°N (WGS-84)</text>
  <text x="12" y="42" fill="#cccccc" font-size="10" font-family="monospace">z${z} | ~${res.toFixed(2)}m/px | 高德卫星图 | 绿圈=100m | ${areaWM.toFixed(0)}m×${areaHM.toFixed(0)}m</text>
  <!-- Scale bar -->
  <rect x="10" y="${cropH-28}" width="${scalePx}" height="5" fill="white" opacity="0.85" rx="1"/>
  <rect x="10" y="${cropH-28}" width="${scalePx/2}" height="5" fill="black" opacity="0.7" rx="1"/>
  <text x="10" y="${cropH-32}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#s)">0</text>
  <text x="${scalePx+14}" y="${cropH-32}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#s)">100m</text>
  <!-- Corner coords -->
  <text x="${cropW-130}" y="${cropH-10}" fill="white" font-size="8" font-family="monospace" stroke="black" stroke-width="1" filter="url(#s)">${BOUNDS_WGS.sw.lat.toFixed(5)},${BOUNDS_WGS.sw.lng.toFixed(5)}</text>
  <text x="5" y="${cropH-10}" fill="white" font-size="8" font-family="monospace" stroke="black" stroke-width="1" filter="url(#s)">${BOUNDS_WGS.ne.lat.toFixed(5)},${BOUNDS_WGS.ne.lng.toFixed(5)}</text>
</svg>`);

        // Composite then crop
        const outPath = path.join(OUT_DIR, 'area_z' + z + '.jpg');
        await sharp({ create: { width: fullW, height: fullH, channels: 3, background: {r:30,g:30,b:30} } })
            .composite(composites)
            .composite([{ input: svg, top: cropTop, left: cropLeft }])
            .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
            .jpeg({ quality: 93 })
            .toFile(outPath);

        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
        const outMeta = await sharp(outPath).metadata();
        console.log('  -> ' + outPath + ': ' + outMeta.width + 'x' + outMeta.height + ' ' + sizeKB + 'KB');
        results.push({ z, path: outPath, w: outMeta.width, h: outMeta.height, res, areaWM, areaHM });
    }

    // HTML viewer
    console.log('\nGenerating HTML...');
    let cards = '';
    for (const r of results) {
        cards += `
        <div class="card">
            <h3>z${r.z} <span class="badge">${r.res.toFixed(2)}m/px</span></h3>
            <div class="meta">${r.w}x${r.h}px | 覆盖 ${r.areaWM.toFixed(0)}m x ${r.areaHM.toFixed(0)}m</div>
            <a href="area_z${r.z}.jpg" target="_blank"><img src="area_z${r.z}.jpg" /></a>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>框选区域卫星图</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI','Microsoft YaHei',sans-serif;padding:24px}
h1{color:#58a6ff;font-size:1.2em}
h2{color:#8b949e;font-size:0.8em;font-weight:normal;margin:4px 0 18px}
.info{background:#161b22;border-left:3px solid #3fb950;padding:14px 18px;margin:16px 0;border-radius:6px;font-size:0.85em;line-height:1.7}
.info strong{color:#3fb950}
.card{background:#161b22;padding:18px;margin:20px 0;border-radius:8px;border:1px solid #30363d}
.card h3{color:#d2a8ff;margin-bottom:6px}
.badge{background:#238636;color:#fff;font-size:0.75em;padding:2px 8px;border-radius:10px;margin-left:8px}
.meta{color:#8b949e;font-size:0.8em;margin:2px 0 8px}
.card img{max-width:100%;border-radius:4px;border:1px solid #30363d}
.note{background:#1a1a0e;border:1px solid #d2991d;padding:14px;margin:24px 0;border-radius:6px;font-size:0.85em}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0;font-size:0.8em;color:#8b949e}
</style>
</head>
<body>
<h1>框选区域卫星图 — 高德卫星图</h1>
<h2>中心: ${BOUNDS_WGS.center.lng}°E, ${BOUNDS_WGS.center.lat}°N | 区域: ${results[0]?.areaWM?.toFixed(0) || '?'}m × ${results[0]?.areaHM?.toFixed(0) || '?'}m</h2>
<div class="info">
    📍 <strong>WGS-84 中心:</strong> ${BOUNDS_WGS.center.lng}°E, ${BOUNDS_WGS.center.lat}°N<br>
    📐 <strong>范围:</strong> [${BOUNDS_WGS.sw.lng}, ${BOUNDS_WGS.ne.lng}] x [${BOUNDS_WGS.sw.lat}, ${BOUNDS_WGS.ne.lat}]<br>
    🛰️ <strong>数据源:</strong> 高德卫星图 | 🔴 红色十字=中心 | 🟢 绿色虚线圈=100m半径
</div>
<div class="legend">
    <span>🔴 红色十字 = 区域中心</span>
    <span>🟢 绿色虚线圆 = 100m 半径</span>
</div>
${cards}
<div class="note">
    ✅ 这是你框选区域的精确卫星图。如果能在这个区域内看到规则排列的深色矩形块，那就是光伏板阵列。<br>
    z19 (0.25m/px) 级别下，单块光伏板约占 9×4 像素，可清晰分辨。
</div>
</body>
</html>`;

    fs.writeFileSync(path.join(OUT_DIR, 'area_viewer.html'), html);
    console.log('Done! Open area_viewer.html');
}

downloadAndCompose().catch(e => { console.error(e); process.exit(1); });
