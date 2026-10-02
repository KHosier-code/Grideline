"""Turn sweep.py's output into the robustness tables and a self-contained HTML results page.

Usage: report.py <out dir from sweep.py> <page.html>
Writes <out dir>/survivors.json and the page.
"""
import html
import json
import sys

import numpy as np
import pandas as pd

OUT, PAGE = sys.argv[1], sys.argv[2]
d = json.load(open(f"{OUT}/sweep_results.json"))
games = pd.read_parquet(f"{OUT}/eval_games.parquet")
algos = d["algorithms"]
BE = d["breakEven"]


def wl(r):
    return (r["w"], r["l"]) if r else (0, 0)


def pct(r):
    return r["pct"] if r and r["pct"] is not None else None


# ---------------------------------------------------------------- the opener-disagreement signal, checked several ways
g = games.dropna(subset=["open_line"]).copy()
g["gap"] = g.epa_rating - g.open_line
g["qb_change"] = (g.home_qb_new == 1) | (g.away_qb_new == 1)


def record(sub, cover_col):
    res = np.sign(sub[cover_col]) * np.sign(sub.gap)
    w, l = int((res > 0).sum()), int((res < 0).sum())
    return {"w": w, "l": l, "pct": round(w / (w + l), 4) if w + l else None}


g["cover_open"] = g.margin - g.open_line
g["cover_close"] = g.margin - g.spread_line
signal = []
for t in [2, 3, 4, 5, 6]:
    s = g[g.gap.abs() >= t]
    signal.append({
        "gap": t,
        **{str(y): record(s[s.season == y], "cover_open") for y in (2023, 2024, 2025, 2026)},
        "all": record(s, "cover_open"),
        "noQbChange": record(s[~s.qb_change], "cover_open"),
        "qbChange": record(s[s.qb_change], "cover_open"),
        "atClose": record(s, "cover_close"),
    })
json.dump({"openerGapSignal": signal}, open(f"{OUT}/survivors.json", "w"), indent=1)

# ---------------------------------------------------------------- compact rows for the page
rows = []
for a in algos:
    def rec(label, key):
        r = a.get(f"{label}_{key}")
        return [r["w"], r["l"], r["pct"]] if r and r["pct"] is not None else None
    rows.append({
        "id": a["id"], "name": a["name"], "family": a["family"], "kind": a["kind"], "usesClose": a["usesClose"],
        **{f"{lab}_{k}": rec(lab, k) for lab in ("close", "open", "close2", "open2") for k in ("select", "holdout", "live")},
        **{f"{lab}_adj": a.get(f"{lab}_adj_p") for lab in ("close", "open", "close2", "open2")},
        "mae_select": a.get("mae_select"), "mae_holdout": a.get("mae_holdout"),
        "su_select": a.get("su_select"), "su_holdout": a.get("su_holdout"),
        "clv_select": (a.get("clv_select") or {}).get("toward"), "clv_holdout": (a.get("clv_holdout") or {}).get("toward"),
    })


def top_then_holdout(label, min_sel, k=10):
    pool = [r for r in rows if r[f"{label}_select"] and r[f"{label}_select"][0] + r[f"{label}_select"][1] >= min_sel]
    pool.sort(key=lambda r: -r[f"{label}_select"][2])
    top = pool[:k]
    sw = sum(r[f"{label}_select"][0] for r in top); sl = sum(r[f"{label}_select"][1] for r in top)
    hw = sum(r[f"{label}_holdout"][0] for r in top if r[f"{label}_holdout"]); hl = sum(r[f"{label}_holdout"][1] for r in top if r[f"{label}_holdout"])
    return sw / (sw + sl), hw / (hw + hl)


top_close = top_then_holdout("close", 100)
top_open = top_then_holdout("open", 100)
margin = [a for a in algos if a["kind"] == "margin"]
no_close = [a for a in margin if not a["usesClose"]]
best_mae = min(no_close, key=lambda a: a["mae_select"])
best_su = max(no_close, key=lambda a: a["su_select"])
eligible_close = [r for r in rows if r["close_select"] and r["close_select"][0] + r["close_select"][1] >= 100]
best_close = max(eligible_close, key=lambda r: r["close_select"][2])
above_be_close = sum(1 for r in eligible_close if r["close_select"][2] > BE)
s4 = next(s for s in signal if s["gap"] == 4)
s3 = next(s for s in signal if s["gap"] == 3)

