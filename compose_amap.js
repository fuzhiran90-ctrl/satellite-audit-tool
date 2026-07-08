const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/amap';
const OUT_DIR = __dirname;

// Target WGS-84
const TARGET_LON_WGS = 120.583515;
const TARGET_LAT_WGS = 31.986279;

// WGS-84 to GCJ-02
function wgs84ToGcj02(lng, lat) {
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
    const dLat = tLat(lng - 105, lat - 35);
    const dLon = tLon(lng - 105, lat - 35);
    const radLat = lat / 180 * PI;
    const m = 1 - EE * Math.sin(radLat) * Math.sin(radLat);
    const sm = Math.sqrt(m);
    return {
        lng: lng + (dLon*180) / (A/sm*Math.cos(radLat)*PI),
        lat: lat + (dLat*180) / ((A*(1-EE))/(m*sm)*PI)
    };
}

const TARGET = wgs84ToGcj02(TARGET_LON_WGS, TARGET_LAT_WGS);
console.log('Target GCJ-02: ' + TARGET.lng.toFixed(6) + ', ' + TARGET.lat.toFixed(6));

function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

async function composeLevel(name, z, rows, cols) {
    const TILE_SIZE = 256;
    const composites = [];
    let missing = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
            const file = path.join(BASE, 'z' + z, `${rows[r]}_${cols[c]}.jpg`);
            if (!fs.existsSync(file) || fs.statSync(file).size < 500) { missing++; continue; }
            composites.push({ input: file, top: r * TILE_SIZE, left: c * TILE_SIZE });
        }
    }

    if (composites.length === 0) { console.log('  ' + name + ': no tiles'); return null; }

    const width = cols.length * TILE_SIZE;
    const height = rows.length * TILE_SIZE;

    // Amap tiles use GCJ-02, so we calculate bounds in GCJ-02 space
    const minLon = tile2lon(cols[0], z);
    const maxLon = tile2lon(cols[cols.length - 1] + 1, z);
    const maxLat = tile2lat(rows[0], z);
    const minLat = tile2lat(rows[rows.length - 1] + 1, z);
    const resolution = 156543.03 / Math.pow(2, z) * Math.cos(TARGET_LAT_WGS * Math.PI / 180);

    // Target position in pixels (using GCJ-02 coords)
    const cx = ((TARGET.lng - minLon) / (maxLon - minLon)) * width;
    const cy = ((maxLat - TARGET.lat) / (maxLat - minLat)) * height;

    // scale bar: 100m
    const scalePx = 100 / resolution;

    const svgText = `<svg width="${width}" height="${height}">
  <defs>
    <filter id="shadow">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="black" flood-opacity="0.7"/>
    </filter>
  </defs>
  <!-- Crosshair -->
  <line x1="${cx-50}" y1="${cy}" x2="${cx+50}" y2="${cy}" stroke="#ff0000" stroke-width="2" opacity="0.9" filter="url(#shadow)"/>
  <line x1="${cx}" y1="${cy-50}" x2="${cx}" y2="${cy+50}" stroke="#ff0000" stroke-width="2" opacity="0.9" filter="url(#shadow)"/>
  <circle cx="${cx}" cy="${cy}" r="18" fill="none" stroke="#ff0000" stroke-width="2" opacity="0.9" filter="url(#shadow)"/>
  <circle cx="${cx}" cy="${cy}" r="3" fill="#ff0000" opacity="0.9"/>
  <!-- 100m radius circle -->
  <circle cx="${cx}" cy="${cy}" r="${100/resolution}" fill="none" stroke="#00ff88" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.6"/>
  <!-- Info bar -->
  <rect x="5" y="5" width="440" height="44" rx="3" fill="rgba(0,0,0,0.55)"/>
  <text x="12" y="23" fill="#00ff88" font-size="12" font-family="monospace" font-weight="bold">${TARGET_LON_WGS}°E, ${TARGET_LAT_WGS}°N (WGS-84)</text>
  <text x="12" y="41" fill="#cccccc" font-size="10" font-family="monospace">${name} | ~${resolution.toFixed(3)}m/px | 高德卫星图 | 虚线圆=100m半径</text>
  <!-- Scale bar -->
  <rect x="10" y="${height - 28}" width="${scalePx}" height="5" fill="white" opacity="0.85" rx="1"/>
  <rect x="10" y="${height - 28}" width="${scalePx/2}" height="5" fill="black" opacity="0.7" rx="1"/>
  <text x="10" y="${height - 32}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#shadow)">0</text>
  <text x="${12 + scalePx}" y="${height - 32}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#shadow)">100m</text>
  <!-- Corner coords -->
  <text x="${width - 120}" y="${height - 8}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#shadow)">${minLat.toFixed(5)},${minLon.toFixed(5)}</text>
  <text x="5" y="${height - 8}" fill="white" font-size="9" font-family="monospace" stroke="black" stroke-width="1" filter="url(#shadow)">${maxLat.toFixed(5)},${maxLon.toFixed(5)}</text>
</svg>`;

    const outPath = path.join(OUT_DIR, 'satellite_amap_' + name + '.jpg');
    await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 30, b: 30 } } })
        .composite(composites)
        .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
        .jpeg({ quality: 93 })
        .toFile(outPath);

    const areaW = ((maxLon - minLon) * 111320 * Math.cos(TARGET_LAT_WGS * Math.PI / 180)).toFixed(0);
    const areaH = ((maxLat - minLat) * 111320).toFixed(0);
    console.log('  ' + name + ': ' + width + 'x' + height + 'px, ~' + resolution.toFixed(3) + 'm/px, ' + areaW + 'm x ' + areaH + 'm, ' + missing + ' missing');

    return { name, width, height, minLon, maxLon, minLat, maxLat, resolution, areaW, areaH };
}

