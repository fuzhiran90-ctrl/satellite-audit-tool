const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/v2';
const OUT_DIR = __dirname;
const TARGET_LON = 120.583515;
const TARGET_LAT = 31.986279;

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
            if (!fs.existsSync(file)) { missing++; continue; }
            composites.push({ input: file, top: r * TILE_SIZE, left: c * TILE_SIZE });
        }
    }

    if (composites.length === 0) {
        console.log(`  ${name}: no tiles, skipping`);
        return null;
    }

    const width = cols.length * TILE_SIZE;
    const height = rows.length * TILE_SIZE;
    const minLon = tile2lon(cols[0], z);
    const maxLon = tile2lon(cols[cols.length - 1] + 1, z);
    const maxLat = tile2lat(rows[0], z);
    const minLat = tile2lat(rows[rows.length - 1] + 1, z);
    const resolution = 156543.03 / Math.pow(2, z) * Math.cos(TARGET_LAT * Math.PI / 180);

    const cx = ((TARGET_LON - minLon) / (maxLon - minLon)) * width;
    const cy = ((maxLat - TARGET_LAT) / (maxLat - minLat)) * height;

    const svgText = `<svg width="${width}" height="${height}">
  <line x1="${cx - 60}" y1="${cy}" x2="${cx + 60}" y2="${cy}" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <line x1="${cx}" y1="${cy - 60}" x2="${cx}" y2="${cy + 60}" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="#ff0000" stroke-width="3" opacity="0.9"/>
  <rect x="5" y="5" width="400" height="42" rx="3" fill="rgba(0,0,0,0.6)"/>
  <text x="12" y="24" fill="#00ff88" font-size="13" font-family="monospace" font-weight="bold">${TARGET_LON}°E, ${TARGET_LAT}°N (WGS-84)</text>
  <text x="12" y="40" fill="#cccccc" font-size="11" font-family="monospace">${name} | ~${resolution.toFixed(3)}m/px | Esri World Imagery</text>
  <rect x="10" y="${height - 30}" width="${100/resolution}" height="6" fill="white" opacity="0.8"/>
  <rect x="10" y="${height - 30}" width="${50/resolution}" height="6" fill="black" opacity="0.8"/>
  <text x="12" y="${height - 34}" fill="white" font-size="10" font-family="monospace" stroke="black" stroke-width="1">0</text>
  <text x="${14 + 100/resolution}" y="${height - 34}" fill="white" font-size="10" font-family="monospace" stroke="black" stroke-width="1">100m</text>
</svg>`;

    const outPath = path.join(OUT_DIR, `satellite_v2_${name}.jpg`);
    await sharp({ create: { width, height, channels: 3, background: { r: 50, g: 50, b: 50 } } })
        .composite(composites)
        .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
        .jpeg({ quality: 93 })
        .toFile(outPath);

    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    const areaW = ((maxLon - minLon) * 111320 * Math.cos(TARGET_LAT * Math.PI / 180)).toFixed(0);
    const areaH = ((maxLat - minLat) * 111320).toFixed(0);
    console.log(`  ${name}: ${width}x${height}px, ${sizeKB}KB, ${missing} missing, ~${resolution.toFixed(3)}m/px`);
    console.log(`    覆盖: ${areaW}m x ${areaH}m | [${minLon.toFixed(5)},${maxLon.toFixed(5)}] x [${minLat.toFixed(5)},${maxLat.toFixed(5)}]`);

    return { name, width, height, minLon, maxLon, minLat, maxLat, resolution, path: outPath, areaW, areaH };
}

