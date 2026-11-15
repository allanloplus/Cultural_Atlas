"""產生 data/raw/typhoon-names.json：有發布警報的颱風中文名稱（1958 年起）

來源：交通部中央氣象署颱風資料庫 https://rdc28.cwa.gov.tw/TDB/ 的「有發布警報颱風列表」。
依氣象署「政府網站資料開放宣告」可重製、改作，須註明出處；只在需要更新時手動執行，一次抓一頁。
用法：python3 tools/fetch_typhoon_names.py
"""
import json, os, sys, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://rdc28.cwa.gov.tw/TDB/public/warning_typhoon_list/get_warning_typhoon"
req = urllib.request.Request(URL, data=urllib.parse.urlencode({"year": "all"}).encode(),
                             headers={"X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0 (static-site build script)"})
rows = json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig"))
if isinstance(rows, dict):
    rows = rows.get("data") or rows.get("rows") or []
names = {}
for r in rows:
    y, en, zh = str(r.get("id", ""))[:4], (r.get("eng_name") or "").strip().upper(), (r.get("cht_name") or "").strip()
    if y.isdigit() and en and zh:
        names["%s|%s" % (y, en)] = zh
if not names:
    sys.exit("沒有取得資料，欄位可能改了：%s" % (str(rows)[:300]))
p = os.path.join(HERE, "data", "raw", "typhoon-names.json")
json.dump({"meta": {"fetched": datetime.date.today().isoformat(), "source": "交通部中央氣象署颱風資料庫（有發布警報颱風列表）https://rdc28.cwa.gov.tw/TDB/",
                    "note": "鍵是「年份|英文名（大寫）」"}, "names": names}, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("寫入 %s：%d 個颱風" % (p, len(names)))