families = {}
for r in rows:
    f = families.setdefault(r["family"], {"family": r["family"], "count": 0, "cs": [], "ch": [], "os": [], "oh": []})
    f["count"] += 1
    for key, col in (("cs", "close_select"), ("ch", "close_holdout"), ("os", "open_select"), ("oh", "open_holdout")):
        if r[col] and r[col][0] + r[col][1] >= 100:
            f[key].append(r[col][2])
fam_rows = []
for f in families.values():
    fam_rows.append({"family": f["family"], "count": f["count"],
                     **{k: (round(float(np.mean(f[k])), 4) if f[k] else None) for k in ("cs", "ch", "os", "oh")},
                     **{f"{k}_max": (round(float(np.max(f[k])), 4) if f[k] else None) for k in ("cs", "os")}})
fam_rows.sort(key=lambda f: -f["count"])

payload = {
    "rows": rows, "families": fam_rows, "signal": signal, "breakEven": BE, "nullMax": d["nullMax"],
    "lineMae": d["lineMae"], "openMae": d["openMae"], "favouriteSU": d["favouriteSU"], "games": d["games"],
}


def f1(x):
    return f"{x * 100:.1f}%"


def rec_s(r):
    return f"{r['w']}–{r['l']}"


facts = {
    "n": len(algos),
    "best_close_name": html.escape(best_close["name"]),
    "best_close": f1(best_close["close_select"][2]),
    "luck50": f1(d["nullMax"]["close"]["p50"]),
    "luck95": f1(d["nullMax"]["close"]["p95"]),
    "above_be": above_be_close,
    "eligible": len(eligible_close),
    "top_close_sel": f1(top_close[0]), "top_close_hold": f1(top_close[1]),
    "top_open_sel": f1(top_open[0]), "top_open_hold": f1(top_open[1]),
    "s4_sel": rec_s({"w": s4["2023"]["w"] + s4["2024"]["w"], "l": s4["2023"]["l"] + s4["2024"]["l"]}),
    "s4_sel_pct": f1((s4["2023"]["w"] + s4["2024"]["w"]) / (s4["2023"]["w"] + s4["2024"]["w"] + s4["2023"]["l"] + s4["2024"]["l"])),
    "s4_2025": rec_s(s4["2025"]), "s4_2025_pct": f1(s4["2025"]["pct"]),
    "s4_2026": rec_s(s4["2026"]),
    "s4_noqb": rec_s(s4["noQbChange"]), "s4_noqb_pct": f1(s4["noQbChange"]["pct"]),
    "s4_close": rec_s(s4["atClose"]), "s4_close_pct": f1(s4["atClose"]["pct"]),
    "s3_all": rec_s(s3["all"]), "s3_all_pct": f1(s3["all"]["pct"]),
    "s4_adj": next(r for r in rows if r["name"] == "50% EPA rating + 50% opening line")["open2_adj"],
    "mae_name": html.escape(best_mae["name"]), "mae": f"{best_mae['mae_select']:.2f}", "mae_h": f"{best_mae['mae_holdout']:.2f}",
    "open_mae": f"{d['openMae']['select']:.2f}", "open_mae_h": f"{d['openMae']['holdout']:.2f}",
    "line_mae": f"{d['lineMae']['select']:.2f}", "line_mae_h": f"{d['lineMae']['holdout']:.2f}",
    "su_name": html.escape(best_su["name"]), "su": f1(best_su["su_select"]), "su_h": f1(best_su["su_holdout"]),
    "fav_su": f1(d["favouriteSU"]["select"]), "fav_su_h": f1(d["favouriteSU"]["holdout"]),
}

open2_pool = [r for r in rows if r["open2_select"] and r["open2_select"][0] + r["open2_select"][1] >= 60]
open2_pool.sort(key=lambda r: -r["open2_select"][2])
facts["top4"] = "; ".join(f"{html.escape(r['name'])} {r['open2_holdout'][0]}–{r['open2_holdout'][1]}" for r in open2_pool[:4])
facts["top_adj"] = f"{open2_pool[0]['open2_adj']:.2f}"
facts["s4_adj"] = f"{facts['s4_adj']:.2f}"

template = open(__file__.replace("report.py", "page_template.html")).read()
page = template.replace("/*__DATA__*/null", json.dumps(payload, separators=(",", ":")))
for key, value in facts.items():
    page = page.replace("{{" + key + "}}", str(value))
open(PAGE, "w").write(page)
print("wrote", PAGE, len(page) // 1024, "KB")
print(json.dumps(facts, indent=1))
