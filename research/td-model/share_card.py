"""Draws this week's anytime-TD top 10 as a 1200x630 share image and sends it to the site.

Usage: python share_card.py td_payload.json [OUT.png]

The site serves the newest card at /api/share/td-card.png, which is also the
link preview for the TD Picks page, so posts on X, Reddit or iMessage show the
current picks.
"""
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

from PIL import Image, ImageDraw

import brand

PAYLOAD, OUT = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
payload = json.load(open(PAYLOAD))
picks = payload["picks"][:10]
season, week = payload["season"], payload["week"]

W, H = 1200, 630
BG, CARD, LINE = brand.NAVY, brand.CARD, brand.LINE
TEXT, MUTED, ORANGE = brand.TEXT, brand.MUTED, brand.CORAL


def font(weight, size):
    """Headlines and numbers in Space Grotesk; "Medium" (small text) in Instrument Sans."""
    if weight == "Medium":
        return brand.font(size, "Medium", "InstrumentSans")
    return brand.font(size, "Bold" if weight == "Bold" else "Medium")


def last_week_line():
    """'Last week: 7 of 10 scored' from the site's live record, when it has one."""
    origin = os.environ.get("GRIDLINE_INGEST_URL")
    if not origin:
        return None
    try:
        with urllib.request.urlopen(f"{origin.rstrip('/')}/api/consumer/touchdowns", timeout=30) as response:
            weeks = json.load(response).get("record", {}).get("weeks", [])
        previous = [w for w in weeks if w["week"] < week]
        if previous:
            w = previous[-1]
            return f"Last week: {w['hits']} of {w['picks']} scored"
    except (urllib.error.URLError, ValueError, KeyError):
        pass
    return None


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
# Header
brand.wordmark(img, 56, 62, 38, TEXT)
d.text((W - 56, 62), f"{season} · WEEK {week}", font=font("SemiBold", 26), fill=ORANGE, anchor="rm")
d.text((56, 100), "Anytime touchdown picks", font=font("Bold", 50), fill=TEXT, anchor="lt")
d.text((56, 160), "Chance each player scores, from our model", font=font("Medium", 24), fill=MUTED, anchor="lt")

# Two columns of five
col_w, row_h, top = (W - 56 * 2 - 24) // 2, 60, 202
name_font, meta_font, pct_font, rank_font = font("Bold", 24), font("Medium", 18), font("Bold", 32), font("SemiBold", 22)
for i, pick in enumerate(picks):
    col, row = divmod(i, 5)
    x = 56 + col * (col_w + 24)
    y = top + row * (row_h + 8)
    d.rounded_rectangle((x, y, x + col_w, y + row_h), radius=12, fill=CARD, outline=LINE)
    d.text((x + 26, y + row_h / 2), str(i + 1), font=rank_font, fill=MUTED, anchor="mm")
    name, limit = pick["name"], col_w - 190
    if d.textlength(name, font=name_font) > limit:
        while name and d.textlength(name + "…", font=name_font) > limit:
            name = name[:-1]
        name = name.rstrip() + "…"
    d.text((x + 52, y + 9), name, font=name_font, fill=TEXT, anchor="lt")
    where = "vs" if pick.get("isHome") else "at"
    d.text((x + 52, y + 38), f"{pick['position']} · {pick['team']} {where} {pick['opponent']}", font=meta_font, fill=MUTED, anchor="lt")
    d.text((x + col_w - 20, y + row_h / 2), f"{round(pick['probability'] * 100)}%", font=pct_font, fill=ORANGE, anchor="rm")

# Footer
foot_y = H - 38
d.line((56, foot_y - 26, W - 56, foot_y - 26), fill=LINE, width=1)
d.text((56, foot_y), "probablesports.com/touchdowns", font=font("Bold", 24), fill=TEXT, anchor="lm")
record = last_week_line()
right = "Model estimates, not guarantees · 21+" if not record else f"{record} · 21+"
d.text((W - 56, foot_y), right, font=font("Medium", 24), fill=MUTED, anchor="rm")

buffer = io.BytesIO()
img.save(buffer, format="PNG", optimize=True)
png = buffer.getvalue()
print(f"Share card for {season} week {week}: {len(png) / 1024:.0f} KB")
if OUT:
    open(OUT, "wb").write(png)

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
body = json.dumps({"kind": "share-td", "season": season, "week": week,
                   "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                   "payload": {"png": base64.b64encode(png).decode(), "lastWeek": record}}).encode()
request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-share-card"})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Sent:", response.status, response.read().decode()[:200])
except urllib.error.HTTPError as error:
    print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
