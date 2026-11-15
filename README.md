# 文資地圖集

臺灣文化資產的地圖與資料視覺化網站，是「Allan Lo 和你逛文化」的第三個姊妹站。

- 網址：https://cultural-atlas.123hi.org/
- 規劃設計：Allan Lo，https://www.123hi.org，2026年11月

| 網站 | 內容 | Repo |
|---|---|---|
| https://cultural.123hi.org/ | 文資知識網站第一站（13 縣市＋共用程式） | allanloplus/Cultural_Heritage |
| https://cultural2.123hi.org/ | 文資知識網站第二站（9 縣市） | allanloplus/Cultural_Heritage2 |
| https://cultural-visit.123hi.org/ | 文資達人訪查 | allanloplus/Cultural_Heritage_Master |
| https://cultural-atlas.123hi.org/ | 文資地圖集（本 repo） | allanloplus/Cultural_Atlas |

## 目前的內容

**臺灣是怎麼長出來的（時間軸動畫）**：3,032 處有形文化資產依年份在地圖上亮起。

- 「創建年」軸：史前到今天，顏色分六個時代（1624 年以前、荷西、明鄭、清領、日治、戰後）。年代為推估的文資以空心圈表示，可在圖例關閉。
- 「公告日期」軸：1982 年《文化資產保存法》公布至今，顏色分類別，軌道上標出修法節點。
- 點任何一處會開卡片，並連回知識網站的 `<縣市>/#map/<景點 id>`。
- 網址可直接指定狀態：`#timeline/built/1895`、`#timeline/listed/2005-11`。

**它挺過了什麼（歷史地震與颱風）**：用創建年與位置對照 183 個災害地震與 1884 年以來的颱風路徑，推估每處文資經歷過什麼。

- 地震：可看「歷來最大推估震度」，或選一個地震，看當時已存在的文資各自的推估震度。
- 颱風：每處文資創建以來，颱風中心從 100 公里內通過的次數。
- 卡片上有每處文資的一句經歷摘要。
- **全部是推估，不是官方觀測**；方法、誤差與來源寫在頁面的「資料說明」。
- 網址：`#survived/quake/cwa111`（集集地震）、`#survived/typhoon`。

**文資風險地圖**：文資座標套疊政府公開的災害潛勢圖資。

- 淹水潛勢（水利署第三代，24 小時 350／500／650 毫米三個情境）、活動斷層（距離 100、500 公尺內）、土石流（影響範圍內或距潛勢溪流 200 公尺內）、大規模崩塌（潛勢區或影響範圍內），以及四項合計的「綜合」。
- 圖例有各級處數與各縣市統計；卡片列出該處的每一項標籤。
- **圖資套疊結果，僅供防災參考**。淹水潛勢圖依《水災潛勢資料公開辦法》僅供防救災使用，不得作為土地使用管制或開發限制的依據，頁面上保留了這段聲明，請勿移除。
- 活動斷層的距離門檻是本站自訂的，不是法定地質敏感區。
- 沒有土壤液化：目前沒有可穩定下載的全臺向量檔。
- 網址：`#risk`、`#risk/flood/1`、`#risk/fault`、`#risk/debris`、`#risk/landslide`。

目前的套疊結果（2026 年 11 月）：24 小時 350／500／650 毫米情境下淹水 0.5 公尺以上的文資 51／122／242 處；距活動斷層 500 公尺內 178 處；土石流 30 處；大規模崩塌 3 處。

規劃中的圖層：3D 文資島。

## 架構

純靜態網站，沒有後台與資料庫。所有資料在建置時用 Python 算好，輸出成 `data/` 的 JSON，網頁只讀取結果。

