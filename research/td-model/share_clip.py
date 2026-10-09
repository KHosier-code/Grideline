"""Animates this week's anytime-TD top 10 as a vertical video and sends it to the site.

Usage: python share_clip.py td_payload.json [OUT.mp4]

A 9-second 1080x1920 MP4 (Reels, TikTok, Shorts, X) that sits next to the
share card: the logo and title come in, the ten picks slide in one by one
with their chance bars filling and percentages counting up, then the site
link and last week's record. The site serves the newest clip at
/api/share/td-clip.mp4 and offers it on the Share page.
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import imageio_ffmpeg
from PIL import Image, ImageDraw

import brand

PAYLOAD, OUT = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
payload = json.load(open(PAYLOAD))
picks = payload["picks"][:10]
season, week = payload["season"], payload["week"]

W, H, FPS, SECONDS = 1080, 1920, 30, 9
BG, CARD, LINE, TRACK = brand.NAVY, brand.CARD, brand.LINE, brand.LINE
TEXT, MUTED, ORANGE = brand.TEXT, brand.MUTED, brand.CORAL


def font(weight, size):
    """Headlines and numbers in Space Grotesk; "Medium" (small text) in Instrument Sans."""
    if weight == "Medium":
        return brand.font(size, "Medium", "InstrumentSans")
    return brand.font(size, "Bold" if weight == "Bold" else "Medium")


def last_week_line():
    """'Last week: 6 of 10 scored' from the site's live record, when it has one."""
    origin = os.environ.get("GRIDLINE_INGEST_URL")
    if not origin:
        return None
    try:
        with urllib.request.urlopen(f"{origin.rstrip('/')}/api/consumer/touchdowns", timeout=30) as response:
            weeks = json.load(response).get("record", {}).get("weeks", [])
        previous = [w for w in weeks if w["week"] < week]
        if previous:
            return f"Last week: {previous[-1]['hits']} of {previous[-1]['picks']} scored"
    except (urllib.error.URLError, ValueError, KeyError):
        pass
    return None


def ease(t):
    """Ease-out cubic on 0..1, clamped."""
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def progress(now, start, length):
    return ease((now - start) / length)


def mix(color, alpha, base=BG):
    return tuple(round(b + (c - b) * alpha) for c, b in zip(color, base))


def fit(draw, text, fnt, limit):
    if draw.textlength(text, font=fnt) <= limit:
        return text
    while text and draw.textlength(text + "…", font=fnt) > limit:
        text = text[:-1]
    return text.rstrip() + "…"


record = last_week_line()
# Bars run 0-50%, so their length is the actual chance (a top-10 pick is rarely above 50%).
top_probability = max([0.5] + [p["probability"] for p in picks])
ROW_H, ROW_GAP, ROWS_TOP, MARGIN = 108, 14, 480, 64
ROW_START, ROW_STAGGER, ROW_IN = 1.3, 0.28, 0.55


