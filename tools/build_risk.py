"""產生 data/risk.json、data/risk-lines.geojson：「文資風險地圖」圖層的資料

把文資座標套疊政府公開的災害潛勢圖資，算出每處文資的標籤。原始圖資只下載到 .cache/risk/（不進 repo），
repo 裡只有計算結果。全部圖資依「政府資料開放授權條款－第 1 版」利用（https://data.gov.tw/license）。

圖資（網址寫在下面的 SRC；農業部的 RID 每年更新版本時會變，失效時到資料集頁面找新的）：
  土石流潛勢溪流、影響範圍   農業部農村發展及水土保持署   https://data.gov.tw/dataset/176524 、176526
  大規模崩塌潛勢區、影響範圍 農業部農村發展及水土保持署   https://data.gov.tw/dataset/176527 、176528
  活動斷層                  經濟部地質調查及礦業管理中心 https://data.gov.tw/dataset/6697（向量取自地質雲 API）
  淹水潛勢圖（第三代）       經濟部水利署                 https://data.gov.tw/dataset/25766（分縣市，20 個檔共約 2.5 GB）

淹水潛勢圖的法定限制（水災潛勢資料公開辦法）：僅供防救災使用，不得作為土地使用管制或開發限制的依據；
模擬結果基於設計降雨、特定地形與水理模式，具不確定性。網頁上必須保留這段說明。

需要：pip install pyshp shapely pyproj py7zr
用法：python3 tools/build_risk.py [--offline]
"""
import glob, json, os, sys, time, zipfile, datetime, urllib.request
import numpy as np
import shapefile
import shapely
from shapely.geometry import shape, mapping
from pyproj import CRS, Transformer

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(HERE, ".cache", "risk")
OFFLINE = "--offline" in sys.argv
SRC = {
    "debris_stream": "https://data.moa.gov.tw/GetOpenDataFile.aspx?id=J71&FileType=SHP&RID=71084",
    "debris_area": "https://data.moa.gov.tw/OpenData/GetOpenDataFile.aspx?id=J73&FileType=SHP&RID=71085",
    "landslide": "https://data.moa.gov.tw/OpenData/GetOpenDataFile.aspx?id=J74&FileType=SHP&RID=66656",
    "landslide_area": "https://data.moa.gov.tw/OpenData/GetOpenDataFile.aspx?id=J75&FileType=SHP&RID=66657",
    "fault": "https://www.geologycloud.tw/api/v1/zh-tw/ActiveFault?all=true",
}
FLOOD_BASE = "https://opendata.wra.gov.tw/cloud/25766InundationProbabilityMaps/"
FLOOD_FILES = ["207-%02d.7z" % i for i in range(1, 18)] + ["223-18.7z", "223-19.7z", "223-20.7z"]
FLOOD_SCENARIOS = ["24h350", "24h500", "24h650"]      # 24 小時累積雨量 350、500、650 毫米（各縣市檔名大小寫與結尾的 r 不一致）
FLOOD_DEPTH = ["", "0–0.3 公尺", "0.3–0.5 公尺", "0.5–1 公尺", "1–2 公尺", "2–3 公尺", "3 公尺以上"]   # GRIDCODE 1–6
FAULT_MAX_M = 5000        # 超過這個距離不記
STREAM_MAX_M = 500
RISK_CODE = {"低": 1, "中": 2, "高": 3, "持續觀察": 4}
TWD97 = CRS.from_epsg(3826)


