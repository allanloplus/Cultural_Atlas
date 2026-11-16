/* 平面分頁的「Allan 和阿拉蕾說故事」（比照 3D 文資島的導覽）
 * 每個圖層給一串「站」：每站的事實由資料即時算出，鏡頭與圖層狀態由圖層自己設定；
 * 語音旁白是 data/narration/<track><第幾站>.mp3（tools/build_narration.py 產生，劇本的算法要和這裡的 prep 一致）。
 * 卡片與對話一律放在下方面板（.panel.is-touring），不蓋住地圖。
 *
 * 用法（見 layers/timeline.js）：
 *   var story = Story.create({
 *     layer: "timeline", track: "tl", invite: "帶你看……",
 *     stops: [{ title: "…" 或 function (d), tag: "推估", prep: function () { return d 或 null（跳過） },
 *               apply: function (d) { 設定圖層狀態、回傳鏡頭 { bounds } 或 { center, zoom } },
 *               text: function (d) { return HTML } }]
 *   });
 *   面板 HTML 放 story.button()，畫完面板後呼叫 story.mount(A.panel)；enter 時 story.enter()，leave 時 story.leave()。
 */
(function (root) {
  "use strict";
  var A = root.Atlas, N = root.Narration, esc = A.esc;
  var reduced = root.matchMedia("(prefers-reduced-motion: reduce)");
  var narrP = null;

  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function faces(a, r) { var C = root.Characters; return C ? '<img src="' + C.face("A", a) + '" alt="" width="40" height="40"><img src="' + C.face("R", r) + '" alt="" width="40" height="40">' : ""; }
  function sayLine(el, l) {
    if (!el) return;
    var C = root.Characters, name = l.who === "R" ? "阿拉蕾" : "Allan";
    el.hidden = false; el.dataset.who = l.who;
    el.innerHTML = (C ? '<img src="' + C.face(l.who, C.mood(l.who, l.text)) + '" alt="" width="44" height="44">' : "") + "<p><b>" + name + "</b>" + esc(l.text) + "</p>";
  }
  function voiceBtn(ok) { var on = N.on(); return '<button type="button" class="is-voice" aria-pressed="' + on + '" aria-label="旁白聲音" title="旁白聲音"' + (ok ? "" : " hidden") + ">" + (on ? "🔊" : "🔇") + "</button>"; }

  function create(cfg) {
    var tour = null, narrOK = false, advTimer = null, card = null;
    var inviteKey = "atlas-story-off-" + cfg.layer;
    function here() { return A.current && A.current.id === cfg.layer; }
    function list() { return cfg.stops.filter(function (s) { return !s.need || s.need(); }); }
    function voiceOn() { return narrOK && N.on(); }

    function fly(cam) {
      var m = A.map, o = { duration: reduced.matches ? 0 : 2400, essential: false };
      m.stop();
      if (cam.bounds) return m.fitBounds(cam.bounds, Object.assign(o, { padding: { top: 40, bottom: 40, left: 30, right: 30 }, maxZoom: cam.maxZoom || 13 }));
      if (reduced.matches) m.jumpTo(cam); else m.flyTo(Object.assign(o, cam));
    }
    function hideInvite() { var el = document.getElementById("stInvite"); if (el) el.remove(); }
    function showInvite() {
      if (ss(inviteKey) || tour || document.getElementById("stInvite") || !here()) return;
      var el = document.createElement("div");
      el.id = "stInvite"; el.className = "is-invite";
      el.innerHTML = faces("smile", "laugh") + "<p><b>Allan 和阿拉蕾</b>" + esc(cfg.invite) + (narrOK ? "（有聲音）" : "") +
        '</p><button type="button" class="go">▶ 聽故事</button><button type="button" class="x" aria-label="關閉">×</button>';
      A.map.getContainer().parentNode.appendChild(el);
      el.querySelector(".go").onclick = function () { start(); };
      el.querySelector(".x").onclick = function () { ss(inviteKey, "1"); hideInvite(); };
    }
    function setVoice(v) {
      N.set(v);
      Array.prototype.forEach.call(document.querySelectorAll(".is-voice"), function (b) { b.setAttribute("aria-pressed", String(v)); b.textContent = v ? "🔊" : "🔇"; });
      if (!v) { clearTimeout(advTimer); if (card) { card.classList.remove("talking"); var s = card.querySelector(".is-say"); if (s) s.hidden = true; } }
      else if (tour) go(tour.k);
    }
    function bindVoice(el) { Array.prototype.forEach.call(el.querySelectorAll(".is-voice"), function (b) { b.onclick = function () { setVoice(!N.on()); }; }); }

    /* 面板重畫後把卡片放回去 */
    function mount(panel) {
      var b = panel.querySelector(".st-btn");
      if (b) { b.onclick = function () { if (tour) stop(); else start(); }; b.setAttribute("aria-pressed", String(!!tour)); }
      bindVoice(panel);
      if (!tour || !card) return;
      if (card.parentNode !== panel) panel.appendChild(card);
      if (!panel.classList.contains("is-touring")) { panel.classList.add("is-touring"); A.map.resize(); }
    }
    function stop() {
      if (!tour) return;
      tour = null; clearTimeout(advTimer); N.stop();
      if (card) { card.remove(); card = null; }
      if (A.panel.classList.contains("is-touring")) { A.panel.classList.remove("is-touring"); A.map.resize(); }
      var b = A.panel.querySelector(".st-btn"); if (b) b.setAttribute("aria-pressed", "false");
      if (cfg.onStop) cfg.onStop();
    }
    function start() {
      hideInvite(); A.hideCard();
      (narrP || Promise.resolve(false)).then(function (ok) { narrOK = ok; if (here()) go(0); });
    }
    function go(k) {
      var L = list();
      k = Math.max(0, Math.min(L.length - 1, k));
      tour = { k: k }; clearTimeout(advTimer); N.stop();
      var S = L[k];
      Promise.resolve(cfg.ready ? cfg.ready() : null).then(function () {
        if (!tour || tour.k !== k || !here()) return;
        var d = S.prep ? S.prep() : {};
        if (!d) return go(k + 1);
        A.hideCard();
        var cam = S.apply(d);
        if (!card) { card = document.createElement("div"); card.className = "is-tour st-tour"; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "說故事"); }
        card.innerHTML = '<p class="is-tour-k">說故事 ' + (k + 1) + "／" + L.length + (S.tag ? '　<span class="sv-tag">' + S.tag + "</span>" : "") + "</p><h3>" + esc(typeof S.title === "function" ? S.title(d) : S.title) + "</h3>" +
          '<div class="is-say" hidden></div><p class="is-fact">' + S.text(d) + "</p>" +
          '<div class="is-tour-nav">' + voiceBtn(narrOK) + '<button type="button" data-d="-1"' + (k ? "" : " disabled") + '>‹ 上一段</button><button type="button" data-d="0">結束</button>' +
          '<button type="button" data-d="1" class="go"' + (k < L.length - 1 ? "" : " disabled") + ">下一段 ›</button></div>";
        Array.prototype.forEach.call(card.querySelectorAll("button[data-d]"), function (b) {
          b.onclick = function () { var dd = +b.dataset.d; if (!dd) stop(); else go(k + dd); };
        });
        bindVoice(card);
        mount(A.panel);
        if (cam) fly(cam);
        card.classList.remove("talking");
        if (voiceOn()) {                /* 講完自動到下一段 */
          card.classList.add("talking");
          var el = card;
          N.play(cfg.track + (cfg.stops.indexOf(S) + 1), {
            onLine: function (_, l) { sayLine(el.querySelector(".is-say"), l); },
            onEnd: function () {
              el.classList.remove("talking");
              if (tour && tour.k === k && k < L.length - 1 && voiceOn()) advTimer = setTimeout(function () { if (tour && tour.k === k) go(k + 1); }, 1500);
            }
          });
        }
      });
    }
    return {
      button: function () { return '<button type="button" class="st-btn" aria-pressed="' + !!tour + '">' + faces("smile", "laugh") + "<span>Allan 和阿拉蕾說故事</span></button>"; },
      mount: mount, start: start, stop: stop, active: function () { return !!tour; },
      enter: function () {
        narrP = narrP || (N ? N.ready() : Promise.resolve(false));
        narrP.then(function (ok) { narrOK = ok; if (here() && !tour) { showInvite(); Array.prototype.forEach.call(A.panel.querySelectorAll(".is-voice"), function (b) { b.hidden = !ok; }); } });
      },
      leave: function () { stop(); hideInvite(); }
    };
  }
  root.Story = { create: create, voiceBtn: voiceBtn };
})(this);
