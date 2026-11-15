/* 文資地圖集 — 核心：載入資料、建立地圖、圖層註冊、文資卡片
 *
 * 圖層的寫法（見 assets/js/layers/timeline.js）：
 *   Atlas.registerLayer({
 *     id: "timeline",                       // 與 data/layers.json 的 id 相同
 *     init: function (A) {},                // 地圖與資料就緒後呼叫一次：加入地圖圖層
 *     enter: function (A, args) {},         // 切到這個圖層：畫控制面板（A.panel）、圖例（A.legend）、說明（A.about）
 *     leave: function (A) {},               // 離開：隱藏自己的地圖圖層、停止動畫
 *     pick: ["layer-id", ...],              // 可以點選的地圖圖層 id（點了會開文資卡片）
 *     canPick: function (site) {},          // （選用）回傳 false 的文資不能點（例如目前沒顯示）
 *     cardExtra: function (site) {},        // （選用）加在卡片裡的 HTML
 *     theme: function (A) {}                // （選用）深淺色切換時重畫
 *   });
 * 立體圖層：enter 時呼叫 A.set3D(true)（開放旋轉與傾斜），leave 時呼叫 A.set3D(false)（關閉並把鏡頭轉正）。
 * pick 的圖層不是點（例如立體柱）時，點選取最上面的那一個。
 * 網址：#<圖層 id>/<圖層自己的參數…>
 */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* 顏色：時代（本站自訂）與類別（沿用知識網站） */
  var ERA_COLORS = { pre: "#8a7f72", dutch: "#3b7bbf", zheng: "#6b5bb5", qing: "#b23a3a", japan: "#2f8f7b", postwar: "#e0a020" };
  var CAT_COLORS = { national: "#b23a3a", local: "#e07a3f", building: "#2f7d6d", memorial: "#a0527e", cluster: "#6b5bb5", landscape: "#3b7bbf", archaeo: "#8a6d3b" };
  var BASE_TILES = "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
  var HOME = [[119.2, 21.75], [122.3, 25.45]];

  var A = window.Atlas = {
    esc: esc, fmt: fmt, map: null, meta: null, eras: [], cats: [], counties: [], sites: [],
    layers: {}, defs: [], current: null,
    panel: $("#panel"), legend: $("#legendSlot"), about: $("#aboutLayer"),
    dark: function () { return mq.matches; },
    registerLayer: function (L) { A.layers[L.id] = L; },
    showCard: showCard, hideCard: hideCard, set3D: set3D,
    setHash: function (s) { try { history.replaceState(null, "", "#" + s); } catch (e) { /* 略過 */ } }
  };
  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  /* 平面圖層不能旋轉、傾斜；立體圖層進入時打開，離開時關閉並轉正 */
  var compass = null;
  function set3D(on) {
    var m = A.map;
    if (on) {
      m.dragRotate.enable(); m.touchPitch.enable(); m.touchZoomRotate.enableRotation(); m.keyboard.enableRotation();
      if (!compass) { compass = new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }); m.addControl(compass, "top-right"); }
    } else {
      m.dragRotate.disable(); m.touchPitch.disable(); m.touchZoomRotate.disableRotation(); m.keyboard.disableRotation();
      if (compass) { m.removeControl(compass); compass = null; }
      if (m.getPitch() || m.getBearing()) { m.stop(); m.easeTo({ pitch: 0, bearing: 0, duration: 500 }); }
    }
  }

  function fail(msg) { var m = $("#mapMsg"); m.hidden = false; m.innerHTML = "<p>" + msg + "</p>"; }

  function loadScript(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { no(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  function basePaint() {
    return A.dark()
      ? { "raster-opacity": 0.75, "raster-saturation": -0.85, "raster-brightness-min": 0.95, "raster-brightness-max": 0.1, "raster-contrast": -0.1 }
      : { "raster-opacity": 0.8, "raster-saturation": -0.55, "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-contrast": 0 };
  }
  function applyTheme() {
    if (!A.map) return;
    var p = basePaint();
    Object.keys(p).forEach(function (k) { A.map.setPaintProperty("base", k, p[k]); });
    A.map.setPaintProperty("bg", "background-color", A.dark() ? "#17130f" : "#efe7d8");
    if (A.current && A.current.theme) A.current.theme(A);
  }

  /* ---------- 文資卡片 ---------- */
  function showCard(s, extra) {
    var c = $("#card"), cty = A.counties[s.county];
    c.style.setProperty("--c", CAT_COLORS[A.cats[s.cat].id]);
    c.innerHTML =
      '<button class="x" type="button" aria-label="關閉">×</button>' +
      '<p class="eyebrow">' + esc(s.rawCategory) + "・" + esc(cty.label) + (s.town ? " " + esc(s.town) : "") + "</p>" +
      "<h3>" + esc(s.name) + "</h3>" +
      '<p class="yt">' + esc(s.yearText) + (s.estimated ? '<span class="badge">年代為推估</span>' : "") + "</p>" +
      (s.summary ? '<p class="sum">' + esc(s.summary) + "</p>" : "") +
      '<p class="meta">' + A.eras[s.era].name + "時期" + (s.localPeriod ? "（" + esc(cty.name) + "當地：" + esc(s.localPeriod) + "）" : "") +
      (s.announced ? "・" + s.announced.replace(/-/g, "/") + " 公告" : "") + "</p>" +
      (extra || "") +
      '<a class="btn" href="' + esc(cty.base) + "#map/" + encodeURIComponent(s.id) + '" target="_blank" rel="noopener">到知識網站看詳情・聽導覽</a>';
    c.hidden = false;
    $(".x", c).onclick = hideCard;
  }
  function hideCard() { $("#card").hidden = true; }

  /* ---------- 路由 ---------- */
  function route() {
    var h = (location.hash || "").slice(1).split("/");
    if (h[0] === "about") return;
    var L = A.layers[h[0]] || A.layers[A.defs[0].id];
    if (A.current !== L) {
      var want = location.hash;
      if (A.current && A.current.leave) A.current.leave(A);
      if (location.hash !== want) A.setHash(want.slice(1));      /* 離開時不讓舊圖層把網址改回去 */
      hideCard();
      A.current = L;
      Array.prototype.forEach.call(document.querySelectorAll("#layerTabs a"), function (a) {
        if (a.dataset.id === L.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
    }
    L.enter(A, h.slice(1));
  }

  /* ---------- 啟動 ---------- */
  function boot(data, cfg) {
    A.meta = data.meta; A.eras = data.eras; A.cats = data.cats; A.counties = data.counties;
    A.eras.forEach(function (e) { e.color = ERA_COLORS[e.id] || "#888"; });
    A.cats.forEach(function (c) { c.color = CAT_COLORS[c.id] || "#888"; });
    var F = data.meta.fields;
    A.sites = data.sites.map(function (r, i) { var o = { i: i }; F.forEach(function (k, j) { o[k] = r[j]; });
      /* annMonth：公告日期換成「1982 年 1 月起第幾個月」（含小數），沒有日期的是 -1 */
      var d = o.announced ? o.announced.split("-").map(Number) : null;
      o.annMonth = d ? Math.round(((d[0] - 1982) * 12 + (d[1] - 1) + (d[2] - 1) / 31) * 100) / 100 : -1;
      return o;
    });
    A.defs = cfg.layers.filter(function (l) { return l.on; });
    $("#aboutGen").textContent = "資料產生日期：" + A.meta.generated + "，共 " + fmt(A.meta.total) + " 處有形文化資產（22 縣市）。文化資產的指定、登錄與廢止隨時會異動，請以文化部文化資產局公告為準。";

    var tabs = $("#layerTabs");
    if (A.defs.length > 1) tabs.innerHTML = A.defs.map(function (l) { return '<a href="#' + l.id + '" data-id="' + l.id + '">' + esc(l.short || l.title) + "</a>"; }).join("");

    var map;
    try {
      map = A.map = new maplibregl.Map({
        container: "map", bounds: HOME, fitBoundsOptions: { padding: 24 }, minZoom: 5, maxZoom: 18,
        maxBounds: [[112, 18], [127, 29]], maxPitch: 75, attributionControl: false,
        style: {
          version: 8,
          sources: { base: { type: "raster", tiles: [BASE_TILES], tileSize: 256, maxzoom: 19 } },
          layers: [
            { id: "bg", type: "background", paint: { "background-color": A.dark() ? "#17130f" : "#efe7d8" } },
            { id: "base", type: "raster", source: "base", paint: basePaint() }
          ]
        }
      });
    } catch (e) {
      return fail("這個瀏覽器無法顯示地圖（需要 WebGL）。請改用較新的瀏覽器，或直接到<a href='https://cultural.123hi.org/'>文資知識網站</a>瀏覽。");
    }
    map.dragRotate.disable(); map.touchPitch.disable(); map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '底圖 &copy; <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>' }), "bottom-right");

    $("#jumpSel").onchange = function () {
      if (!this.value) return;
      var b = this.value.split(",").map(Number);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 900 });
      this.value = "";
    };
    Array.prototype.forEach.call(document.querySelectorAll("a[data-scroll]"), function (a) {
      a.onclick = function (e) { e.preventDefault(); $("#about").scrollIntoView(); };
    });

    map.on("load", function () {
      /* 手機：版權標示預設收合（點 ⓘ 展開），不要蓋住地圖 */
      var at = $(".maplibregl-ctrl-attrib");
      if (at && window.innerWidth <= 720) { at.classList.remove("maplibregl-compact-show"); at.removeAttribute("open"); }
      map.addSource("sites", {
        type: "geojson",
        data: { type: "FeatureCollection", features: A.sites.map(function (s) {
          return { type: "Feature", id: s.i, geometry: { type: "Point", coordinates: [s.lng, s.lat] }, properties: { i: s.i, y: s.year, m: s.annMonth, e: s.era, c: s.cat, u: s.estimated } };
        }) }
      });
      Promise.all(A.defs.map(function (l) { return loadScript(l.script); })).then(function () {
        A.defs = A.defs.filter(function (l) { return A.layers[l.id]; });
        A.defs.forEach(function (l) { A.layers[l.id].init(A); });
        /* 點選：在點擊位置附近找最上層的文資 */
        map.on("click", function (e) {
          var ids = (A.current && A.current.pick) || [];
          if (!ids.length) return;
          var r = window.matchMedia("(pointer: coarse)").matches ? 16 : 9, f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ids });
          if (!f.length) return hideCard();
          var best = null, bd = 1e9;
          if (A.current.canPick) f = f.filter(function (x) { return A.current.canPick(A.sites[x.properties.i]); });
          if (!f.length) return hideCard();
          f.forEach(function (x, k) {
            if (x.geometry.type !== "Point") { if (!k) best = x; return; }   /* 立體柱：查詢結果已由近到遠排序 */
            var p = map.project(x.geometry.coordinates), d = Math.pow(p.x - e.point.x, 2) + Math.pow(p.y - e.point.y, 2);
            if (d < bd) { bd = d; best = x; }
          });
          var s = A.sites[best.properties.i];
          if (A.current.canPick && !A.current.canPick(s)) return hideCard();
          showCard(s, A.current.cardExtra ? A.current.cardExtra(s) : "");
        });
        map.on("mousemove", function (e) {
          var ids = (A.current && A.current.pick) || [];
          map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? "pointer" : "";
        });
        window.addEventListener("hashchange", route);
        route();
      }).catch(function (e) { fail("圖層程式載入失敗：" + esc(e.message)); });
    });
    if (mq.addEventListener) mq.addEventListener("change", applyTheme); else if (mq.addListener) mq.addListener(applyTheme);
  }

  if (!window.maplibregl) return fail("地圖程式載入失敗，請重新整理。");
  Promise.all([
    fetch("data/sites.json").then(function (r) { return r.json(); }),
    fetch("data/layers.json").then(function (r) { return r.json(); })
  ]).then(function (r) { boot(r[0], r[1]); }).catch(function () { fail("資料載入失敗，請重新整理。"); });
})();
