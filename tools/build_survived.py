"""產生 data/survived.json：「它挺過了什麼」圖層的資料（每處文資歷來遇過的地震與颱風，皆為推估）

輸入：
  data/sites.json           tools/build_sites.py 的輸出
  data/raw/quakes.json      tools/fetch_quakes.py 的輸出（災害地震清單）
  data/raw/typhoon-names.json（選用）  tools/fetch_typhoon_names.py 的輸出（氣象署颱風中文名）
  USGS ShakeMap 震度格網     規模 6.8 以上、USGS 有提供的地震（1919 年起），下載到 .cache/（不進 repo）
  NOAA IBTrACS 西北太平洋颱風路徑（約 115 MB），下載到 .cache/（不進 repo）

地震震度的推估方法（輸出的 method 欄）：
  shakemap  USGS ShakeMap 格網在文資位置的 PGA、PGV（早期事件是 USGS 的模式推估，不是觀測值）
  gmpe      Liu & Tsai (2005, BSSA 95:1045–1058) 全臺水平向衰減式，由規模與震源距離估 PGA、PGV（點震源）
            ln Y = a·ln(X + h) + b·X + c·Mw + d，X 為震源距離（km）；PGA 單位 gal、PGV 單位 cm/s
  兩者都再依中央氣象署 2020 年起的震度分級換算：4 級以下看 PGA，5 弱以上看 PGV。
  1900 年以前的地震只有文獻推估的震央與規模，不估震度；網頁只顯示震央距離。

颱風：以文資到颱風中心路徑的最短距離判定，100 公里內算「中心通過附近」。風速取各機構在最接近時刻前後的最大值；
     1945 年以前 IBTrACS 沒有風速，只能知道路徑。

用法：python3 tools/build_survived.py [--offline]   （--offline：不下載，只用 .cache/ 已有的檔案）
"""
import csv, json, math, os, re, sys, time, datetime, urllib.request, urllib.parse
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(HERE, ".cache")
OFFLINE = "--offline" in sys.argv
USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query"
IBTRACS = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.WP.list.v04r01.csv"
SHAKEMAP_MIN_M = 6.8
TY_KM = 100           # 颱風中心通過「附近」的距離
G = 9.80665

# Liu & Tsai (2005) 全臺（TWN）水平向係數
LT_PGA = dict(a=-0.852, b=-0.0071, c=1.027, d=1.062, h=1.24)
LT_PGV = dict(a=-0.857, b=-0.0023, c=1.486, d=-4.472, h=1.34)
# 氣象署震度分級（2020 年起）。代碼 0–9 ＝ 0、1、2、3、4、5弱、5強、6弱、6強、7 級
PGA_T = [0.8, 2.5, 8, 25, 80, 140, 250, 440, 800]
PGV_T = [0.2, 0.7, 1.9, 5.7, 15, 30, 50, 80, 140]
LEVELS = ["0", "1", "2", "3", "4", "5弱", "5強", "6弱", "6強", "7"]


def fetch(url, path=None, tries=4):
    if path and os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    if OFFLINE:
        raise IOError("離線模式，沒有快取：" + url)
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (static-site build script)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            if path:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path + ".part", "wb").write(data)
                os.replace(path + ".part", path)
                return path
            return data
        except Exception as e:  # noqa: BLE001
            print("    重試（%s）" % e)
            time.sleep(4 * (k + 1))
    raise IOError("下載失敗：" + url)


def level(pga, pgv):
    """PGA（gal）、PGV（cm/s）陣列 → 震度代碼陣列"""
    la = np.searchsorted(PGA_T, pga, side="right")
    lv = np.searchsorted(PGV_T, pgv, side="right")
    return np.where(la >= 5, np.maximum(4, lv), la).astype(int)


def gmpe(mw, depth, dist_km):
    x = np.sqrt(dist_km ** 2 + (depth if depth is not None else 10.0) ** 2)
    f = lambda k: np.exp(k["a"] * np.log(x + k["h"]) + k["b"] * x + k["c"] * mw + k["d"])  # noqa: E731
    return f(LT_PGA), f(LT_PGV)