def frame(now):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Brand: the logo tile grows in, the wordmark slides in.
    a = progress(now, 0.0, 0.5)
    size = round(72 * (0.6 + 0.4 * a))
    cx, cy = MARGIN + 36, 150
    if a > 0:
        tile = brand.icon(size)
        tile.putalpha(tile.getchannel("A").point(lambda v: round(v * a)))
        img.paste(tile, (int(cx - size / 2), int(cy - size / 2)), tile)
    b = progress(now, 0.15, 0.5)
    d.text((MARGIN + 92 - 30 * (1 - b), cy + 3), "probable", font=font("Bold", 66), fill=mix(TEXT, b), anchor="lm")

    # Eyebrow and title rise in.
    c = progress(now, 0.45, 0.6)
    d.text((MARGIN, 250 + 24 * (1 - c)), f"{season} · WEEK {week}", font=font("SemiBold", 44), fill=mix(ORANGE, c), anchor="lt")
    e = progress(now, 0.6, 0.6)
    d.text((MARGIN, 306 + 30 * (1 - e)), "Anytime TD picks", font=font("Bold", 96), fill=mix(TEXT, e), anchor="lt")
    d.text((MARGIN, 420 + 20 * (1 - e)), "Chance each player scores, from our model", font=font("Medium", 36), fill=mix(MUTED, e), anchor="lt")

    # Rows slide in from the right, then the bar fills and the number counts up.
    width = W - 2 * MARGIN
    for i, pick in enumerate(picks):
        start = ROW_START + i * ROW_STAGGER
        r = progress(now, start, ROW_IN)
        if r <= 0:
            continue
        x = MARGIN + 140 * (1 - r)
        y = ROWS_TOP + i * (ROW_H + ROW_GAP)
        d.rounded_rectangle((x, y, x + width, y + ROW_H), radius=18, fill=mix(CARD, r), outline=mix(LINE, r))
        d.text((x + 44, y + ROW_H / 2), str(i + 1), font=font("SemiBold", 44), fill=mix(MUTED, r), anchor="mm")
        name = fit(d, pick["name"], font("Bold", 46), width - 330)
        d.text((x + 92, y + 12), name, font=font("Bold", 46), fill=mix(TEXT, r), anchor="lt")
        where = "vs" if pick.get("isHome") else "at"
        d.text((x + 92, y + 62), f"{pick['position']} · {pick['team']} {where} {pick['opponent']}",
               font=font("Medium", 32), fill=mix(MUTED, r), anchor="lt")
        fill = progress(now, start + 0.25, 0.9)
        shown = pick["probability"] * fill
        bar_x0, bar_x1, bar_y = x + width - 214, x + width - 30, y + ROW_H - 22
        d.rounded_rectangle((bar_x0, bar_y, bar_x1, bar_y + 8), radius=4, fill=mix(TRACK, r))
        span = (bar_x1 - bar_x0) * min(shown / top_probability, 1)
        if span > 8:
            d.rounded_rectangle((bar_x0, bar_y, bar_x0 + span, bar_y + 8), radius=4, fill=mix(ORANGE, r))
        d.text((x + width - 30, y + 42), f"{round(shown * 100)}%", font=font("Bold", 64), fill=mix(ORANGE, r), anchor="rm")

    # Footer.
    f = progress(now, ROW_START + len(picks) * ROW_STAGGER + 0.5, 0.6)
    foot = H - 170
    d.line((MARGIN, foot, MARGIN + (W - 2 * MARGIN) * f, foot), fill=LINE, width=2)
    d.text((MARGIN, foot + 34 + 16 * (1 - f)), "probablesports.com", font=font("Bold", 52), fill=mix(TEXT, f), anchor="lt")
    detail = f"{record} · 21+" if record else "Model estimates, not guarantees · 21+"
    d.text((MARGIN, foot + 100 + 16 * (1 - f)), detail, font=font("Medium", 34), fill=mix(MUTED, f), anchor="lt")
    return img


ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
out_path = OUT or "td_clip.mp4"
encoder = subprocess.Popen([
    ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path,
], stdin=subprocess.PIPE)
for n in range(FPS * SECONDS):
    encoder.stdin.write(frame(n / FPS).tobytes())
encoder.stdin.close()
if encoder.wait() != 0:
    sys.exit("ffmpeg failed to encode the clip")
frame(SECONDS).save(out_path.replace(".mp4", "-poster.png"))
video = open(out_path, "rb").read()
print(f"Share clip for {season} week {week}: {len(video) / 1024:.0f} KB")

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
body = json.dumps({"kind": "share-clip", "season": season, "week": week,
                   "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                   "payload": {"mp4": base64.b64encode(video).decode(), "seconds": SECONDS}}).encode()
request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-share-clip"})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Sent:", response.status, response.read().decode()[:200])
except urllib.error.HTTPError as error:
    print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
