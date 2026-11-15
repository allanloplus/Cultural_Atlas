/* 圖層：它挺過了什麼（歷史地震與颱風，全部是推估）
 * 資料：data/survived.json（tools/build_survived.py）
 * 網址：#survived/quake/<地震 id 或 all>、#survived/typhoon
 */
(function () {
  "use strict";
  var A = window.Atlas, esc = A.esc, fmt = A.fmt;
  var DOTS = "sv-dots";
  var V = null, loading = null, mode = "quake", evIdx = -1, marker = null, state = [], order = [];
  /* 震度代碼 3–9（3、4、5弱、5強、6弱、6強、7）的顏色 */
  var LV_COLOR = { 3: "#b9c98a", 4: "#f0cf45", 5: "#f2a23a", 6: "#e8742c", 7: "#d6432b", 8: "#a51f3d", 9: "#5e1a6e" };
  var NONE = "#9a9087", NEAR = "#a8714a";
  var TY_BINS = [[0, 34, "#bcd7ea"], [35, 49, "#7fb3d9"], [50, 64, "#3b7bbf"], [65, 999, "#1c3f7a"]];
  var OLD_KM = 50;         /* 1900 年以前的地震：震央在這個距離內才列出 */

  function yearOf(q) { return +q.date.slice(0, 4); }
  function km(s, q) {
    var p = Math.PI / 180, a = Math.pow(Math.sin((s.lat - q.lat) * p / 2), 2) + Math.cos(s.lat * p) * Math.cos(q.lat * p) * Math.pow(Math.sin((s.lng - q.lng) * p / 2), 2);
    return 12742 * Math.asin(Math.sqrt(a));
  }
  function lvName(c) { var n = V.meta.levels[c]; return /^\d$/.test(n) ? n + " 級" : n.charAt(0) + " " + n.charAt(1); }
  function qTitle(q) { return yearOf(q) + " 年" + (q.name ? q.name.replace(/^\d{4}年/, "") : "地震"); }
  function methodText(q) {
    return q.method === "shakemap" ? "震度取自美國地質調查所（USGS）ShakeMap 的模式推估" : q.method === "gmpe" ? "震度依規模與震源距離用衰減式估算" : "只有文獻推估的震央與規模，不估震度";
  }

  /* 一處文資遇過的地震與颱風 */
  function history(s) {
    var qs = [], old = [];
    V.quakes.forEach(function (q, k) {
      if (yearOf(q) < s.year) return;
      if (q.method === "none") { var d = km(s, q); if (d <= OLD_KM && q.m >= 6) old.push({ q: q, k: k, d: d }); return; }
      var c = +q.levels.charAt(s.i);
      if (c >= 4) qs.push({ q: q, k: k, c: c });
    });
    qs.sort(function (a, b) { return b.c - a.c || (a.q.date < b.q.date ? 1 : -1); });
    old.sort(function (a, b) { return b.q.m - a.q.m; });
    return { qs: qs, old: old, ty: V.typhoons[s.i] };
  }
  function sentence(s, h) {
    var t = [];
    if (h.qs.length) t.push("推估遇過 <b>" + h.qs.length + "</b> 次震度 4 級以上的地震，最強是 " + esc(qTitle(h.qs[0].q)) + "（推估 " + lvName(h.qs[0].c) + "）");
    else t.push("創建以來沒有推估達 4 級的災害地震紀錄");
    if (h.old.length) t.push("1900 年以前另有 " + h.old.length + " 次規模 6 以上地震的震央在 " + OLD_KM + " 公里內");
    if (h.ty[0]) t.push((s.year < 1884 ? "1884 年有路徑紀錄以來" : "創建以來") + "有 <b>" + h.ty[0] + "</b> 個熱帶氣旋的中心從 " + V.meta.typhoonKm + " 公里內通過，其中至少 " + h.ty[2] + " 個達颱風強度");
    return t.join("；") + "。";
  }
  function cardExtra(s) {
    if (!V) return "";
    var h = history(s), html = '<div class="sv-box"><p class="sv-tag">推估・非官方觀測</p><p>' + sentence(s, h) + "</p>";
    if (h.qs.length) html += "<ul>" + h.qs.slice(0, 5).map(function (x) {
      return '<li><a href="#survived/quake/' + x.q.id + '"><i style="background:' + LV_COLOR[x.c] + '"></i>' + esc(qTitle(x.q)) + "</a>　推估 " + lvName(x.c) + "</li>";
    }).join("") + "</ul>";
    if (h.old.length) html += '<p class="sv-sm">較早的地震：' + h.old.slice(0, 3).map(function (x) { return x.q.date.slice(0, 4) + " 年（規模約 " + x.q.m + "，震央約 " + Math.round(x.d) + " 公里）"; }).join("、") + "</p>";
    if (h.ty[3].length) html += '<p class="sv-sm">通過時較強的颱風：' + h.ty[3].map(function (x) {
      var st = V.storms[x[0]]; return st.date.slice(0, 4) + " " + esc(st.zh || st.en || "未命名");
    }).join("、") + "</p>";
    if (s.estimated) html += '<p class="sv-sm">這處文資的創建年是推估值，早年的紀錄可能多算或少算。</p>';
    return html + "</div>";
  }

  /* 歷來最大推估震度：只算創建年之後、有估震度的地震 */
  function maxLevel(s) {
    var v = 0;
    for (var k = 0; k < order.length; k++) { var e = V.quakes[order[k]]; if (yearOf(e) >= s.year) { var c = +e.levels.charAt(s.i); if (c > v) v = c; } }
    return v;
  }
  function load() {
    loading = loading || fetch("data/survived.json").then(function (r) { return r.json(); }).then(function (d) {
      V = d;
      V.quakes.forEach(function (q, k) { if (q.method !== "none") order.push(k); });
      paint();
    });
    return loading;
  }
  /* 給其他圖層（3D 文資島）用：同一份資料、同一套算法與顏色 */
  A.survivedData = { load: load, maxLevel: maxLevel, levelName: function (c) { return lvName(c); }, colors: LV_COLOR, none: NONE, count: function () { return order.length; }, raw: function () { return V; } };

  /* ---------- 地圖 ---------- */
  function applyState() {
    var n = A.sites.length, q = evIdx >= 0 ? V.quakes[evIdx] : null, counts = {};
    for (var i = 0; i < n; i++) {
      var s = A.sites[i], v;
      if (mode === "typhoon") {
        var c = V.typhoons[i][2];
        v = 20; TY_BINS.forEach(function (b, k) { if (c >= b[0] && c <= b[1]) v = 20 + k; });
      } else if (!q) {             /* 全部地震：歷來最大推估震度 */
        v = maxLevel(s);
      } else if (yearOf(q) < s.year) v = -1;                         /* 當時還沒出現 */
      else if (q.method === "none") v = km(s, q) <= OLD_KM ? 10 : 0; /* 只看震央距離 */
      else v = +q.levels.charAt(i);
      if (v !== state[i]) { state[i] = v; A.map.setFeatureState({ source: "sites", id: i }, { v: v }); }
      counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }
  function paint() {
    var fs = ["coalesce", ["feature-state", "v"], 0], col = ["match", fs];
    Object.keys(LV_COLOR).forEach(function (k) { col.push(+k, LV_COLOR[k]); });
    col.push(10, NEAR);
    TY_BINS.forEach(function (b, k) { col.push(20 + k, b[2]); });
    col.push(NONE);
    A.map.setPaintProperty(DOTS, "circle-color", col);
    A.map.setPaintProperty(DOTS, "circle-opacity", ["case", ["==", fs, -1], 0, ["==", fs, 0], 0.35, 0.9]);
    A.map.setPaintProperty(DOTS, "circle-stroke-opacity", ["case", ["==", fs, -1], 0, ["==", fs, 0], 0.2, 1]);
    A.map.setPaintProperty(DOTS, "circle-stroke-color", A.dark() ? "#17130f" : "#fffdf8");
  }

  /* ---------- 面板 ---------- */
  function render() {
    var q = evIdx >= 0 ? V.quakes[evIdx] : null;
    var opts = '<option value="all">全部地震：每處文資歷來的最大推估震度</option><optgroup label="1901 年以後（估震度）">' +
      order.slice().reverse().map(function (k) { var e = V.quakes[k]; return '<option value="' + e.id + '">' + e.date + "　" + esc(e.name || "地震") + "　規模 " + e.m + "</option>"; }).join("") +
      '</optgroup><optgroup label="1900 年以前（只有震央）">' +
      V.quakes.map(function (e, k) { return e.method === "none" ? '<option value="' + e.id + '">' + e.date.slice(0, 4) + " 年　" + esc(e.name.replace(/^\d{4}年/, "")) + "　規模約 " + e.m + "</option>" : ""; }).reverse().join("") + "</optgroup>";
    var cap;
    if (mode === "typhoon") {
      cap = "<b>颱風</b>　顏色是每處文資創建以來（最早從 1945 年有強度紀錄起算），達颱風強度（中心附近最大風速 64 節以上）的熱帶氣旋中心從 " + V.meta.typhoonKm + " 公里內通過的次數。越晚出現的文資次數自然越少。點文資可以看它遇過哪些。";
    } else if (!q) {
      cap = "<b>全部地震</b>　顏色是每處文資從創建到現在，在 " + order.length + " 個災害地震中推估遇過的最大震度。選一個地震，可以看當時已經存在的文資各搖得多厲害。";
    } else {
      cap = "<b>" + esc(q.date.replace(/-/g, "/")) + (q.time ? " " + q.time : "") + "　" + esc(q.name || "地震") + "</b>　規模" + (q.method === "none" ? "約 " : " ") + q.m +
        (q.magRange && q.magRange[0] !== q.magRange[1] ? "（各家估計 " + q.magRange[0] + "–" + q.magRange[1] + "）" : "") + (q.depth != null ? "，深度 " + q.depth + " 公里" : "") + "。" +
        (q.note ? esc(q.note) + "。" : "") + '<span class="sv-method">' + methodText(q) + "。</span>";
    }
    A.panel.innerHTML =
      '<div class="tl-head"><div class="seg" role="group" aria-label="災害類型">' +
        '<button type="button" data-m="quake" aria-pressed="' + (mode === "quake") + '">地震</button>' +
        '<button type="button" data-m="typhoon" aria-pressed="' + (mode === "typhoon") + '">颱風</button></div>' +
        (mode === "quake" ? '<div class="sv-pick"><button type="button" id="svPrev" aria-label="較早的地震">‹</button><label class="sr-only" for="svSel">選擇地震</label><select id="svSel">' + opts + '</select><button type="button" id="svNext" aria-label="較晚的地震">›</button></div>' : "") +
        '<span class="sv-tag">全部是推估，不是官方觀測</span></div>' +
      '<p class="tl-cap sv-cap">' + cap + "</p>";
    Array.prototype.forEach.call(A.panel.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { location.hash = "#survived/" + b.dataset.m; };
    });
    var sel = document.getElementById("svSel");
    if (sel) {
      sel.value = q ? q.id : "all";
      sel.onchange = function () { location.hash = "#survived/quake/" + sel.value; };
      var step = function (d) {
        var list = [-1].concat(V.quakes.map(function (_, k) { return k; })), i = list.indexOf(evIdx) + d;
        if (i >= 0 && i < list.length) location.hash = "#survived/quake/" + (list[i] < 0 ? "all" : V.quakes[list[i]].id);
      };
      document.getElementById("svPrev").onclick = function () { step(-1); };
      document.getElementById("svNext").onclick = function () { step(1); };
    }
  }
  function legend(counts) {
    var rows = [], q = evIdx >= 0 ? V.quakes[evIdx] : null, title, total = 0;
    function row(color, label, n, ring) { rows.push('<div class="lg-row' + (n ? "" : " off") + '"><i style="--c:' + color + '"' + (ring ? ' class="ring"' : "") + "></i><span>" + label + '</span><span class="n">' + fmt(n || 0) + "</span></div>"); }
    if (mode === "typhoon") {
      title = "颱風通過次數";
      TY_BINS.forEach(function (b, k) { row(b[2], (b[1] > 900 ? b[0] + " 個以上" : b[0] ? b[0] + "–" + b[1] + " 個" : b[1] + " 個以下"), counts[20 + k]); total += counts[20 + k] || 0; });
    } else if (q && q.method === "none") {
      title = "震央 " + OLD_KM + " 公里內";
      row(NEAR, "當時已存在、在 " + OLD_KM + " 公里內", counts[10]); row(NONE, "當時已存在、較遠", counts[0]); total = counts[10] || 0;
    } else {
      title = q ? "推估震度" : "歷來最大推估震度";
      for (var c = 9; c >= 3; c--) { row(LV_COLOR[c], lvName(c), counts[c]); if (c >= 4) total += counts[c] || 0; }
      row(NONE, "3 級以下或未估算", counts[0]);
    }
    A.legend.innerHTML = '<details class="legend"' + (window.innerWidth > 720 ? " open" : "") + "><summary><span>" + title + "</span><b>" +
      (mode === "typhoon" ? "" : fmt(total)) + '</b></summary><div class="legend-body">' + rows.join("") +
      (q ? '<p class="sv-sm">沒顯示的文資當時還沒出現（共 ' + fmt(counts[-1] || 0) + " 處）。</p>" : "") +
      (mode === "quake" && !(q && q.method === "none") ? '<p class="sv-sm">標題的數字是 4 級以上的處數。</p>' : "") + "</div></details>";
  }
  function show() {
    var q = evIdx >= 0 && mode === "quake" ? V.quakes[evIdx] : null;
    if (marker) { marker.remove(); marker = null; }
    if (q) {
      var el = document.createElement("div"); el.className = "sv-epi"; el.title = "震央"; el.textContent = "✸";
      marker = new maplibregl.Marker({ element: el }).setLngLat([q.lng, q.lat]).addTo(A.map);
    }
    render(); legend(applyState());
  }

  function about() {
    A.about.innerHTML =
      "<h3>它挺過了什麼</h3>" +
      "<p>用每處文化資產的創建年與位置，對照歷史上的災害地震與颱風路徑，估算它經歷過什麼。<b>這一頁的震度與颱風影響都是本站依公開資料推估的，不是官方觀測，也不代表建築實際的受損情形。</b></p>" +
      '<div class="note"><b>推估方法與限制</b><ul>' +
      "<li><b>地震清單</b>：1901 年以後採用中央氣象署地震測報中心的災害性地震列表，並補上 2024 年花蓮、2025 年嘉義大埔兩次地震（震源參數取自美國地質調查所）；1900 年以前採用氣象署整理的歷史地震記載中，有震央與規模的 " + V.quakes.filter(function (q) { return q.method === "none"; }).length + " 筆。</li>" +
      "<li><b>震度（規模 6.8 以上）</b>：取美國地質調查所 ShakeMap 在文資位置的地動值。1970 年代以前的事件，ShakeMap 本身是由震源參數算出來的模式結果，不是實測。</li>" +
      "<li><b>震度（其他地震）</b>：用 Liu 與 Tsai（2005）的臺灣地動衰減式，由規模與震源距離估算最大地動加速度與速度。這是把震源當成一個點的平均估計，不考慮斷層破裂範圍與各地的地盤條件。</li>" +
      "<li>地動值再依中央氣象署 2020 年起的震度分級換算成震度。</li>" +
      "<li><b>誤差</b>：拿氣象署 13 個地震、實測 5 弱以上的 572 個測站紀錄來比，衰減式的推估平均低 1.3 級，ShakeMap 平均低 0.7 級。比較對象只有搖得比較厲害的測站，推估偏低是可以預期的，但也表示<b>實際震度可能比這裡顯示的高一級左右</b>。</li>" +
      "<li><b>1900 年以前的地震</b>只有文獻推估的震央與規模，本站不估震度，只列出震央在 " + OLD_KM + " 公里內、規模 6 以上的地震。</li>" +
      "<li><b>颱風</b>：用文資到颱風中心路徑的最短距離判定，" + V.meta.typhoonKm + " 公里內算通過附近。路徑紀錄從 1884 年開始；1945 年以前沒有強度資料，只能知道有熱帶氣旋經過。風速取各氣象機構紀錄的最大值，各機構的平均時間不同，僅供排序。</li>" +
      "<li>創建年之後建築可能經過重建或修復，「遇過」不等於同一棟建築原樣保存至今。</li>" +
      "</ul></div><h3>本圖層的資料來源</h3><ul>" +
      V.meta.quakeSources.concat(V.meta.typhoonSources).map(function (s) {
        return "<li>" + esc(s).replace(/(https?:\/\/[^\s）]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + "</li>";
      }).join("") +
      '<li>颱風中文名稱：交通部中央氣象署颱風資料庫 <a href="https://rdc28.cwa.gov.tw/TDB/" target="_blank" rel="noopener">https://rdc28.cwa.gov.tw/TDB/</a></li>' +
      "<li>中央氣象署的資料依其政府網站資料開放宣告利用；美國地質調查所與美國國家海洋暨大氣總署的資料屬公有領域。</li></ul>";
  }

  A.registerLayer({
    id: "survived",
    pick: [DOTS],
    canPick: function (s) { return state[s.i] !== -1; },
    cardExtra: cardExtra,
    init: function () {
      A.map.addLayer({ id: DOTS, type: "circle", source: "sites", layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 7, 3.2, 10, 5, 14, 8], "circle-color": NONE, "circle-stroke-width": 0.7, "circle-stroke-color": "#fff" } });
    },
    enter: function (_, args) {
      A.map.setLayoutProperty(DOTS, "visibility", "visible");
      if (!V) {
        A.panel.innerHTML = '<p class="tl-cap">資料載入中…</p>'; A.legend.innerHTML = "";
        return load().then(function () { if (A.current && A.current.id === "survived") A.current.enter(A, args); })
          .catch(function () { A.panel.innerHTML = '<p class="tl-cap">資料載入失敗，請重新整理。</p>'; });
      }
      mode = args[0] === "typhoon" ? "typhoon" : "quake";
      evIdx = -1;
      if (mode === "quake" && args[1] && args[1] !== "all") V.quakes.forEach(function (q, k) { if (q.id === args[1]) evIdx = k; });
      A.hideCard();
      about(); show();
    },
    leave: function () {
      A.map.setLayoutProperty(DOTS, "visibility", "none");
      if (marker) { marker.remove(); marker = null; }
      state = [];          /* 其他圖層會改同一個 feature-state，回來時要全部重設 */
    },
    theme: function () { if (V) paint(); }
  });
})();
