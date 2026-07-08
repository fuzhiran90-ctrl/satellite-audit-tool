const fs = require('fs');
const path = require('path');
const BASE = 'C:/Users/rayjie/AppData/Local/Temp/satellite_tiles/amap';

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

async function downloadTiles(z, cx, cy, grid) {
    const dir = path.join(BASE, 'z' + z);
    fs.mkdirSync(dir, { recursive: true });
    const half = Math.floor(grid / 2);
    const tasks = [];
    for (let row = cy - half; row <= cy + half; row++) {
        for (let col = cx - half; col <= cx + half; col++) {
            const file = path.join(dir, row + '_' + col + '.jpg');
            if (fs.existsSync(file) && fs.statSync(file).size > 500) continue;
            const sub = ((row + col) % 4) + 1;
            const url = 'https://webst0' + sub + '.is.autonavi.com/appmaptile?style=6&x=' + col + '&y=' + row + '&z=' + z;
            tasks.push(
                fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                .then(buf => fs.writeFileSync(file, Buffer.from(buf)))
                .catch(e => console.log('  FAIL z' + z + ' ' + row + '_' + col + ': ' + e.message))
            );
        }
    }
    await Promise.all(tasks);
    const count = fs.readdirSync(dir).filter(f => f.endsWith('.jpg') && fs.statSync(path.join(dir, f)).size > 500).length;
    console.log('z' + z + ': ' + count + '/' + (grid*grid) + ' tiles');
}

async function main() {
    const gcj = wgs84ToGcj02(120.583515, 31.986279);
    console.log('WGS-84: 120.583515, 31.986279');
    console.log('GCJ-02: ' + gcj.lng.toFixed(6) + ', ' + gcj.lat.toFixed(6));

    for (const z of [17, 18, 19]) {
        const n = Math.pow(2, z);
        const x = Math.floor((gcj.lng + 180) / 360 * n);
        const y = Math.floor((1 - Math.log(Math.tan(gcj.lat * Math.PI/180) + 1/Math.cos(gcj.lat * Math.PI/180)) / Math.PI) / 2 * n);
        const res = 156543.03 / Math.pow(2, z) * Math.cos(gcj.lat * Math.PI/180);
        console.log('Downloading z' + z + ': x=' + x + ' y=' + y + ' ~' + res.toFixed(3) + 'm/px, grid=' + (z===17?5:3));
        await downloadTiles(z, x, y, z === 17 ? 5 : 3);
    }
    console.log('\nDone.');
}
main().catch(e => { console.error(e); process.exit(1); });
