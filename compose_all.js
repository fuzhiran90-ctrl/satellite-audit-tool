const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/esri';
const OUT_DIR = __dirname;

function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
function getTileCoords(lat, lon, z) {
    const n = Math.pow(2, z);
    return {
        x: Math.floor((lon + 180) / 360 * n),
        y: Math.floor((1 - Math.log(Math.tan(lat * Math.PI/180) + 1/Math.cos(lat * Math.PI/180)) / Math.PI) / 2 * n)
    };
}

async function composeLevel(name, z, rows, cols, label) {
    const TILE_SIZE = 256;
    const composites = [];
    let missing = 0;

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
            const file = path.join(BASE, 'z' + z, `${rows[r]}_${cols[c]}.jpg`);
            if (!fs.existsSync(file)) {
                missing++;
                continue;
            }
            composites.push({
                input: file,
                top: r * TILE_SIZE,
                left: c * TILE_SIZE
            });
        }
    }

    if (composites.length === 0) {
        console.log(`  ${name}: no tiles found, skipping`);
        return null;
    }

    const width = cols.length * TILE_SIZE;
    const height = rows.length * TILE_SIZE;

    const minLon = tile2lon(cols[0], z);
    const maxLon = tile2lon(cols[cols.length - 1] + 1, z);
    const maxLat = tile2lat(rows[0], z);
    const minLat = tile2lat(rows[rows.length - 1] + 1, z);
    const resolution = 156543.03 / Math.pow(2, z) * Math.cos(31.99 * Math.PI / 180);

    // Center marker at 120.59, 31.99
    const cx = ((120.59 - minLon) / (maxLon - minLon)) * width;
    const cy = ((maxLat - 31.99) / (maxLat - minLat)) * height;

    const svg = Buffer.from(`<svg width="${width}" height="${height}">
  <line x1="${cx - 60}" y1="${cy}" x2="${cx + 60}" y2="${cy}" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <line x1="${cx}" y1="${cy - 60}" x2="${cx}" y2="${cy + 60}" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <rect x="5" y="5" width="380" height="40" rx="3" fill="rgba(0,0,0,0.6)"/>
  <text x="12" y="23" fill="#ffffff" font-size="13" font-family="monospace" font-weight="bold">120.59°E, 31.99°N</text>
  <text x="12" y="39" fill="#cccccc" font-size="11" font-family="monospace">${label} | ~${resolution.toFixed(2)}m/px | Esri World Imagery</text>
  <text x="${width - 100}" y="${height - 8}" fill="#ffffff" font-size="10" font-family="monospace" stroke="black" stroke-width="1">${minLat.toFixed(5)},${minLon.toFixed(5)}</text>
  <text x="5" y="${height - 8}" fill="#ffffff" font-size="10" font-family="monospace" stroke="black" stroke-width="1">${maxLat.toFixed(5)},${maxLon.toFixed(5)}</text>
  <!-- Scale bar: 100m -->
  <rect x="10" y="${height - 30}" width="${100/resolution}" height="6" fill="white" opacity="0.9"/>
  <rect x="10" y="${height - 30}" width="${50/resolution}" height="6" fill="black" opacity="0.9"/>
  <text x="10" y="${height - 34}" fill="white" font-size="10" font-family="monospace" stroke="black" stroke-width="1">0</text>
  <text x="${12 + 100/resolution}" y="${height - 34}" fill="white" font-size="10" font-family="monospace" stroke="black" stroke-width="1">100m</text>
</svg>`);

    const outPath = path.join(OUT_DIR, `satellite_${name}.jpg`);
    await sharp({
        create: { width, height, channels: 3, background: { r: 50, g: 50, b: 50 } }
    })
    .composite(composites)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(outPath);

    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`  ${name}: ${width}x${height}, ${sizeKB}KB, ${missing} tiles missing, ~${resolution.toFixed(3)}m/px`);
    console.log(`    Coverage: [${minLon.toFixed(5)},${maxLon.toFixed(5)}] x [${minLat.toFixed(5)},${maxLat.toFixed(5)}]`);

    return { name, width, height, minLon, maxLon, minLat, maxLat, resolution, path: outPath };
}

