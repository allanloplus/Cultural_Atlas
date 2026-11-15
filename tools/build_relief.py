#!/usr/bin/env python3
"""產生 3D 文資島的立體地形底圖（紙雕風格）：data/relief/{light,dark}/{z}/{x}/{y}.webp

和 tools/build_terrain.py 用同一份 Copernicus DEM GLO-30（.cache/dem/，先跑過 build_terrain.py）。
做法：3 角秒（約 90 公尺）的高程 → 依海拔分層上色（一層一層像疊起來的紙）→ 疊上山影與層邊的陰影 →
      海面依離岸距離漸層 → 切成 Web Mercator 圖磚。不放文字。
      不屬於本站範圍的陸地（福建沿海）只留淡淡的海岸線（判斷方式見 build_terrain.py 的 ours_mask），讓視線留在臺灣與離島。
授權：同 build_terrain.py（Copernicus WorldDEM-30，須標示，見 README）。

用法：pip install numpy pillow rasterio scipy
      python3 tools/build_relief.py
"""
import json
import math
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_terrain as T  # noqa: E402

ROOT = T.ROOT
OUT = os.path.join(ROOT, "data", "relief")
ZMIN, ZMAX = 5, 11
QUALITY = 80

# 分層：海拔門檻（公尺）
STEPS = [0, 40, 100, 200, 350, 550, 800, 1100, 1500, 2000, 2500, 3000, 3500]
# 每一層的顏色（淺色：米紙 → 檜木 → 岩；深色：夜裡的土色）
PALETTE = {
    "light": {
        "bands": ["#f3ead6", "#ece1c7", "#e4d6b6", "#dacaa4", "#cdbb91", "#bfab80", "#ae9a71", "#9c8865", "#8a775a", "#7a6a52", "#8c8174", "#b3aba0", "#e2ddd5"],
        "sea_near": "#e2eae6", "sea_far": "#c4d5d6", "other": "#cbd9d9",
        "shade": (0.62, 0.42), "edge": 0.86,
    },
    "dark": {
        "bands": ["#2e2924", "#332d27", "#39322a", "#3f372e", "#463d32", "#4e4437", "#574b3d", "#605343", "#6a5c4a", "#756552", "#80766a", "#9a9187", "#bdb6ad"],
        "sea_near": "#17202a", "sea_far": "#0f151b", "other": "#141b21",
        "shade": (0.55, 0.55), "edge": 0.78,
    },
}


def rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)


def hillshade(z, lat_rows):
    """多方向山影（0–1）。z 是 3 角秒格網，lat_rows 是每一列的緯度。"""
    dy = 30.87 * T.STEP
    dx = dy * np.cos(np.radians(lat_rows))[:, None]
    gy, gx = np.gradient(z * 1.6)               # 稍微誇大，讓山稜清楚
    gx, gy = gx / dx, gy / dy
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    out = 0
    for az, w in ((315, 0.5), (270, 0.2), (360, 0.2), (225, 0.1)):
        a, alt = math.radians(az), math.radians(42)
        out = out + w * (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(a - aspect))
    return np.clip(out, 0, 1).astype(np.float32)


def paint(z, land, ours, sea_km, hs, theme):
    P = PALETTE[theme]
    h, w = z.shape
    img = np.zeros((h, w, 3), dtype=np.float32)
    # 海：離本站範圍的陸地越遠越深
    t = np.clip(sea_km / 25.0, 0, 1)[..., None]
    img[:] = rgb(P["sea_near"]) * (1 - t) + rgb(P["sea_far"]) * t
    # 分層
    band = np.clip(np.digitize(z, STEPS) - 1, 0, len(STEPS) - 1)
    cols = np.stack([rgb(c) for c in P["bands"]])
    lc = cols[band]
    # 層邊的陰影：西北方向（光源）比自己高一層的地方，自己落在陰影裡
    k = 2
    nw = np.zeros_like(band)
    nw[k:, k:] = band[:-k, :-k]
    edge = (nw > band)[..., None]
    a, b = P["shade"]
    lc = lc * (a + b * hs[..., None]) * np.where(edge, P["edge"], 1.0)
    m = (land & ours)[..., None]
    img = np.where(m, lc, img)
    o = (land & ~ours)[..., None]
    img = np.where(o, rgb(P["other"]), img)      # 範圍外的陸地：平的、幾乎和遠海同色，只留海岸線
    return np.clip(img, 0, 255)