def dist_km(lat, lng, lat0, lng0):
    p = math.pi / 180
    a = np.sin((lat - lat0) * p / 2) ** 2 + np.cos(lat * p) * math.cos(lat0 * p) * np.sin((lng - lng0) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


# ---------- ShakeMap ----------
def find_shakemap(e):
    """回傳 (USGS 事件 id, grid.xml 路徑)；找不到回 (None, None)"""
    idx_p = os.path.join(CACHE, "shakemap", "index.json")
    idx = json.load(open(idx_p)) if os.path.exists(idx_p) else {}
    if e["id"] not in idx:
        if OFFLINE:
            return None, None
        t = datetime.datetime.strptime(e["date"] + " " + (e["time"] or "12:00"), "%Y-%m-%d %H:%M") - datetime.timedelta(hours=8)
        q = urllib.parse.urlencode({"format": "geojson", "producttype": "shakemap",
                                    "starttime": (t - datetime.timedelta(minutes=10)).isoformat(), "endtime": (t + datetime.timedelta(minutes=10)).isoformat(),
                                    "minlatitude": e["lat"] - 1.5, "maxlatitude": e["lat"] + 1.5, "minlongitude": e["lng"] - 1.5, "maxlongitude": e["lng"] + 1.5})
        fs = json.loads(fetch(USGS + "?" + q))["features"]
        fs = [f for f in fs if (f["properties"]["mag"] or 0) >= (e["mw"] or e["ml"]) - 1.0]     # 排除同時段的小餘震
        fs.sort(key=lambda f: abs(f["properties"]["time"] / 1000 - t.replace(tzinfo=datetime.timezone.utc).timestamp()))
        url = None
        if fs:
            det = json.loads(fetch(USGS + "?" + urllib.parse.urlencode({"format": "geojson", "eventid": fs[0]["id"]})))
            sm = det["properties"]["products"].get("shakemap") or []
            url = sm and sm[0]["contents"].get("download/grid.xml", {}).get("url")
        idx[e["id"]] = {"usgs": fs[0]["id"], "url": url} if fs and url else {}
        os.makedirs(os.path.dirname(idx_p), exist_ok=True)
        json.dump(idx, open(idx_p, "w"), indent=0)
        time.sleep(1)
    r = idx[e["id"]]
    if not r:
        return None, None
    try:
        return r["usgs"], fetch(r["url"], os.path.join(CACHE, "shakemap", r["usgs"] + ".grid.xml"))
    except IOError as err:
        print("    " + str(err))
        return None, None


def sample_grid(path, lat, lng):
    """回傳文資位置的 (PGA gal, PGV cm/s)，格網範圍外是 nan"""
    t = open(path, encoding="utf-8", errors="replace").read()
    spec = dict(re.findall(r'(\w+)="([^"]*)"', re.search(r"<grid_specification([^>]*)>", t).group(1)))
    names = [n.upper() for _, n in sorted((int(i), n) for i, n in re.findall(r'<grid_field index="(\d+)" name="(\w+)"', t))]
    body = t[t.index("<grid_data>") + 11:t.index("</grid_data>")]
    a = np.array(body.split(), dtype=float).reshape(-1, len(names))
    nlon, nlat = int(spec["nlon"]), int(spec["nlat"])
    lon0, lat1 = float(spec["lon_min"]), float(spec["lat_max"])
    # 標頭的 nominal spacing 只有四位小數（0.0167），累積起來會偏，改用範圍除以格數
    dx, dy = (float(spec["lon_max"]) - lon0) / (nlon - 1), (lat1 - float(spec["lat_min"])) / (nlat - 1)
    col, row = np.rint((lng - lon0) / dx).astype(int), np.rint((lat1 - lat) / dy).astype(int)
    ok = (col >= 0) & (col < nlon) & (row >= 0) & (row < nlat)
    i = np.where(ok, row * nlon + col, 0)
    assert a.shape[0] == nlon * nlat, "格網大小不符"
    chk = ok & ((np.abs(a[i, names.index("LON")] - lng) > dx) | (np.abs(a[i, names.index("LAT")] - lat) > dy))
    assert not chk.any(), "格網排列與預期不同"
    pga = np.where(ok, a[i, names.index("PGA")] / 100 * G * 100, np.nan)   # %g → gal
    pgv = np.where(ok, a[i, names.index("PGV")], np.nan)
    return pga, pgv


# ---------- 颱風 ----------
def typhoons(lat, lng, years):
    path = fetch(IBTRACS, os.path.join(CACHE, "ibtracs.WP.csv"))
    names_p = os.path.join(HERE, "data", "raw", "typhoon-names.json")
    zh = json.load(open(names_p, encoding="utf-8"))["names"] if os.path.exists(names_p) else {}
    storms = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        rd = csv.reader(f)
        head = next(rd); next(rd)
        ix = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "ISO_TIME", "LAT", "LON")}
        wind_ix = [i for i, h in enumerate(head) if h.endswith("_WIND") and h != "WMO_WIND"]
        for r in rd:
            try:
                la, lo = float(r[ix["LAT"]]), float(r[ix["LON"]])
            except ValueError:
                continue
            w = [float(r[i]) for i in wind_ix if r[i].strip() not in ("", "-")]
            storms.setdefault(r[ix["SID"]], {"year": int(r[ix["ISO_TIME"]][:4]), "name": r[ix["NAME"]].strip(), "pts": []})["pts"].append(
                (la, lo, max(w) if w else -1.0, r[ix["ISO_TIME"]]))
    kx = 111.32 * math.cos(math.radians(23.7))    # 平面近似（公里），臺灣範圍內誤差很小
    X, Y = lng * kx, lat * 110.57
    out, per_site = [], [[] for _ in lat]
    for sid in sorted(storms):
        s = storms[sid]
        p = np.array([(a, b, c) for a, b, c, _ in s["pts"]])
        if len(p) < 2 or not ((p[:, 0] > 19) & (p[:, 0] < 28.5) & (p[:, 1] > 115) & (p[:, 1] < 125)).any():
            continue
        ax, ay, bx, by = p[:-1, 1] * kx, p[:-1, 0] * 110.57, p[1:, 1] * kx, p[1:, 0] * 110.57
        ok = (np.abs(bx - ax) < 600) & (np.abs(by - ay) < 600)     # 跳過資料斷點
        if not ok.any():
            continue
        ax, ay, bx, by = ax[ok], ay[ok], bx[ok], by[ok]
        w = np.maximum(p[:-1, 2], p[1:, 2])[ok]
        dx, dy = bx - ax, by - ay
        L2 = np.maximum(dx * dx + dy * dy, 1e-9)
        tt = np.clip(((X[:, None] - ax) * dx + (Y[:, None] - ay) * dy) / L2, 0, 1)
        d = np.hypot(X[:, None] - (ax + tt * dx), Y[:, None] - (ay + tt * dy))
        j = d.argmin(axis=1)
        dmin = d[np.arange(len(lat)), j]
        hit = np.nonzero((dmin <= TY_KM) & (years <= s["year"]))[0]
        if not len(hit):
            continue
        date = [t for a, b, c, t in s["pts"] if 19 < a < 28.5 and 115 < b < 125][0][:10]
        en = "" if s["name"] in ("UNNAMED", "NOT_NAMED", "") else s["name"].title()
        k = len(out)
        out.append({"id": sid, "date": date, "en": en, "zh": zh.get("%d|%s" % (s["year"], en.upper()), "")})
        for i in hit:
            per_site[i].append((k, int(round(dmin[i])), int(w[j[i]])))
    return out, per_site


