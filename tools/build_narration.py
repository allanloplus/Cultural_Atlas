#!/usr/bin/env python3
"""產生雙人語音旁白（Allan × 阿拉蕾）：data/narration/script.json 與 data/narration/<track>.mp3

四個分頁都有：3D 文資島的導覽（tour1–8）與「島怎麼長出來」（grow），
時間軸（tl1–）、挺過了什麼（sv1–）、風險地圖（rk1–）的「說故事」。
劇本裡的數字由資料算出，算法與網頁相同：island.js 的 STOPS，timeline.js、survived.js、risk.js 的 STORY；
網頁會比對 script.json 的 sites（資料產生日期與處數），和目前的 data/sites.json 不一致時就不播語音，只顯示文字。
所以 data/sites.json 或 data/terrain/sites-elev.json、data/survived.json、data/risk.json 有變動時，要重跑這支腳本。

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
import re
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


def first(t):
    """最多的那一個；同數時取鍵比較小的（和網頁的排序一致）"""
    return min(t, key=lambda k: (-t[k], k))


def story_facts():
    """三個平面分頁「說故事」的事實，算法與各圖層 js 的 STORY 相同"""
    S = load("data/sites.json")
    F = S["meta"]["fields"]
    sites = [dict(zip(F, r), i=i) for i, r in enumerate(S["sites"])]
    eras, cats, cty = S["eras"], S["cats"], S["counties"]
    cn = lambda s: cty[s["county"]]["name"]
    cid = lambda s: cats[s["cat"]]["id"]
    f = {}
    # ---- 時間軸 ----
    o = min(sites, key=lambda s: (s["year"], s["i"]))
    L = [s for s in sites if s["year"] < 1624]
    t = tally(L, lambda s: s["county"])
    k = first(t)
    f["tl1"] = dict(o=o["name"], oc=cn(o), oy=o["year"], n=len(L), c=cty[k]["name"], cn=t[k])
    L = [s for s in sites if 1624 <= s["year"] <= 1661]
    t = tally(L, cn)
    f["tl2"] = dict(all=sum(1 for s in sites if s["year"] <= 1661), n=len(L), tn=t.get("臺南市", 0), km=t.get("金門縣", 0), nn=t.get("基隆市", 0) + t.get("新北市", 0))
    L = [s for s in sites if 1684 <= s["year"] <= 1894]
    t = tally(L, lambda s: s["county"])
    f["tl3"] = dict(all=sum(1 for s in sites if s["year"] <= 1894), n=len(L), top=[(cty[k]["name"], t[k]) for k in sorted(t, key=lambda k: (-t[k], k))[:4]])
    te = tally(sites, lambda s: s["era"])
    L = [s for s in sites if eras[s["era"]]["id"] == "japan"]
    f["tl4"] = dict(all=sum(1 for s in sites if s["year"] <= 1945), n=len(L), pct=jround(len(L) / len(sites) * 100), b=sum(1 for s in L if cid(s) == "building"),
                    most=eras[first(te)]["id"] == "japan")
    L = [s for s in sites if s["announced"] and s["announced"] < "2000"]
    fd = S["meta"]["announcedMin"]
    f["tl5"] = dict(n=len(L), g=sum(1 for s in L if cid(s) in ("national", "local")), first=fd, fn=sum(1 for s in sites if s["announced"] == fd),
                    names=[s["name"] for s in sites if s["announced"] == fd])
    L = [s for s in sites if s["announced"] and s["announced"] >= "2000"]
    t = tally(L, lambda s: int(s["announced"][:4]))
    y = first(t)
    f["tl6"] = dict(n=len(L), b=sum(1 for s in L if cid(s) == "building"), y=y, yn=t[y])
    # ---- 挺過了什麼（推估） ----
    V = load("data/survived.json")
    Q = V["quakes"]
    yr = lambda q: int(q["date"][:4])
    order = [q for q in Q if q["method"] != "none"]
    lv = [[int(q["levels"][s["i"]]) if yr(q) >= s["year"] else 0 for q in order] for s in sites]
    mx = [max(x) if x else 0 for x in lv]
    f["sv1"] = dict(q=len(order), n5=sum(1 for v in mx if v >= 5), n7=sum(1 for v in mx if v >= 7), n9=sum(1 for v in mx if v >= 9))
    for key, qid in (("sv2", "cwa006"), ("sv3", "cwa111"), ("sv4", "usgsus7000m9g4")):
        q = [x for x in Q if x["id"] == qid][0]
        c = [int(q["levels"][s["i"]]) for s in sites if s["year"] <= yr(q)]
        f[key] = dict(m=q["m"], date=q["date"], ex=len(c), n6=sum(1 for x in c if x >= 6), n7=sum(1 for x in c if x >= 7))
    cnt = [sum(1 for x in row if x >= 6) for row in lv]
    b = max(range(len(sites)), key=lambda i: (cnt[i], -i))
    f["sv5"] = dict(name=sites[b]["name"], c=cn(sites[b]), n=cnt[b])
    T = V["typhoons"]
    L = [s for s in sites if T[s["i"]][2] >= 65]
    t = tally(L, lambda s: s["county"])
    k = first(t)
    f["sv6"] = dict(km=V["meta"]["typhoonKm"], n=len(L), c=cty[k]["name"], cn=t[k], mx=max(x[2] for x in T))
    # ---- 風險地圖（圖資套疊，僅供防災參考） ----
    R = load("data/risk.json")

    def lab(i):
        r, o = R["sites"][i], dict(fault=0, debris=0, landslide=0, flood=0)
        if r[0]:
            o["fault"] = 2 if r[0][1] <= 100 else 1 if r[0][1] <= 500 else 0
        if r[1]:
            o["debris"] = 2 if r[1][0] == 1 else 1 if r[1][3] <= 200 else 0
        if r[2]:
            o["landslide"] = r[2][0]
        o["flood"] = 1 if r[3][1] >= 3 else 0
        o["n"] = sum(1 for x in ("fault", "debris", "landslide") if o[x]) + o["flood"]
        return o
    lb = [lab(i) for i in range(len(sites))]
    L = [s for s in sites if lb[s["i"]]["n"] >= 1]
    M = [s for s in L if lb[s["i"]]["n"] >= 2]
    t = tally(M, lambda s: cn(s) + (s["town"] or ""))
    k = first(t)
    TT = [s for s in M if cn(s) + (s["town"] or "") == k]
    kinds = [nm for key, nm in (("flood", "淹水潛勢"), ("fault", "活動斷層"), ("debris", "土石流"), ("landslide", "大規模崩塌")) if all(lb[s["i"]][key] for s in TT)]
    f["rk1"] = dict(n=len(L), m=len(M), place=k, pn=t[k], kinds=kinds)

    def flood(sc):
        L = [s for s in sites if R["sites"][s["i"]][3][sc] >= 3]
        t = tally(L, cn)
        k = first(t)
        return dict(n=len(L), c=k, cn=t[k])
    f["rk2"] = dict(a=flood(1), b=flood(2))
    L = [s for s in sites if lb[s["i"]]["fault"]]
    fn = lambda s: R["faults"][R["sites"][s["i"]][0][0]]
    t = tally(L, fn)
    k = first(t)
    near = min(L, key=lambda s: (R["sites"][s["i"]][0][1], s["i"]))
    f["rk3"] = dict(n=len(L), n1=sum(1 for s in L if lb[s["i"]]["fault"] == 2), f=k, fn=t[k], near=near["name"], nd=R["sites"][near["i"]][0][1], nf=fn(near))
    L = [s for s in sites if lb[s["i"]]["debris"]]
    t = tally(L, cn)
    k = first(t)
    f["rk4"] = dict(n=len(L), n2=sum(1 for s in L if lb[s["i"]]["debris"] == 2), c=k, cn=t[k])
    f["rk5"] = dict(names=[s["name"] for s in sites if lb[s["i"]]["landslide"]])
    return f


def ymd(d):
    y, m, dd = d.split("-")
    return "%d年%d月%d日" % (int(y), int(m), int(dd))


def story_script(f):
    A, Rr = "A", "R"
    T = {}
    d = f["tl1"]
    when = "西元前大約%s年" % n(jround(-d["oy"] / 100) * 100) if d["oy"] < -3000 else "西元前%s年" % n(-d["oy"]) if d["oy"] < 0 else "%d年" % d["oy"]
    T["tl1"] = [
        (Rr, "Allan，地圖上的點點，怎麼一開始只有零零星星的？"),
        (A, "因為我們從最早的時候開始看。全臺最老的文資，是%s的%s，年代是%s。" % (d["oc"], d["o"], when)),
        (Rr, "哇，比阿拉蕾阿公的阿公還要老好多！"),
        (A, "1624年以前的文資一共有%d處，最多的在%s，有%d處。" % (d["n"], d["c"], d["cn"]) + ("金門從宋朝、明朝就有家廟、古厝和墓。" if d["c"] == "金門縣" else "")),
        (Rr, "原來在荷蘭人來之前，就已經有很多故事了！"),
        (A, "沒錯。按下播放，就能看它們一處一處亮起來。"),
    ]
    d = f["tl2"]
    T["tl2"] = [
        (Rr, "地圖跑到臺南了！1624年發生了什麼事？"),
        (A, "1624年荷蘭人在大員，也就是今天的安平築城。1624到1661年之間出現的文資有%d處，臺南就有%d處。" % (d["n"], d["tn"])),
        (Rr, "那其他的在哪裡？"),
        (A, "金門有%d處，北邊的基隆和新北有%d處，像淡水紅毛城，最早就是西班牙人蓋的城堡。" % (d["km"], d["nn"])),
        (Rr, "到1661年，地圖上一共亮了幾處？"),
        (A, "%d處。下一段，點點會沿著西部一路亮上去。" % d["all"]),
    ]
    d = f["tl3"]
    tp = d["top"]
    T["tl3"] = [
        (Rr, "哇，西部亮成一整排了！"),
        (A, "這是清領時期，從1684年到1894年。這段時間出現的文資有%d處，到1894年，地圖上一共亮了%d處。" % (d["n"], d["all"])),
        (Rr, "哪裡最多？臺南嗎？"),
        (A, ("答案有點意外：" if tp[0][0] != "臺南市" else "") + "最多的是%s，有%d處，接下來是%s。" % (tp[0][0], tp[0][1], "、".join("%s%d處" % x for x in tp[1:]))),
        (Rr, "廟、書院、老街，原來很多是那時候蓋的。"),
        (A, "對，漢人移墾從南往北、從平原往丘陵走，寺廟和宅第也跟著蓋起來。"),
    ]
    d = f["tl4"]
    T["tl4"] = [
        (Rr, "一下子亮了好多好多！"),
        (A, "日治時期的文資有%s處，占全部的%d%%%s。" % (n(d["n"]), d["pct"], "，是最多的一個時期" if d["most"] else "")),
        (Rr, "為什麼這麼多？"),
        (A, "鐵路、糖廠、學校、官舍和宿舍蓋遍全臺，年代也比較近，留下來的比較多。其中%s處是歷史建築。" % n(d["b"])),
        (Rr, "到1945年，地圖上一共有幾處？"),
        (A, "%s處。接下來換個角度，看它們是什麼時候變成文資的。" % n(d["all"])),
    ]
    d = f["tl5"]
    famous = [x for x in ("赤嵌樓", "淡水紅毛城") if x in d["names"]]
    T["tl5"] = [
        (Rr, "咦，顏色換了！這次是在看什麼？"),
        (A, "這是公告日期，也就是政府正式指定或登錄成文化資產的那一天。1982年《文化資產保存法》公布，臺灣開始有保護古蹟的法律。"),
        (Rr, "第一批是什麼時候？"),
        (A, "%s，一共%d處%s。" % (ymd(d["first"]), d["fn"], ("，像" + "、".join(famous) + "都在第一批裡") if famous else "")),
        (Rr, "那2000年以前，一共有幾處？"),
        (A, ("%d處，全部是古蹟，那時候還沒有歷史建築這個類別。" % d["n"]) if d["g"] == d["n"] else "%d處，其中%d處是古蹟。那時候還沒有歷史建築這個類別。" % (d["n"], d["g"])),
    ]
    d = f["tl6"]
    T["tl6"] = [
        (Rr, "2000年以後，點點像下雨一樣冒出來！"),
        (A, "九二一地震震壞了很多老房子，2000年修法加了歷史建築，登錄的門檻比古蹟低，保存的速度就快了起來。"),
        (Rr, "那後來有多少處？"),
        (A, "2000年以後公告的有%s處，其中%s處是歷史建築。最多的一年是%d年，一共%d處。" % (n(d["n"]), n(d["b"]), d["y"], d["yn"])),
        (Rr, "所以一處老房子變成文資，背後也有一段故事！"),
        (A, "說得好。拉動下面的滑桿，可以自己找找看，你家附近的文資是哪一年亮起來的。"),
    ]
    d = f["sv1"]
    T["sv1"] = [
        (Rr, "Allan，這些點點為什麼有黃有紅？"),
        (A, "顏色是每處文資從創建到現在，推估遇過最大的地震搖晃。我們對照了%d個災害地震。" % d["q"]),
        (Rr, "有很多被搖得很厲害嗎？"),
        (A, "推估有%s處遇過5弱以上，%d處遇過6弱以上，還有%d處遇過7級。" % (n(d["n5"]), d["n7"], d["n9"])),
        (Rr, "等等，推估是說不是真的量到的嗎？"),
        (A, "對，這是用地震的規模、位置和公式算出來的，不是當時的觀測紀錄，實際可能更強或更弱。我們一個一個地震來看。"),
    ]
    d = f["sv2"]
    T["sv2"] = [
        (Rr, "這個地震好久以前喔！"),
        (A, "1906年的梅山地震，規模%s，震央在嘉義。那時候已經存在的文資有%d處。" % (d["m"], d["ex"])),
        (Rr, "它們搖得厲害嗎？"),
        (A, "推估有%d處搖到5強以上。這麼早的地震，觀測資料很少，這是用公式估算的，誤差會比較大。" % d["n6"]),
        (Rr, "一百多年前的地震，老房子還站在這裡，好厲害！"),
        (A, "很多是震後修復或重建的，所以「遇過」不代表原樣保存到今天。"),
    ]
    d = f["sv3"]
    T["sv3"] = [
        (Rr, "這個我知道！九二一大地震！"),
        (A, "1999年9月21日的集集地震，規模%s。當時已經存在的%s處文資，推估有%d處搖到5強以上。" % (d["m"], n(d["ex"]), d["n6"])),
        (Rr, "%d處！那更強的呢？" % d["n6"]),
        (A, "其中%d處推估達到6弱以上。這場地震也讓大家發現，很多老房子沒有法律保護。" % d["n7"]),
        (Rr, "所以後來才有歷史建築？"),
        (A, "沒錯，隔年修法增加了歷史建築，在時間軸那一頁也看得到。"),
    ]
    d = f["sv4"]
    T["sv4"] = [
        (Rr, "這個地震是最近的耶！"),
        (A, "2024年4月3日的花蓮地震，規模%s。推估有%d處文資搖到5強以上，%d處達6弱以上。" % (d["m"], d["n6"], d["n7"])),
        (Rr, "花蓮的文資好辛苦。"),
        (A, "花東在板塊交界，地震特別多。下一段，我們去看最常被搖的那一處。"),
    ]
    d = f["sv5"]
    T["sv5"] = [
        (Rr, "全臺灣被搖最多次的文資是哪一處？"),
        (A, "推估是%s的%s，創建以來有%d次搖到5強以上。" % (d["c"], d["name"], d["n"])),
        (Rr, "%d次！它好勇敢。" % d["n"]),
        (A, "再提醒一次，這是用公式推估的次數。點地圖上的文資，卡片上可以看到它遇過哪些地震。"),
    ]
    d = f["sv6"]
    T["sv6"] = [
        (Rr, "換成藍色了，這次是颱風嗎？"),
        (A, "對。顏色是每處文資創建以來，有幾個颱風強度的熱帶氣旋，中心從%d公里內經過。" % d["km"]),
        (Rr, "哪裡最常被颱風掃到？"),
        (A, "有%d處文資遇過65個以上，最多的是%s，有%d處。最多的一處遇過%d個。" % (d["n"], d["c"], d["cn"], d["mx"])),
        (Rr, "原來文資每年都在跟颱風搏鬥！"),
        (A, "這些也都是推估。故事講到這裡，點任何一處文資，都能看它挺過了什麼。"),
    ]
    d = f["rk1"]
    T["rk1"] = [
        (Rr, "Allan，這一頁的點點在說什麼？"),
        (A, "我們把每處文資的位置，疊到政府公開的災害潛勢圖上，看它附近有沒有淹水、活動斷層、土石流和大規模崩塌的潛勢。"),
        (Rr, "有很多文資在要注意的地方嗎？"),
        (A, "有%d處至少有一項標籤，%d處有兩項，最集中的是%s，有%d處%s。" % (d["n"], d["m"], d["place"], d["pn"], ("，都同時有" + "和".join(d["kinds"]) + "標籤") if len(d["kinds"]) == 2 else "")),
        (Rr, "那它們一定會受災嗎？"),
        (A, "不一定。這是圖資套疊的結果，只能當作防災的參考，不是每一棟建築的風險評估。"),
    ]
    d = f["rk2"]
    a, b = d["a"], d["b"]
    T["rk2"] = [
        (Rr, "藍色的點是會淹水的地方嗎？"),
        (A, "這是24小時下500毫米雨的情境。淹水0.5公尺以上的文資有%d處，最多的是%s，有%d處。" % (a["n"], a["c"], a["cn"])),
        (Rr, "雨下得更大會怎樣？"),
        (A, "下到650毫米時，增加到%d處，最多的%s%s，有%d處。" % (b["n"], "還是" if b["c"] == a["c"] else "變成", b["c"], b["cn"])),
        (Rr, "原來雨越大，要注意的文資越多。"),
        (A, "要特別說明，淹水潛勢圖依規定只能用在防救災，不能拿來管制土地使用或限制開發。"),
    ]
    d = f["rk3"]
    T["rk3"] = [
        (Rr, "這些紅線是什麼？"),
        (A, "紅線是活動斷層。離斷層500公尺內的文資有%d處，100公尺內有%d處。" % (d["n"], d["n1"])),
        (Rr, "哪一條斷層旁邊最多？"),
        (A, "%s沿線最多，有%d處。最近的是%s，離%s大約%d公尺。" % (d["f"], d["fn"], d["near"], d["nf"], d["nd"])),
        (Rr, "%d公尺？好近喔！" % d["nd"]),
        (A, "不過斷層線本身的位置也有誤差，而且這些距離門檻是我們自己訂的，不是法定的地質敏感區。"),
    ]
    d = f["rk4"]
    T["rk4"] = [
        (Rr, "棕色的線是河嗎？"),
        (A, "是土石流潛勢溪流。在土石流影響範圍內，或離潛勢溪流200公尺內的文資有%d處，其中%d處在影響範圍裡。" % (d["n"], d["n2"])),
        (Rr, "哪裡最多？"),
        (A, "最多的是%s，有%d處。" % (d["c"], d["cn"])),
        (Rr, "下大雨的時候，山邊的文資要小心。"),
        (A, "對，颱風和豪雨來的時候，大家也要注意自己的安全。"),
    ]
    d = f["rk5"]
    T["rk5"] = [
        (Rr, "最後一個是大規模崩塌？"),
        (A, "對。落在大規模崩塌潛勢區或影響範圍內的文資有%d處：%s。" % (len(d["names"]), "、".join(re.sub(r"(\d)-(\d)", r"\1到\2", x) for x in d["names"]))),
        (Rr, "只有%d處，比我想的少。" % len(d["names"])),
        (A, "因為這份圖資主要畫的是山區聚落附近。再提醒一次，這些都是圖資套疊的結果，僅供防災參考。點任何一處文資，都能看它的標籤。"),
    ]
    return T


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
    T.update(story_script(story_facts()))
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
    doc = {"note": "雙人語音旁白：3D 文資島的導覽與「島怎麼長出來」，以及時間軸、挺過了什麼、風險地圖的說故事（tools/build_narration.py 產生）。cues：每句的起訖秒數與文字雜湊；sites：產生時的文資資料，與網頁目前的資料不同時不播語音。",
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
