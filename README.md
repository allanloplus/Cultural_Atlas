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
| https://cultural-rail.123hi.org/ | 搭火車逛文資 | allanloplus/Cultural_Rail |
| https://cultural-town.123hi.org/ | 鄉鎮文資性格卡 | allanloplus/Cultural_Town |
| https://cultural-ascent.123hi.org/ | 從海口到山頂 | allanloplus/Cultural_Ascent |

## 目前的內容

**3D 文資島（首頁）**：立體的臺灣地形上看 3,032 處文資，可以旋轉、傾斜。

- 底圖是本站用地形算出的「紙雕」分層設色與山影（`data/relief/`，淺色、深色各一套），不含道路與文字；地名用網頁文字標縣市與玉山、雪山。拉近到街區（12 級以上）時底圖淡出，換回國土測繪中心的通用電子地圖。導覽卡片放在下方面板，不蓋住地圖。範圍外的陸地（福建沿海）壓平，只留淡淡的海岸線。
- 遠看（縮放 9.7 級以下）是六角聚合柱：寬約 6 公里的格子，高度是格內處數的平方根，顏色是格內最多的那一類；點六角柱會拉近。拉近後換成每處一根柱子。
- 「島怎麼長出來」：從 1550 年播到今天，柱子依創建年長出來，畫面上方顯示年份、時代與歷史節點。
- 「導覽 8 站」：每站的事實都在網頁上由資料即時算出（文資的海拔分布、府城、最密的一平方公里、阿里山、東部、集集地震、金門、最孤單的文資）。文資增減後數字會自動更新，但站點的鏡頭位置與說明文字是寫死的，見 `island.js` 的 `STOPS`。
- 「海拔」顏色：文資所在位置的推估海拔（5 級），圖例對照文資與本島陸地落在各高度的比例（例如陸地 47% 在 500 公尺以上，文資只有 1.7%），附海拔最高的 10 處；拉桿可只看某個高度以上的文資。卡片上也會顯示推估海拔。陡坡上的座標標為「海拔不確定」。
- 語音旁白：導覽 8 站與「島怎麼長出來」都有 Allan 和阿拉蕾的雙人對話（聲音、角色圖、表情規則與知識網站相同），角色頭像與字幕放在下方面板，不蓋住地圖（桌機、手機都一樣）；播放時鏡頭把全島往下移，地圖上方只留年份。導覽講完一站自動到下一站；「島怎麼長出來」播到 1624、1662、1684、1875、1895、1946、1982 年等節點會停下來講，講完再繼續。🔊 按鈕可關掉聲音（記在瀏覽器裡）。首頁左下角有「Allan 和阿拉蕾帶你用 8 站逛文資島」的邀請；瀏覽器不允許網頁自己出聲，所以要按了才開始。
- 單根柱子的高度分三級，只代表等級：國定古蹟最高；直轄市定、縣市定古蹟次之；其餘（歷史建築、紀念建築、聚落建築群、文化景觀、考古遺址）最低。
- 顏色可切換：類別（預設）、年代、地震（歷來最大推估震度）、風險（災害潛勢標籤數）。換顏色時柱高不變；每種顏色附「看完整圖層」連到對應的平面分頁。地震與風險直接用下面兩個圖層的資料與算法，並保留「推估」「僅供防災參考」的標示。
- 進站會慢慢環繞一圈，碰一下就停；系統設定「減少動態效果」時不轉。面板上有向左轉、向右轉、俯視／斜看、全島、環繞一圈的按鈕，手機不用手勢也能操作。
- 地形高度誇大 2.5 倍，解析度約 140 公尺，只呈現大地勢。
- 退路：顯示太慢（相鄰畫面間隔的中位數超過 250 毫秒）或無法建立地形時，自動改開 `#timeline` 並顯示提示，提示上有「仍要開啟 3D」。同一個瀏覽器分頁內會記住這個結果。
- 網址：`#island`、`#island/era`、`#island/quake`、`#island/risk`。

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
data/terrain/               3D 文資島的地形圖磚（Terrarium 編碼的 PNG，第 5–10 級）、meta.json、sites-elev.json（每處文資的地面高度）
data/relief/                3D 文資島的底圖圖磚（WebP，第 5–11 級，light／dark 兩套）
data/raw/                   抓一次就存檔的原始清單（災害地震、颱風中文名）
data/layers.json            圖層清單
tools/build_sites.py        產生 data/sites.json
tools/fetch_quakes.py       抓氣象署災害地震列表 → data/raw/quakes.json
tools/fetch_typhoon_names.py 抓氣象署颱風中文名 → data/raw/typhoon-names.json
tools/build_survived.py     產生 data/survived.json
tools/build_risk.py         產生 data/risk.json、data/risk-lines.geojson
tools/build_terrain.py      產生 data/terrain/
tools/build_relief.py       產生 data/relief/（要先跑過 build_terrain.py 下載 DEM）
tools/build_narration.py    產生 data/narration/（語音旁白的劇本與 mp3）
assets/js/narration.js      語音旁白播放器
assets/js/characters.js     Allan 與阿拉蕾的角色與表情規則（複製自知識網站，兩邊要一起改）
assets/characters/          角色表情圖（複製自知識網站）
reports/coord-check.csv     座標檢查清單（build_terrain.py 產生，給知識網站校對用）
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