async function main() {
    console.log('高德卫星图合成: WGS-84 ' + TARGET_LON_WGS + ', ' + TARGET_LAT_WGS + '\n');

    const results = [];

    const r17 = await composeLevel('z17_overview', 17,
        [53232, 53233, 53234, 53235, 53236],
        [109438, 109439, 109440, 109441, 109442]);
    if (r17) results.push(r17);

    const r18 = await composeLevel('z18_detail', 18,
        [106467, 106468, 106469],
        [218880, 218881, 218882]);
    if (r18) results.push(r18);

    const r19 = await composeLevel('z19_ultra', 19,
        [212936, 212937, 212938],
        [437761, 437762, 437763]);
    if (r19) results.push(r19);

    // Generate HTML
    console.log('\nGenerating HTML viewer...');
    let cards = '';
    for (const r of results) {
        cards += `
        <div class="card">
            <h3>${r.name} <span class="badge">${r.resolution.toFixed(2)}m/px</span></h3>
            <div class="meta">${r.width}x${r.height}px | 覆盖 ${r.areaW}m x ${r.areaH}m</div>
            <div class="meta">范围(GCJ-02): [${r.minLon.toFixed(5)}, ${r.maxLon.toFixed(5)}] x [${r.minLat.toFixed(5)}, ${r.maxLat.toFixed(5)}]</div>
            <a href="satellite_amap_${r.name}.jpg" target="_blank"><img src="satellite_amap_${r.name}.jpg" loading="lazy" /></a>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>卫星地图 - ${TARGET_LON_WGS}°E, ${TARGET_LAT_WGS}°N</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI','Microsoft YaHei',sans-serif;padding:24px}
h1{color:#58a6ff;font-size:1.3em}
h2{color:#8b949e;font-size:0.85em;font-weight:normal;margin:4px 0 18px}
.info{background:#161b22;border-left:3px solid #3fb950;padding:14px 18px;margin:16px 0;border-radius:6px;font-size:0.9em;line-height:1.7}
.info strong{color:#3fb950}
.card{background:#161b22;padding:18px;margin:20px 0;border-radius:8px;border:1px solid #30363d}
.card h3{color:#d2a8ff;margin-bottom:6px}
.badge{background:#238636;color:#fff;font-size:0.75em;padding:2px 8px;border-radius:10px;margin-left:8px}
.meta{color:#8b949e;font-size:0.8em;margin:2px 0}
.card img{max-width:100%;margin-top:12px;border-radius:4px;border:1px solid #30363d;cursor:pointer}
.note{background:#1a1a0e;border:1px solid #d2991d;padding:14px;margin:24px 0;border-radius:6px;font-size:0.85em;line-height:1.6}
.note strong{color:#d2991d}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0}
.legend span{font-size:0.8em;color:#8b949e}
.legend .red{color:#ff4444}.legend .green{color:#00ff88}
</style>
</head>
<body>
<h1>卫星地图核查视图 — 高德卫星图</h1>
<h2>WGS-84: ${TARGET_LON_WGS}°E, ${TARGET_LAT_WGS}°N | 江苏省苏州市张家港市锦丰镇沿江</h2>
<div class="info">
    📍 <strong>WGS-84:</strong> ${TARGET_LON_WGS}°E, ${TARGET_LAT_WGS}°N<br>
    🗺️ <strong>坐标系统:</strong> GCJ-02 (高德/国标) — WGS-84 已自动转换<br>
    🛰️ <strong>数据源:</strong> 高德卫星图 (webst0{1-4}.is.autonavi.com)<br>
    🔴 <strong>红色十字</strong> = 目标位置 | <span style="color:#00ff88">绿色虚线圈</span> = 100m 半径
</div>
<div class="legend">
    <span class="red">━━ 红色十字 = 目标坐标</span>
    <span class="green">┅┅ 绿色虚线圆 = 100m 半径</span>
    <span>底部 = 100m 比例尺</span>
</div>
${cards}
<div class="note">
    ⚠️ <strong>注意:</strong><br>
    • 高德卫星图为当前最新影像，无法回溯历史日期<br>
    • 430/531 核查需采购 2025年3-6月历史存档影像<br>
    • z18 (0.5m/px) 即可满足光伏板面积识别，可清楚分辨屋顶光伏阵列
</div>
</body>
</html>`;

    const htmlPath = path.join(OUT_DIR, 'satellite_viewer_amap.html');
    fs.writeFileSync(htmlPath, html);
    console.log('HTML: ' + htmlPath);
    console.log('\nDone! Open satellite_viewer_amap.html in browser.');
}
main().catch(e => { console.error(e); process.exit(1); });
