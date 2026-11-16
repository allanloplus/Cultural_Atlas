#!/usr/bin/env python3
"""產生 3D 文資島的雙人語音導覽（Allan × 阿拉蕾）：data/narration/script.json 與 data/narration/<track>.mp3

劇本裡的數字由資料算出，算法與 assets/js/layers/island.js 的導覽（STOPS）相同；
網頁會比對 script.json 的 sites（資料產生日期與處數），和目前的 data/sites.json 不一致時就不播語音，只顯示文字。
所以 data/sites.json 或 data/terrain/sites-elev.json、data/survived.json 有變動時，要重跑這支腳本。

語音沿用知識網站（Cultural_Heritage/tools/gen_audio.py）的設定：
  Allan：zh-TW-YunJheNeural；阿拉蕾：zh-TW-HsiaoYuNeural 提高音調
  只會重新合成內容有變動的句子（快取在 .cache/tts/，不進 repo）。

用法：pip install edge-tts；需要 ffmpeg
      python3 tools/build_narration.py            （--text 只更新劇本、不合成語音）
"""
import asyncio
import hashlib
import json
import math
import os
import random
import ssl
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "narration")
CACHE = os.path.join(ROOT, ".cache", "tts")
VOICE = {
    "A": dict(voice="zh-TW-YunJheNeural", pitch="+0Hz", rate="+0%"),
    "R": dict(voice="zh-TW-HsiaoYuNeural", pitch="+55Hz", rate="+6%"),
}
RATE, GAP, BITRATE = 24000, 0.35, "32k"


def load(p):
    return json.load(open(os.path.join(ROOT, p), encoding="utf-8"))