async function main() {
    console.log('Composing satellite views for 120.59, 31.99...\n');

    const results = [];

    // z=17: 5x5 tiles, ~1.0m/px, ~1.28km x 1.28km
    const t17 = getTileCoords(31.99, 120.59, 17);
    const rows17 = [t17.y-2, t17.y-1, t17.y, t17.y+1, t17.y+2];
    const cols17 = [t17.x-2, t17.x-1, t17.x, t17.x+1, t17.x+2];
    const r17 = await composeLevel('z17_overview', 17, rows17, cols17, 'Zoom 17 概览');
    if (r17) results.push(r17);

    // z=18: 3x3 tiles, ~0.5m/px, ~384m x 384m
    const t18 = getTileCoords(31.99, 120.59, 18);
    const rows18 = [t18.y-1, t18.y, t18.y+1];
    const cols18 = [t18.x-1, t18.x, t18.x+1];
    const r18 = await composeLevel('z18_detail', 18, rows18, cols18, 'Zoom 18 详细');
    if (r18) results.push(r18);

    // z=19: 2x3 tiles (some tiles may be missing), ~0.25m/px
    const t19 = getTileCoords(31.99, 120.59, 19);
    const rows19 = [t19.y-1, t19.y, t19.y+1];
    const cols19 = [t19.x-1, t19.x, t19.x+1];
    const r19 = await composeLevel('z19_ultra', 19, rows19, cols19, 'Zoom 19 超清');
    if (r19) results.push(r19);

    // Generate HTML viewer
    console.log('\nGenerating HTML viewer...');
    let htmlImgs = '';
    for (const r of results) {
        htmlImgs += `
        <div class="image-card">
            <h3>${r.name}</h3>
            <p>${r.width}x${r.height}px | ~${r.resolution.toFixed(3)}m/px</p>
            <p>范围: [${r.minLon.toFixed(5)}, ${r.maxLon.toFixed(5)}] x [${r.minLat.toFixed(5)}, ${r.maxLat.toFixed(5)}]</p>
            <img src="satellite_${r.name}.jpg" loading="lazy" style="max-width:100%;border:1px solid #333;border-radius:4px" />
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>卫星地图 - 120.59°E, 31.99°N (江苏) - 光伏核查</title>
<style>
  body { background: #1a1a2e; color: #eee; font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; }
  h1 { color: #00ff88; font-size: 1.5em; margin-bottom: 0; }
  .subtitle { color: #888; font-size: 0.9em; margin-top: 4px; }
  .location { background: #16213e; border-left: 3px solid #00ff88; padding: 12px 16px; margin: 16px 0; border-radius: 4px; }
  .location strong { color: #00ff88; }
  .image-card { background: #16213e; padding: 16px; margin: 20px 0; border-radius: 8px; }
  .image-card h3 { margin: 0 0 4px 0; color: #ffd700; }
  .image-card p { margin: 4px 0; color: #aaa; font-size: 0.85em; }
  .legend { background: #16213e; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 0.9em; }
  .legend span { display: inline-block; width: 40px; height: 3px; margin: 0 6px; vertical-align: middle; }
  .red-line { background: #ff0000; } .green-line { background: #00ff88; }
  img { display: block; margin-top: 10px; cursor: zoom-in; }
  .note { background: #2a1a0e; border: 1px solid #ff8800; padding: 12px; margin: 20px 0; border-radius: 4px; font-size: 0.85em; }
</style>
</head>
<body>
<h1>卫星地图核查视图</h1>
<p class="subtitle">坐标: 120.59°E, 31.99°N — 江苏省苏州市张家港市附近</p>
<div class="location">
    📍 <strong>目标坐标:</strong> 120.590000°E, 31.990000°N<br>
    🗺️ <strong>数据源:</strong> Esri World Imagery (通过 ArcGIS REST API)<br>
    📐 <strong>分辨率:</strong> z=18 约 0.51m/px (满足亚米级要求)<br>
    🔴 红色十字 = 目标坐标位置
</div>
<div class="legend">
    分辨率对比:
    <span class="red-line"></span> z17=~1.0m/px (概览) |
    <span class="green-line"></span> z18=~0.5m/px (详细识别) |
    <span class="red-line"></span> z19=~0.25m/px (单板识别)
</div>
${htmlImgs}
<div class="note">
    ⚠️ <strong>说明:</strong> Esri World Imagery 为当前最新影像（非历史影像）。<br>
    430/531 新政核查需采购 2025年3-6月的历史卫星影像（吉林一号/高分多模/北京二号）。<br>
    当前图片仅演示分辨率效果 — z19 级别的 0.25m 分辨率可清晰分辨单块光伏板（约2.4㎡/块）。
</div>
</body>
</html>`;

    const htmlPath = path.join(OUT_DIR, 'satellite_viewer.html');
    fs.writeFileSync(htmlPath, html);
    console.log('HTML viewer saved:', htmlPath);
    console.log('\nDone! Open satellite_viewer.html in a browser.');
}

main().catch(e => { console.error(e); process.exit(1); });
