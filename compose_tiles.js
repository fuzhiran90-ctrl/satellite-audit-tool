const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const TILE_DIR = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/esri';
const Z = 18;
const rows = [106461, 106462, 106463];
const cols = [218880, 218881, 218882];
const TILE_SIZE = 256;

function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

async function compose() {
    const composites = [];
    const missing = [];

    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
            const file = path.join(TILE_DIR, `${rows[r]}_${cols[c]}.jpg`);
            if (!fs.existsSync(file)) {
                missing.push(file);
                continue;
            }
            composites.push({
                input: file,
                top: r * TILE_SIZE,
                left: c * TILE_SIZE
            });
        }
    }

    if (missing.length) {
        console.error('Missing tiles:', missing);
        return;
    }

    const width = cols.length * TILE_SIZE;
    const height = rows.length * TILE_SIZE;

    // Create SVG overlay with coordinate grid and center marker
    const minLon = tile2lon(cols[0], Z);
    const maxLon = tile2lon(cols[cols.length - 1] + 1, Z);
    const maxLat = tile2lat(rows[0], Z);
    const minLat = tile2lat(rows[rows.length - 1] + 1, Z);
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // Convert center coordinate to pixel position
    const centerX = ((120.59 - minLon) / (maxLon - minLon)) * width;
    const centerY = ((maxLat - 31.99) / (maxLat - minLat)) * height;

    console.log(`Coverage: lon [${minLon.toFixed(6)}, ${maxLon.toFixed(6)}], lat [${minLat.toFixed(6)}, ${maxLat.toFixed(6)}]`);
    console.log(`Center pixel: ${centerX.toFixed(1)}, ${centerY.toFixed(1)}`);
    console.log(`Resolution: ~${(156543.03 / Math.pow(2, Z) * Math.cos(31.99 * Math.PI / 180)).toFixed(3)} m/pixel at z=${Z}`);

    // Create SVG annotation
    const svgOverlay = Buffer.from(`
<svg width="${width}" height="${height}">
  <!-- Crosshair at target coordinate -->
  <line x1="${centerX - 40}" y1="${centerY}" x2="${centerX + 40}" y2="${centerY}"
        stroke="red" stroke-width="2" opacity="0.9"/>
  <line x1="${centerX}" y1="${centerY - 40}" x2="${centerX}" y2="${centerY + 40}"
        stroke="red" stroke-width="2" opacity="0.9"/>
  <circle cx="${centerX}" cy="${centerY}" r="15" fill="none" stroke="red" stroke-width="2" opacity="0.9"/>

  <!-- Scale bar -->
  <text x="10" y="${height - 15}" fill="white" font-size="14" font-family="monospace"
        stroke="black" stroke-width="2" paint-order="stroke">120.59°E, 31.99°N | ~0.5m/px | Esri World Imagery</text>
</svg>`);

    const outputPath = path.join(__dirname, 'satellite_view.jpg');
    await sharp({
        create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
    })
    .composite(composites)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 93 })
    .toFile(outputPath);

    console.log('Saved:', outputPath);
    console.log('Size:', (fs.statSync(outputPath).size / 1024).toFixed(1), 'KB');
    console.log('Dimensions:', `${width}x${height}`);
}

compose().catch(e => { console.error(e); process.exit(1); });