def km(a, b):
    p = math.pi / 180
    h = math.sin((b["lat"] - a["lat"]) * p / 2) ** 2 + math.cos(a["lat"] * p) * math.cos(b["lat"] * p) * math.sin((b["lng"] - a["lng"]) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def jround(x):
    """JavaScript 的 Math.round"""
    return math.floor(x + 0.5)


def tally(lst, f):
    t = {}
    for s in lst:
        t[f(s)] = t.get(f(s), 0) + 1
    return t


def top(t):
    return max(t, key=lambda k: t[k])


def facts():
    S = load("data/sites.json")
    F = S["meta"]["fields"]
    sites = [dict(zip(F, r), i=i) for i, r in enumerate(S["sites"])]
    E = load("data/terrain/sites-elev.json")
    V = load("data/survived.json")
    eras, cats, cty = S["eras"], S["cats"], S["counties"]
    h = E["h"]
    f = {"N": len(sites), "eras": eras, "cats": cats}
    hs = sorted(h)
    f["med"], f["hi"], f["land500"] = hs[len(hs) >> 1], sum(1 for x in h if x > 500), round(E["landShare"]["over500"] * 100)
    L = [s for s in sites if km(s, {"lat": 22.9975, "lng": 120.2025}) <= 1]
    f["tn"] = (len(L), tally(L, lambda s: s["era"]))
    g = {}
    for s in sites:
        g.setdefault((jround(s["lat"] / 0.009), jround(s["lng"] / 0.0099)), []).append(s)
    L = max(g.values(), key=len)
    f["dense"] = dict(n=len(L), county=cty[L[0]["county"]]["name"], cat=tally(L, lambda s: s["cat"]), era=tally(L, lambda s: s["era"]), names=[s["name"] for s in L[:2]])
    L = sorted([s for s in sites if h[s["i"]] >= 2000 and 120.7 < s["lng"] < 120.9 and 23.4 < s["lat"] < 23.6], key=lambda s: -h[s["i"]])
    hi1000 = [s for s in sites if h[s["i"]] >= 1000]
    f["ali"] = dict(n=len(L), name=L[0]["name"] if L else "", m=len(hi1000), j=sum(1 for s in hi1000 if eras[s["era"]]["id"] == "japan"))
    L = [s for s in sites if 121.25 < s["lng"] < 122 and 22.3 < s["lat"] < 24.45]
    t = tally(L, lambda s: eras[s["era"]]["id"])
    f["east"] = dict(n=len(L), qing=t.get("qing", 0), japan=t.get("japan", 0), post=t.get("postwar", 0))
    q = [x for x in V["quakes"] if x["date"] == "1999-09-21"][0]
    n6 = n5 = 0
    for s in sites:
        if s["year"] > 1999:
            continue
        c = int(q["levels"][s["i"]])
        if c >= 8:
            n6 += 1
        elif c >= 6:
            n5 += 1
    f["chichi"] = dict(m=q["m"], n6=n6, n5=n5)
    k = [c["name"] for c in cty].index("金門縣")
    L = [s for s in sites if s["county"] == k]
    t = tally(L, lambda s: s["cat"])
    f["km"] = dict(n=len(L), cat=cats[top(t)]["name"], x=t[top(t)])
    best, bd = None, 0
    for s in sites:
        m = min(km(s, o) for o in sites if o is not s)
        if m > bd:
            best, bd = s, m
    f["lonely"] = dict(name=best["name"], km=jround(bd))
    f["japanShare"] = round(sum(1 for s in sites if eras[s["era"]]["id"] == "japan") / len(sites) * 100)
    f["meta"] = {"generated": S["meta"]["generated"], "total": len(sites)}
    return f


def n(x):
    return "{:,}".format(x)


def script(f):
    E, C = f["eras"], f["cats"]
    tn_n, tn_t = f["tn"]
    tn_list = "、".join("%s%d處" % (E[k]["name"], tn_t[k]) for k in sorted(tn_t))
    d = f["dense"]
    dc, de = top(d["cat"]), top(d["era"])
    A, Rr = "A", "R"
    T = {}
    T["tour1"] = [
        (Rr, "哇，Allan，整座臺灣都站起來了耶！這些柱子是什麼？"),
        (A, "每一根柱子都是一處文化資產，全臺一共%s處。遠看是六角柱，越高代表那一帶的文資越多。" % n(f["N"])),
        (Rr, "我發現了！柱子都擠在海邊跟平原，山上好空喔。"),
        (A, "觀察力滿分！臺灣有%d%%的土地在海拔500公尺以上，可是文資只有%d處在那個高度。" % (f["land500"], f["hi"])),
        (Rr, "才%d處？那其他的文資都住在哪裡？" % f["hi"]),
        (A, "有一半的文資，海拔不到%d公尺。人住在哪裡，文資就跟到哪裡：港口、平原、河邊。" % f["med"]),
        (Rr, "原來文資也怕爬山！走吧，我們去看最早熱鬧起來的地方！"),
    ]
    T["tour2"] = [
        (Rr, "這裡的柱子好多顏色，好像彩虹蛋糕！"),
        (A, "我們在臺南赤嵌樓附近，方圓一公里內就有%d處文資，顏色代表不同的時代。" % tn_n),
        (Rr, "一公里就有%d處？那總共有幾個時代？" % tn_n),
        (A, "%s，%s個時代疊在同一個街區裡。" % (tn_list, "零一二三四五六"[len(tn_t)])),
        (Rr, "所以在這裡散步，就像在翻一本很厚的歷史書！"),
        (A, "說得好！1624年荷蘭人來到大員，這裡後來成了臺灣最早的城市。給大家一個小任務：下次來臺南，找找看同一條街上不同時代的建築。"),
    ]
    T["tour3"] = [
        (Rr, "咦？這裡的柱子擠成一團，好像捷運的尖峰時間！"),
        (A, "這是全臺文資最密的一平方公里，在%s，一共有%d處。" % (d["county"], d["n"])),
        (Rr, "%d處！是誰住在這麼擠的地方？" % d["n"]),
        (A, "最多的是%s，有%d處，而且%s時期的就占了%d處，像%s、%s都在這裡。" % (C[dc]["name"], d["cat"][dc], E[de]["name"], d["era"][de], d["names"][0], d["names"][1])),
        (Rr, "原來老房子也喜歡當鄰居！"),
        (A, "沒錯，來這裡不用坐車，散步就能一口氣看好幾十處。"),
    ]
    a = f["ali"]
    T["tour4"] = [
        (Rr, "好高喔，我的耳朵都要塞住了！"),
        (A, "我們到了阿里山。這裡有%d處文資在海拔大約2000公尺以上，最高的是%s。" % (a["n"], a["name"])),
        (Rr, "為什麼要把房子蓋在這麼高的地方？"),
        (A, "全臺海拔1000公尺以上的文資只有%d處，其中%d處是日治時期留下來的，像是林業、氣象觀測，還有山區的管理設施。" % (a["m"], a["j"])),
        (Rr, "所以是為了木頭和天氣，才爬到雲上面！"),
        (A, "沒錯。不過要提醒大家，這裡的海拔是從地形資料推估的，山區的座標差一點點，高度就可能差很多。"),
    ]
    e = f["east"]
    T["tour5"] = [
        (Rr, "換到東邊了！這邊的柱子顏色好像都差不多耶。"),
        (A, "你發現重點了！花蓮和臺東一共有%d處文資，清領時期只有%d處，日治時期卻有%d處。" % (e["n"], e["qing"], e["japan"])),
        (Rr, "為什麼差這麼多？東部比較晚起床嗎？"),
        (A, "哈哈，可以這麼說。中央山脈擋住了早年的開發，東部的鐵道、移民村和港口，多半是日治以後才出現的。"),
        (Rr, "原來是被大山擋住了！"),
        (A, "現在搭火車沿著花東縱谷走，沿路就能看到這些故事。"),
    ]
    c = f["chichi"]
    T["tour6"] = [
        (Rr, "柱子變成黃色、橘色、紅色，好像在發燒！"),
        (A, "我們來到1999年集集地震的震央附近，規模%s，是臺灣近代最嚴重的地震之一。" % c["m"]),
        (Rr, "那時候已經存在的文資，有很多被震到嗎？"),
        (A, "依照我們的推估，有%d處遇到6強以上的搖晃，還有%d處遇到5強到6弱。" % (c["n6"], c["n5"])),
        (Rr, "等等，推估是什麼意思？不是真的量到的嗎？"),
        (A, "問得好！這是用地震的資料和公式推算出來的，不是當時每一處的觀測紀錄，實際可能更強或更弱。很多文資在震後修復，才能留到今天。"),
    ]
    k = f["km"]
    T["tour7"] = [
        (Rr, "飛到海上了！這座小島的柱子好密！"),
        (A, "這裡是金門，一共有%d處文資，最多的是%s，有%d處。" % (k["n"], k["cat"], k["x"])),
        (Rr, "這麼小的島，怎麼會有這麼多？"),
        (A, "這裡有閩南聚落，有到南洋打拚的人寄錢回鄉蓋的洋樓，還有戰地時期的碉堡和坑道。"),
        (Rr, "原來一座島，同時是家鄉，也是前線。"),
        (A, "沒錯。小任務：下次去金門，數數看一天能逛到幾種不同的建築。"),
    ]
    lo = f["lonely"]
    T["tour8"] = [
        (Rr, "咦，這裡怎麼只有一根柱子？"),
        (A, "這是%s，離最近的另一處文資大約%s公里，是全臺最孤單的一處。" % (lo["name"], n(lo["km"]))),
        (Rr, "%s公里！它一定很想念朋友吧。" % n(lo["km"])),
        (A, "所以我們特地來看它。導覽到這裡結束，按「全島」可以回到臺灣，點任何一根柱子都能看介紹。"),
        (Rr, "下次見！記得到知識網站，聽我們講更多文資的故事喔！"),
    ]
    # 「島怎麼長出來」：at 是觸發的年份，播放到那一年時暫停，講完再繼續
    T["grow"] = [
        (Rr, "Allan，按下播放會發生什麼事？", 1550),
        (A, "時間會往前跑，每處文資在它建造的那一年長出來。現在先出現的，是史前和早期的遺址。", None),
        (Rr, "臺南那邊開始長柱子了！", 1624),
        (A, "1624年荷蘭人來到大員築城，臺灣進入有文字紀錄的時代。", None),
        (A, "1662年鄭成功趕走荷蘭人，明鄭時期開始。", 1662),
        (Rr, "換清朝了！柱子沿著西部平原一路長上去。", 1684),
        (A, "清代的廟宇、書院和城門，大多在西部的平原和港口。", None),
        (A, "1875年以後，清廷開山撫番、開放移民，往山區和東部的路才慢慢打開。", 1875),
        (Rr, "哇，一下子冒出好多柱子！", 1895),
        (A, "1895年進入日治時期，鐵道、學校和官舍一口氣蓋起來，現存的文資有%d%%是這個時期留下的。" % f["japanShare"], None),
        (A, "戰後的眷村、工廠和公共建築，也陸續成了文資。", 1946),
        (Rr, "1982年發生什麼事？", 1982),
        (A, "《文化資產保存法》公布了，從那時候起，這些老房子有了法律的保護。", None),
        (Rr, "全部長出來了！一共%s處耶！" % n(f["N"]), 2026),
        (A, "這就是臺灣一步一步長出來的樣子。", None),
    ]
    out = {}
    for tid, lines in T.items():
        out[tid] = {"lines": [dict({"who": l[0], "text": l[1]}, **({"at": l[2]} if len(l) > 2 and l[2] is not None else {})) for l in lines]}
    return out


def fnv(text):
    """與網頁相同的 FNV-1a（UTF-16 碼元），用來確認語音檔與文字一致。"""
    h = 0x811C9DC5
    b = text.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "x")


