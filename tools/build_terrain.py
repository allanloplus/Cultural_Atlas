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

      不屬於本站範圍的陸地（福建沿海）壓平成海面高度，只有臺灣、澎湖、金門、馬祖等有地形。
用法：pip install numpy pillow rasterio scipy
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
from scipy import ndimage

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


def ours_mask(land):
    """哪些陸地屬於本站範圍：有文資的島，或東經 119.2 度以東、北緯 25.4 度以南、不連到圖框邊的陸地。"""
    lab, n = ndimage.label(land)
    keep = np.zeros(n + 1, dtype=bool)
    edge = set(np.unique(np.concatenate([lab[0], lab[:, 0]]))) - {0}
    rows, cols = np.nonzero(lab)
    labs = lab[rows, cols]
    cnt = np.bincount(labs, minlength=n + 1).astype(np.float64)
    cr = np.bincount(labs, weights=rows, minlength=n + 1) / np.maximum(cnt, 1)
    cc = np.bincount(labs, weights=cols, minlength=n + 1) / np.maximum(cnt, 1)
    lat = LAT1 - cr / PPD
    lng = LNG0 + cc / PPD
    for k in range(1, n + 1):
        if k not in edge and lng[k] > 119.2 and lat[k] < 25.4:
            keep[k] = True
    sites = json.load(open(os.path.join(ROOT, "data", "sites.json"), encoding="utf-8"))
    F = sites["meta"]["fields"]
    ila, ilo = F.index("lat"), F.index("lng")
    h, w = land.shape
    for r in sites["sites"]:
        y = int((LAT1 - r[ila]) * PPD)
        x = int((r[ilo] - LNG0) * PPD)
        win = lab[max(0, y - 4):min(h, y + 5), max(0, x - 4):min(w, x + 5)]
        keep[np.unique(win)] = True
    keep[0] = False
    return keep[lab]



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


ELEV_BANDS = [0, 20, 100, 500, 1000]     # 海拔分級（公尺）：網頁「海拔」顏色與分布圖用
STEEP_M = 250                            # 座標周圍約 300 公尺內的高低差超過這個值：海拔不可靠
SEA_M = 300                              # 座標離最近的陸地超過這個距離：座標可能落在海上
COUNTY_KM = 10                           # 離同縣市最近的文資超過這個距離、而別的縣市的文資近得多：縣市或座標可能有誤


def check_sites(big):
    """每處文資的地面高度與座標檢查 → data/terrain/sites-elev.json、reports/coord-check.csv"""
    import csv
    S = json.load(open(os.path.join(ROOT, "data", "sites.json"), encoding="utf-8"))
    F = S["meta"]["fields"]
    rows = [dict(zip(F, r)) for r in S["sites"]]
    lat = np.array([r["lat"] for r in rows]); lng = np.array([r["lng"] for r in rows])
    elev = np.maximum(0, np.rint(sample(big, lng, lat))).astype(int)
    land = big > 0.5
    sea_px = ndimage.distance_transform_edt(~land)
    h, w = big.shape
    ys = np.clip(((LAT1 - lat) * PPD).astype(int), 0, h - 1); xs = np.clip(((lng - LNG0) * PPD).astype(int), 0, w - 1)
    issues = {}

    def flag(i, kind, text):
        issues.setdefault(i, []).append((kind, text))

    for i in range(len(rows)):
        y, x = ys[i], xs[i]
        win = big[max(0, y - 3):y + 4, max(0, x - 3):x + 4]
        rng = float(win.max() - win.min())
        if rng > STEEP_M:
            flag(i, "steep", "座標周圍約 300 公尺內高低差 %d 公尺，海拔可能差很多（推估 %d 公尺）" % (rng, elev[i]))
        d = sea_px[y, x] * 30.87 * STEP * math.cos(math.radians(lat[i]))
        inside = BOUNDS[0] <= lng[i] <= BOUNDS[2] and BOUNDS[1] <= lat[i] <= BOUNDS[3]   # 東沙等範圍外的點不檢查
        if inside and not land[y, x] and d > SEA_M:
            flag(i, "sea", "座標落在水面上（海、潟湖、鹽田或魚塭），離最近的陸地約 %d 公尺" % d)
    P = np.radians(np.c_[lat, lng]); county = np.array([r["county"] for r in rows])
    for i in range(len(rows)):
        dd = P - P[i]
        km = 12742 * np.arcsin(np.sqrt(np.sin(dd[:, 0] / 2) ** 2 + np.cos(P[i, 0]) * np.cos(P[:, 0]) * np.sin(dd[:, 1] / 2) ** 2))
        km[i] = 1e9
        same, other = km[county == county[i]].min(), km[county != county[i]].min()
        if same > COUNTY_KM and other < same / 3:
            j = int(np.where(county != county[i], km, 1e9).argmin())
            flag(i, "county", "離同縣市最近的文資 %.1f 公里，卻離%s的「%s」只有 %.1f 公里" % (same, S["counties"][rows[j]["county"]]["name"], rows[j]["name"], other))
    mi = land[(LAT1 - 26) * PPD:(LAT1 - 21) * PPD, (120 - LNG0) * PPD:(122 - LNG0) * PPD]
    mb = big[(LAT1 - 26) * PPD:(LAT1 - 21) * PPD, (120 - LNG0) * PPD:(122 - LNG0) * PPD][mi]
    edges = ELEV_BANDS + [1e9]
    out = {"note": "h：每處文資所在位置的地表高度（公尺），順序同 data/sites.json；來源是數值地表模型（含樹冠與建築），由約 90 公尺的格網內插，只是近似值。"
                   "u：海拔不可靠或座標可疑的文資索引（明細見 reports/coord-check.csv）。land：臺灣本島陸地落在各海拔分級的比例。",
           "bands": ELEV_BANDS,
           "land": [round(float(((mb >= edges[k]) & (mb < edges[k + 1])).mean()), 4) for k in range(len(ELEV_BANDS))],
           "landShare": {"over500": round(float((mb > 500).mean()), 3), "over1000": round(float((mb > 1000).mean()), 3)},
           "u": sorted(issues), "h": elev.tolist()}
    with open(os.path.join(OUT, "sites-elev.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(ROOT, "reports"), exist_ok=True)
    kinds = {"sea": "座標在水面上", "county": "縣市或座標可能有誤", "steep": "海拔不可靠（陡坡）"}
    with open(os.path.join(ROOT, "reports", "coord-check.csv"), "w", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["問題", "縣市", "名稱", "類別", "緯度", "經度", "推估海拔（公尺）", "說明", "知識網站連結"])
        order = sorted(issues, key=lambda i: (min(["sea", "county", "steep"].index(k) for k, _ in issues[i]), rows[i]["county"], -elev[i]))
        for i in order:
            r, c = rows[i], S["counties"][rows[i]["county"]]
            for k, t in issues[i]:
                wr.writerow([kinds[k], c["name"], r["name"], S["cats"][r["cat"]]["name"], r["lat"], r["lng"], elev[i], t, c["base"] + "#map/" + r["id"]])
    n = {k: sum(1 for v in issues.values() if any(x == k for x, _ in v)) for k in kinds}
    print("  座標檢查：%s → reports/coord-check.csv" % "、".join("%s %d 處" % (kinds[k], n[k]) for k in kinds))


def main():
    offline = "--offline" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    print("讀取 DEM…")
    big = mosaic(offline)
    big[(big > 0.5) & ~ours_mask(big > 0.5)] = 0      # 範圍外的陸地（福建沿海）壓平，和海面一樣高
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
    check_sites(big)
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
