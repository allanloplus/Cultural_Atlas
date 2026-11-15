"""產生 data/sites.json：全臺有形文化資產的精簡主檔（地圖集所有圖層共用）

資料來源是兩個文資知識網站（Cultural_Heritage、Cultural_Heritage2）各縣市的
data/sites-official.json 與 data/sites-content.json；本腳本只讀取，不修改它們。

用法：
  python3 tools/build_sites.py
兩個 repo 的位置：環境變數 CH1_DIR、CH2_DIR，沒設就找本 repo 旁邊的 Cultural_Heritage、Cultural_Heritage2。
縣市清單、哪個縣市在哪個網站、網站網址，都以 Cultural_Heritage/assets/js/cities.js 為準
（做法與 Cultural_Heritage_Master/tools/build_index.py 相同）。

建置時做的整理：
  1. 全國時代（era）一律由創建年重新計算。各縣市 sites-content.json 的 era 是「該縣市時光地圖」的代碼，
     意義不一致（例如金門的 dutch 是「唐宋到明代」），不能直接用在全國時間軸。
  2. 金門、馬祖沒有荷西與日治時期，另外算一個「當地時期」名稱（local）給卡片顯示。
  3. 公告日期明顯錯誤的，用 ANNOUNCED_FIX 修正（原始資料不動）。
  4. 座標完全相同的文資（同址）排成一小圈錯開，約 15 公尺。
"""
import json, os, re, sys, math, datetime, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARENT = os.path.dirname(HERE)


def find(env, names):
    d = os.environ.get(env)
    if d:
        return os.path.abspath(d)
    for n in names:
        p = os.path.join(PARENT, n)
        if os.path.isdir(p):
            return p
    sys.exit("找不到 %s，請設定環境變數 %s" % (names[0], env))


CH1 = find("CH1_DIR", ["Cultural_Heritage", "cultural_heritage"])
CH2 = find("CH2_DIR", ["Cultural_Heritage2", "cultural_heritage2"])

# 全國時代：[代碼, 名稱, 起始年（含）]。1945 年算日治，1946 年起算戰後。
ERAS = [["pre", "史前與早期", None], ["dutch", "荷西", 1624], ["zheng", "明鄭", 1662],
        ["qing", "清領", 1684], ["japan", "日治", 1895], ["postwar", "戰後", 1946]]
# 類別分組（縣定、市定古蹟合併）：[代碼, 名稱, 原始類別]
CATS = [["national", "國定古蹟", ["國定古蹟"]], ["local", "直轄市定、縣市定古蹟", ["市定古蹟", "縣定古蹟"]],
        ["building", "歷史建築", ["歷史建築"]], ["memorial", "紀念建築", ["紀念建築"]],
        ["cluster", "聚落建築群", ["聚落建築群"]], ["landscape", "文化景觀", ["文化景觀"]],
        ["archaeo", "考古遺址", ["考古遺址"]]]
CAT_IDX = {raw: i for i, c in enumerate(CATS) for raw in c[2]}
# 公告日期修正：(縣市, id 或名稱) → 正確日期。原因寫在後面。
ANNOUNCED_FIX = {("hsinchu-city", "金城新村"): "2024-10-17"}  # 原始資料為 0113-10-17（民國 113 年未換算）
OUTLYING = {"kinmen-county", "lienchiang-county"}  # 沒有荷西、日治時期的縣


def era_of(year):
    i = 0
    for k, e in enumerate(ERAS):
        if e[2] is not None and year >= e[2]:
            i = k
    return i


def local_period(year):
    """金門、馬祖的當地時期名稱"""
    if year < 618:
        return "史前與早期"
    if year < 1368:
        return "唐宋元時期"
    if year < 1662:
        return "明代"
    if year < 1684:
        return "明鄭時期"
    if year < 1912:
        return "清代"
    if year < 1949:
        return "民國初年"
    return "1949 年以後（戰地時期）"


txt = open(os.path.join(CH1, "assets", "js", "cities.js"), encoding="utf-8").read()
urls = {int(k): v for k, v in re.findall(r'(\d+):\s*"([^"]+)"', re.search(r"var SITES = \{([^}]*)\}", txt).group(1))}
site2 = re.findall(r'"([^"]+)"', re.search(r"var SITE2 = \[([^\]]*)\]", txt).group(1))

ORDER = ["keelung-city", "taipei-city", "new-taipei-city", "taoyuan-city", "hsinchu-city", "hsinchu-county", "miaoli-county",
         "taichung-city", "changhua-county", "nantou-county", "yunlin-county", "chiayi-city", "chiayi-county", "tainan-city",
         "kaohsiung-city", "pingtung-county", "yilan-county", "hualien-county", "taitung-county", "penghu-county",
         "kinmen-county", "lienchiang-county"]
found = []
for m in re.finditer(r"\{\s*slug:\s*\"([^\"]+)\",\s*name:\s*\"([^\"]+)\"(.*?)\}", txt, re.S):
    slug, name, rest = m.group(1), m.group(2), m.group(3)
    if not re.search(r"on:\s*true", rest):
        continue
    sm = re.search(r"site:\s*(\d)", rest)
    site = int(sm.group(1)) if sm else (2 if name in site2 else 1)
    lm = re.search(r'label:\s*"([^"]+)"', rest)
    found.append((slug, name, lm.group(1) if lm else name, site))
