/* 圖層：3D 文資島（立體地形上，每處文資一根柱子）
 * 地形：data/terrain/（tools/build_terrain.py）；底圖：data/relief/（tools/build_relief.py，紙雕風格，不放文字）
 * 每處文資的地面高度：data/terrain/sites-elev.json（導覽算海拔用）
 * 畫法：遠看（縮放 9.6 級以下）是六角聚合柱，高度＝格內處數；拉近後是每處一根，高度分三級
 *       （國定古蹟最高；直轄市定、縣市定古蹟次之；其餘最低）。顏色可切換類別、年代、地震、風險。
 *       地震、風險直接用「臺灣挺過了什麼」「臺灣文資風險地圖」的資料與算法；那兩個圖層沒啟用時，切換鈕不出現。
 * 另有「島怎麼長出來」（依創建年長出柱子的動畫）與「導覽」（由資料算出事實的 8 站巡禮）。
 * 網址：#island/<cat|era|quake|risk>
 * 新增一種顏色：在 MODES 加一筆；新增一站導覽：在 STOPS 加一筆。
 */
(function () {
  "use strict";
  var A = window.Atlas, esc = A.esc, fmt = A.fmt;
  var DEM = "island-dem", HEX = "is-hex", PILLAR = "is-pillar-", RELIEF = "is-relief-";
  var EXAGGERATION = 2.5;                          /* 地形高度誇大倍數 */
  var TERRAIN = { tileSize: 256, minzoom: 5, maxzoom: 10, bounds: [118.0, 21.7, 122.4, 26.5] };   /* 同 data/terrain/meta.json */
  var RELIEF_Z = { minzoom: 5, maxzoom: 11 };                                                      /* 同 data/relief/meta.json */
  var SEA = { light: "#c4d5d6", dark: "#0f151b" };                                                 /* 遠海的顏色，同 build_relief.py */
  /* 授權要求的標示與免責聲明（Licence for the use of the Copernicus WorldDEM-30 第 6 條），請勿移除 */
  var DEM_NOTICE = "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved";
  var DEM_DISCLAIMER = "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30";
  var BANDS = [9, 10, 11, 12, 13, 14];             /* 單根柱子：每個整數縮放級一組，半徑各自換算成公尺 */
  var SWITCH = [8.8, 9.7];                         /* 在這段縮放級之間，六角柱淡出、單根柱子淡入 */
  var TIER_PX = [14, 32, 58];
  var TIER_NAME = ["歷史建築、紀念建築、聚落建築群、文化景觀、考古遺址", "直轄市定、縣市定古蹟", "國定古蹟"];
  var HEX_R = 3500;                                /* 六角格中心到頂點（公尺），寬約 6 公里 */
  var MPP0 = 78271.517 * Math.cos(24 * Math.PI / 180);   /* 北緯 24 度、縮放 0 級時每像素幾公尺 */
  var VIEW = { bounds: [[119.95, 21.9], [122.05, 25.3]], pitch: 55, bearing: -18 };
  var ORBIT_MS = 50000, SLOW_MS = 250, SLOW_KEY = "atlas-island-slow", FORCE_KEY = "atlas-island-force";
  var GROW = { from: 1550, to: 2026, ms: 34000 };
  var MILESTONES = [[1624, "荷蘭東印度公司在大員（今臺南安平）築城"], [1662, "鄭成功驅逐荷蘭人"], [1684, "清廷將臺灣納入版圖"],
    [1875, "牡丹社事件後，清廷開山撫番、解除渡臺禁令"], [1895, "馬關條約，進入日治時期"], [1946, "戰後"], [1982, "《文化資產保存法》公布"]];
  /* 地名標籤（地形上不放底圖文字，只標縣市與兩座高山） */
  var PLACES = [["基隆", 121.74, 25.13], ["臺北", 121.53, 25.05], ["新北", 121.67, 24.93], ["桃園", 121.22, 24.96], ["新竹", 121.01, 24.79], ["苗栗", 120.87, 24.52],
    ["臺中", 120.70, 24.20], ["彰化", 120.48, 24.02], ["南投", 120.92, 23.93], ["雲林", 120.38, 23.71], ["嘉義", 120.42, 23.47], ["臺南", 120.25, 23.08], ["高雄", 120.38, 22.70],
    ["屏東", 120.60, 22.45], ["宜蘭", 121.73, 24.68], ["花蓮", 121.48, 23.80], ["臺東", 121.15, 22.85], ["澎湖", 119.58, 23.57], ["金門", 118.37, 24.45], ["馬祖", 119.94, 26.17],
    ["玉山 3,952", 120.957, 23.470, 1], ["雪山 3,886", 121.231, 24.383, 1]];
  var NONE = "#9a9087";

  var mode = "cat", cls = [], ks = [], rings = null, hexes = null, elev = null, entered = false, active = false, orbit = null, checked = false, toast = null;
  var grow = null, tour = null, labels = [], year = null;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)"), coarse = window.matchMedia("(pointer: coarse)");

  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function tierOf(s) { var id = A.cats[s.cat].id; return id === "national" ? 2 : id === "local" ? 1 : 0; }
  function scale(z) { return 1 + Math.max(0, Math.min(8, z - 6)) * 0.14; }           /* 拉近時柱子略為變大 */
  function radiusPx(z) { return 1.45 * scale(z); }
  function km(a, b) {
    var p = Math.PI / 180, h = Math.pow(Math.sin((b.lat - a.lat) * p / 2), 2) + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.pow(Math.sin((b.lng - a.lng) * p / 2), 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function dur(ms) { return reduced.matches ? 0 : ms; }
  function theme() { return A.dark() ? "dark" : "light"; }

  var MODES = [
    { id: "cat", name: "類別", more: ["#timeline/listed", "臺灣年代時間軸（公告日期）"],
      cap: "顏色是文化資產的類別。",
      classes: function () { return A.cats.map(function (c) { return [c.name, c.color]; }); },
      classOf: function (s) { return s.cat; } },
    { id: "era", name: "年代", more: ["#timeline/built", "臺灣年代時間軸（創建年）"],
      cap: "顏色是創建年所在的時代，年代為推估的文資也一併顯示。",
      classes: function () { return A.eras.map(function (e) { return [e.name + (e.from ? "（" + e.from + " 年起）" : ""), e.color]; }); },
      classOf: function (s) { return s.era; } },
    { id: "quake", name: "地震", more: ["#survived/quake/all", "臺灣挺過了什麼"], tag: "推估，不是官方觀測", data: function () { return A.survivedData; },
      cap: "顏色是每處文資從創建到現在，在歷次災害地震中<b>推估</b>遇過的最大震度，不是官方觀測，實際震度可能高一級左右。",
      classes: function () {
        var D = A.survivedData, out = [["3 級以下或未估算", D.none]];
        for (var c = 3; c <= 9; c++) out.push([D.levelName(c), D.colors[c]]);
        return out;
      },
      classOf: function (s) { var v = A.survivedData.maxLevel(s); return v >= 3 ? v - 2 : 0; },
      head: function (counts) { return counts.slice(2).reduce(function (a, b) { return a + b; }, 0); }, headNote: "標題的數字是 4 級以上的處數。" },
    { id: "risk", name: "風險", more: ["#risk/all", "臺灣文資風險地圖"], tag: "圖資套疊，僅供防災參考", data: function () { return A.riskData; },
      cap: "顏色是每處文資符合幾項災害潛勢標籤（淹水、活動斷層、土石流、大規模崩塌）。<b>圖資套疊的結果，僅供防災參考</b>；淹水潛勢圖依規定不得作為土地使用管制或開發限制的依據。",
      classes: function () { return ["沒有標籤", "1 項", "2 項", "3 項以上"].map(function (t, k) { return [t, A.riskData.colors[k]]; }); },
      classOf: function (s) { return Math.min(3, A.riskData.count(s.i)); },
      head: function (counts) { return counts.slice(1).reduce(function (a, b) { return a + b; }, 0); }, headNote: "標題的數字是有標籤的處數。" }
  ];
  function modes() { return MODES.filter(function (m) { return !m.data || m.data(); }); }
  function modeDef(id) { return MODES.filter(function (m) { return m.id === (id || mode); })[0]; }
  function loadMode(id) { var M = modeDef(id); return M.data ? M.data().load() : Promise.resolve(); }

  /* ---------- 單根柱子 ---------- */
  function hexagon(lng, lat, r) {
    var out = [], k = Math.cos(lat * Math.PI / 180);
    for (var i = 0; i <= 6; i++) { var a = i * Math.PI / 3 + Math.PI / 6; out.push([lng + r / 111320 / k * Math.cos(a), lat + r / 111320 * Math.sin(a)]); }
    return [out];
  }
  function buildRings() {
    rings = BANDS.map(function (z) {
      var r = radiusPx(z) * MPP0 / Math.pow(2, z);
      return A.sites.map(function (s) { return hexagon(s.lng, s.lat, r); });
    });
  }
  /* 高度（公尺）＝ 像素高度 × 每像素公尺數；每像素公尺數隨縮放級減半，所以用底數 0.5 的指數內插。
     「島怎麼長出來」播放時，還沒出現的柱子 feature-state g＝0，高度為 0。 */
  function heightExpr() {
    var e = ["interpolate", ["exponential", 0.5], ["zoom"]], on = ["case", ["==", ["feature-state", "g"], 0], 0, 1];
    [5, 6, 14, 16].forEach(function (z) { e.push(z, ["*", ["get", "h"], scale(z) * MPP0 / Math.pow(2, z), on]); });
    return e;
  }

  /* ---------- 六角聚合柱 ---------- */
  var LAT0 = 23.7, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110540;
  function buildHexes() {
    var map = {};
    A.sites.forEach(function (s) {
      var x = (s.lng - 121) * KX, y = (s.lat - LAT0) * KY;
      var q = (Math.sqrt(3) / 3 * x - y / 3) / HEX_R, r = (2 / 3 * y) / HEX_R, c = -q - r;
      var rq = Math.round(q), rr = Math.round(r), rc = Math.round(c);
      var dq = Math.abs(rq - q), dr = Math.abs(rr - r), dc = Math.abs(rc - c);
      if (dq > dr && dq > dc) rq = -rr - rc; else if (dr > dc) rr = -rq - rc;
      var key = rq + "," + rr;
      (map[key] = map[key] || { q: rq, r: rr, s: [] }).s.push(s.i);
    });
    hexes = Object.keys(map).map(function (k) {
      var h = map[k], cx = HEX_R * Math.sqrt(3) * (h.q + h.r / 2), cy = HEX_R * 1.5 * h.r;
      h.lng = 121 + cx / KX; h.lat = LAT0 + cy / KY;
      h.ring = hexagon(h.lng, h.lat, HEX_R * 0.7)[0].map(function (p) { return [h.lng + (p[0] - h.lng) * KX / (111320 * Math.cos(h.lat * Math.PI / 180)), p[1]]; });
      return h;
    });
  }
  function hexData() {
    return { type: "FeatureCollection", features: hexes.map(function (h, j) {
      var n = 0, tally = {};
      h.s.forEach(function (i) { if (year != null && A.sites[i].year > year) return; n++; tally[ks[i]] = (tally[ks[i]] || 0) + 1; });
      var best = 0, bk = 0;
      Object.keys(tally).forEach(function (k) { if (tally[k] > best || (tally[k] === best && +k > bk)) { best = tally[k]; bk = +k; } });
      return { type: "Feature", id: j, properties: { j: j, n: n, h: n ? 3 + 5.5 * Math.sqrt(n) : 0, col: cls[bk] ? cls[bk][1] : NONE }, geometry: { type: "Polygon", coordinates: [h.ring] } };
    }) };
  }

  function paint() {
    if (!rings) buildRings();
    if (!hexes) buildHexes();
    var M = modeDef(), counts;
    cls = M.classes(); counts = cls.map(function () { return 0; });
    ks = A.sites.map(function (s) { var k = M.classOf(s); counts[k]++; return k; });
    BANDS.forEach(function (z, b) {
      A.map.getSource(PILLAR + z).setData({ type: "FeatureCollection", features: A.sites.map(function (s, i) {
        return { type: "Feature", id: i, properties: { i: i, h: TIER_PX[tierOf(s)], col: cls[ks[i]][1] }, geometry: { type: "Polygon", coordinates: rings[b][i] } };
      }) });
    });
    A.map.getSource(HEX).setData(hexData());
    return counts;
  }
  function pillarIds() { return BANDS.map(function (z) { return PILLAR + z; }); }
  function ownLayers() { return [RELIEF + "light", RELIEF + "dark", HEX].concat(pillarIds()); }
  function applyTheme() {
    var t = theme();
    A.map.setLayoutProperty(RELIEF + "light", "visibility", active && t === "light" ? "visible" : "none");
    A.map.setLayoutProperty(RELIEF + "dark", "visibility", active && t === "dark" ? "visible" : "none");
    if (active) A.map.setPaintProperty("bg", "background-color", SEA[t]);
  }

  /* ---------- 地名 ---------- */
  function showLabels(on) {
    if (on && !labels.length) labels = PLACES.map(function (p) {
      var el = document.createElement("div"); el.className = "is-lab" + (p[3] ? " peak" : ""); el.textContent = p[0];
      return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p[1], p[2]]).addTo(A.map);
    });
    if (!on) { labels.forEach(function (m) { m.remove(); }); labels = []; }
  }
  function zoomClass() {
    var c = A.map.getContainer();
    c.classList.toggle("is-near", A.map.getZoom() > 10.2);
  }

  /* ---------- 鏡頭 ---------- */
  function stopOrbit() {
    if (!orbit) return;
    cancelAnimationFrame(orbit.raf); orbit = null;
    var b = document.getElementById("isSpin"); if (b) b.setAttribute("aria-pressed", "false");
  }
  function startOrbit() {
    stopOrbit();
    var t0 = performance.now(), b0 = A.map.getBearing();
    orbit = { raf: 0 };
    (function step(now) {
      if (!orbit) return;
      var t = (now - t0) / ORBIT_MS;
      if (t >= 1) { A.map.setBearing(b0); return stopOrbit(); }
      A.map.setBearing(b0 + 360 * t);
      orbit.raf = requestAnimationFrame(step);
    })(t0);
    var b = document.getElementById("isSpin"); if (b) b.setAttribute("aria-pressed", "true");
  }
  function homeCam() {
    var cam = A.map.cameraForBounds(VIEW.bounds, { padding: 20 });
    return { center: cam.center, zoom: cam.zoom, pitch: VIEW.pitch, bearing: VIEW.bearing };
  }
  function homeView() { A.map.jumpTo(homeCam()); }
  function fly(cam) { A.map.stop(); if (reduced.matches) A.map.jumpTo(cam); else A.map.flyTo(Object.assign({ duration: 3200, essential: false }, cam)); }
  function interrupt() { stopOrbit(); }

  /* ---------- 島怎麼長出來 ---------- */
  function setYear(y) {
    var prev = year; year = y;
    var show = function (i, on) { BANDS.forEach(function (z) { A.map.setFeatureState({ source: PILLAR + z, id: i }, { g: on ? 1 : 0 }); }); };
    A.sites.forEach(function (s, i) {
      var was = prev == null || s.year <= prev, now = y == null || s.year <= y;
      if (was !== now) show(i, now);
    });
  }
  function yearBox(y) {
    var box = document.getElementById("isYear");
    if (y == null) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "isYear"; box.className = "is-year"; box.setAttribute("aria-live", "off"); A.map.getContainer().parentNode.appendChild(box); }
    var e = A.eras.filter(function (x) { return !x.from || y >= x.from; }).pop(), ms = MILESTONES.filter(function (m) { return y >= m[0]; }).pop();
    var n = A.sites.filter(function (s) { return s.year <= y; }).length;
    box.style.setProperty("--c", e.color);
    box.innerHTML = "<b>" + Math.floor(y) + "</b><span>" + e.name + "</span><small>已出現 " + fmt(n) + " 處" + (ms && y - ms[0] < 40 ? "・" + ms[0] + " " + esc(ms[1]) : "") + "</small>";
  }
  function stopGrow(done) {
    if (!grow) return;
    cancelAnimationFrame(grow.raf); grow = null;
    setYear(null); yearBox(null);
    A.map.getSource(HEX).setData(hexData());
    var b = document.getElementById("isGrow"); if (b) { b.setAttribute("aria-pressed", "false"); b.textContent = "▶ 島怎麼長出來"; }
    if (done) say("播放完畢：" + fmt(A.sites.length) + " 處文資都長出來了。", 5000);
  }
  function startGrow() {
    stopTour(); stopOrbit(); A.hideCard();
    if (mode !== "era") { mode = "era"; A.setHash("island/era"); show(); }
    fly(homeCam());
    var t0 = performance.now() + dur(1200), last = 0, b0 = VIEW.bearing;
    grow = { raf: 0 };
    setYear(GROW.from); yearBox(GROW.from); A.map.getSource(HEX).setData(hexData());
    var b = document.getElementById("isGrow"); if (b) { b.setAttribute("aria-pressed", "true"); b.textContent = "■ 停止播放"; }
    (function step(now) {
      if (!grow) return;
      var t = Math.max(0, Math.min(1, (now - t0) / GROW.ms)), y = GROW.from + (GROW.to - GROW.from) * t;
      if (now - last > 120 || t >= 1) {
        last = now; setYear(y); yearBox(y); A.map.getSource(HEX).setData(hexData());
        if (!reduced.matches && t > 0 && !A.map.isMoving()) A.map.setBearing(b0 + 40 * t);
      }
      if (t >= 1) return stopGrow(true);
      grow.raf = requestAnimationFrame(step);
    })(performance.now());
  }

  /* ---------- 導覽：每站的事實都由資料算出 ---------- */
  function near(c, r) { return A.sites.filter(function (s) { return km(s, c) <= r; }); }
  function tally(list, f) { var t = {}; list.forEach(function (s) { var k = f(s); t[k] = (t[k] || 0) + 1; }); return t; }
  function top(t) { return Object.keys(t).sort(function (a, b) { return t[b] - t[a]; })[0]; }
  function names(list, n) { return list.slice(0, n).map(function (s) { return "「" + esc(s.name) + "」"; }).join("、"); }
  var STOPS = [
    { title: "一座住在海邊的文資島", mode: "cat", cam: function () { return homeCam(); },
      text: function () {
        var hs = elev.h.slice().sort(function (a, b) { return a - b; }), med = hs[hs.length >> 1], hi = elev.h.filter(function (h) { return h > 500; }).length;
        return "臺灣本島的陸地有 " + Math.round(elev.landShare.over500 * 100) + "% 在海拔 500 公尺以上，但 " + fmt(A.sites.length) + " 處文資只有 <b>" + hi + " 處</b>（" + (hi / A.sites.length * 100).toFixed(1) +
          "%）在 500 公尺以上，一半位在海拔 <b>" + med + " 公尺</b>以下。文資跟著人走：沿海、平原、河口。";
      } },
    { title: "府城：四個時代疊在一起", mode: "era", cam: function () { return { center: [120.2025, 22.993], zoom: 13.4, pitch: 62, bearing: 35 }; },
      text: function () {
        var L = near({ lat: 22.9975, lng: 120.2025 }, 1), t = tally(L, function (s) { return s.era; });
        return "赤嵌樓周邊一公里內有 <b>" + L.length + " 處</b>文資，" + Object.keys(t).sort().map(function (k) { return A.eras[k].name + " " + t[k] + " 處"; }).join("、") +
          "。1624 年荷蘭人到大員之後，這裡是臺灣最早的城市。";
      } },
    { title: "全臺最擠的一平方公里", mode: "cat", cam: function (d) { return { center: [d.lng, d.lat], zoom: 14.2, pitch: 64, bearing: -25 }; },
      prep: function () {
        var g = {}; A.sites.forEach(function (s) { var k = Math.round(s.lat / 0.009) + "," + Math.round(s.lng / 0.0099); (g[k] = g[k] || []).push(s); });
        var best = Object.keys(g).sort(function (a, b) { return g[b].length - g[a].length; })[0], L = g[best];
        return { L: L, lat: L.reduce(function (a, s) { return a + s.lat; }, 0) / L.length, lng: L.reduce(function (a, s) { return a + s.lng; }, 0) / L.length };
      },
      text: function (d) {
        var t = tally(d.L, function (s) { return s.cat; }), e = tally(d.L, function (s) { return s.era; });
        return "約一平方公里的格子裡有 <b>" + d.L.length + " 處</b>文資（" + esc(A.counties[d.L[0].county].name) + "），是全臺最密的地方。最多的是" + A.cats[top(t)].name + "（" + t[top(t)] + " 處），" +
          A.eras[top(e)].name + "時期的占 " + e[top(e)] + " 處，例如" + names(d.L, 3) + "。";
      } },
    { title: "最高的文資在阿里山", mode: "era", cam: function () { return { center: [120.805, 23.51], zoom: 12.2, pitch: 70, bearing: 70 }; },
      text: function () {
        var L = A.sites.filter(function (s) { return elev.h[s.i] >= 2000 && s.lng > 120.7 && s.lng < 120.9 && s.lat > 23.4 && s.lat < 23.6; }).sort(function (a, b) { return elev.h[b.i] - elev.h[a.i]; });
        var all = A.sites.filter(function (s) { return elev.h[s.i] >= 1000; }), j = all.filter(function (s) { return A.eras[s.era].id === "japan"; }).length;
        return "阿里山有 " + L.length + " 處文資在海拔約 2,000 公尺以上，例如" + names(L, 3) + "。全臺海拔 1,000 公尺以上的 " + all.length + " 處文資中，<b>" + j + " 處是日治時期</b>留下的林業、觀測與山地治理設施。（海拔由地形資料推估。）";
      } },
    { title: "東部：日治以後才長出來", mode: "era", cam: function () { return { center: [121.3, 23.35], zoom: 8.6, pitch: 60, bearing: 25 }; },
      text: function () {
        var L = A.sites.filter(function (s) { return s.lng > 121.25 && s.lng < 122 && s.lat > 22.3 && s.lat < 24.45; }), t = tally(L, function (s) { return A.eras[s.era].id; });
        return "花蓮、臺東的 <b>" + L.length + " 處</b>文資中，清領時期只有 " + (t.qing || 0) + " 處，日治時期 " + (t.japan || 0) + " 處、戰後 " + (t.postwar || 0) +
          " 處。中央山脈擋住了早年的開發，東部的鐵道、移民村與港口多半是日治以後才出現。";
      } },
    { title: "1999 年集集地震", mode: "quake", tag: "推估，不是官方觀測", need: function () { return A.survivedData; },
      cam: function (d) { return { center: [d.q.lng, d.q.lat], zoom: 8.7, pitch: 58, bearing: -10 }; },
      prep: function () {
        var V = A.survivedData.raw(), q = V && V.quakes.filter(function (x) { return x.date === "1999-09-21"; })[0];
        return q ? { q: q } : null;
      },
      text: function (d) {
        var n6 = 0, n5 = 0;
        A.sites.forEach(function (s) { if (s.year > 1999) return; var c = +d.q.levels.charAt(s.i); if (c >= 8) n6++; else if (c >= 6) n5++; });
        return "規模 " + d.q.m + "，震央在南投集集附近。當時已存在的文資中，推估有 <b>" + n6 + " 處遇到 6 強以上</b>、" + n5 + " 處遇到 5 強到 6 弱。顏色是每處歷來的最大推估震度。<b>這是推估，不是官方觀測。</b>";
      } },
    { title: "金門：前線與僑鄉", mode: "cat", cam: function () { return { center: [118.36, 24.45], zoom: 10.6, pitch: 58, bearing: 15 }; },
      text: function () {
        var k = A.counties.map(function (c) { return c.name; }).indexOf("金門縣"), L = A.sites.filter(function (s) { return s.county === k; }), t = tally(L, function (s) { return s.cat; });
        return "金門有 <b>" + L.length + " 處</b>文資，其中" + A.cats[top(t)].name + " " + t[top(t)] + " 處。閩南聚落、洋樓與戰地設施擠在 150 平方公里的島上，密度是本島的好幾倍。";
      } },
    { title: "最孤單的文資", mode: "cat", cam: function (d) { return { center: [d.s.lng, d.s.lat], zoom: 9.5, pitch: 50, bearing: 0 }; },
      prep: function () {
        var best = null, bd = 0;
        A.sites.forEach(function (s) { var m = 1e9; A.sites.forEach(function (o) { if (o !== s) { var d = km(s, o); if (d < m) m = d; } }); if (m > bd) { bd = m; best = s; } });
        return { s: best, d: bd };
      },
      text: function (d) {
        return "「" + esc(d.s.name) + "」離最近的另一處文資約 <b>" + fmt(Math.round(d.d)) + " 公里</b>，是全臺最孤單的一處。最後一站，按「全島」回到臺灣，或點任何一根柱子看介紹。";
      } }
  ];
  function stopTour() {
    if (!tour) return;
    tour = null;
    var el = document.getElementById("isTour"); if (el) el.remove();
    var b = document.getElementById("isTourBtn"); if (b) b.setAttribute("aria-pressed", "false");
  }
  function startTour() { stopGrow(); stopOrbit(); A.hideCard(); tour = { k: 0 }; goStop(0); var b = document.getElementById("isTourBtn"); if (b) b.setAttribute("aria-pressed", "true"); }
  function goStop(k) {
    var list = STOPS.filter(function (s) { return !s.need || s.need(); });
    k = Math.max(0, Math.min(list.length - 1, k));
    tour = { k: k };
    var S = list[k], el = document.getElementById("isTour");
    Promise.all([loadMode(S.mode), elevP]).then(function () {
      if (!tour || tour.k !== k) return;
      var d = S.prep ? S.prep() : {};
      if (!d) return goStop(k + 1);
      if (mode !== S.mode) { mode = S.mode; A.setHash("island/" + mode); show(); }
      if (!el) { el = document.createElement("div"); el.id = "isTour"; el.className = "is-tour"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "導覽"); A.map.getContainer().parentNode.appendChild(el); }
      el.innerHTML = '<p class="is-tour-k">導覽 ' + (k + 1) + "／" + list.length + (S.tag ? '　<span class="sv-tag">' + S.tag + "</span>" : "") + '</p><h3>' + esc(S.title) + "</h3><p>" + S.text(d) + "</p>" +
        '<div class="is-tour-nav"><button type="button" data-d="-1"' + (k ? "" : " disabled") + '>‹ 上一站</button><button type="button" data-d="0">結束</button>' +
        '<button type="button" data-d="1" class="go"' + (k < list.length - 1 ? "" : " disabled") + ">下一站 ›</button></div>";
      Array.prototype.forEach.call(el.querySelectorAll("button"), function (b) {
        b.onclick = function () { var dd = +b.dataset.d; if (!dd) stopTour(); else goStop(k + dd); };
      });
      fly(S.cam(d));
    });
  }

  /* ---------- 退路：顯示太慢就改開平面的時間軸 ---------- */
  function say(html, ms) {
    if (!toast) { toast = document.createElement("div"); toast.className = "is-toast"; toast.setAttribute("role", "status"); A.map.getContainer().parentNode.appendChild(toast); }
    toast.innerHTML = html; toast.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { toast.hidden = true; }, ms || 12000);
    var go = toast.querySelector("button");
    if (go) go.onclick = function () { ss(FORCE_KEY, "1"); toast.hidden = true; location.hash = "#island"; };
  }
  function fallback(why) {
    ss(SLOW_KEY, "1");
    try { history.replaceState(null, "", "#timeline"); } catch (e) { location.hash = "#timeline"; }
    window.dispatchEvent(new Event("hashchange"));
    say(why + "已改開平面的「臺灣年代時間軸」。<button type=\"button\">仍要開啟 3D</button>");
  }
  /* 連續重畫約三秒，看相鄰兩個畫面間隔的中位數；超過 SLOW_MS 就當作效能不足。
     用中位數是為了不被單次卡頓（例如剛載入圖磚）誤判。結果存在 Atlas.islandFrameMs 方便檢查。 */
  function perfCheck() {
    if (checked) return;
    checked = true;
    var ts = [], t0 = performance.now(), mark = function () { ts.push(performance.now()); };
    A.map.on("render", mark);
    (function tick() {
      if (!active) { checked = false; return A.map.off("render", mark); }
      if (performance.now() - t0 < 3000 && ts.length < 40) { A.map.triggerRepaint(); return requestAnimationFrame(tick); }
      A.map.off("render", mark);
      var gaps = [];
      for (var i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
      gaps.sort(function (x, y) { return x - y; });
      var med = gaps.length ? gaps[gaps.length >> 1] : 9999;
      A.islandFrameMs = Math.round(med);
      if (med > SLOW_MS && !ss(FORCE_KEY)) fallback("這台裝置顯示 3D 地形比較吃力，");
    })();
  }

  /* ---------- 面板、圖例、說明 ---------- */
  function render(counts) {
    var M = modeDef(), list = modes();
    A.panel.innerHTML =
      '<div class="tl-head"><div class="seg rk-seg" role="group" aria-label="柱子顏色">' +
      list.map(function (m) { return '<button type="button" data-m="' + m.id + '" aria-pressed="' + (m.id === mode) + '">' + m.name + "</button>"; }).join("") + "</div>" +
      '<a class="is-more" href="' + M.more[0] + '">看完整圖層：' + M.more[1] + " →</a>" +
      (M.tag ? '<span class="sv-tag">' + M.tag + "</span>" : "") + "</div>" +
      '<div class="is-acts"><button type="button" class="is-main" id="isGrow" aria-pressed="' + !!grow + '">' + (grow ? "■ 停止播放" : "▶ 島怎麼長出來") + "</button>" +
      '<button type="button" class="is-main" id="isTourBtn" aria-pressed="' + !!tour + '">導覽 ' + STOPS.length + " 站</button>" +
      '<span class="is-cam" role="group" aria-label="鏡頭">' +
      '<button type="button" data-cam="left" aria-label="向左轉" title="向左轉">↺</button>' +
      '<button type="button" data-cam="right" aria-label="向右轉" title="向右轉">↻</button>' +
      '<button type="button" data-cam="tilt" title="切換俯視與斜看">' + (A.map.getPitch() > 20 ? "俯視" : "斜看") + "</button>" +
      '<button type="button" data-cam="home" title="回到全島">全島</button>' +
      '<button type="button" id="isSpin" aria-pressed="' + !!orbit + '">環繞</button></span></div>' +
      '<p class="tl-cap is-cap"><b>3D 文資島</b>　' + fmt(A.sites.length) + " 處文化資產。遠看是六角柱，高度是約 6 公里格子內的處數；拉近後變成每處一根，越高等級越高。" + M.cap +
      '<span class="sv-method">' + (coarse.matches ? "單指拖曳平移，兩指張合縮放、轉動旋轉、一起上下滑傾斜；點六角柱拉近，點柱子看介紹。" : "拖曳平移，按住右鍵或 Ctrl 拖曳可旋轉與傾斜；點六角柱拉近，點柱子看介紹。") + "地形高度誇大 " + EXAGGERATION + " 倍。</span></p>";
    Array.prototype.forEach.call(A.panel.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { stopGrow(); location.hash = "#island/" + b.dataset.m; };
    });
    document.getElementById("isSpin").onclick = function () { if (orbit) stopOrbit(); else { stopGrow(); stopTour(); startOrbit(); } };
    document.getElementById("isGrow").onclick = function () { if (grow) stopGrow(); else startGrow(); };
    document.getElementById("isTourBtn").onclick = function () { if (tour) stopTour(); else startTour(); };
    Array.prototype.forEach.call(A.panel.querySelectorAll("[data-cam]"), function (b) {
      b.onclick = function () {
        var c = b.dataset.cam, m = A.map, d = dur(500);
        stopOrbit();
        if (c === "home") { stopTour(); return fly(homeCam()); }
        if (c === "tilt") { var flat = m.getPitch() > 20; b.textContent = flat ? "斜看" : "俯視"; return m.easeTo({ pitch: flat ? 0 : VIEW.pitch, duration: d }); }
        m.easeTo({ bearing: m.getBearing() + (c === "left" ? 45 : -45), duration: d });
      };
    });

    var head = M.head ? M.head(counts) : A.sites.length;
    var order = cls.map(function (_, k) { return k; });
    if (M.head) order = order.slice(1).reverse().concat([0]);
    A.legend.innerHTML = '<details class="legend"' + (window.innerWidth > 720 ? " open" : "") + "><summary><span>" + M.name + "</span><b>" + fmt(head) + '</b></summary><div class="legend-body">' +
      order.map(function (k) { return '<div class="lg-row' + (counts[k] ? "" : " off") + '"><i style="--c:' + cls[k][1] + '"></i><span>' + esc(cls[k][0]) + '</span><span class="n">' + fmt(counts[k]) + "</span></div>"; }).join("") +
      (M.headNote ? '<p class="sv-sm">' + M.headNote + "</p>" : "") +
      '<p class="sv-sm">六角柱的顏色是格內最多的那一類。</p>' +
      '<div class="is-tiers"><span>柱高</span>' + [2, 1, 0].map(function (t) { return '<div><i style="height:' + (6 + t * 7) + 'px"></i><span>' + ["其餘", "市縣定", "國定"][t] + "</span></div>"; }).join("") + "</div>" +
      "</div></details>";
  }
  function about() {
    A.about.innerHTML =
      "<h3>3D 文資島</h3>" +
      "<p>把臺灣的地形立起來，看三千多處有形文化資產沿著海岸、平原、河谷與山區的分布。遠看是六角聚合柱，看哪裡最密；拉近後每處一根柱子，點了可以看介紹。「島怎麼長出來」依創建年把柱子一根根長出來；「導覽」用 8 站帶你看資料裡的發現。</p>" +
      '<div class="note"><b>閱讀時請留意</b><ul>' +
      "<li><b>六角柱</b>：把臺灣切成寬約 6 公里的六角格，高度是格內的處數（取平方根，避免市區的柱子高到看不見其他地方），顏色是格內最多的那一類。</li>" +
      "<li><b>單根柱子的高度只代表等級</b>，分三級：國定古蹟最高；直轄市定、縣市定古蹟次之；" + TIER_NAME[0] + "最低。與建築的實際高度、年代、價值高低都無關。</li>" +
      "<li><b>地形高度誇大 " + EXAGGERATION + " 倍</b>，解析度約 140 公尺，只用來呈現大地勢。底圖是本站依地形算出的分層設色與山影，不含道路與地名；拉近看街道請到其他分頁。範圍以外的陸地只留淡淡的海岸線。</li>" +
      "<li><b>導覽裡的海拔</b>是由數值地表模型（含樹冠與建築）在文資座標上取的值，只是近似；座標本身若有誤差，海拔也會跟著錯。</li>" +
      "<li><b>「島怎麼長出來」</b>依知識網站整理的創建年排序；年代為推估的文資也一併出現，早期的年份誤差可能很大。創建年之後建築可能經過重建。</li>" +
      "<li><b>「地震」的顏色是推估</b>：依創建年與位置對照歷次災害地震，估算遇過的最大震度，不是官方觀測。方法與誤差見「臺灣挺過了什麼」分頁的資料說明。</li>" +
      "<li><b>「風險」的顏色是圖資套疊的結果，僅供防災參考</b>，不是個別建築的風險評估。淹水潛勢圖依《水災潛勢資料公開辦法》僅供防救災使用，不得作為土地使用管制或開發限制的依據。門檻與限制見「臺灣文資風險地圖」分頁的資料說明。</li>" +
      "<li>顯示立體地形需要較新的瀏覽器與顯示晶片；裝置顯示太慢時，會自動改開平面的「臺灣年代時間軸」。</li>" +
      "</ul></div><h3>本圖層的資料來源</h3><ul>" +
      '<li>地形與底圖：Copernicus DEM GLO-30（歐盟哥白尼計畫的 30 公尺全球數值地表模型），取自 <a href="https://registry.opendata.aws/copernicus-dem/" target="_blank" rel="noopener">AWS 開放資料</a>，經本站降低解析度、轉成地形圖磚並算出分層設色與山影。依 Licence for the use of the Copernicus WorldDEM-30 利用：<br>' + esc(DEM_NOTICE) + ".</li>" +
      "<li>" + esc(DEM_DISCLAIMER) + "。（哥白尼計畫依法或受委託的主管機構，對 Copernicus WorldDEM-30 的任何使用不負任何責任。）本站與歐盟、歐洲太空總署、Airbus 沒有關係，也未經其認可或背書。</li>" +
      "<li>導覽的歷史節點：一般臺灣史年表。地震與風險的顏色：資料來源同「臺灣挺過了什麼」「臺灣文資風險地圖」兩個分頁。</li></ul>";
  }
  function show() {
    var counts = paint();
    render(counts); about();
  }

  var elevP = null;
  A.registerLayer({
    id: "island",
    pick: pillarIds(),
    init: function () {
      var base = location.href.replace(/[#?].*$/, "").replace(/[^\/]*$/, "");
      elevP = fetch("data/terrain/sites-elev.json").then(function (r) { return r.json(); }).then(function (d) { elev = d; });
      A.map.addSource(DEM, { type: "raster-dem", tiles: [base + "data/terrain/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: TERRAIN.tileSize, minzoom: TERRAIN.minzoom, maxzoom: TERRAIN.maxzoom, bounds: TERRAIN.bounds, attribution: "地形：" + DEM_NOTICE });
      ["light", "dark"].forEach(function (t) {
        A.map.addSource(RELIEF + t, { type: "raster", tiles: [base + "data/relief/" + t + "/{z}/{x}/{y}.webp"], tileSize: 256, minzoom: RELIEF_Z.minzoom, maxzoom: RELIEF_Z.maxzoom, bounds: TERRAIN.bounds });
        A.map.addLayer({ id: RELIEF + t, type: "raster", source: RELIEF + t, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } });
      });
      var fadeOut = ["interpolate", ["linear"], ["zoom"], SWITCH[0], 0.93, SWITCH[1], 0], fadeIn = ["interpolate", ["linear"], ["zoom"], SWITCH[0], 0, SWITCH[1], 0.9];
      A.map.addSource(HEX, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      A.map.addLayer({ id: HEX, type: "fill-extrusion", source: HEX, maxzoom: SWITCH[1], layout: { visibility: "none" },
        paint: { "fill-extrusion-color": ["get", "col"], "fill-extrusion-height": heightExpr(), "fill-extrusion-base": 0, "fill-extrusion-opacity": fadeOut, "fill-extrusion-vertical-gradient": true } });
      BANDS.forEach(function (z, b) {
        A.map.addSource(PILLAR + z, { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0, buffer: 32 });
        var L = { id: PILLAR + z, type: "fill-extrusion", source: PILLAR + z, layout: { visibility: "none" },
          paint: { "fill-extrusion-color": ["get", "col"], "fill-extrusion-height": heightExpr(), "fill-extrusion-base": 0, "fill-extrusion-opacity": b ? 0.9 : fadeIn, "fill-extrusion-vertical-gradient": true } };
        L.minzoom = b ? z : SWITCH[0];
        if (b < BANDS.length - 1) L.maxzoom = z + 1;
        A.map.addLayer(L);
      });
      A.map.on("click", HEX, function (e) {
        if (!active || A.map.getZoom() >= SWITCH[1]) return;
        var f = e.features[0], h = hexes[f.properties.j];
        stopOrbit(); stopTour();
        fly({ center: [h.lng, h.lat], zoom: Math.max(11, A.map.getZoom() + 2.5), pitch: 60 });
      });
      A.map.on("mouseenter", HEX, function () { if (active) A.map.getCanvas().style.cursor = "pointer"; });
      A.map.on("zoom", function () { if (active) zoomClass(); });
      ["mousedown", "touchstart", "wheel", "keydown"].forEach(function (ev) {
        A.map.getContainer().addEventListener(ev, interrupt, { passive: true, capture: true });
      });
      document.getElementById("jumpSel").addEventListener("change", function () { stopOrbit(); stopTour(); });
    },
    enter: function (_, args) {
      var explicit = /^#island/.test(location.hash);
      /* 這個工作階段已經量過效能不足：沒有指定圖層時直接開平面圖層 */
      if (!active && !explicit && ss(SLOW_KEY) && !ss(FORCE_KEY) && A.layers.timeline) return fallback("先前量到這台裝置顯示 3D 地形比較吃力，");
      var m = MODES.filter(function (x) { return x.id === args[0]; })[0];
      var want = m && (!m.data || m.data()) ? m.id : "cat";
      if (want !== mode) stopGrow();
      mode = want;
      if (!active) {
        active = true;
        try {
          A.set3D(true);
          A.map.setTerrain({ source: DEM, exaggeration: EXAGGERATION });
        } catch (e) {
          active = false; A.set3D(false);
          if (A.layers.timeline) return fallback("這個瀏覽器無法顯示 3D 地形，");
        }
        A.map.setLayoutProperty("base", "visibility", "none");
        applyTheme();
        [HEX].concat(pillarIds()).forEach(function (id) { A.map.setLayoutProperty(id, "visibility", "visible"); });
        showLabels(true); zoomClass();
        if (!entered) {                       /* 進站：全島視角，慢慢環繞一圈 */
          entered = true;
          homeView();
          if (!reduced.matches) startOrbit();
        } else {
          A.map.stop();
          if (reduced.matches) A.map.jumpTo({ pitch: VIEW.pitch }); else A.map.easeTo({ pitch: VIEW.pitch, duration: 800 });
        }
        if (A.layers.timeline) A.map.once("idle", perfCheck);
      }
      A.hideCard();
      var M = modeDef();
      if (M.data) {
        A.panel.innerHTML = '<p class="tl-cap">資料載入中…</p>';
        return M.data().load().then(function () { if (active && mode === M.id) show(); })
          .catch(function () { A.panel.innerHTML = '<p class="tl-cap">資料載入失敗，請重新整理。</p>'; });
      }
      show();
    },
    leave: function () {
      active = false;
      stopOrbit(); stopGrow(); stopTour(); showLabels(false);
      ownLayers().forEach(function (id) { A.map.setLayoutProperty(id, "visibility", "none"); });
      A.map.setLayoutProperty("base", "visibility", "visible");
      A.map.setPaintProperty("bg", "background-color", A.dark() ? "#17130f" : "#efe7d8");
      A.map.getContainer().classList.remove("is-near");
      A.map.setTerrain(null);
      A.set3D(false);
    },
    theme: function () { if (active) applyTheme(); }
  });
})();
