#!/usr/bin/env python3
"""產生 3D 文資島的地形圖磚：data/terrain/{z}/{x}/{y}.png、data/terrain/meta.json

來源：Copernicus DEM GLO-30（歐盟哥白尼計畫，30 公尺數值地表模型），AWS 公開桶
      https://copernicus-dem-30m.s3.amazonaws.com/
授權：Licence for the use of the Copernicus WorldDEM-30（可重製、散布、改作；須標示來源與免責聲明，
      文字記在 meta.json 的 attribution、disclaimer，也寫在 assets/js/layers/island.js 與 README，請勿移除）。

做法：下載 1°×1° 的 GeoTIFF 到 .cache/dem/（不進 repo，約 380 MB）→ 3×3 平均成約 90 公尺 →
      重新取樣成 Web Mercator 第 10 級圖磚（每像素約 140 公尺）→ 往上平均出第 5–9 級。
      高度取整數公尺，用 Terrarium 編碼（高度 = R×256 + G − 32768，B 固定為 0）存成 PNG。
      海面與沒有資料的地方是 0。範圍內全是海的圖磚也會輸出（很小），網頁才不會抓到 404。

用法：pip install numpy pillow rasterio
      python3 tools/build_terrain.py            （加 --offline 只用已下載的檔案）
"""
import datetime
import json
import math
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

import numpy as np
import rasterio
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "dem")
OUT = os.path.join(ROOT, "data", "terrain")
SRC = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"
LAT0, LAT1, LNG0, LNG1 = 21, 27, 118, 123      # 下載的整數經緯度範圍（含金門、馬祖）
BOUNDS = [118.0, 21.7, 122.4, 26.5]            # 圖磚涵蓋範圍 [西, 南, 東, 北]
ZMAX, ZMIN, TILE = 10, 5, 256
STEP = 3                                       # 3×3 平均：1 角秒 → 3 角秒（約 90 公尺）
PPD = 3600 // STEP                             # 每度的格數


def fetch(lat, lng, offline):
    """回傳本機檔案路徑；桶裡沒有這一格（全是海）回傳 None。"""
    name = "Copernicus_DSM_COG_10_N%02d_00_E%03d_00_DEM" % (lat, lng)
    path = os.path.join(CACHE, name + ".tif")
    miss = path + ".none"
    if os.path.exists(path):
        return path
    if os.path.exists(miss) or offline:
        return None
    for attempt in range(4):
        try:
            print("  下載", name, flush=True)
            with urllib.request.urlopen(SRC.format(n=name), timeout=120) as r, open(path + ".part", "wb") as f:
                want = int(r.headers.get("Content-Length") or 0)
                shutil.copyfileobj(r, f)
            got = os.path.getsize(path + ".part")
            if want and got != want:               # 連線中斷時不會報錯，要自己比對大小
                raise IOError("只收到 %d／%d 位元組" % (got, want))
            os.replace(path + ".part", path)
            return path
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                open(miss, "w").close()
                return None
            print("   失敗（%s），重試" % e)
        except (IOError, OSError) as e:
            print("   失敗（%s），重試" % e)
        time.sleep(3 * (attempt + 1))
    sys.exit("注意：%s 下載失敗，請稍後重跑。" % name)


def mosaic(offline):
    """拼成一張 3 角秒的大圖，第 0 列是最北邊。"""
    h, w = (LAT1 - LAT0) * PPD, (LNG1 - LNG0) * PPD
    big = np.zeros((h, w), dtype=np.float32)
    n = 0
    for lat in range(LAT0, LAT1):
        for lng in range(LNG0, LNG1):
            p = fetch(lat, lng, offline)
            if not p:
                continue
            with rasterio.open(p) as ds:
                a = ds.read(1).astype(np.float32)
                if ds.nodata is not None:
                    a[a == ds.nodata] = 0
            if a.shape != (3600, 3600):
                sys.exit("注意：%s 的大小是 %s，不是 3600×3600，請檢查。" % (p, a.shape))
            a = np.nan_to_num(a).reshape(PPD, STEP, PPD, STEP).mean(axis=(1, 3))
            r0, c0 = (LAT1 - 1 - lat) * PPD, (lng - LNG0) * PPD
            big[r0:r0 + PPD, c0:c0 + PPD] = a
            n += 1
    if not n:
        sys.exit("沒有任何 DEM 檔可用。")
    print("  拼接 %d 格，最高 %.0f 公尺" % (n, big.max()))
    return big


