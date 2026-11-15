/* 圖層：文資風險地圖（文資座標套疊政府公開的災害潛勢圖資）
 * 資料：data/risk.json、data/risk-lines.geojson（tools/build_risk.py）
 * 網址：#risk/<all|flood|fault|debris|landslide>/<淹水情境 0–2>
 */
(function () {
  "use strict";
  var A = window.Atlas, esc = A.esc, fmt = A.fmt;
  var DOTS = "rk-dots", FAULTS = "rk-faults", STREAMS = "rk-streams";
  var R = null, loading = null, mode = "all", scen = 1, cls = [];
  var NONE = "#9a9087";
  var FAULT_NEAR = 100, FAULT_FAR = 500, STREAM_NEAR = 200, FLOOD_LABEL = 3;   /* 自訂門檻；FLOOD_LABEL＝淹水深度代碼 3（0.5 公尺以上） */
  var RISK = ["", "低", "中", "高", "持續觀察"];
  var MODES = [["all", "綜合"], ["flood", "淹水"], ["fault", "活動斷層"], ["debris", "土石流"], ["landslide", "大規模崩塌"]];
  var FLOOD_COLORS = ["", "#cfe1ee", "#9ecae1", "#5ba3d0", "#2b7bba", "#1c4f91", "#3a1c71"];

  /* 一處文資的各項標籤 */
  function labels(i) {
    var r = R.sites[i], out = { fault: 0, debris: 0, landslide: 0, flood: 0, n: 0 };
    if (r[0]) out.fault = r[0][1] <= FAULT_NEAR ? 2 : r[0][1] <= FAULT_FAR ? 1 : 0;
    if (r[1]) out.debris = r[1][0] === 1 ? 2 : r[1][3] <= STREAM_NEAR ? 1 : 0;
    if (r[2]) out.landslide = r[2][0];
    out.flood = r[3][1] >= FLOOD_LABEL ? 1 : 0;          /* 綜合：以 24 小時 500 毫米情境為準 */
    out.n = (out.fault ? 1 : 0) + (out.debris ? 1 : 0) + (out.landslide ? 1 : 0) + out.flood;
    return out;
  }
  /* 各模式的分級：[標籤, 顏色]，第 0 級是「沒有」；classOf 回傳級別索引 */
  function classes() {
    if (mode === "flood") return [["未達 0.3 公尺，或不在模擬範圍", NONE]].concat([2, 3, 4, 5, 6].map(function (c) { return ["淹水 " + R.meta.floodDepth[c], FLOOD_COLORS[c]]; }));
    if (mode === "fault") return [["超過 " + FAULT_FAR + " 公尺", NONE], [FAULT_NEAR + "–" + FAULT_FAR + " 公尺", "#e8742c"], [FAULT_NEAR + " 公尺內", "#b3202a"]];
    if (mode === "debris") return [["沒有", NONE], ["距潛勢溪流 " + STREAM_NEAR + " 公尺內", "#c99a5b"], ["在影響範圍內", "#7a4a1e"]];
    if (mode === "landslide") return [["沒有", NONE], ["在影響範圍內", "#b784a7"], ["在潛勢區內", "#7a2e6b"]];
    return [["沒有標籤", NONE], ["1 項", "#f0cf45"], ["2 項", "#e8742c"], ["3 項以上", "#a51f3d"]];
  }
  function classOf(i) {
    var r = R.sites[i], L = labels(i);
    if (mode === "flood") { var c = r[3][scen]; return c >= 2 ? c - 1 : 0; }
    if (mode === "all") return Math.min(3, L.n);
    return L[mode];
  }
  function flagged(k) { return mode === "flood" ? k >= 2 && k <= 5 : k > 0; }   /* 淹水：0.5 公尺以上才算入統計 */

  function cardExtra(s) {
    if (!R) return "";
    var r = R.sites[s.i], li = [];
    if (r[3][0] >= 2 || r[3][1] >= 2 || r[3][2] >= 2) li.push("<b>淹水潛勢</b>（24 小時累積雨量）：" + R.meta.floodScenarios.map(function (n, k) { return n.replace("24 小時 ", "") + " → " + (r[3][k] >= 2 ? R.meta.floodDepth[r[3][k]] : "未達 0.3 公尺"); }).join("；"));
    else li.push("<b>淹水潛勢</b>：三個情境都未達 0.3 公尺，或不在模擬範圍");
    if (r[0]) li.push("<b>活動斷層</b>：距" + esc(R.faults[r[0][0]]) + "約 " + (r[0][1] >= 1000 ? (r[0][1] / 1000).toFixed(1) + " 公里" : fmt(r[0][1]) + " 公尺"));
    else li.push("<b>活動斷層</b>：5 公里內沒有");
    if (r[1]) li.push("<b>土石流</b>：" + (r[1][0] === 1 ? "在潛勢溪流 " + esc(r[1][1]) + " 的影響範圍內" : "距潛勢溪流 " + esc(r[1][1]) + " 約 " + r[1][3] + " 公尺") + (r[1][2] ? "（風險等級：" + RISK[r[1][2]] + "）" : ""));
    if (r[2]) li.push("<b>大規模崩塌</b>：在 " + esc(r[2][1]) + " 的" + (r[2][0] === 2 ? "潛勢區" : "影響範圍") + "內" + (r[2][2] ? "（風險等級：" + RISK[r[2][2]] + "）" : ""));
    return '<div class="sv-box"><p class="sv-tag">圖資套疊・僅供防災參考</p><ul class="rk-list"><li>' + li.join("</li><li>") + "</li></ul></div>";
  }

  function show() {
    cls = classes();
    var col = ["match", ["coalesce", ["feature-state", "v"], 0]], counts = cls.map(function () { return 0; }), cty = A.counties.map(function () { return 0; });
    cls.forEach(function (c, k) { if (k) col.push(k, c[1]); });
    col.push(cls[0][1]);
    A.sites.forEach(function (s, i) {
      var k = classOf(i);
      A.map.setFeatureState({ source: "sites", id: i }, { v: k });
      counts[k]++; if (flagged(k)) cty[s.county]++;
    });
    var fs = ["coalesce", ["feature-state", "v"], 0], quiet = ["==", fs, 0];
    A.map.setPaintProperty(DOTS, "circle-color", col);
    A.map.setPaintProperty(DOTS, "circle-opacity", ["case", quiet, 0.35, 0.92]);
    A.map.setPaintProperty(DOTS, "circle-stroke-opacity", ["case", quiet, 0.2, 1]);
    A.map.setPaintProperty(DOTS, "circle-radius", ["interpolate", ["linear"], ["zoom"], 5, ["case", quiet, 1.8, 3], 7, ["case", quiet, 2.6, 4], 10, ["case", quiet, 4, 6], 14, 8]);
    A.map.setPaintProperty(DOTS, "circle-stroke-color", A.dark() ? "#17130f" : "#fffdf8");
    A.map.setLayoutProperty(FAULTS, "visibility", mode === "fault" || mode === "all" ? "visible" : "none");
    A.map.setLayoutProperty(STREAMS, "visibility", mode === "debris" ? "visible" : "none");

    var cap = {
      all: "<b>綜合</b>　每處文資符合幾項：24 小時 500 毫米情境下淹水 0.5 公尺以上、距活動斷層 " + FAULT_FAR + " 公尺內、在土石流影響範圍內或距潛勢溪流 " + STREAM_NEAR + " 公尺內、在大規模崩塌潛勢區或影響範圍內。紅線是活動斷層。",
      flood: "<b>淹水潛勢</b>　經濟部水利署第三代淹水潛勢圖（2018 年）在文資位置的模擬淹水深度。<b>依規定僅供防救災使用，不得作為土地使用管制或開發限制的依據</b>；模擬假設防洪設施正常運作，結果具不確定性。",
      fault: "<b>活動斷層</b>　文資到最近一條活動斷層線的直線距離（36 條，地質調查及礦業管理中心）。" + FAULT_NEAR + " 與 " + FAULT_FAR + " 公尺是本站自訂的門檻，不是法定的地質敏感區範圍。",
      debris: "<b>土石流</b>　文資是否落在土石流潛勢溪流的影響範圍內，或距潛勢溪流 " + STREAM_NEAR + " 公尺內（農村發展及水土保持署，2026 年，1,753 條）。棕色線是潛勢溪流。",
      landslide: "<b>大規模崩塌</b>　文資是否落在大規模崩塌潛勢區或其影響範圍內（農村發展及水土保持署，2026 年，94 處）。"
    }[mode];
    A.panel.innerHTML =
      '<div class="tl-head"><div class="seg rk-seg" role="group" aria-label="災害類型">' +
      MODES.map(function (m) { return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</div>" +
      (mode === "flood" ? '<label class="rk-scen">情境 <select id="rkScen">' + R.meta.floodScenarios.map(function (n, k) { return '<option value="' + k + '"' + (k === scen ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" : "") +
      '<span class="sv-tag">圖資套疊，僅供防災參考</span></div><p class="tl-cap sv-cap">' + cap + "</p>";
    Array.prototype.forEach.call(A.panel.querySelectorAll(".seg button"), function (b) {
      b.onclick = function () { location.hash = "#risk/" + b.dataset.m + (b.dataset.m === "flood" ? "/" + scen : ""); };
    });
    var sel = document.getElementById("rkScen");
    if (sel) sel.onchange = function () { location.hash = "#risk/flood/" + sel.value; };

    var total = counts.reduce(function (a, n, k) { return a + (flagged(k) ? n : 0); }, 0), cmax = Math.max.apply(null, cty.concat([1]));
    var order = cls.map(function (_, k) { return k; }).filter(function (k) { return k > 0; }).reverse().concat([0]);
    A.legend.innerHTML = '<details class="legend"' + (window.innerWidth > 720 ? " open" : "") + "><summary><span>" + MODES.filter(function (m) { return m[0] === mode; })[0][1] +
      (mode === "flood" ? "（0.5 公尺以上）" : "") + "</span><b>" + fmt(total) + '</b></summary><div class="legend-body">' +
      order.map(function (k) { return '<div class="lg-row' + (counts[k] ? "" : " off") + '"><i style="--c:' + cls[k][1] + '"></i><span>' + cls[k][0] + '</span><span class="n">' + fmt(counts[k]) + "</span></div>"; }).join("") +
      '<details class="lg-counties"><summary>各縣市（有標籤的處數）</summary>' +
      A.counties.map(function (c, i) { return '<div class="cty"><span>' + esc(c.name) + '</span><div class="bar"><i style="width:' + (cty[i] / cmax * 100) + '%"></i></div><span>' + cty[i] + "</span></div>"; }).join("") +
      "</details></div></details>";
  }

  function about() {
    A.about.innerHTML =
      "<h3>文資風險地圖</h3>" +
      "<p>把每處文化資產的座標，套疊到政府公開的災害潛勢圖資上，看它落在哪些潛勢範圍內。<b>這是圖資套疊的結果，僅供防災參考，不是個別建築的風險評估，也不代表一定會或一定不會受災。</b></p>" +
      '<div class="note"><b>閱讀時請留意</b><ul>' +
      "<li><b>淹水潛勢圖的使用限制</b>：依《水災潛勢資料公開辦法》，淹水潛勢資料僅供防救災使用，不得作為土地使用管制或土地開發限制的判定依據。圖資是依設計降雨條件、特定地形地貌資料與水理模式演算而成，並假設防洪設施正常運作，結果具有不確定性。本站使用的是 2018 年建置的第三代圖資，官方說明潛勢圖以五年為更新週期。</li>" +
      "<li>淹水深度未達 0.3 公尺的不列入；統計以 0.5 公尺以上為準。各縣市的圖資只有部分標出模擬範圍，所以本站無法區分「在模擬範圍內但沒有淹水」與「不在模擬範圍」，兩者都顯示為灰點。</li>" +
      "<li>各縣市淹水圖的檔案格式不一致，金門、連江、澎湖的檔案只有 1–5 的分級而沒有深度文字，本站比照其他五級制縣市，視為從 0.3–0.5 公尺起算。</li>" +
      "<li><b>活動斷層的距離門檻是本站自訂的</b>（" + FAULT_NEAR + "、" + FAULT_FAR + " 公尺），量的是到斷層線的直線距離，不是法定的活動斷層地質敏感區，實際管制範圍以主管機關公告為準。斷層線含推測與隱伏段，位置本身有誤差。</li>" +
      "<li>每處文資只用一個座標點代表。範圍大的文資（聚落、文化景觀、考古遺址）可能只有一部分在潛勢範圍內，或座標點剛好落在範圍外。</li>" +
      "<li>土石流與大規模崩塌的圖資只涵蓋臺灣本島；金門、馬祖、澎湖沒有這兩項與活動斷層資料。</li>" +
      "<li><b>沒有土壤液化</b>：土壤液化潛勢圖目前沒有可穩定下載的全臺向量檔，而且只涵蓋部分縣市的平原地區，這一版先不納入。</li>" +
      "</ul></div><h3>本圖層的資料來源</h3><ul>" +
      R.meta.attribution.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
      "</ul><p>" + esc(R.meta.license).replace(/(https?:\/\/\S+)/, '<a href="$1" target="_blank" rel="noopener">$1</a>') + "</p>" +
      '<p class="muted">套疊計算日期：' + R.meta.generated + "。</p>";
  }

  A.registerLayer({
    id: "risk",
    pick: [DOTS],
    cardExtra: cardExtra,
    init: function () {
      A.map.addSource("risk-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      A.map.addLayer({ id: STREAMS, type: "line", source: "risk-lines", filter: ["==", ["get", "k"], "debris"], layout: { visibility: "none" },
        paint: { "line-color": "#8a5a2b", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 12, 2], "line-opacity": 0.8 } });
      A.map.addLayer({ id: FAULTS, type: "line", source: "risk-lines", filter: ["==", ["get", "k"], "fault"], layout: { visibility: "none" },
        paint: { "line-color": "#c22a2a", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.2, 12, 3], "line-opacity": 0.85 } });
      A.map.addLayer({ id: DOTS, type: "circle", source: "sites", layout: { visibility: "none" },
        paint: { "circle-radius": 3, "circle-color": NONE, "circle-stroke-width": 0.7, "circle-stroke-color": "#fff" } });
    },
    enter: function (_, args) {
      A.map.setLayoutProperty(DOTS, "visibility", "visible");
      if (!R) {
        A.panel.innerHTML = '<p class="tl-cap">資料載入中…</p>'; A.legend.innerHTML = "";
        loading = loading || Promise.all([
          fetch("data/risk.json").then(function (r) { return r.json(); }),
          fetch("data/risk-lines.geojson").then(function (r) { return r.json(); })
        ]).then(function (d) { R = d[0]; A.map.getSource("risk-lines").setData(d[1]); });
        return loading.then(function () { if (A.current && A.current.id === "risk") A.current.enter(A, args); })
          .catch(function () { A.panel.innerHTML = '<p class="tl-cap">資料載入失敗，請重新整理。</p>'; });
      }
      mode = MODES.some(function (m) { return m[0] === args[0]; }) ? args[0] : "all";
      if (mode === "flood" && /^[012]$/.test(args[1] || "")) scen = +args[1];
      A.hideCard();
      about(); show();
    },
    leave: function () {
      [DOTS, FAULTS, STREAMS].forEach(function (id) { A.map.setLayoutProperty(id, "visibility", "none"); });
    },
    theme: function () { if (R) show(); }
  });
})();
