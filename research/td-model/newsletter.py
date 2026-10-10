"""Writes this week's "Tuesday's picks" email and saves it as a Buttondown draft.

Usage: python newsletter.py td_payload.json [OUT.md]

The site keeps the Buttondown key and creates the draft (POST
/api/newsletter/draft); it makes one draft per week, so later runs in the same
week do nothing. Review the draft in Buttondown and press send.
"""
import json
import os
import sys
import urllib.error
import urllib.request

SITE = "https://probablesports.com"
PAYLOAD, OUT = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
payload = json.load(open(PAYLOAD))
season, week = payload["season"], payload["week"]
picks = payload["picks"][:10]
origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")


def fair_odds(p):
    return f"-{round(100 * p / (1 - p))}" if p >= 0.5 else f"+{round(100 * (1 - p) / p)}"


def reason(pick):
    f = pick.get("factors") or {}
    parts = []
    carry, target = f.get("carryShare"), f.get("targetShare")
    if carry is not None and (target is None or carry >= target):
        parts.append(f"{round(carry * 100)}% of carries")
    elif target is not None:
        parts.append(f"{round(target * 100)}% of targets")
    if f.get("redZoneTouchesPerGame") is not None:
        parts.append(f"{f['redZoneTouchesPerGame']:.1f} red-zone touches a game")
    if f.get("teamImpliedPoints") is not None:
        parts.append(f"team total {f['teamImpliedPoints']:.1f}")
    return ", ".join(parts)


def last_week():
    """'Last week 6 of our top 10 scored (3.5 expected), +1.9 units at book prices.'"""
    if not origin:
        return None
    try:
        with urllib.request.urlopen(f"{origin.rstrip('/')}/api/consumer/touchdowns", timeout=30) as response:
            weeks = json.load(response).get("record", {}).get("weeks", [])
    except (urllib.error.URLError, ValueError):
        return None
    previous = [w for w in weeks if w["week"] < week]
    if not previous:
        return None
    w = previous[-1]
    line = f"Last week {w['hits']} of our top {w['picks']} scored ({w.get('expectedHits', 0):.1f} expected)"
    if w.get("pricedPicks"):
        units = w.get("units", 0)
        line += f", {'+' if units >= 0 else '−'}{abs(units):.1f} units at the best sportsbook price"
    return line + "."


record = last_week()
lines = [
    f"![Week {week} anytime TD picks]({SITE}/api/share/td-card.png?v={season}-{week})",
    "",
    f"Here are this week's 10 players most likely to score a rushing or receiving touchdown, by our model."
    + (f" {record}" if record else ""),
    "",
]
for i, pick in enumerate(picks, 1):
    where = "vs" if pick.get("isHome") else "at"
    lines.append(f"**{i}. {pick['name']}** ({pick['position']}, {pick['team']} {where} {pick['opponent']}): "
                 f"**{round(pick['probability'] * 100)}%**, fair odds {fair_odds(pick['probability'])}" + ("  " if reason(pick) else ""))
    why = reason(pick)
    if why:
        lines.append(f"_{why}_")  # the two trailing spaces above force a line break
    lines.append("")
lines += [
    f"Every player, today's sportsbook prices and where we see value: {SITE}/touchdowns",
    "",
    f"Every pick is timestamped before kickoff. Wins and losses: {SITE}/receipts",
    "",
    "---",
    "",
    "Model estimates, not guarantees. Lines move, so check your sportsbook. 21+ where legal. "
    "If gambling stops being fun, call or text 1-800-GAMBLER.",
]
subject = f"Week {week}: our top 10 anytime TD picks"
body = "\n".join(lines)
print(subject)
if OUT:
    open(OUT, "w").write(f"# {subject}\n\n{body}\n")

if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
request = urllib.request.Request(
    f"{origin.rstrip('/')}/api/newsletter/draft",
    data=json.dumps({"season": season, "week": week, "subject": subject, "body": body}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "probable-newsletter"},
)
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Draft:", response.status, response.read().decode()[:300])
except urllib.error.HTTPError as error:
    print(f"Draft failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