async function main() {
    console.log('合成卫星图: 120.583515°E, 31.986279°N\n');

    const results = [];

    // z=17: 5x5 tiles, ~1.0m/px, ~1.2km x 1.2km
    const rows17 = [53231, 53232, 53233, 53234, 53235];
    const cols17 = [109437, 109438, 109439, 109440, 109441];
    const r17 = await composeLevel('z17_overview', 17, rows17, cols17);
    if (r17) results.push(r17);

    // z=18: 3x3 tiles, ~0.5m/px, ~384m x 384m
    const rows18 = [106465, 106466, 106467];
    const cols18 = [218877, 218878, 218879];
    const r18 = await composeLevel('z18_detail', 18, rows18, cols18);
    if (r18) results.push(r18);

    // z=19: 3x3 tiles, ~0.25m/px, ~192m x 192m
    const rows19 = [212932, 212933, 212934];
    const cols19 = [437755, 437756, 437757];
    const r19 = await composeLevel('z19_ultra', 19, rows19, cols19);
    if (r19) results.push(r19);

    // z=20: 3x3 tiles, ~0.13m/px, ~96m x 96m
    const rows20 = [425865, 425866, 425867];
    const cols20 = [875511, 875512, 875513];
    const r20 = await composeLevel('z20_extreme', 20, rows20, cols20);
    if (r20) results.push(r20);

    // Generate HTML
    console.log('\n生成 HTML 查看器...');
    let htmlCards = '';
    for (const r of results) {
        htmlCards += `
        <div class="card">
            <h3>${r.name}</h3>
            <div class="meta">${r.width}x${r.height}px | ~${r.resolution.toFixed(3)}m/px | 覆盖 ${r.areaW}m x ${r.areaH}m</div>
            <div class="meta">范围: [${r.minLon.toFixed(5)}, ${r.maxLon.toFixed(5)}] x [${r.minLat.toFixed(5)}, ${r.maxLat.toFixed(5)}]</div>
            <img src="satellite_v2_${r.name}.jpg" loading="lazy" />
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>卫星图 - ${TARGET_LON}°E, ${TARGET_LAT}°N</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI','Microsoft YaHei',sans-serif;padding:24px}
h1{color:#58a6ff;font-size:1.4em}
h2{color:#8b949e;font-size:0.9em;font-weight:normal;margin:4px 0 20px}
.info{background:#161b22;border-left:3px solid #3fb950;padding:14px 18px;margin:16px 0;border-radius:6px;font-size:0.9em;line-height:1.6}
.info strong{color:#3fb950}
.card{background:#161b22;padding:18px;margin:20px 0;border-radius:8px;border:1px solid #30363d}
.card h3{color:#d2a8ff;margin-bottom:6px}
.card .meta{color:#8b949e;font-size:0.8em;margin:2px 0}
.card img{max-width:100%;margin-top:12px;border-radius:4px;border:1px solid #30363d;cursor:zoom-in}
.note{background:#1a1a0e;border:1px solid #d2991d;padding:14px;margin:24px 0;border-radius:6px;font-size:0.85em;line-height:1.5}
.note strong{color:#d2991d}
.scale{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0}
.scale-item{background:#161b22;padding:8px 14px;border-radius:4px;font-size:0.8em;color:#8b949e;border:1px solid #30363d}
.scale-item b{color:#c9d1d9}
</style>
</head>
<body>
<h1>卫星地图核查视图 v2</h1>
<h2>WGS-84: ${TARGET_LON}°E, ${TARGET_LAT}°N — 江苏省苏州市张家港市锦丰镇沿江</h2>
<div class="info">
    📍 <strong>目标坐标:</strong> ${TARGET_LON}°E, ${TARGET_LAT}°N (WGS-84)<br>
    🗺️ <strong>数据源:</strong> Esri World Imagery (ArcGIS REST API)<br>
    🔴 <strong>红色十字</strong> = 目标坐标位置 | 底部比例尺 = 100m
</div>
<div class="scale">
    <div class="scale-item">z17<b> ~1.0m/px</b> 概览</div>
    <div class="scale-item">z18 <b>~0.5m/px</b> 详细</div>
    <div class="scale-item">z19 <b>~0.25m/px</b> 超清</div>
    <div class="scale-item">z20 <b>~0.13m/px</b> 极限</div>
</div>
${htmlCards}
<div class="note">
    ⚠️ <strong>注意:</strong> 当前为 Esri 免费图源最新影像，无法回溯历史日期。<br>
    430/531 新政核查需采购 2025年3-6月存档影像，z18(0.5m)即可满足光伏板面积识别。
</div>
</body>
</html>`;

    const htmlPath = path.join(OUT_DIR, 'satellite_viewer_v2.html');
    fs.writeFileSync(htmlPath, html);
    console.log('HTML: ' + htmlPath);
    console.log('\n全部完成！浏览器打开 satellite_viewer_v2.html');
}

main().catch(e => { console.error(e); process.exit(1); });
