"""產生 data/raw/quakes.json：臺灣災害性地震清單（「它挺過了什麼」圖層的原始資料）

來源（都抓一次就存檔，之後的建置只讀存檔；要更新時再執行本腳本）：
  1. 中央氣象署地震測報中心「災害性地震列表」（1901 年起）  https://scweb.cwa.gov.tw/zh-tw/page/disaster/5
  2. 中央氣象署地震測報中心「20 世紀前地震記載」（1604–1900） https://scweb.cwa.gov.tw/zh-tw/DisasterList/list
     原始出處：鄭世楠、葉永田（1989）《西元 1604 年至 1988 年臺灣地區地震目錄》
  3. 氣象署列表之後的災害地震：名稱寫在下面的 EXTRA，震源參數取自美國地質調查所（USGS）地震目錄

氣象署網站資料依其「政府網站資料開放宣告」可重製、改作，須註明出處；該宣告不建議自動擷取，
所以本腳本只在需要更新時手動執行，一次各抓一頁。

用法：python3 tools/fetch_quakes.py            （從網路抓）
      python3 tools/fetch_quakes.py a.html b.html （用已存下來的兩個網頁：1901 年後、1900 年前）
"""
import json, os, re, sys, html, time, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL_MODERN = "https://scweb.cwa.gov.tw/zh-tw/page/disaster/5"
URL_OLD = "https://scweb.cwa.gov.tw/zh-tw/DisasterList/list"
USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query"
# 氣象署列表（到 2022/09/18）之後的災害地震：日期（臺灣時間）→ 名稱與災情。震源參數由 USGS 補。
EXTRA = {
    "2024-04-03": ["0403花蓮地震", "花蓮縣災情嚴重，太魯閣地區多處落石坍方"],
    "2025-01-21": ["0121嘉義大埔地震", "臺南市楠西區、嘉義縣大埔鄉一帶多棟房屋受損"],
}


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (static-site build script)"})
            return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            print("  重試（%s）" % e)
            time.sleep(3 * (k + 1))
    sys.exit("下載失敗：" + url)


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", s or "")
    return float(m.group()) if m else None


def parse_modern(t):
    out = []
    for row in re.split(r'(?=<div class="data-row)', t)[1:]:
        row = row.split("<script")[0]
        no = text(re.search(r'class="dr-no">(.*?)</div>', row, re.S).group(1))
        dates = re.findall(r'class="dr-md">([\d/]+)</span>\s*<span class="dr-time">([\d:]+)', row)
        pills = re.findall(r'class="lbl">(N|E|Dep|ML|Mw)</span>\s*<span class="val">(.*?)</span>', row)
        shocks, cur = [], {}
        for k, v in pills:
            if k == "N" and cur:
                shocks.append(cur); cur = {}
            cur[k] = num(v)
        if cur:
            shocks.append(cur)
        names = [text(x) for x in re.findall(r'class="eq-name-hl">(.*?)</span>', row, re.S)]
        rm = re.search(r'class="dr-remark">(.*)', row, re.S)
        remark = text(rm.group(1)) if rm else ""
        for n in names:
            remark = remark.replace(n, "", 1)
        remark = re.sub(r"載入更多.*$", "", remark)
        remark = re.sub(r"\(\s*[上下]\s*\)", "", remark).strip(" ，,、|")
        if len(dates) != len(shocks):
            print("  注意：編號 %s 的日期與震源參數筆數不同（%d／%d），請人工檢查" % (no, len(dates), len(shocks)))
        for i, (d, tm) in enumerate(dates[:len(shocks)]):
            s = shocks[i]
            if s.get("N") is None or s.get("E") is None or (s.get("ML") is None and s.get("Mw") is None):
                continue
            out.append({"id": "cwa%s%s" % (no, "abcdef"[i] if len(dates) > 1 else ""), "date": d.replace("/", "-"), "time": tm,
                        "lat": s["N"], "lng": s["E"], "depth": s.get("Dep"), "ml": s.get("ML"), "mw": s.get("Mw"),
                        "name": names[i] if i < len(names) else (names[0] if names else ""),
                        # 同一編號裡名稱不同的第二個地震：災情文字無法確定屬於哪一個，不帶入
                        "note": remark if (i == 0 or len(set(names)) <= 1) else "", "src": "cwa"})
    return out