def key(who, text):
    return hashlib.sha1(json.dumps([VOICE[who], text], ensure_ascii=False).encode()).hexdigest()[:16]


async def synth(who, text, sem):
    import edge_tts
    import edge_tts.communicate as C
    if os.environ.get("TTS_CA_BUNDLE"):   # 經過代理時使用其 CA
        C._SSL_CTX = ssl.create_default_context(cafile=os.environ["TTS_CA_BUNDLE"])
        C._SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT
    path = os.path.join(CACHE, key(who, text) + ".wav")
    if os.path.exists(path):
        return path
    v = VOICE[who]
    async with sem:
        for attempt in range(40):
            try:
                mp3 = path[:-4] + ".mp3"
                await edge_tts.Communicate(text, v["voice"], pitch=v["pitch"], rate=v["rate"], proxy=os.environ.get("HTTPS_PROXY")).save(mp3)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ac", "1", "-ar", str(RATE), "-sample_fmt", "s16", path], check=True)
                os.remove(mp3)
                return path
            except Exception as e:  # 語音服務偶爾回傳空白或限流，等一下重試
                print("  重試", attempt, text[:16], e, file=sys.stderr)
                await asyncio.sleep(2 + random.random() * 3)
    raise RuntimeError("語音合成失敗：" + text[:40])