### 更新「3D 文資島」的地形

地形不會變，平常不需要重跑；要改解析度或範圍時才需要：

```bash
pip install numpy pillow rasterio scipy
```

```bash
python3 tools/build_terrain.py
```

```bash
python3 tools/build_relief.py
```

會從 AWS 公開桶下載 Copernicus DEM GLO-30 的 19 個 1°×1° 檔到 `.cache/dem/`（約 320 MB，不進 repo；加 `--offline` 只用已下載的檔案），降到約 90 公尺後重新取樣成 Web Mercator 第 10 級圖磚（每像素約 140 公尺），再往上平均出第 5–9 級。輸出 336 張圖磚、約 3 MB，以及每處文資的地面高度 `sites-elev.json`（導覽用；`data/sites.json` 有變動就要重跑）。`build_relief.py` 用同一份 DEM 產生底圖，兩套共 2,284 張、約 2.2 MB；分層的海拔門檻與配色寫在腳本開頭。

- 高度取整數公尺，用 Terrarium 編碼（高度 = R×256 + G − 32768）。海面與沒有資料的地方是 0。
- 範圍（東經 118–122.4、北緯 21.7–26.5）內全是海的圖磚也會輸出，網頁才不會抓到 404。範圍、級數有改時，`assets/js/layers/island.js` 開頭的 `TERRAIN` 要跟著改。
- `build_terrain.py` 也會檢查每處文資的座標，結果寫在 `reports/coord-check.csv`（Excel 可直接開）。三種問題：座標落在水面上且離岸 300 公尺以上（可能是座標偏移，也可能真的在潟湖、鹽田上）；座標附近約 300 公尺內高低差超過 250 公尺（海拔不可靠，網頁標「海拔不確定」）；離同縣市最近的文資超過 10 公里、卻離別的縣市的文資近得多。門檻是腳本開頭的常數。這份清單是給知識網站校對用的，確認有誤請改知識網站的資料，再重跑 `build_sites.py` 與這支腳本。
- 範圍外的陸地（福建沿海）在兩支腳本裡都會被處理掉：地形壓平成海面，底圖只留淡淡的海岸線。判斷方式在 `build_terrain.py` 的 `ours_mask`：有文資的島，或東經 119.2 度以東、北緯 25.4 度以南、不連到圖框邊的陸地。
- 下載偶爾會中途斷線而不報錯，腳本會比對檔案大小並自動重試。
- 文資增減只需要重跑 `build_terrain.py`（更新 `sites-elev.json`）；柱子是網頁依 `data/sites.json` 即時畫的，地震與風險的顏色來自 `data/survived.json`、`data/risk.json`。
- 柱子的粗細、三級高度、六角格大小、切換縮放級、誇大倍數、環繞一圈與播放的時間、效能門檻，都是 `island.js` 開頭的常數。
- 曾試過自己寫 WebGL 圖層畫發光的光束，但 MapLibre 4.7.1 開地形時，自繪圖層在山區對不齊地形，而且不能點選，所以沿用 fill-extrusion。

