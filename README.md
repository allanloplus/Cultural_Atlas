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

規劃中的圖層：它挺過了什麼（地震與颱風）、文資風險地圖、3D 文資島。

## 架構

純靜態網站，沒有後台與資料庫。所有資料在建置時用 Python 算好，輸出成 `data/` 的 JSON，網頁只讀取結果。

```
index.html                  唯一的頁面
assets/css/atlas.css        樣式（配色、深色模式沿用知識網站 site.css 的變數）
assets/js/core.js           載入資料、建立地圖、圖層註冊、文資卡片、網址路由
assets/js/layers/           一個圖層一支檔
assets/vendor/              MapLibre GL JS 4.7.1（放本機、固定版本）
data/sites.json             全臺有形文資的精簡主檔（所有圖層共用）
data/layers.json            圖層清單
tools/build_sites.py        產生 data/sites.json
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

GitHub Pages 每個網站上限 1 GB。本站不放照片與語音，目前不到 2 MB；之後加入地形與圖資時，要在建置腳本裡先簡化再輸出，並在這裡記錄用量。

## 資料來源與授權

- 文化資產清單、座標、公告日期：文化部文化資產局國家文化資產網，經兩個知識網站整理。
- 底圖：內政部國土測繪中心臺灣通用電子地圖。
- 修法節點：全國法規資料庫〈文化資產保存法〉沿革。
- 地圖程式：MapLibre GL JS，BSD 3-Clause 授權（`assets/vendor/maplibre-gl.LICENSE.txt`）。

---

Copyright © 2026 Allan Lo. 文字內容與程式碼版權所有；第三方資料依各自授權。