def pack(name, lines, paths):
    gap = b"\x00\x00" * int(RATE * GAP)
    frames, cues, t = [], [], 0.0
    for it, p in zip(lines, paths):
        with wave.open(p) as w:
            data = w.readframes(w.getnframes())
        dur = len(data) / 2 / RATE
        cues.append([round(t, 3), round(t + dur, 3), fnv(it["text"])])
        frames += [data, gap]
        t += dur + GAP
    wav = os.path.join(CACHE, name + ".all.wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(frames))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", BITRATE, "-ac", "1", "-ar", str(RATE), os.path.join(OUT, name + ".mp3")], check=True)
    os.remove(wav)
    return cues, round(t, 1)


async def main():
    f = facts()
    tracks = script(f)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(OUT, "script.json")
    old = json.load(open(path, encoding="utf-8"))["tracks"] if os.path.exists(path) else {}
    sem = asyncio.Semaphore(3)
    for tid, tr in tracks.items():
        o = old.get(tid)
        if o and o.get("cues") and [c[2] for c in o["cues"]] == [fnv(l["text"]) for l in tr["lines"]] and os.path.exists(os.path.join(OUT, tid + ".mp3")):
            tr["cues"], tr["duration"] = o["cues"], o["duration"]
            continue
        if "--text" in sys.argv:
            continue
        paths = await asyncio.gather(*[synth(l["who"], l["text"], sem) for l in tr["lines"]])
        tr["cues"], tr["duration"] = pack(tid, tr["lines"], paths)
        print("  %s：%d 句，%.0f 秒" % (tid, len(tr["lines"]), tr["duration"]), flush=True)
    doc = {"note": "3D 文資島的雙人語音導覽（tools/build_narration.py 產生）。cues：每句的起訖秒數與文字雜湊；sites：產生時的文資資料，與網頁目前的資料不同時不播語音。",
           "sites": f["meta"], "tracks": tracks}
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(doc, fp, ensure_ascii=False, indent=1)
    for fn in os.listdir(OUT):
        if fn.endswith(".mp3") and fn[:-4] not in tracks:
            os.remove(os.path.join(OUT, fn))
    total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print("完成：data/narration/，共 %.1f MB" % (total / 1048576))


if __name__ == "__main__":
    asyncio.run(main())