### 更新語音旁白

```bash
pip install edge-tts
```

```bash
TTS_CA_BUNDLE=/root/.ccr/ca-bundle.crt python3 tools/build_narration.py
```

（`TTS_CA_BUNDLE` 只有經過企業代理、需要指定憑證時才要設；一般電腦直接執行即可。需要 ffmpeg。）

- 劇本寫在腳本的 `script()` 裡，數字由資料算出，算法和 `island.js` 導覽（`STOPS`）相同；改了其中一邊的算法，另一邊也要改。
- `data/sites.json`、`data/terrain/sites-elev.json`、`data/survived.json` 有變動就要重跑。網頁會比對 `script.json` 記錄的文資資料日期與處數，不一致時不播語音（避免講出過時的數字），只顯示文字。
- 聲音設定與知識網站的 `tools/gen_audio.py` 相同（Allan：zh-TW-YunJheNeural；阿拉蕾：zh-TW-HsiaoYuNeural 提高音調）。只重新合成文字有變動的句子，快取在 `.cache/tts/`。
- 某段文字改了但語音沒重新產生時，播放器改用瀏覽器內建語音。
- 目前 9 段、約 7.5 分鐘、1.7 MB。

### 新增圖層

1. 在 `tools/` 寫建置腳本，輸出以文資 id 為鍵的 JSON 到 `data/`。
2. 寫 `assets/js/layers/<id>.js`，呼叫 `Atlas.registerLayer({...})`（介面說明在 `core.js` 開頭，範例見 `timeline.js`）。
3. 在 `data/layers.json` 加一筆。圖層有兩個以上時，頂端列會自動出現切換分頁；排第一個且啟用的圖層是首頁。
4. 立體圖層在 `enter` 呼叫 `Atlas.set3D(true)`、`leave` 呼叫 `Atlas.set3D(false)`（平面圖層不開放旋轉與傾斜）。要在 3D 文資島多一種光柱顏色，在 `island.js` 的 `MODES` 加一筆即可。

## 分享預覽圖

連結貼到通訊軟體時顯示的縮圖是 `assets/og.jpg`（1200×630），原稿在 `tools/og.html`：右邊的臺灣是用 `data/sites.json` 的座標點出來的。要重做時在 repo 根目錄開本機伺服器，用瀏覽器以 1200×630 開啟 `tools/og.html` 後截圖存檔。

## 本機預覽

```bash
python3 -m http.server 8000
```

開啟 http://localhost:8000/ 。底圖與字型需要連網。

## 部署

GitHub Pages：Settings → Pages → Deploy from a branch，選 `main` 與 `/ (root)`。自訂網域寫在 `CNAME`（`cultural-atlas.123hi.org`），DNS 需要一筆 CNAME 記錄指向 `allanloplus.github.io`。開發在工作分支進行，合併到 `main` 才上線。

GitHub Pages 每個網站上限 1 GB。本站不放照片與語音，目前約 11 MB（其中地形與底圖圖磚約 5.3 MB、語音旁白 1.7 MB、角色圖 0.5 MB）；之後加入圖資時，要在建置腳本裡先簡化再輸出，並在這裡記錄用量。

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
- 地形：Copernicus DEM GLO-30（Copernicus WorldDEM-30），依 Licence for the use of the Copernicus WorldDEM-30 利用（可重製、散布、向公眾傳播、改作；免費）。授權第 6 條要求的標示與聲明如下，頁面的地圖版權列與「資料說明」都有，請勿移除：
  - produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.
  - The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.
  - 本站與歐盟、歐洲太空總署、Airbus 沒有關係，也未經其認可或背書（授權要求不得讓人誤以為受官方認可）。
- 地圖程式：MapLibre GL JS，BSD 3-Clause 授權（`assets/vendor/maplibre-gl.LICENSE.txt`）。

---

Copyright © 2026 Allan Lo. 文字內容與程式碼版權所有；第三方資料依各自授權。
