/* 雙人語音旁白（Allan × 阿拉蕾）：播放 data/narration/<track>.mp3 的某幾句
 * 劇本與每句起訖時間：data/narration/script.json（tools/build_narration.py 產生）
 * - 劇本是依產生當時的文資資料寫的；和目前的 data/sites.json 不一致時，不播語音（數字可能已過時）。
 * - 某段的文字和語音檔對不上（雜湊不符）或語音檔載入失敗時，改用瀏覽器內建語音；連內建語音都沒有時，只依字數計時顯示字幕。
 * 用法：Narration.ready().then(ok) → Narration.play(track, { from, to, onLine(k, line), onEnd() })；Narration.stop()
 */
(function (root) {
  "use strict";
  var KEY = "atlas-voice", BASE = "data/narration/";
  var doc = null, loading = null, audio = new Audio(), job = null, hasTTS = "speechSynthesis" in root, voices = { A: null, R: null };
  audio.preload = "none";

  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
  function ls(v) { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { return null; } }
  function pickVoices() {
    if (!hasTTS) return;
    var zh = root.speechSynthesis.getVoices().filter(function (v) { return /zh[-_]TW|Taiwan|臺灣|台灣/i.test(v.lang + " " + v.name); });
    voices.A = zh.filter(function (v) { return /YunJhe|Zhiwei|Male|男/i.test(v.name); })[0] || zh[0] || null;
    voices.R = zh.filter(function (v) { return /HsiaoYu|HsiaoChen|Mei-?Jia|Female|女/i.test(v.name); })[0] || zh[1] || zh[0] || null;
  }
  if (hasTTS) { pickVoices(); root.speechSynthesis.onvoiceschanged = pickVoices; }

  function ready() {
    loading = loading || fetch(BASE + "script.json").then(function (r) { return r.json(); }).then(function (d) {
      var A = root.Atlas;
      doc = d.sites && A && A.meta && d.sites.generated === A.meta.generated && d.sites.total === A.sites.length ? d : null;
      return !!doc;
    }).catch(function () { return false; });
    return loading;
  }
  function track(id) { return doc && doc.tracks[id]; }
  function synced(t) {
    if (!t.cues || t.cues.length !== t.lines.length) return false;
    for (var k = 0; k < t.lines.length; k++) if (t.cues[k][2] !== fnv(t.lines[k].text)) return false;
    return true;
  }
  function stop() {
    var j = job; job = null;
    if (j && j.timer) clearTimeout(j.timer);
    audio.pause(); audio.ontimeupdate = audio.onended = audio.onerror = null;
    if (hasTTS) root.speechSynthesis.cancel();
  }
  function play(id, o) {
    stop();
    var t = track(id); if (!t) { if (o.onEnd) o.onEnd(); return; }
    var from = o.from || 0, to = o.to == null ? t.lines.length - 1 : o.to, me = job = { k: -1 };
    var line = function (k) { if (job !== me || me.k === k) return; me.k = k; if (o.onLine) o.onLine(k, t.lines[k]); };
    var done = function () { if (job !== me) return; stop(); if (o.onEnd) o.onEnd(); };
    var fallback = function (k) {                       /* 瀏覽器內建語音，或只依字數計時 */
      if (job !== me) return;
      if (k > to) return done();
      line(k);
      var L = t.lines[k];
      if (hasTTS && voices.A) {
        var u = new SpeechSynthesisUtterance(L.text); u.lang = "zh-TW"; u.voice = voices[L.who] || voices.A;
        if (L.who === "R") u.pitch = 1.5;
        u.onend = u.onerror = function () { fallback(k + 1); };
        root.speechSynthesis.speak(u);
      } else me.timer = setTimeout(function () { fallback(k + 1); }, 900 + L.text.length * 230);
    };
    if (!synced(t)) return fallback(from);
    if (audio.src.indexOf(BASE + id + ".mp3") < 0) audio.src = BASE + id + ".mp3";   /* 同一段語音不要重新載入 */
    audio.ontimeupdate = function () {
      if (job !== me) return;
      var c = audio.currentTime;
      if (c >= t.cues[to][1]) return done();
      for (var k = to; k >= from; k--) if (t.cues[k][0] <= c + 0.05) { line(k); break; }
    };
    audio.onended = done;
    audio.onerror = function () { audio.onerror = null; fallback(Math.max(from, me.k)); };
    var go = function () { try { audio.currentTime = t.cues[from][0]; } catch (e) { /* 略過 */ } line(from); var p = audio.play(); if (p && p.catch) p.catch(function () { audio.onerror && audio.onerror(); }); };
    if (audio.readyState >= 1) go(); else { audio.onloadedmetadata = function () { audio.onloadedmetadata = null; go(); }; audio.load(); }
  }

  root.Narration = {
    ready: ready, play: play, stop: stop, track: track,
    on: function () { return ls() !== "0"; }, set: function (v) { ls(v ? "1" : "0"); if (!v) stop(); },
    playing: function () { return !!job; }
  };
})(this);
