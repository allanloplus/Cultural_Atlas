/* 圖層：3D 文資島（立體地形上，每處文資一根光柱）
 * 地形：data/terrain/（tools/build_terrain.py，Copernicus DEM GLO-30 降到約 140 公尺）
 * 光柱：高度分三級（國定古蹟最高；直轄市定、縣市定古蹟次之；其餘最低），顏色可切換。
 *       地震、風險兩種顏色直接用「臺灣挺過了什麼」「臺灣文資風險地圖」兩個圖層的資料與算法；
 *       那兩個圖層沒有啟用時，對應的切換鈕不會出現。
 * 網址：#island/<cat|era|quake|risk>
 * 新增一種顏色：在 MODES 加一筆（classes 回傳 [[標籤, 顏色], …]，classOf 回傳每處文資的級別索引）。
 */
(function () {
  "use strict";
  var A = window.Atlas, esc = A.esc, fmt = A.fmt;
  var DEM = "island-dem", DEM_HS = "island-dem-hs", SHADE = "is-shade", PILLAR = "is-pillar-";
  var EXAGGERATION = 2.5;                          /* 地形高度誇大倍數 */
  var TERRAIN = { tileSize: 256, minzoom: 5, maxzoom: 10, bounds: [118.0, 21.7, 122.4, 26.5] };   /* 同 data/terrain/meta.json */
  /* 授權要求的標示與免責聲明（Licence for the use of the Copernicus WorldDEM-30 第 6 條），請勿移除 */
  var DEM_NOTICE = "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved";
  var DEM_DISCLAIMER = "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30";
  /* 光柱在畫面上的大小（像素，隨縮放略為放大）：半徑、三級高度 */
  var BANDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];  /* 每個整數縮放級一組柱子，半徑各自換算成公尺 */
  var TIER_PX = [14, 32, 58];
  var TIER_NAME = ["歷史建築、紀念建築、聚落建築群、文化景觀、考古遺址", "直轄市定、縣市定古蹟", "國定古蹟"];
  var MPP0 = 78271.517 * Math.cos(24 * Math.PI / 180);   /* 北緯 24 度、縮放 0 級時每像素幾公尺 */
  var VIEW = { bounds: [[119.95, 21.9], [122.05, 25.3]], pitch: 55, bearing: -18 };
  var ORBIT_MS = 50000, SLOW_MS = 250, SLOW_KEY = "atlas-island-slow", FORCE_KEY = "atlas-island-force";
  var NONE = "#9a9087";

  var mode = "cat", cls = [], rings = null, entered = false, active = false, orbit = null, checked = false, toast = null;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)"), coarse = window.matchMedia("(pointer: coarse)");

  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function tierOf(s) { var id = A.cats[s.cat].id; return id === "national" ? 2 : id === "local" ? 1 : 0; }
  function scale(z) { return 1 + Math.max(0, Math.min(8, z - 6)) * 0.14; }           /* 拉近時柱子略為變大 */
  function radiusPx(z) { return 1.7 * scale(z); }

  var MODES = [
    { id: "cat", name: "類別", more: ["#timeline/listed", "臺灣年代時間軸（公告日期）"],
      cap: "顏色是文化資產的類別。",
      classes: function () { return A.cats.map(function (c) { return [c.name, c.color]; }); },
      classOf: function (s) { return s.cat; } },
    { id: "era", name: "年代", more: ["#timeline/built", "臺灣年代時間軸（創建年）"],
      cap: "顏色是創建年所在的時代。年代為推估的文資也一併顯示。",
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
  function modeDef() { return MODES.filter(function (m) { return m.id === mode; })[0]; }

  /* ---------- 光柱 ---------- */
  function hexagon(s, r) {
    var out = [], k = Math.cos(s.lat * Math.PI / 180);
    for (var i = 0; i <= 6; i++) { var a = i * Math.PI / 3; out.push([s.lng + r / 111320 / k * Math.cos(a), s.lat + r / 111320 * Math.sin(a)]); }
    return [out];
  }
  function buildRings() {
    rings = BANDS.map(function (z) {
      var r = radiusPx(z) * MPP0 / Math.pow(2, z);
      return A.sites.map(function (s) { return hexagon(s, r); });
    });
  }
  function heightExpr() {
    /* 高度（公尺）＝ 像素高度 × 每像素公尺數；每像素公尺數隨縮放級減半，所以用底數 0.5 的指數內插 */
    var e = ["interpolate", ["exponential", 0.5], ["zoom"]];
    [5, 6, 14, 16].forEach(function (z) { e.push(z, ["*", ["get", "h"], scale(z) * MPP0 / Math.pow(2, z)]); });
    return e;
  }
  function paintPillars() {
    if (!rings) buildRings();
    var M = modeDef(), counts;
    cls = M.classes(); counts = cls.map(function () { return 0; });
    var ks = A.sites.map(function (s) { var k = M.classOf(s); counts[k]++; return k; });
    BANDS.forEach(function (z, b) {
      A.map.getSource(PILLAR + z).setData({ type: "FeatureCollection", features: A.sites.map(function (s, i) {
        return { type: "Feature", id: i, properties: { i: i, h: TIER_PX[tierOf(s)], col: cls[ks[i]][1] }, geometry: { type: "Polygon", coordinates: rings[b][i] } };
      }) });
    });
    return counts;
  }
  function shadePaint() {
    return A.dark()
      ? { "hillshade-exaggeration": 0.3, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#8a7f72", "hillshade-accent-color": "#000000" }
      : { "hillshade-exaggeration": 0.28, "hillshade-shadow-color": "#4a3b2c", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#4a3b2c" };
  }
  function layerIds() { return BANDS.map(function (z) { return PILLAR + z; }); }

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
  function homeView() {
    var cam = A.map.cameraForBounds(VIEW.bounds, { padding: 20 });
    A.map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: VIEW.pitch, bearing: VIEW.bearing });
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
  /* 連續重畫約三秒，看相鄰兩個畫面間隔的中位數；超過 250 毫秒（每秒不到 4 個畫面）就當作效能不足。
     用中位數是為了不被單次卡頓（例如剛載入圖磚）誤判。結果存在 window.Atlas.islandFrameMs 方便檢查。 */
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
      '<div class="tl-head"><div class="seg rk-seg" role="group" aria-label="光柱顏色">' +
      list.map(function (m) { return '<button type="button" data-m="' + m.id + '" aria-pressed="' + (m.id === mode) + '">' + m.name + "</button>"; }).join("") + "</div>" +
      '<a class="is-more" href="' + M.more[0] + '">看完整圖層：' + M.more[1] + " →</a>" +
      (M.tag ? '<span class="sv-tag">' + M.tag + "</span>" : "") +
      '<span class="is-cam" role="group" aria-label="鏡頭">' +
      '<button type="button" data-cam="left" aria-label="向左轉" title="向左轉">↺</button>' +
      '<button type="button" data-cam="right" aria-label="向右轉" title="向右轉">↻</button>' +
      '<button type="button" data-cam="tilt" title="切換俯視與斜看">' + (A.map.getPitch() > 20 ? "俯視" : "斜看") + "</button>" +
      '<button type="button" data-cam="home" title="回到全島">全島</button>' +
      '<button type="button" class="is-spin" id="isSpin" aria-pressed="' + !!orbit + '">環繞一圈</button></span></div>' +
      '<p class="tl-cap is-cap"><b>3D 文資島</b>　' + fmt(A.sites.length) + " 處文化資產各是一根光柱，柱子越高等級越高（國定古蹟最高，直轄市定、縣市定古蹟次之）。" + M.cap +
      '<span class="sv-method">' + (coarse.matches ? "單指拖曳平移，兩指張合縮放、轉動旋轉、一起上下滑傾斜，也可以用上面的按鈕；點光柱看介紹。" : "拖曳平移，按住右鍵或 Ctrl 拖曳可旋轉與傾斜，也可以用右邊的按鈕；點光柱看介紹。") + "地形高度誇大 " + EXAGGERATION + " 倍。</span></p>";
    Array.prototype.forEach.call(A.panel.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { location.hash = "#island/" + b.dataset.m; };
    });
    document.getElementById("isSpin").onclick = function () { if (orbit) stopOrbit(); else startOrbit(); };
    Array.prototype.forEach.call(A.panel.querySelectorAll("[data-cam]"), function (b) {
      b.onclick = function () {
        var c = b.dataset.cam, m = A.map, d = reduced.matches ? 0 : 500;
        stopOrbit();
        if (c === "home") return homeView();
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
      '<div class="is-tiers"><span>柱高</span>' + [2, 1, 0].map(function (t) { return '<div><i style="height:' + (6 + t * 7) + 'px"></i><span>' + ["其餘", "市縣定", "國定"][t] + "</span></div>"; }).join("") + "</div>" +
      "</div></details>";
  }
  function about() {
    A.about.innerHTML =
      "<h3>3D 文資島</h3>" +
      "<p>把臺灣的地形立起來，每一處有形文化資產在所在位置化成一根光柱，可以旋轉、傾斜，從不同角度看文化資產沿著海岸、平原、河谷與山區的分布。</p>" +
      '<div class="note"><b>閱讀時請留意</b><ul>' +
      "<li><b>柱子的高度只代表等級</b>，分三級：國定古蹟最高；直轄市定、縣市定古蹟次之；" + TIER_NAME[0] + "最低。高度與建築的實際高度、年代、價值高低都無關，換顏色時高度不變。</li>" +
      "<li><b>地形高度誇大 " + EXAGGERATION + " 倍</b>，並由 30 公尺的原始資料降到每格約 140 公尺，只用來呈現大地勢，不能用來量測高度或坡度。原始資料是數值地表模型（含建築物與樹冠），不是裸露地面的高程。</li>" +
      "<li>柱子的粗細與高度會隨縮放調整，讓遠看近看都看得到；文資密集的市區，柱子會互相重疊。每處文資只用一個座標點代表。</li>" +
      "<li><b>「地震」的顏色是推估</b>：依創建年與位置對照歷次災害地震，估算遇過的最大震度，不是官方觀測。方法與誤差見「臺灣挺過了什麼」分頁的資料說明。</li>" +
      "<li><b>「風險」的顏色是圖資套疊的結果，僅供防災參考</b>，不是個別建築的風險評估。淹水潛勢圖依《水災潛勢資料公開辦法》僅供防救災使用，不得作為土地使用管制或開發限制的依據。門檻與限制見「臺灣文資風險地圖」分頁的資料說明。</li>" +
      "<li>顯示立體地形需要較新的瀏覽器與顯示晶片；裝置顯示太慢時，會自動改開平面的「臺灣年代時間軸」。</li>" +
      "</ul></div><h3>本圖層的資料來源</h3><ul>" +
      '<li>地形：Copernicus DEM GLO-30（歐盟哥白尼計畫的 30 公尺全球數值地表模型），取自 <a href="https://registry.opendata.aws/copernicus-dem/" target="_blank" rel="noopener">AWS 開放資料</a>，經本站降低解析度、轉成地形圖磚。依 Licence for the use of the Copernicus WorldDEM-30 利用：<br>' + esc(DEM_NOTICE) + ".</li>" +
      "<li>" + esc(DEM_DISCLAIMER) + "。（哥白尼計畫依法或受委託的主管機構，對 Copernicus WorldDEM-30 的任何使用不負任何責任。）本站與歐盟、歐洲太空總署、Airbus 沒有關係，也未經其認可或背書。</li>" +
      "<li>地震與風險的顏色：資料來源同「臺灣挺過了什麼」「臺灣文資風險地圖」兩個分頁。</li></ul>";
  }
  function show() {
    var counts = paintPillars();
    render(counts); about();
  }

  A.registerLayer({
    id: "island",
    pick: layerIds(),
    init: function () {
      var tiles = [location.href.replace(/[#?].*$/, "").replace(/[^\/]*$/, "") + "data/terrain/{z}/{x}/{y}.png"];
      var src = function (attr) { return { type: "raster-dem", tiles: tiles, encoding: "terrarium", tileSize: TERRAIN.tileSize, minzoom: TERRAIN.minzoom, maxzoom: TERRAIN.maxzoom, bounds: TERRAIN.bounds, attribution: attr }; };
      A.map.addSource(DEM, src("地形：" + DEM_NOTICE));
      A.map.addSource(DEM_HS, src(""));
      A.map.addLayer({ id: SHADE, type: "hillshade", source: DEM_HS, layout: { visibility: "none" }, paint: shadePaint() });
      BANDS.forEach(function (z, b) {
        A.map.addSource(PILLAR + z, { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0, buffer: 32 });
        var L = { id: PILLAR + z, type: "fill-extrusion", source: PILLAR + z, layout: { visibility: "none" },
          paint: { "fill-extrusion-color": ["get", "col"], "fill-extrusion-height": heightExpr(), "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92, "fill-extrusion-vertical-gradient": true } };
        if (b > 0) L.minzoom = z;
        if (b < BANDS.length - 1) L.maxzoom = z + 1;
        A.map.addLayer(L);
      });
      ["mousedown", "touchstart", "wheel", "keydown"].forEach(function (ev) {
        A.map.getContainer().addEventListener(ev, stopOrbit, { passive: true, capture: true });
      });
      document.getElementById("jumpSel").addEventListener("change", stopOrbit);
    },
    enter: function (_, args) {
      var explicit = /^#island/.test(location.hash);
      /* 這個工作階段已經量過效能不足：沒有指定圖層時直接開平面圖層 */
      if (!active && !explicit && ss(SLOW_KEY) && !ss(FORCE_KEY) && A.layers.timeline) return fallback("先前量到這台裝置顯示 3D 地形比較吃力，");
      var m = MODES.filter(function (x) { return x.id === args[0]; })[0];
      mode = m && (!m.data || m.data()) ? m.id : "cat";
      var M = modeDef();
      if (!active) {
        active = true;
        try {
          A.set3D(true);
          A.map.setTerrain({ source: DEM, exaggeration: EXAGGERATION });
        } catch (e) {
          active = false; A.set3D(false);
          if (A.layers.timeline) return fallback("這個瀏覽器無法顯示 3D 地形，");
        }
        A.map.setLayoutProperty(SHADE, "visibility", "visible");
        layerIds().forEach(function (id) { A.map.setLayoutProperty(id, "visibility", "visible"); });
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
      if (M.data) {
        A.panel.innerHTML = '<p class="tl-cap">資料載入中…</p>';
        return M.data().load().then(function () { if (active && mode === M.id) show(); })
          .catch(function () { A.panel.innerHTML = '<p class="tl-cap">資料載入失敗，請重新整理。</p>'; });
      }
      show();
    },
    leave: function () {
      active = false;
      stopOrbit();
      A.map.setLayoutProperty(SHADE, "visibility", "none");
      layerIds().forEach(function (id) { A.map.setLayoutProperty(id, "visibility", "none"); });
      A.map.setTerrain(null);
      A.set3D(false);
    },
    theme: function () {
      var p = shadePaint();
      Object.keys(p).forEach(function (k) { A.map.setPaintProperty(SHADE, k, p[k]); });
    }
  });
})();