found.sort(key=lambda c: ORDER.index(c[0]) if c[0] in ORDER else 99)

counties, sites, warn = [], [], []
today = datetime.date.today()
for ci, (slug, name, label, site) in enumerate(found):
    base = CH1 if site == 1 else CH2
    off_p = os.path.join(base, slug, "data", "sites-official.json")
    con_p = os.path.join(base, slug, "data", "sites-content.json")
    if not os.path.exists(off_p) or not os.path.exists(con_p):
        print("略過（沒有資料）：", slug)
        continue
    off = json.load(open(off_p, encoding="utf-8"))
    con = {c["id"]: c for c in json.load(open(con_p, encoding="utf-8"))}
    n = 0
    for s in off:
        c = con.get(s["id"])
        if c is None:
            warn.append("%s／%s：沒有 sites-content，略過" % (name, s["name"]))
            continue
        lat, lng = c.get("lat", s.get("lat")), c.get("lng", s.get("lng"))
        year = c.get("year")
        if not lat or not lng or not isinstance(year, (int, float)):
            warn.append("%s／%s：缺座標或年份，略過" % (name, s["name"]))
            continue
        ann = ANNOUNCED_FIX.get((slug, s["id"])) or ANNOUNCED_FIX.get((slug, s["name"])) or s.get("announced") or ""
        try:
            d = datetime.date.fromisoformat(ann)
            if not (datetime.date(1982, 5, 26) <= d <= today):
                raise ValueError
        except ValueError:
            warn.append("%s／%s：公告日期不合理（%s），第二條時間軸不顯示這一處；請在 ANNOUNCED_FIX 補上" % (name, s["name"], ann))
            ann = ""
        if s["category"] not in CAT_IDX:
            warn.append("%s／%s：未知的類別 %s，歸入歷史建築" % (name, s["name"], s["category"]))
        sites.append({"c": len(counties), "id": s["id"], "name": s["name"], "cat": CAT_IDX.get(s["category"], 2),
                      "rawcat": s["category"], "town": s.get("town") or "", "lat": lat, "lng": lng, "year": int(year),
                      "est": 1 if c.get("yearUnknown") else 0, "yt": c.get("yearText") or "", "ann": ann,
                      "sum": c.get("summary") or "", "local": local_period(year) if slug in OUTLYING else ""})
        n += 1
    counties.append({"slug": slug, "name": name, "label": label, "base": urls[site] + slug + "/", "n": n})

# 同址的文資排成一小圈
groups = collections.defaultdict(list)
for s in sites:
    groups[(round(s["lat"], 5), round(s["lng"], 5))].append(s)
moved = 0
for g in groups.values():
    if len(g) > 1:
        for k, s in enumerate(g):
            a = 2 * math.pi * k / len(g)
            s["lat"] += 0.00014 * math.sin(a)
            s["lng"] += 0.00015 * math.cos(a)
            moved += 1

FIELDS = ["county", "id", "name", "cat", "rawCategory", "town", "lat", "lng", "year", "estimated", "yearText",
          "announced", "era", "summary", "localPeriod"]
rows = [[s["c"], s["id"], s["name"], s["cat"], s["rawcat"], s["town"], round(s["lat"], 5), round(s["lng"], 5), s["year"],
         s["est"], s["yt"], s["ann"], era_of(s["year"]), s["sum"], s["local"]] for s in sites]
out = {"meta": {"generated": today.isoformat(), "total": len(rows),
                "source": "allanloplus/Cultural_Heritage、allanloplus/Cultural_Heritage2 各縣市的 data/sites-official.json、sites-content.json",
                "fields": FIELDS, "estimated": sum(s["est"] for s in sites),
                "yearMin": min(s["year"] for s in sites), "yearMax": max(s["year"] for s in sites),
                "announcedMin": min(s["ann"] for s in sites if s["ann"]), "announcedMax": max(s["ann"] for s in sites)},
       "eras": [{"id": e[0], "name": e[1], "from": e[2]} for e in ERAS],
       "cats": [{"id": c[0], "name": c[1]} for c in CATS],
       "counties": counties, "sites": rows}
p = os.path.join(HERE, "data", "sites.json")
with open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("寫入 %s：%d 個縣市、%d 處（年代推估 %d 處、同址錯開 %d 處），%d KB" % (
    p, len(counties), len(rows), out["meta"]["estimated"], moved, os.path.getsize(p) // 1024))
ec = collections.Counter(r[12] for r in rows)
print("各時代：" + "、".join("%s %d" % (ERAS[i][1], ec[i]) for i in range(len(ERAS))))
for w in warn:
    print("注意：" + w)
ids = collections.Counter((r[0], r[1]) for r in rows)
if any(v > 1 for v in ids.values()):
    sys.exit("錯誤：同一縣市內有重複的 id")
