/* 圖層：臺灣是怎麼長出來的（時間軸動畫）
 * 兩條軸：built＝創建年（顏色分時代）、listed＝公告日期（顏色分類別）。只用 data/sites.json。
 * 網址：#timeline/built/1895、#timeline/listed/2005-11
 */
(function () {
  "use strict";
  var A = window.Atlas, esc = A.esc, fmt = A.fmt;
  var DOTS = "tl-dots", GLOW = "tl-glow";
  var PLAY_SECONDS = 42;       /* 1 倍速從頭播到尾的秒數 */
  var mode = "built", pos = 0, trail = 0, playing = false, raf = 0, last = 0, speed = 1, showEst = true, built = false;
  var ui = {}, axes = {};

  /* ---------- 各時代的背景說明（一般臺灣史分期；金門、馬祖的歷史分期不同，見卡片上的當地時期） ---------- */
  var ERA_TEXT = {
    pre: "<b>1624 年以前</b>　史前文化的考古遺址遍布全島，最早可追溯到舊石器時代；金門等離島在宋、元、明時期已有聚落、家廟與墓葬。",
    dutch: "<b>荷西時期（1624–1661）</b>　1624 年荷蘭東印度公司在大員（今臺南安平）築城；1626 年西班牙人占領雞籠（今基隆），之後到淡水，1642 年被荷蘭人逐走。",
    zheng: "<b>明鄭時期（1662–1683）</b>　1662 年鄭成功取得臺灣，鄭氏政權以今天的臺南為中心設官治理、屯田開墾，臺南孔廟等建築在這段時間創建。",
    qing: "<b>清領時期（1684–1894）</b>　1684 年清朝設臺灣府，漢人移墾由南往北、由平原往丘陵擴展，寺廟、宅第、書院與城池陸續出現；1885 年清廷宣布臺灣建省。",
    japan: "<b>日治時期（1895–1945）</b>　日本統治五十年間，鐵路、糖廠、官署、學校與宿舍遍布全臺。本站收錄的文化資產約有 {pct}% 創建於這段時間。",
    postwar: "<b>戰後（1946 年以後）</b>　眷村、軍事設施、公共建築與產業設施，近年也陸續取得文化資產身分。"
  };
  /* ---------- 文化資產保存法的節點（來源：全國法規資料庫〈文化資產保存法〉沿革） ---------- */
  var MILESTONES = [
    { d: [1982, 5], t: "<b>1982 年 5 月 26 日</b>　《文化資產保存法》制定公布，臺灣開始有指定古蹟的法律依據。" },
    { d: [1997, 5], t: "<b>1997 年 5 月 14 日修法</b>　古蹟改分為國定、省（市）定、縣（市）定，地方政府可以自行指定古蹟。" },
    { d: [2000, 2], t: "<b>2000 年 2 月 9 日修法</b>　九二一地震之後，增訂「歷史建築」的登錄制度，登錄數量從此快速增加。" },
    { d: [2005, 11], t: "<b>2005 年 11 月 1 日施行新法</b>　同年 2 月 5 日全文修正公布，增列聚落、文化景觀等類別。" },
    { d: [2016, 7], t: "<b>2016 年 7 月 27 日全文修正</b>　增列紀念建築與史蹟，「聚落」改稱聚落建築群，「遺址」改稱考古遺址。" }
  ];
  var LISTED_INTRO = "<b>公告日期</b>　每一處文化資產依主管機關公告指定或登錄的日期亮起。軌道上的長條是每年公告的數量，▲ 是《文化資產保存法》的修法節點。";

  /* ---------- 兩條軸的定義 ---------- */
  function buildAxes() {
    var nowY = +A.meta.generated.slice(0, 4), nowM = +A.meta.generated.slice(5, 7);
    /* 創建年：史前壓成一小段（分段線性），1624 年之後按年等距。位置 0–1000。 */
    var K = [[Math.min(A.meta.yearMin, -28000), 0], [-5000, 30], [0, 70], [1624, 130], [nowY, 1000]];
    function y2p(y) {
      if (y <= K[0][0]) return 0;
      for (var i = 1; i < K.length; i++) if (y <= K[i][0]) return K[i - 1][1] + (y - K[i - 1][0]) / (K[i][0] - K[i - 1][0]) * (K[i][1] - K[i - 1][1]);
      return 1000;
    }
    function p2y(p) {
      for (var i = 1; i < K.length; i++) if (p <= K[i][1]) return K[i - 1][0] + (p - K[i - 1][1]) / (K[i][1] - K[i - 1][1]) * (K[i][0] - K[i - 1][0]);
      return K[K.length - 1][0];
    }
    function eraAt(y) { var k = 0; A.eras.forEach(function (e, i) { if (e.from != null && y >= e.from) k = i; }); return k; }
    var japan = A.sites.filter(function (s) { return A.eras[s.era].id === "japan"; }).length;
    axes.built = {
      max: 1000, prop: "y", groupProp: "e", groups: A.eras, title: "依創建年亮起",
      posOf: function (s) { return y2p(s.year); }, group: function (s) { return s.era; },
      value: p2y,
      label: function (p) {
        var y = Math.round(p2y(p)), e = A.eras[eraAt(y)];
        var text = y < -3000 ? "西元前約 " + fmt(Math.round(-y / 100) * 100) + " 年" : y < 0 ? "西元前 " + fmt(-y) + " 年" : y + " 年";
        return { text: text, tag: e.name, color: e.color };
      },
      caption: function (p) { return ERA_TEXT[A.eras[eraAt(Math.round(p2y(p)))].id].replace("{pct}", Math.round(japan / A.sites.length * 100)); },
      ticks: [{ p: 0, t: "史前", l: 1 }].concat(A.eras.filter(function (e) { return e.from; }).map(function (e) { return { p: y2p(e.from), t: e.from + " " + e.name }; })),
      marks: [],
      toHash: function (p) { return String(Math.round(p2y(p))); },
      fromHash: function (s) { var y = parseInt(s, 10); return isNaN(y) ? null : y2p(y); }
    };
    /* 公告日期：單位是月，從 1982 年 1 月到資料產生的月份 */
    var maxM = (nowY - 1982) * 12 + nowM;
    function ym(p) { var m = Math.floor(Math.min(p, maxM - 0.001)); return [1982 + Math.floor(m / 12), m % 12 + 1]; }
    var ticks = [];
    for (var y = 1985; y <= nowY; y += 5) ticks.push({ p: (y - 1982) * 12, t: String(y) });
    axes.listed = {
      max: maxM, prop: "m", groupProp: "c", groups: A.cats, title: "依公告日期亮起",
      posOf: function (s) { return s.annMonth; }, group: function (s) { return s.cat; },
      value: function (p) { return p; },
      label: function (p) { var d = ym(p); return { text: d[0] + " 年 " + d[1] + " 月", tag: "", color: "" }; },
      caption: function (p) {
        var t = LISTED_INTRO;
        MILESTONES.forEach(function (m) { if (p >= m.p) t = m.t; });
        return t;
      },
      ticks: ticks,
      marks: MILESTONES.map(function (m) { m.p = (m.d[0] - 1982) * 12 + m.d[1] - 1; return m; }),
      toHash: function (p) { var d = ym(p); return d[0] + "-" + (d[1] < 10 ? "0" : "") + d[1]; },
      fromHash: function (s) { var m = /^(\d{4})-(\d{1,2})$/.exec(s || ""); return m ? (m[1] - 1982) * 12 + (+m[2]) - 1 + 0.99 : null; }
    };
  }

  /* ---------- 地圖圖層 ---------- */
  function colorExpr(ax) {
    var e = ["match", ["get", ax.groupProp]];
    ax.groups.forEach(function (g, i) { e.push(i, g.color); });
    e.push("#888");
    return e;
  }
  function filterFor(ax, lo, hi) {
    var f = ["all", [">=", ["get", ax.prop], mode === "listed" ? Math.max(0, lo) : lo], ["<=", ["get", ax.prop], hi]];
    if (mode === "built" && !showEst) f.push(["==", ["get", "u"], 0]);
    return f;
  }
  function stylePaint() {
    var ax = axes[mode], map = A.map, col = colorExpr(ax), hollow = mode === "built";
    map.setPaintProperty(DOTS, "circle-color", col);
    map.setPaintProperty(DOTS, "circle-opacity", hollow ? ["case", ["==", ["get", "u"], 1], 0, 0.88] : 0.88);
    map.setPaintProperty(DOTS, "circle-stroke-color", hollow ? ["case", ["==", ["get", "u"], 1], col, A.dark() ? "#17130f" : "#fffdf8"] : (A.dark() ? "#17130f" : "#fffdf8"));
    map.setPaintProperty(DOTS, "circle-stroke-width", hollow ? ["case", ["==", ["get", "u"], 1], 1.6, 0.7] : 0.7);
    map.setPaintProperty(GLOW, "circle-color", col);
  }

  /* ---------- 畫面更新 ---------- */
  function update() {
    var ax = axes[mode], v = ax.value(pos), map = A.map;
    map.setFilter(DOTS, filterFor(ax, -1e9, v));
    map.setFilter(GLOW, filterFor(ax, ax.value(Math.min(trail, pos)) + 1e-6, v));
    var lab = ax.label(pos);
    ui.now.innerHTML = esc(lab.text) + (lab.tag ? '<small style="--c:' + lab.color + '">' + esc(lab.tag) + "</small>" : "");
    ui.range.value = Math.round(pos);
    ui.range.setAttribute("aria-valuetext", lab.text);
    ui.cap.innerHTML = ax.caption(pos);
    /* 計數：各分組與各縣市 */
    var g = ax.groups.map(function () { return 0; }), c = A.counties.map(function () { return 0; }), n = 0, est = 0;
    A.sites.forEach(function (s) {
      var p = ax.posOf(s);
      if (p < 0 && mode === "listed") return;
      if (p > pos) return;
      if (mode === "built" && s.estimated) { if (!showEst) return; est++; }
      n++; g[ax.group(s)]++; c[s.county]++;
    });
    ui.count.innerHTML = "已亮起 <b>" + fmt(n) + "</b> ／ " + fmt(A.sites.length) + " 處";
    ui.total.textContent = fmt(n);
    ui.gn.forEach(function (el, i) { el.textContent = fmt(g[i]); el.parentNode.classList.toggle("off", !g[i]); });
    if (ui.estN) ui.estN.textContent = fmt(est);
    ui.cn.forEach(function (o, i) { o.n.textContent = c[i]; o.bar.style.width = (c[i] / ui.cmax * 100) + "%"; });
    ui.marks.forEach(function (b) { b.el.classList.toggle("on", pos >= b.p); });
    drawTrack();
  }

  function drawTrack() {
    var ax = axes[mode], cv = ui.canvas, w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ui.bins = null; }
    var pad = 7, iw = w - pad * 2, bw = 3, nb = Math.max(20, Math.floor(iw / bw));
    if (!ui.bins || ui.binsMode !== mode + showEst) {
      var bins = [];
      for (var i = 0; i < nb; i++) bins.push(ax.groups.map(function () { return 0; }));
      A.sites.forEach(function (s) {
        var p = ax.posOf(s);
        if (p < 0 || (mode === "built" && s.estimated && !showEst)) return;
        bins[Math.min(nb - 1, Math.floor(p / ax.max * nb))][ax.group(s)]++;
      });
      ui.bins = bins; ui.binsMode = mode + showEst;
      ui.binMax = Math.max.apply(null, bins.map(function (b) { return b.reduce(function (a, x) { return a + x; }, 0); }));
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = A.dark() ? "#1e1914" : "#efe7d8";
    ctx.fillRect(0, 0, w, h);
    var px = pad + pos / ax.max * iw, band = mode === "built" ? 5 : 0;
    if (band) {              /* 創建年軸：底部一條時代色帶 */
      A.eras.forEach(function (e, i) {
        var a = i ? axes.built.ticks[i].p : 0, b = i + 1 < A.eras.length ? axes.built.ticks[i + 1].p : 1000;
        ctx.fillStyle = e.color;
        ctx.fillRect(pad + a / 1000 * iw, h - band, (b - a) / 1000 * iw, band);
      });
    }
    var H = h - band - 4, x0, n = ui.bins.length, step = iw / n;
    for (var k = 0; k < n; k++) {
      x0 = pad + k * step;
      var y = h - band, lit = x0 + step / 2 <= px;
      ctx.globalAlpha = lit ? 1 : 0.28;
      var tot = ui.bins[k].reduce(function (s, x) { return s + x; }, 0);
      for (var j = 0; j < ui.bins[k].length; j++) {
        var v = ui.bins[k][j];
        if (!v) continue;
        /* 整根高度取平方根（讓數量少的年代也看得到），再依比例分給各分組 */
        var bh = Math.max(1.5, Math.sqrt(tot / ui.binMax) * H * v / tot);
        ctx.fillStyle = ax.groups[j].color;
        ctx.fillRect(x0, y - bh, Math.max(1, step - 0.6), bh);
        y -= bh;
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 播放 ---------- */
  function frame(t) {
    if (!playing) return;
    var ax = axes[mode], dt = Math.min(0.1, (t - last) / 1000); last = t;
    pos = Math.min(ax.max, pos + ax.max / PLAY_SECONDS * speed * dt);
    trail += (pos - trail) * Math.min(1, dt * 2.2);
    update();
    if (pos >= ax.max) return stop(true);
    raf = requestAnimationFrame(frame);
  }
  function play() {
    var ax = axes[mode];
    if (pos >= ax.max) { pos = 0; trail = 0; }
    playing = true; last = performance.now();
    ui.play.textContent = "❚❚"; ui.play.setAttribute("aria-label", "暫停");
    raf = requestAnimationFrame(frame);
  }
  function stop(finished) {
    playing = false; cancelAnimationFrame(raf);
    if (ui.play) { ui.play.textContent = "▶"; ui.play.setAttribute("aria-label", pos >= axes[mode].max ? "從頭播放" : "播放"); }
    if (finished) { trail = pos; update(); }
    saveHash();
  }
  function saveHash() { A.setHash("timeline/" + mode + (pos >= axes[mode].max ? "" : "/" + axes[mode].toHash(pos))); }

  /* ---------- 面板與圖例 ---------- */
  function render() {
    var ax = axes[mode];
    A.panel.innerHTML =
      '<div class="tl-head">' +
        '<div class="seg" role="group" aria-label="時間軸">' +
          '<button type="button" data-m="built" aria-pressed="' + (mode === "built") + '">創建年</button>' +
          '<button type="button" data-m="listed" aria-pressed="' + (mode === "listed") + '">公告日期</button></div>' +
        '<div class="tl-now" id="tlNow"></div><div class="tl-count" id="tlCount"></div></div>' +
      '<div class="tl-row">' +
        '<button class="tl-play" id="tlPlay" type="button" aria-label="播放">▶</button>' +
        '<div><div class="tl-track"><canvas id="tlCanvas"></canvas>' +
          '<input type="range" id="tlRange" min="0" max="' + ax.max + '" step="1" aria-label="' + (mode === "built" ? "創建年" : "公告日期") + '"></div>' +
          (ax.marks.length ? '<div class="tl-marks" id="tlMarks"></div>' : "") +
          '<div class="tl-ticks" id="tlTicks"></div></div>' +
        '<select class="tl-speed" id="tlSpeed" aria-label="播放速度"><option value="0.5">慢</option><option value="1" selected>正常</option><option value="2.5">快</option></select></div>' +
      '<p class="tl-cap" id="tlCap"></p>';
    ui.now = document.getElementById("tlNow"); ui.count = document.getElementById("tlCount"); ui.play = document.getElementById("tlPlay");
    ui.canvas = document.getElementById("tlCanvas"); ui.range = document.getElementById("tlRange"); ui.cap = document.getElementById("tlCap");
    ui.bins = null;
    document.getElementById("tlSpeed").value = String(speed);
    document.getElementById("tlSpeed").onchange = function () { speed = +this.value; };
    Array.prototype.forEach.call(A.panel.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { if (b.dataset.m !== mode) { stop(); setMode(b.dataset.m, null); } };
    });
    ui.play.onclick = function () { if (playing) stop(); else play(); };
    ui.range.oninput = function () { if (playing) stop(); var p = +this.value; if (p < pos) trail = p; else trail = pos; pos = p; update(); };
    ui.range.onchange = function () { trail = pos; update(); saveHash(); };
    /* 修法節點 */
    ui.marks = [];
    var mk = document.getElementById("tlMarks");
    ax.marks.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = "▲"; b.style.left = (m.p / ax.max * 100) + "%";
      b.title = m.t.replace(/<[^>]+>/g, "").replace(/\s+/g, " "); b.setAttribute("aria-label", b.title);
      b.onclick = function () { stop(); trail = pos = m.p; update(); saveHash(); };
      mk.appendChild(b); ui.marks.push({ el: b, p: m.p });
    });
    layoutTicks();

    /* 圖例 */
    var open = window.innerWidth > 720;
    A.legend.innerHTML =
      '<details class="legend"' + (open ? " open" : "") + '><summary><span>' + ax.title + '</span><b id="lgTotal"></b></summary><div class="legend-body">' +
      ax.groups.map(function (g) { return '<div class="lg-row"><i style="--c:' + g.color + '"></i><span>' + esc(g.name) + '</span><span class="n"></span></div>'; }).join("") +
      (mode === "built"
        ? '<label class="lg-check"><input type="checkbox" id="lgEst"' + (showEst ? " checked" : "") + '><span>空心圈：年代為推估（<span id="lgEstN"></span>）</span></label>'
        : "") +
      '<details class="lg-counties"><summary>各縣市</summary>' +
      A.counties.map(function (c) { return '<div class="cty"><span>' + esc(c.name) + '</span><div class="bar"><i></i></div><span></span></div>'; }).join("") +
      "</details></div></details>";
    ui.total = document.getElementById("lgTotal");
    ui.gn = Array.prototype.slice.call(A.legend.querySelectorAll(".lg-row .n"));
    ui.estN = document.getElementById("lgEstN");
    ui.cmax = Math.max.apply(null, A.counties.map(function (c) { return c.n; }));
    ui.cn = Array.prototype.map.call(A.legend.querySelectorAll(".cty"), function (el) { return { n: el.lastChild, bar: el.querySelector("i") }; });
    var est = document.getElementById("lgEst");
    if (est) est.onchange = function () { showEst = this.checked; update(); };
  }
  function layoutTicks() {
    var ax = axes[mode], box = document.getElementById("tlTicks");
    if (!box) return;
    var w = box.clientWidth, lastEnd = -99;
    box.innerHTML = "";
    ax.ticks.forEach(function (t) {
      var el = document.createElement("span");
      el.textContent = t.t; if (t.l) el.className = "l";
      el.style.left = (t.p / ax.max * 100) + "%";
      box.appendChild(el);
      var x = t.p / ax.max * w, half = el.offsetWidth / 2, start = t.l ? x : x - half, end = t.l ? x + half * 2 : x + half;
      if (start < lastEnd + 6 || end > w + 8) box.removeChild(el); else lastEnd = end;
    });
  }
  function setMode(m, p) {
    mode = m;
    pos = p == null ? axes[m].max : Math.max(0, Math.min(axes[m].max, p));
    trail = pos;
    A.hideCard();
    render(); stylePaint(); update(); stop();
  }

  A.registerLayer({
    id: "timeline",
    pick: [DOTS],
    init: function () {
      buildAxes();
      var r = ["interpolate", ["linear"], ["zoom"], 5, 2, 7, 3, 10, 4.6, 14, 7.5];
      A.map.addLayer({ id: GLOW, type: "circle", source: "sites", layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 8, 7, 11, 10, 15, 14, 20], "circle-opacity": 0.38, "circle-blur": 0.7, "circle-color": "#888" } });
      A.map.addLayer({ id: DOTS, type: "circle", source: "sites", layout: { visibility: "none" },
        paint: { "circle-radius": r, "circle-color": "#888", "circle-stroke-width": 0.7, "circle-stroke-color": "#fff" } });
      window.addEventListener("resize", function () { if (A.current && A.current.id === "timeline") { layoutTicks(); drawTrack(); } });
    },
    enter: function (_, args) {
      A.map.setLayoutProperty(DOTS, "visibility", "visible");
      A.map.setLayoutProperty(GLOW, "visibility", "visible");
      var m = args[0] === "listed" ? "listed" : "built";
      {
        A.about.innerHTML =
          "<h3>臺灣是怎麼長出來的</h3>" +
          "<p>按下播放或拉動滑桿，文化資產會依年份在地圖上亮起。「創建年」看的是這些建築與遺址出現的先後；「公告日期」看的是它們什麼時候取得文化資產身分。</p>" +
          '<div class="note"><b>閱讀時請留意</b><ul>' +
          "<li>創建年取自知識網站各景點的年代資料。多數是始建年，少數是重建、改建或遷建年，卡片上會顯示原始的年代說明。</li>" +
          "<li>" + fmt(A.meta.estimated) + " 處文化資產沒有確切年代，年份是依登錄資料推估的，地圖上以空心圈表示，可以在圖例關閉。</li>" +
          "<li>時代依創建年劃分：1624 年以前、荷西（1624–1661）、明鄭（1662–1683）、清領（1684–1894）、日治（1895–1945）、戰後（1946 年起）。這是臺灣本島的分期；金門、馬祖沒有荷西與日治時期，卡片上另外標示當地的時期。</li>" +
          "<li>地圖上只有今天仍具文化資產身分的項目，已消失或未登錄的建築不在其中，所以這不是完整的聚落發展史。</li>" +
          "<li>公告日期是現行資料上的日期；曾經變更等級或重新公告的文化資產，日期可能是最近一次公告。</li>" +
          '<li>修法節點依<a href="https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode=H0170001" target="_blank" rel="noopener">全國法規資料庫〈文化資產保存法〉沿革</a>整理。</li>' +
          "</ul></div>";
      }
      var p = args[1] != null ? axes[m].fromHash(args[1]) : null;
      setMode(m, p);
    },
    leave: function () {
      stop();
      A.map.setLayoutProperty(DOTS, "visibility", "none");
      A.map.setLayoutProperty(GLOW, "visibility", "none");
    },
    theme: function () { stylePaint(); drawTrack(); }
  });
})();