```
index.html                  唯一的頁面
assets/css/atlas.css        樣式（配色、深色模式沿用知識網站 site.css 的變數）
assets/js/core.js           載入資料、建立地圖、圖層註冊、文資卡片、網址路由
assets/js/layers/           一個圖層一支檔
assets/vendor/              MapLibre GL JS 4.7.1（放本機、固定版本）
data/sites.json             全臺有形文資的精簡主檔（所有圖層共用）
data/survived.json          每處文資的推估震度與颱風通過紀錄
data/risk.json              每處文資的災害潛勢標籤
data/risk-lines.geojson     地圖上畫的活動斷層與土石流潛勢溪流（已簡化）
data/raw/                   抓一次就存檔的原始清單（災害地震、颱風中文名）
data/layers.json            圖層清單
tools/build_sites.py        產生 data/sites.json
tools/fetch_quakes.py       抓氣象署災害地震列表 → data/raw/quakes.json
tools/fetch_typhoon_names.py 抓氣象署颱風中文名 → data/raw/typhoon-names.json
tools/build_survived.py     產生 data/survived.json
tools/build_risk.py         產生 data/risk.json、data/risk-lines.geojson
```

### 更新資料

知識網站的資料有變動（新增文資、修正年代）之後，重新產生主檔並提交：

```bash
python3 tools/build_sites.py
```

腳本會找本 repo 旁邊的 `Cultural_Heritage`、`Cultural_Heritage2` 兩個資料夾（或用環境變數 `CH1_DIR`、`CH2_DIR` 指定），只讀取、不修改它們。縣市清單與網址以 `Cultural_Heritage/assets/js/cities.js` 為準。執行後請看輸出的「注意」訊息。

建置時做的整理：

- 時代一律由創建年重新計算。各縣市 `sites-content.json` 的 `era` 是該縣市時光地圖用的代碼，意義不一致（例如金門的 `dutch` 是「唐宋到明代」），不能用在全國時間軸。
- 金門、馬祖沒有荷西與日治時期，另外產生「當地時期」名稱給卡片顯示。
- 公告日期錯誤的資料在腳本的 `ANNOUNCED_FIX` 修正（目前一筆：新竹市金城新村，原始資料 `0113-10-17` 是民國年未換算，改為 2024-10-17）。日期不合理又沒列在這裡的，腳本會提醒，該處不會出現在公告日期軸。
- 座標完全相同的文資（同址，目前 42 處）排成一小圈錯開約 15 公尺。

### 更新「它挺過了什麼」

```bash
python3 tools/build_survived.py
```

需要 Python 的 numpy。第一次執行會下載約 600 MB 到 `.cache/`（USGS 震度格網 33 個、NOAA 颱風路徑檔），約需數分鐘；`.cache/` 不進 repo，之後加 `--offline` 可以只用已下載的檔案。`data/sites.json` 有變動（文資增減）就要重跑，因為結果是照文資順序存的。

有新的災害地震時：在 `tools/fetch_quakes.py` 的 `EXTRA` 加一筆（日期、名稱、災情），執行 `python3 tools/fetch_quakes.py` 再重跑上面的指令。`fetch_quakes.py` 與 `fetch_typhoon_names.py` 會連到氣象署網站，各只抓一頁；氣象署不建議自動擷取，所以只在需要更新時手動執行，結果存進 `data/raw/`。

推估方法：規模 6.8 以上、USGS 有 ShakeMap 的地震取格網值，其餘用 Liu & Tsai（2005）衰減式，再依氣象署 2020 年震度分級換算。與氣象署 13 個地震、572 個實測 5 弱以上測站比較，衰減式平均低 1.3 級、ShakeMap 平均低 0.7 級（比較對象只有震度大的測站，偏低有一部分是取樣造成）。1900 年以前的地震不估震度。

### 更新「文資風險地圖」

```bash
pip install pyshp shapely pyproj py7zr
```

```bash
python3 tools/build_risk.py
```

會下載原始圖資到 `.cache/risk/`（不進 repo）。淹水潛勢圖是 20 個分縣市壓縮檔，合計約 2.5 GB（多半是附圖），腳本取出向量檔後就把壓縮檔刪掉，留下約 100 MB；單線下載約需一小時。repo 裡只有計算結果。`data/sites.json` 有變動就要重跑。

注意事項：