def sample(big, lng, lat):
    """雙線性取樣；lng、lat 是同形狀的陣列（像素中心）。範圍外是 0。"""
    x = (lng - LNG0) * PPD - 0.5
    y = (LAT1 - lat) * PPD - 0.5
    h, w = big.shape
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = (x - x0).astype(np.float32), (y - y0).astype(np.float32)

    def at(yy, xx):
        ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
        return np.where(ok, big[np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)], 0)

    return (at(y0, x0) * (1 - fx) + at(y0, x0 + 1) * fx) * (1 - fy) + (at(y0 + 1, x0) * (1 - fx) + at(y0 + 1, x0 + 1) * fx) * fy


def tile_xy(lng, lat, z):
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_range(z):
    x0, y1 = tile_xy(BOUNDS[0], BOUNDS[1], z)
    x1, y0 = tile_xy(BOUNDS[2], BOUNDS[3], z)
    return int(x0), int(math.ceil(x1)) - 1, int(y0), int(math.ceil(y1)) - 1


def save(z, x, y, a):
    v = np.clip(np.rint(a), -1000, 9000).astype(np.int32) + 32768
    rgb = np.zeros((TILE, TILE, 3), dtype=np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    d = os.path.join(OUT, str(z), str(x))
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "%d.png" % y)
    Image.fromarray(rgb).save(p, optimize=True)
    return os.path.getsize(p)


def main():
    offline = "--offline" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    print("讀取 DEM…")
    big = mosaic(offline)
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    total, count = 0, 0
    tiles = {}
    x0, x1, y0, y1 = tile_range(ZMAX)
    n = 2 ** ZMAX
    px = (np.arange(TILE) + 0.5) / TILE
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            lng = (tx + px) / n * 360 - 180
            lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty + px) / n))))
            a = sample(big, np.broadcast_to(lng, (TILE, TILE)), np.broadcast_to(lat[:, None], (TILE, TILE)))
            tiles[(tx, ty)] = a.astype(np.float32)
            total += save(ZMAX, tx, ty, a)
            count += 1
    print("  第 %d 級 %d 張" % (ZMAX, len(tiles)))
    for z in range(ZMAX - 1, ZMIN - 1, -1):
        up = {}
        x0, x1, y0, y1 = tile_range(z)
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                a = np.zeros((TILE * 2, TILE * 2), dtype=np.float32)
                for dx in (0, 1):
                    for dy in (0, 1):
                        c = tiles.get((tx * 2 + dx, ty * 2 + dy))
                        if c is not None:
                            a[dy * TILE:(dy + 1) * TILE, dx * TILE:(dx + 1) * TILE] = c
                a = a.reshape(TILE, 2, TILE, 2).mean(axis=(1, 3))
                up[(tx, ty)] = a
                total += save(z, tx, ty, a)
                count += 1
        print("  第 %d 級 %d 張" % (z, len(up)))
        tiles = up
    meta = {
        "generated": datetime.date.today().isoformat(),
        "tiles": "data/terrain/{z}/{x}/{y}.png",
        "encoding": "terrarium", "tileSize": TILE, "minzoom": ZMIN, "maxzoom": ZMAX, "bounds": BOUNDS,
        "resolution": "第 %d 級每像素約 %d 公尺（北緯 24 度）" % (ZMAX, round(40075016.686 / TILE / 2 ** ZMAX * math.cos(math.radians(24)))),
        "source": "Copernicus DEM GLO-30（Copernicus WorldDEM-30），https://copernicus-dem-30m.s3.amazonaws.com/",
        "attribution": "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
        "disclaimer": "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30",
        "bytes": total, "count": count
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print("完成：%d 張圖磚，共 %.1f MB → data/terrain/" % (count, total / 1048576))


if __name__ == "__main__":
    main()