def tiles(img, theme):
    total = 0
    count = 0
    chans = [img[..., c] for c in range(3)]
    level = {}
    x0, x1, y0, y1 = T.tile_range(ZMAX)
    n = 2 ** ZMAX
    px = (np.arange(T.TILE) + 0.5) / T.TILE
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            lng = np.broadcast_to((tx + px) / n * 360 - 180, (T.TILE, T.TILE))
            lat = np.broadcast_to(np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty + px) / n))))[:, None], (T.TILE, T.TILE))
            t = np.stack([sample(c, lng, lat, theme) for c in chans], axis=-1)
            level[(tx, ty)] = t
            total += save(theme, ZMAX, tx, ty, t)
            count += 1
    for zz in range(ZMAX - 1, ZMIN - 1, -1):
        up = {}
        x0, x1, y0, y1 = T.tile_range(zz)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                a = np.zeros((T.TILE * 2, T.TILE * 2, 3), dtype=np.float32)
                a[:] = rgb(PALETTE[theme]["sea_far"])
                for dx in (0, 1):
                    for dy in (0, 1):
                        c = level.get((tx * 2 + dx, ty * 2 + dy))
                        if c is not None:
                            a[dy * T.TILE:(dy + 1) * T.TILE, dx * T.TILE:(dx + 1) * T.TILE] = c
                a = a.reshape(T.TILE, 2, T.TILE, 2, 3).mean(axis=(1, 3))
                up[(tx, ty)] = a
                total += save(theme, zz, tx, ty, a)
                count += 1
        level = up
    return total, count


def sample(chan, lng, lat, theme):
    """雙線性取樣；範圍外填遠海的顏色。"""
    v = T.sample(chan, lng, lat)
    x = (lng - T.LNG0) * T.PPD
    y = (T.LAT1 - lat) * T.PPD
    out = (x < 0) | (y < 0) | (x >= chan.shape[1]) | (y >= chan.shape[0])
    return np.where(out, np.nan, v)


def save(theme, z, x, y, a):
    sea = rgb(PALETTE[theme]["sea_far"])
    a = np.where(np.isnan(a), sea, a)
    d = os.path.join(OUT, theme, str(z), str(x))
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "%d.webp" % y)
    Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).save(p, quality=QUALITY, method=5)
    return os.path.getsize(p)


def main():
    print("讀取 DEM…")
    z = T.mosaic(offline=True)
    land = z > 0.5
    print("判斷陸地範圍…")
    ours = T.ours_mask(land)
    sea_km = ndimage.distance_transform_edt(~(land & ours)).astype(np.float32) * 0.0926
    lat_rows = T.LAT1 - (np.arange(z.shape[0]) + 0.5) / T.PPD
    print("計算山影…")
    hs = hillshade(z, lat_rows)
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    meta = {"themes": {}, "minzoom": ZMIN, "maxzoom": ZMAX, "bounds": T.BOUNDS, "tiles": "data/relief/{theme}/{z}/{x}/{y}.webp"}
    for theme in ("light", "dark"):
        print("上色、切圖磚：", theme)
        img = paint(z, land, ours, sea_km, hs, theme)
        total, count = tiles(img, theme)
        meta["themes"][theme] = {"bytes": total, "count": count, "background": PALETTE[theme]["sea_far"]}
        print("  %d 張，%.1f MB" % (count, total / 1048576))
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