- 農業部（土石流、大規模崩塌）的下載網址帶有 `RID`，每年改版會變。失效時到腳本開頭註明的資料集頁面找新網址，改 `SRC`，並更新 `meta.attribution` 裡的年份與數量。
- 活動斷層取自地質雲 API，偶爾連線中斷，重跑即可。
- 淹水圖 20 個縣市的檔名與欄位格式都不一樣（九種檔名寫法、五級制與六級制並存、編碼不一）。腳本用通用規則判讀，判讀不出來時會印「注意」並保留壓縮檔；看到「注意」請先查清楚再用結果。完全不照規則的檔名寫在 `FLOOD_ALIAS`（目前一筆：彰化縣的 650 毫米情境）。
- 金門、連江、澎湖的淹水檔只有 1–5 的分級、沒有深度文字，腳本比照其他五級制縣市視為從 0.3–0.5 公尺起算，這是推定。
- 水利署的下載速度約每秒 700 KB，容易中斷；`.cache/risk/` 裡已下載的檔不會重抓。
- 水利署另有 2022 年版的全臺淹水圖，但該網站從境外連不上，目前用的是 2018 年版。
- 所有圖資依政府資料開放授權條款第 1 版利用，必須標示提供機關、年份與資料名稱；頁面的「資料說明」會自動列出 `meta.attribution`。

### 新增圖層

1. 在 `tools/` 寫建置腳本，輸出以文資 id 為鍵的 JSON 到 `data/`。
2. 寫 `assets/js/layers/<id>.js`，呼叫 `Atlas.registerLayer({...})`（介面說明在 `core.js` 開頭，範例見 `timeline.js`）。
3. 在 `data/layers.json` 加一筆。圖層有兩個以上時，頂端列會自動出現切換分頁。

## 本機預覽

```bash
python3 -m http.server 8000
```

開啟 http://localhost:8000/ 。底圖與字型需要連網。

## 部署

GitHub Pages：Settings → Pages → Deploy from a branch，選 `main` 與 `/ (root)`。自訂網域寫在 `CNAME`（`cultural-atlas.123hi.org`），DNS 需要一筆 CNAME 記錄指向 `allanloplus.github.io`。開發在工作分支進行，合併到 `main` 才上線。

GitHub Pages 每個網站上限 1 GB。本站不放照片與語音，目前約 3.5 MB；之後加入地形與圖資時，要在建置腳本裡先簡化再輸出，並在這裡記錄用量。

## 資料來源與授權

- 文化資產清單、座標、公告日期：文化部文化資產局國家文化資產網，經兩個知識網站整理。
- 底圖：內政部國土測繪中心臺灣通用電子地圖。
- 修法節點：全國法規資料庫〈文化資產保存法〉沿革。
- 災害地震清單、颱風中文名稱：交通部中央氣象署（地震測報中心、颱風資料庫），依其政府網站資料開放宣告利用；1900 年以前的地震原始出處為鄭世楠、葉永田（1989）。
- 震源參數與 ShakeMap：U.S. Geological Survey（公有領域）。
- 颱風路徑：NOAA NCEI IBTrACS v04r01（Knapp et al. 2010；Gahtan et al. 2024, doi:10.25921/82ty-9e16）。
- 震度衰減式：Liu, K.-S. & Tsai, Y.-B. (2005), BSSA 95(3):1045–1058。
- 淹水潛勢圖：經濟部水利署（2018）第三代淹水潛勢圖。
- 土石流潛勢溪流與影響範圍、大規模崩塌潛勢區與影響範圍：農業部農村發展及水土保持署（2026，115 年版）。
- 活動斷層：經濟部地質調查及礦業管理中心，臺灣活動斷層分布圖（2021 年修正版，2025 年 10 月修訂）。
- 上列四項政府圖資：此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：https://data.gov.tw/license
- 地圖程式：MapLibre GL JS，BSD 3-Clause 授權（`assets/vendor/maplibre-gl.LICENSE.txt`）。

---

Copyright © 2026 Allan Lo. 文字內容與程式碼版權所有；第三方資料依各自授權。