def parse_old(t):
    """1900 年以前：只收有震央經緯度、且三家規模估計至少有一個的紀錄"""
    out = []
    for row in re.split(r'(?=<div class="data-row)', t)[1:]:
        row = row.split("<script")[0]
        cells = [c.strip() for c in re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "|", row))).split("|") if c.strip()]
        if not cells:
            continue
        m = re.match(r"(\d{4})(?:/(\d{1,2}))?(?:/(\d{1,2}))?", cells[0])
        joined = " ".join(cells)
        c = re.search(r"(\d+(?:\.\d+)?)\s*°\s*N\s*[,，]\s*(\d+(?:\.\d+)?)\s*°\s*E", joined)
        mags = {}
        for who in ("徐", "李", "蔡"):
            if who in cells:
                v = num(cells[cells.index(who) + 1]) if cells.index(who) + 1 < len(cells) else None
                if v:
                    mags[who] = v
        if not (m and c and mags):
            continue
        y, mo, d = m.group(1), m.group(2), m.group(3)
        area = cells[2] if len(cells) > 2 else ""
        tail = joined.split("蔡", 1)[1] if "蔡" in joined else ""
        note = re.sub(r"^\s*[-\d.]+\s*", "", tail).strip()
        vals = sorted(mags.values())
        out.append({"id": "old%s%s%s" % (y, (mo or "").zfill(2), (d or "").zfill(2)), "date": "-".join(x.zfill(2) for x in (y, mo, d) if x),
                    "time": "", "lat": float(c.group(1)), "lng": float(c.group(2)), "depth": None, "ml": None,
                    "mw": vals[len(vals) // 2], "magRange": [vals[0], vals[-1]],
                    "name": "%s年%s地震" % (y, area), "note": note, "src": "old"})
    return out


def fetch_extra():
    out = []
    q = urllib.parse.urlencode({"format": "geojson", "starttime": "2022-09-19", "minmagnitude": 5.8, "minlatitude": 21,
                                "maxlatitude": 26.5, "minlongitude": 119, "maxlongitude": 123.5, "orderby": "time-asc"})
    for f in json.loads(get(USGS + "?" + q))["features"]:
        p, g = f["properties"], f["geometry"]["coordinates"]
        tw = datetime.datetime.fromtimestamp(p["time"] / 1000, datetime.timezone(datetime.timedelta(hours=8)))
        key = tw.strftime("%Y-%m-%d")
        if key in EXTRA and not any(o["date"] == key for o in out):   # 同一天取第一個（主震）
            out.append({"id": "usgs" + f["id"], "date": key, "time": tw.strftime("%H:%M"), "lat": round(g[1], 3), "lng": round(g[0], 3),
                        "depth": round(g[2], 1), "ml": None, "mw": p["mag"], "name": EXTRA[key][0], "note": EXTRA[key][1],
                        "src": "usgs", "usgsId": f["id"]})
    for k in EXTRA:
        if not any(o["date"] == k for o in out):
            print("  注意：USGS 找不到 %s 的地震（%s）" % (k, EXTRA[k][0]))
    return out


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        a, b = open(sys.argv[1], encoding="utf-8").read(), open(sys.argv[2], encoding="utf-8").read()
    else:
        a, b = get(URL_MODERN), get(URL_OLD)
    modern, old, extra = parse_modern(a), parse_old(b), fetch_extra()
    ev = sorted(old + modern + extra, key=lambda e: e["date"])
    out = {"meta": {"fetched": datetime.date.today().isoformat(),
                    "sources": ["交通部中央氣象署地震測報中心〈災害性地震列表〉" + URL_MODERN,
                                "交通部中央氣象署地震測報中心〈20 世紀前地震記載〉" + URL_OLD + "（原始出處：鄭世楠、葉永田 1989）",
                                "U.S. Geological Survey Earthquake Catalog（2022 年 9 月以後的震源參數）"],
                    "note": "date、time 為臺灣時間。src：cwa＝氣象署災害地震列表；old＝1900 年以前的歷史文獻推估（mw 為三家規模估計的中位數，magRange 為範圍）；usgs＝USGS。"},
           "events": ev}
    p = os.path.join(HERE, "data", "raw", "quakes.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print("寫入 %s：1900 年以前 %d 筆、氣象署列表 %d 筆、補充 %d 筆" % (p, len(old), len(modern), len(extra)))
