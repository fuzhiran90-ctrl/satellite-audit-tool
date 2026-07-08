// 星图云 API 诊断脚本
// 用法: node api_diagnose.js <你的token>
const TOKEN = process.argv[2];

if (!TOKEN) {
    console.log('用法: node api_diagnose.js <你的token>');
    console.log('请提供星图云 API Token');
    process.exit(1);
}

console.log('========================================');
console.log('  星图云 API 诊断测试');
console.log('  Token: ' + TOKEN.substring(0, 16) + '...');
console.log('========================================\n');

async function test(name, url, options = {}) {
    console.log('[' + name + ']');
    console.log('  URL: ' + (options.method || 'GET') + ' ' + url);
    if (options.body) console.log('  Body: ' + options.body);
    if (options.headers) console.log('  Headers: ' + JSON.stringify(options.headers));

    try {
        const resp = await fetch(url, {
            method: options.method || 'GET',
            headers: { 'User-Agent': 'Geovis-Diagnose/1.0', ...(options.headers || {}) },
            body: options.body || undefined
        });
        const status = resp.status;
        const contentType = resp.headers.get('content-type') || '';
        const text = await resp.text();

        console.log('  Status: ' + status + ' ' + resp.statusText);
        console.log('  Content-Type: ' + contentType);

        // Truncate long responses
        let display = text;
        if (display.length > 2000) display = display.substring(0, 2000) + '\n  ... (truncated, total ' + text.length + ' bytes)';

        // Try to pretty-print JSON
        if (contentType.includes('json')) {
            try {
                const json = JSON.parse(text);
                display = JSON.stringify(json, null, 2);
                if (display.length > 2000) display = display.substring(0, 2000) + '\n  ... (truncated)';
            } catch(e) {}
        }

        console.log('  Response:');
        display.split('\n').forEach(line => console.log('    ' + line));

        console.log('');
        return { ok: status >= 200 && status < 300, status, text, contentType };
    } catch(e) {
        console.log('  ERROR: ' + e.message);
        console.log('  可能原因: DNS解析失败、网络不通、CORS(仅浏览器)');
        console.log('');
        return { ok: false, error: e.message };
    }
}