def fetch(url, name, tries=4):
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    if OFFLINE:
        raise IOError("離線模式，沒有快取：" + name)
    os.makedirs(CACHE, exist_ok=True)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (static-site build script)"})
            with urllib.request.urlopen(req, timeout=600) as r, open(path + ".part", "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(path + ".part", path)
            return path
        except Exception as e:  # noqa: BLE001
            print("    重試 %s（%s）" % (name, e))
            time.sleep(5 * (k + 1))
    raise IOError("下載失敗：" + url)


def read_shp(path):
    """回傳 (幾何陣列, 屬性 list, pyproj CRS)"""
    enc = "utf-8"
    cpg = path[:-4] + ".cpg"
    if os.path.exists(cpg) and "950" in open(cpg).read():
        enc = "big5"
    r = shapefile.Reader(path, encoding=enc, encodingErrors="replace")
    geoms, recs = [], []
    for sr in r.iterShapeRecords():
        if not sr.shape.points:
            continue
        g = shapely.force_2d(shape(sr.shape.__geo_interface__))
        geoms.append(g if g.is_valid else shapely.make_valid(g))
        recs.append(sr.record.as_dict())
    prj = [f for f in glob.glob(glob.escape(path[:-4]) + ".*") if f.lower().endswith(".prj")]
    crs = CRS.from_wkt(open(prj[0]).read()) if prj else TWD97          # 沒附 .prj 的（例如臺南市）當成 TWD97 121 分帶
    return np.array(geoms, dtype=object), recs, crs


def unzip_shp(key):
    z = fetch(SRC[key], key + ".zip")
    d = os.path.join(CACHE, key)
    if not glob.glob(os.path.join(d, "**", "*.shp"), recursive=True):
        with zipfile.ZipFile(z) as f:
            for n in f.namelist():
                if n.endswith("/") or ".." in n:
                    continue
                os.makedirs(d, exist_ok=True)
                open(os.path.join(d, os.path.basename(n)), "wb").write(f.read(n))
    return glob.glob(os.path.join(d, "**", "*.shp"), recursive=True)[0]


def project(lng, lat, crs):
    return Transformer.from_crs(4326, crs, always_xy=True).transform(lng, lat)


def inside(geoms, x, y):
    """每個點落在哪一個多邊形（索引，沒有是 -1；重疊時取第一個）"""
    tree = shapely.STRtree(geoms)
    pts = shapely.points(x, y)
    pi, gi = tree.query(pts, predicate="within")
    out = np.full(len(x), -1)
    for p, g in zip(pi[::-1], gi[::-1]):
        out[p] = g
    return out


def nearest(geoms, x, y):
    tree = shapely.STRtree(geoms)
    pts = shapely.points(x, y)
    idx = tree.nearest(pts)
    return idx, shapely.distance(pts, geoms[idx])


def scen_of(path):
    """檔名 → 情境（24h350r.shp、24H350R.shp、24h350.shp 都算 24h350），不是要用的情境回 None"""
    b = os.path.basename(path).rsplit(".", 1)[0].lower()
    b = b[:-1] if b.endswith("r") else b
    return b if b in FLOOD_SCENARIOS else None


def flood(lng, lat):
    """回傳 shape (n, 情境數) 的 GRIDCODE（0＝不在模擬範圍或沒有資料）"""
    import py7zr
    out = np.zeros((len(lng), len(FLOOD_SCENARIOS)), dtype=int)
    seen = np.zeros(len(lng), dtype=bool)
    for fn in FLOOD_FILES:
        d = os.path.join(CACHE, "flood", fn[:-3])
        if not glob.glob(os.path.join(d, "**", "*.[sS][hH][pP]"), recursive=True):
            try:
                z = fetch(FLOOD_BASE + fn, fn)
            except IOError as e:
                print("  注意：%s，這個縣市的淹水欄位會是空的" % e)
                continue
            with py7zr.SevenZipFile(z) as a:
                want = [n for n in a.getnames() if scen_of(n) and n.rsplit(".", 1)[-1].lower() in ("shp", "shx", "dbf", "prj", "cpg")]
                if not any(n.lower().endswith(".shp") for n in want):
                    print("  注意：%s 裡找不到要用的情境，檔名可能又換了格式；壓縮檔保留在 .cache/risk/" % fn)
                    continue
                a.extract(path=d, targets=want)
            os.remove(z)          # 壓縮檔很大（多半是圖片），取出向量檔後就刪
        for k, sc in enumerate(FLOOD_SCENARIOS):
            shp = [f for f in glob.glob(os.path.join(d, "**", "*.[sS][hH][pP]"), recursive=True) if scen_of(f) == sc]
            if not shp:
                print("  注意：%s 沒有 %s" % (fn, sc))
                continue
            geoms, recs, crs = read_shp(shp[0])
            x, y = project(lng, lat, crs)
            b = shapely.total_bounds(geoms)
            cand = np.nonzero((x >= b[0]) & (x <= b[2]) & (y >= b[1]) & (y <= b[3]))[0]
            if not len(cand):
                continue
            pts = shapely.points(x[cand], y[cand])
            for g, r in zip(geoms, recs):
                shapely.prepare(g)
                hit = cand[shapely.contains(g, pts)]
                out[hit, k] = np.maximum(out[hit, k], int(r["GRIDCODE"]))
                seen[hit] = True
        print("  淹水 %s：累計 %d 處文資落在模擬範圍內" % (fn, seen.sum()))
    return out, seen


def main():
    S = json.load(open(os.path.join(HERE, "data", "sites.json"), encoding="utf-8"))
    F = S["meta"]["fields"]
    lat = np.array([r[F.index("lat")] for r in S["sites"]], dtype=float)
    lng = np.array([r[F.index("lng")] for r in S["sites"]], dtype=float)
    n = len(lat)
    x, y = project(lng, lat, TWD97)
    main_zone = (lng > 119.9) & (lng < 122.2) & (lat > 21.8) & (lat < 25.4)   # TWD97 121 分帶：本島

    # 活動斷層（WGS84 線）
    fj = json.load(open(fetch(SRC["fault"], "fault.geojson"), encoding="utf-8"))
    tr = Transformer.from_crs(4326, TWD97, always_xy=True)
    fl_ll = [shape(f["geometry"]) for f in fj["features"]]
    fl = np.array([shapely.transform(g, lambda c: np.column_stack(tr.transform(c[:, 0], c[:, 1]))) for g in fl_ll], dtype=object)
    fnames = sorted({f["properties"]["Name"] for f in fj["features"]})
    fi, fd = nearest(fl, x, y)
    fault = [[fnames.index(fj["features"][i]["properties"]["Name"]), int(round(d))] if (d <= FAULT_MAX_M and ok) else None
             for i, d, ok in zip(fi, fd, main_zone)]

    # 土石流
    sg, sr, _ = read_shp(unzip_shp("debris_stream"))
    ag, ar, _ = read_shp(unzip_shp("debris_area"))
    ai = inside(ag, x, y)
    si, sd = nearest(sg, x, y)
    # 大規模崩塌
    lg, lr, _ = read_shp(unzip_shp("landslide"))
    mg, mr, _ = read_shp(unzip_shp("landslide_area"))
    li, mi = inside(lg, x, y), inside(mg, x, y)

    fz, seen = flood(lng, lat)

    rows = []
    for i in range(n):
        deb = None
        if main_zone[i] and ai[i] >= 0:
            deb = [1, ar[ai[i]]["Debrisno"], RISK_CODE.get(ar[ai[i]]["Risk"], 0), 0]            # 在影響範圍內
        elif main_zone[i] and sd[i] <= STREAM_MAX_M:
            deb = [0, sr[si[i]]["Debrisno"], RISK_CODE.get(sr[si[i]]["Risk"], 0), int(round(sd[i]))]  # 靠近溪流
        ls = None
        if main_zone[i] and li[i] >= 0:
            ls = [2, lr[li[i]]["lslno"], RISK_CODE.get(lr[li[i]]["Risk"], 0)]                   # 潛勢區內
        elif main_zone[i] and mi[i] >= 0:
            ls = [1, mr[mi[i]]["Islno"], RISK_CODE.get(mr[mi[i]]["Risk"], 0)]                   # 影響範圍內
        rows.append([fault[i], deb, ls, [int(v) for v in fz[i]] if seen[i] else None])

    out = {"meta": {"generated": datetime.date.today().isoformat(),
                    "fields": ["fault", "debris", "landslide", "flood"],
                    "note": "每處文資一列，順序同 sites.json。fault=[斷層名索引, 距離公尺]（%d 公尺內才有）；debris=[1 在影響範圍內／0 靠近溪流, 溪流編號, 風險 1低2中3高4持續觀察, 距溪流公尺]；landslide=[2 潛勢區內／1 影響範圍內, 編號, 風險]；flood=[%s 三個情境的淹水深度代碼]，null 表示不在模擬範圍。" % (FAULT_MAX_M, "、".join(FLOOD_SCENARIOS)),
                    "floodScenarios": ["24 小時 350 毫米", "24 小時 500 毫米", "24 小時 650 毫米"], "floodDepth": FLOOD_DEPTH,
                    "attribution": [
                        "經濟部水利署（2018）淹水潛勢圖（第三代）",
                        "農業部農村發展及水土保持署（2026）土石流潛勢溪流圖、土石流潛勢溪流影響範圍圖（115 年，1,753 條）",
                        "農業部農村發展及水土保持署（2026）大規模崩塌潛勢區、影響範圍（115 年，94 處）",
                        "經濟部地質調查及礦業管理中心（2021 年修正版，2025 年 10 月修訂）臺灣活動斷層分布圖"],
                    "license": "此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：https://data.gov.tw/license"},
           "faults": fnames, "sites": rows}
    p = os.path.join(HERE, "data", "risk.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 地圖上畫的線：活動斷層、土石流潛勢溪流（簡化到約 10–20 公尺）
    back = Transformer.from_crs(TWD97, 4326, always_xy=True)
    feats = [{"type": "Feature", "properties": {"k": "fault", "n": f["properties"]["Name"]},
              "geometry": mapping(shapely.set_precision(shapely.simplify(g, 0.0001), 0.00001))} for f, g in zip(fj["features"], fl_ll)]
    for g, r in zip(sg, sr):
        g2 = shapely.transform(shapely.simplify(g, 20), lambda c: np.column_stack(back.transform(c[:, 0], c[:, 1])))
        g2 = shapely.set_precision(g2, 0.00001)
        if not g2.is_empty:
            feats.append({"type": "Feature", "properties": {"k": "debris", "n": r["Debrisno"], "r": RISK_CODE.get(r["Risk"], 0)}, "geometry": mapping(g2)})
    p2 = os.path.join(HERE, "data", "risk-lines.geojson")
    json.dump({"type": "FeatureCollection", "features": feats}, open(p2, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    c = lambda f: sum(1 for r in rows if f(r))  # noqa: E731
    print("寫入 %s（%d KB）、%s（%d KB）" % (p, os.path.getsize(p) // 1024, p2, os.path.getsize(p2) // 1024))
    print("斷層 100 公尺內 %d、500 公尺內 %d；土石流影響範圍內 %d、溪流 %d 公尺內 %d；大規模崩塌 %d；" % (
        c(lambda r: r[0] and r[0][1] <= 100), c(lambda r: r[0] and r[0][1] <= 500), c(lambda r: r[1] and r[1][0] == 1),
        STREAM_MAX_M, c(lambda r: r[1] and r[1][0] == 0), c(lambda r: r[2])))
    print("淹水模擬範圍內 %d 處；淹水 0.5 公尺以上：%s" % (seen.sum(), "、".join(
        "%s %d 處" % (out["meta"]["floodScenarios"][k], c(lambda r, k=k: r[3] and r[3][k] >= 3)) for k in range(3))))


if __name__ == "__main__":
    main()