def main():
    S = json.load(open(os.path.join(HERE, "data", "sites.json"), encoding="utf-8"))
    F = S["meta"]["fields"]
    lat = np.array([r[F.index("lat")] for r in S["sites"]], dtype=float)
    lng = np.array([r[F.index("lng")] for r in S["sites"]], dtype=float)
    years = np.array([r[F.index("year")] for r in S["sites"]])
    Q = json.load(open(os.path.join(HERE, "data", "raw", "quakes.json"), encoding="utf-8"))
    events, matrix = [], []
    for e in Q["events"]:
        m = e["mw"] or e["ml"]
        o = {k: e[k] for k in ("id", "date", "time", "lat", "lng", "depth", "name", "note")}
        o["m"], o["mType"] = m, ("Mw" if e["mw"] else "ML")
        e = dict(e, mw=e["mw"], ml=e["ml"])
        if e["src"] == "old":
            o["method"], o["magRange"] = "none", e.get("magRange")
            events.append(o); matrix.append("")
            continue
        d = dist_km(lat, lng, e["lat"], e["lng"])
        pga, pgv = gmpe(m, e["depth"], d)
        o["method"] = "gmpe"
        if m >= SHAKEMAP_MIN_M and e["date"] >= "1919":
            uid, path = find_shakemap(e)
            if path:
                ga, gv = sample_grid(path, lat, lng)
                inside = ~np.isnan(ga)
                pga, pgv = np.where(inside, ga, pga), np.where(inside, gv, pgv)
                o["method"], o["usgs"] = "shakemap", uid
                print("  ShakeMap：%s %s（%s），格網內 %d 處" % (e["date"], e["name"], uid, inside.sum()))
            else:
                print("  沒有 ShakeMap，改用衰減式：%s %s M%.1f" % (e["date"], e["name"], m))
        lv = level(pga, pgv)
        lv[lv < 3] = 0                      # 3 級以下不記
        o["max"] = int(lv.max())
        events.append(o); matrix.append("".join(map(str, lv)))
    storms, per_site = typhoons(lat, lng, years)
    ty = []
    for lst in per_site:
        known = [x for x in lst if x[2] >= 0]
        strong = [x for x in known if x[2] >= 64]
        top = sorted(strong, key=lambda x: (-x[2], x[1]))[:5]
        # [路徑通過總數, 其中沒有風速紀錄的, 颱風強度（≥64 節）的, 最強的幾個 [颱風索引, 距離 km, 風速 節]]
        ty.append([len(lst), len(lst) - len(known), len(strong), [list(x) for x in top]])
    used = sorted({x[0] for t in ty for x in t[3]})
    remap = {k: i for i, k in enumerate(used)}
    for t in ty:
        for x in t[3]:
            x[0] = remap[x[0]]
    out = {"meta": {"generated": datetime.date.today().isoformat(), "levels": LEVELS, "typhoonKm": TY_KM,
                    "quakeSources": Q["meta"]["sources"] + ["U.S. Geological Survey ShakeMap（規模 %.1f 以上地震的震度格網）" % SHAKEMAP_MIN_M,
                                                            "Liu, K.-S. & Tsai, Y.-B. (2005) BSSA 95(3):1045–1058（震度衰減式）"],
                    "typhoonSources": ["NOAA NCEI IBTrACS v04r01（Knapp et al. 2010；Gahtan et al. 2024, doi:10.25921/82ty-9e16）"],
                    "note": "quakes[i].levels 是一個字串，第 k 個字元是第 k 處文資（順序同 sites.json）的推估震度代碼（0＝3 級以下或未估算）。沒有扣除文資創建年，由網頁比對。"},
           "quakes": [dict(e, levels=matrix[i]) for i, e in enumerate(events)],
           "storms": [storms[k] for k in used], "typhoons": ty}
    p = os.path.join(HERE, "data", "survived.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("寫入 %s：地震 %d 個（ShakeMap %d、衰減式 %d、只有震央 %d），颱風 %d 個；%d KB" % (
        p, len(events), sum(e["method"] == "shakemap" for e in events), sum(e["method"] == "gmpe" for e in events),
        sum(e["method"] == "none" for e in events), len(used), os.path.getsize(p) // 1024))


if __name__ == "__main__":
    main()