async function main() {
    let pass = 0, fail = 0;

    // Test 1: 当前影像瓦片 (最简单的GET请求)
    console.log('--- 测试1: 当前卫星影像瓦片 ---');
    const r1 = await test('当前影像',
        'https://api.open.geovisearth.com/pj/base/v1/img/6/53/23?format=webp&tmsIds=w&token=' + TOKEN);
    if (r1.ok && !r1.text.includes('error') && !r1.text.includes('fail')) {
        console.log('  ✓ 当前影像 API 正常');
        pass++;
    } else {
        console.log('  ✗ 当前影像 API 异常');
        fail++;
    }

    // Test 2: 历史影像查询 (bbox around Zhangjiagang)
    console.log('--- 测试2: 历史影像查询 ---');
    const bbox = '120.54,31.97,120.56,31.99';
    const r2 = await test('历史影像',
        'https://api.open.geovisearth.com/v2/timeSeries/history/city?bbox=' + bbox + '&token=' + TOKEN);
    if (r2.ok) {
        try {
            const data = JSON.parse(r2.text);
            const cities = Object.keys(data);
            if (cities.length > 0) {
                let totalYears = 0;
                cities.forEach(c => { totalYears += Array.isArray(data[c]) ? data[c].length : 0; });
                console.log('  ✓ 历史影像 API 正常 — ' + cities.length + ' 城市, ' + totalYears + ' 年份');
                console.log('  覆盖城市: ' + cities.join(', '));
                pass++;
            } else {
                console.log('  ⚠ 历史影像 API 正常，但该区域(Zhangjiagang)无覆盖数据');
                console.log('  提示: 历史影像仅覆盖主要城市(上海/合肥等), 县级市暂未覆盖');
                pass++;
            }
        } catch(e) {
            console.log('  ✗ 历史影像返回非JSON: ' + r2.text.substring(0, 100));
            fail++;
        }
    } else {
        console.log('  ✗ 历史影像 API 请求失败');
        fail++;
    }

    // Test 3: 正向地理编码 (正确端点 GET /pj/geo/v2/geocode/geo)
    console.log('--- 测试3: 正向地理编码 (keyword=张家港) ---');
    const r3 = await test('地理编码(GET)',
        'https://api.open.geovisearth.com/pj/geo/v2/geocode/geo?keyword=' + encodeURIComponent('张家港') + '&region=' + encodeURIComponent('苏州市') + '&pageSize=5&token=' + TOKEN,
        { method: 'GET' });
    if (r3.ok) {
        try {
            const data = JSON.parse(r3.text);
            if (data.code === 0) {
                console.log('  ✓ 地理编码 API 正常');
                const records = Array.isArray(data.data) ? data.data : [];
                console.log('  返回 ' + records.length + ' 条结果');
                pass++;
            } else {
                console.log('  ✗ 地理编码返回错误: ' + (data.info || data.msg || data.code));
                fail++;
            }
        } catch(e) {
            console.log('  ✗ 地理编码返回非JSON');
            fail++;
        }
    } else {
        console.log('  ✗ 地理编码 API 异常');
        fail++;
    }

    // Test 4: 地理编码 - 精确地址
    console.log('--- 测试4: 地理编码 (永凝路218号) ---');
    const r4 = await test('地理编码(详细地址)',
        'https://api.open.geovisearth.com/pj/geo/v2/geocode/geo?keyword=' + encodeURIComponent('永凝路218号') + '&region=' + encodeURIComponent('苏州市') + '&pageSize=5&token=' + TOKEN,
        { method: 'GET' });
    if (r4.ok) {
        try {
            const data = JSON.parse(r4.text);
            if (data.code === 0 && Array.isArray(data.data) && data.data.length > 0) {
                console.log('  ✓ 详细地址查询 正常, ' + data.data.length + ' 条');
                pass++;
            } else {
                console.log('  ✗ 返回错误或无结果: ' + (data.info || data.msg || ''));
                fail++;
            }
        } catch(e) {
            console.log('  ✗ 返回非JSON: ' + r4.text.substring(0, 200));
            fail++;
        }
    } else {
        console.log('  ✗ API异常');
        fail++;
    }

    // Test 5: 地理编码 - 宏宝集团
    console.log('--- 测试5: 地理编码 (宏宝集团) ---');
    const r5 = await test('地理编码(企业)',
        'https://api.open.geovisearth.com/pj/geo/v2/geocode/geo?keyword=' + encodeURIComponent('宏宝集团') + '&region=' + encodeURIComponent('苏州市') + '&pageSize=5&token=' + TOKEN,
        { method: 'GET' });
    if (r5.ok) {
        try {
            const data = JSON.parse(r5.text);
            if (data.code === 0 && Array.isArray(data.data) && data.data.length > 0) {
                console.log('  ✓ 企业查询 正常, ' + data.data.length + ' 条');
                pass++;
            } else {
                console.log('  ✗ 无结果: ' + (data.info || data.msg || ''));
                fail++;
            }
        } catch(e) {
            console.log('  ✗ 返回非JSON');
            fail++;
        }
    }

    // Summary
    console.log('========================================');
    console.log('  诊断结果: ' + pass + ' 通过, ' + fail + ' 失败');
    console.log('========================================');

    if (fail > 0) {
        console.log('\n常见问题:');
        console.log('  1. Token无效/过期 → 重新在 open.geovisearth.com 控制台获取');
        console.log('  2. Token未激活地图服务 → 检查API权限是否包含"地图服务"');
        console.log('  3. 域名不匹配 → 确认Token对应的API域名');
        console.log('  4. 账号未认证 → 需完成个人/机构认证');
        console.log('  5. 调用量超限 → 检查控制台流量统计');
    }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
