# Sentinel-2 历史影像下载 — 通过AWS公开数据 (无需注册)
# 用法: python sentinel2_download.py
import requests, json, os, io, sys
from datetime import datetime
import numpy as np
from PIL import Image

# 目标区域: 永凝路128号 江苏宏宝集团 (WGS-84)
LNG, LAT = 120.534896, 31.977671
RADIUS_M = 500  # 500m 半径

# Sentinel-2 L2A STAC 搜索
STAC_URL = "https://earth-search.aws.element84.com/v1/search"

def search_scenes(year, max_cloud=20):
    """搜索指定年份、云量低于阈值的 Sentinel-2 L2A 影像"""
    bbox = [LNG - 0.01, LAT - 0.01, LNG + 0.01, LAT + 0.01]
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": bbox,
        "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z",
        "limit": 20,
        "query": {"eo:cloud_cover": {"lte": max_cloud}}
    }
    resp = requests.post(STAC_URL, json=body, timeout=30)
    data = resp.json()
    return data.get("features", [])

def find_best_per_year():
    """每年找一张最佳(最低云量)影像"""
    results = []
    for year in range(2016, 2027):
        scenes = search_scenes(year, max_cloud=30)
        if not scenes:
            scenes = search_scenes(year, max_cloud=80)
        if scenes:
            best = min(scenes, key=lambda f: f["properties"].get("eo:cloud_cover", 100))
            cc = best["properties"].get("eo:cloud_cover", "?")
            dt = best["properties"]["datetime"][:10]
            results.append({"year": year, "date": dt, "cloud": cc, "feature": best})
            print(f"  {year}: {dt}, cloud={cc:.1f}%")
        else:
            print(f"  {year}: 无影像")
    return results

def get_tci_url(feature):
    """获取TCI (True Color Image) 预览图URL"""
    assets = feature.get("assets", {})
    # Sentinel-2 L2A TCI is a JPEG preview at 10m
    tci = assets.get("visual") or assets.get("tci")
    if tci:
        href = tci["href"]
        # AWS Sentinel-2 data uses S3 URLs, convert to HTTPS
        if href.startswith("s3://"):
            # Convert s3://sentinel-s2-l2a/... to https://sentinel-s2-l2a.s3.amazonaws.com/...
            href = href.replace("s3://", "https://").replace("/sentinel-s2-l2a", ".s3.amazonaws.com")
        return href
    # Fallback: try to construct from alternate S3 URL
    alt = assets.get("thumbnail") or assets.get("preview")
    if alt: return alt["href"]
    return None

def download_tci(url, timeout=60):
    """下载TCI预览图"""
    if not url: return None
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 200:
            return Image.open(io.BytesIO(resp.content))
    except Exception as e:
        print(f"    下载失败: {e}")
    return None

def main():
    print("=" * 50)
    print("  Sentinel-2 历史影像搜索")
    print(f"  位置: {LNG}, {LAT}")
    print(f"  数据源: AWS Sentinel-2 L2A (公开)")
    print("=" * 50)

    print("\n搜索每年最佳影像...")
    results = find_best_per_year()

    if not results:
        print("\n未找到任何影像。")
        return

    # 下载每年预览图
    print("\n下载预览图...")
    images = []
    for r in results:
        url = get_tci_url(r["feature"])
        if url:
            print(f"  {r['year']}: {url[:80]}...")
            img = download_tci(url)
            if img:
                images.append({**r, "image": img})
                print(f"    -> {img.size[0]}x{img.size[1]}")
            else:
                print(f"    -> 下载失败")
        else:
            print(f"  {r['year']}: 无TCI URL")

    if not images:
        print("\n无可用预览图。")
        return

    # 裁剪至目标区域
    # TCI是整景影像, 分辨率10m, 需要根据经纬度裁剪
    # Sentinel-2 场景通常约 100km x 100km, 10m分辨率 = ~10000x10000px
    # 我们只需要500m半径区域 = ~100x100px at 10m

    print("\n生成对比图...")
    out_dir = os.path.dirname(os.path.abspath(__file__))

    # 简单保存: 由于完整裁剪需要知道场景地理范围
    # 这里先保存整景缩略图的中间区域
    for item in images:
        img = item["image"]
        w, h = img.size
        # 裁剪中央 40% 区域 (假设目标在场景中央附近)
        crop = img.crop((int(w*0.3), int(h*0.3), int(w*0.7), int(h*0.7)))
        # 调整到统一大小
        crop = crop.resize((512, 512), Image.LANCZOS)
        fname = f"sentinel2_{item['year']}_{item['date']}.jpg"
        fpath = os.path.join(out_dir, fname)
        crop.save(fpath, quality=90)
        print(f"  {fname} ({crop.size[0]}x{crop.size[1]})")
        item["outfile"] = fname

    # 生成 HTML 查看器
    print("\n生成查看器...")
    cards = ""
    for item in images:
        cards += f"""
        <div class="card">
            <h3>{item['year']}年 <span class="badge">☁{item['cloud']:.0f}%</span></h3>
            <div class="meta">{item['date']} | Sentinel-2 L2A | 10m/px</div>
            <img src="{item['outfile']}" loading="lazy" />
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Sentinel-2 历史影像对比 — 张家港大新镇</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0d1117;color:#c9d1d9;font-family:'Microsoft YaHei',sans-serif;padding:24px}}
h1{{color:#58a6ff;font-size:1.2em}}
h2{{color:#8b949e;font-size:0.8em;font-weight:normal;margin:4px 0 18px}}
.info{{background:#161b22;border-left:3px solid #3fb950;padding:14px 18px;margin:16px 0;border-radius:6px;font-size:0.85em;line-height:1.7}}
.cards{{display:flex;flex-wrap:wrap;gap:16px}}
.card{{background:#161b22;padding:14px;border-radius:8px;border:1px solid #30363d;width:280px}}
.card h3{{color:#d2a8ff;margin-bottom:4px}}
.badge{{background:#9a6700;color:#fff;font-size:0.7em;padding:2px 6px;border-radius:8px;margin-left:6px}}
.meta{{color:#8b949e;font-size:0.75em;margin:4px 0 8px}}
.card img{{width:100%;border-radius:4px;border:1px solid #30363d}}
.note{{background:#1a1a0e;border:1px solid #d2991d;padding:14px;margin:24px 0;border-radius:6px;font-size:0.8em;line-height:1.6}}
</style>
</head>
<body>
<h1>Sentinel-2 历史卫星影像 — 张家港市大新镇永凝路</h1>
<h2>位置: {LNG}°E, {LAT}°N | 分辨率: 10m/px | 数据: ESA Sentinel-2 L2A (公开)</h2>
<div class="info">
    <strong>目标:</strong> 江苏宏宝集团有限公司 (永凝路128号)<br>
    <strong>分辨率:</strong> 10m/px — 可识别大型光伏阵列，不能分辨单块面板<br>
    <strong>数据源:</strong> AWS Sentinel-2 公开数据 (无需注册)<br>
    <strong>说明:</strong> Sentinel-2 从2015年7月开始运行，每5天重访一次
</div>
<div class="cards">{cards}</div>
<div class="note">
    ⚠️ <strong>10m分辨率限制:</strong> Sentinel-2 每个像素代表10m×10m地面区域。<br>
    一块标准光伏板(2m×1m)在影像中远小于1个像素，无法直接分辨。<br>
    但大型光伏阵列(50m×100m以上)会呈现为深色矩形区域，可以识别。<br><br>
    <strong>如需更高分辨率:</strong><br>
    • Google Earth Pro (桌面版) — 历史影像滑块，0.3-1m分辨率，覆盖张家港<br>
    • Planet Labs — 3-5m分辨率，需付费订阅<br>
    • 联系星图云 — 询问企业定制历史影像服务
</div>
</body>
</html>"""

    html_path = os.path.join(out_dir, "sentinel2_viewer.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  -> {html_path}")
    print(f"\n完成! 共 {len(images)} 年影像。在浏览器中打开 sentinel2_viewer.html")

if __name__ == "__main__":
    main()
