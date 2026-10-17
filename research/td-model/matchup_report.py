"""Builds the weekly matchup report: how every offense and defense plays.

Usage: python matchup_report.py DATA_DIR [OUT.json]

Goes past points and yards into style: pressure, blitzing, explosive plays,
pass/run funnels, play action, yards after catch and missed tackles. Sources
are all free nflverse releases that fetch_data.sh downloads:

  - play-by-play (EPA, success, explosive plays, pass rate over expected)
  - FTN charting (blitzers, box count, play action, motion, screens)
  - Pro Football Reference advanced stats (pressures, missed tackles)
  - Next Gen Stats (QB time to throw)

FTN, PFR and NGS often post a week behind play-by-play, so each source reports
the last week it covers. A missing optional source leaves its metrics blank
rather than failing the run. When GRIDLINE_INGEST_URL and GRIDLINE_INGEST_TOKEN
are set, the report is sent to the site. Everything here is observed history
from completed regular-season games; nothing is a prediction.
"""
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DATA = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else None
RECENT = 4  # "Last 4" window

season = max(int(re.search(r"pbp_(\d{4})", os.path.basename(path)).group(1)) for path in glob.glob(f"{DATA}/pbp_*.parquet"))


def optional(path):
    """Reads an optional source, or None when it is missing or has no regular-season rows yet."""
    if not os.path.exists(path):
        print(f"Missing {os.path.basename(path)}: its metrics stay blank.")
        return None
    frame = pd.read_parquet(path)
    if "season_type" in frame:
        frame = frame[frame.season_type == "REG"]
    if "game_type" in frame:
        frame = frame[frame.game_type == "REG"]
    if "season" in frame:
        frame = frame[frame.season == season]
    return frame if len(frame) else None


pbp = pd.read_parquet(f"{DATA}/pbp_{season}.parquet", columns=[
    "game_id", "play_id", "week", "season_type", "posteam", "defteam", "pass", "rush", "qb_dropback",
    "pass_attempt", "complete_pass", "sack", "qb_kneel", "qb_spike", "two_point_attempt", "epa", "success",
    "yards_gained", "air_yards", "yards_after_catch", "pass_oe", "wp", "solo_tackle", "assist_tackle"])
pbp = pbp[(pbp.season_type == "REG") & pbp.posteam.notna() & pbp.defteam.notna()]
plays = pbp[((pbp["pass"] == 1) | (pbp.rush == 1)) & pbp.epa.notna()
            & (pbp.qb_kneel != 1) & (pbp.qb_spike != 1) & (pbp.two_point_attempt != 1)].copy()
if plays.empty:
    sys.exit("No completed regular-season plays yet; nothing to report.")
through_week = int(plays.week.max())

ftn = optional(f"{DATA}/ftn_charting_{season}.parquet")
if ftn is not None:
    ftn = ftn.rename(columns={"nflverse_game_id": "game_id", "nflverse_play_id": "play_id"})
    ftn = plays.merge(ftn[["game_id", "play_id", "n_blitzers", "n_defense_box", "is_play_action", "is_motion",
                           "is_screen_pass"]], on=["game_id", "play_id"], how="inner")
    ftn = ftn if len(ftn) else None
pfr_def = optional(f"{DATA}/advstats_week_def_{season}.parquet")
pfr_pass = optional(f"{DATA}/advstats_week_pass_{season}.parquet")
ngs = optional(f"{DATA}/ngs_passing.parquet")
if ngs is not None:
    ngs = ngs[ngs.week > 0]  # week 0 rows are season totals
    ngs = ngs if len(ngs) else None


def rate(numerator, denominator):
    return numerator / denominator.where(denominator > 0)


def side_metrics(p, f, pd_def, pd_pass, ng, side):
    """Per-team metrics for one side ("posteam" = offense, "defteam" = defense) over the given frames."""
    team = side
    passes = p[p["pass"] == 1]
    rushes = p[p.rush == 1]
    dropbacks = p[p.qb_dropback == 1]
    completions = p[p.complete_pass == 1]
    out = pd.DataFrame({
        "epa_play": p.groupby(team).epa.mean(),
        "success": p.groupby(team).success.mean(),
        "epa_pass": passes.groupby(team).epa.mean(),
        "epa_rush": rushes.groupby(team).epa.mean(),
        "explosive_pass": passes.assign(x=passes.yards_gained >= 20).groupby(team).x.mean(),
        "explosive_rush": rushes.assign(x=rushes.yards_gained >= 10).groupby(team).x.mean(),
        "sack_rate": dropbacks.groupby(team).sack.mean(),
        "yac": completions.groupby(team).yards_after_catch.mean(),
        "deep_epa": passes[passes.air_yards >= 20].groupby(team).epa.mean(),
        "adot": p[p.pass_attempt == 1].groupby(team).air_yards.mean(),
        # Pass rate over expected in neutral game states. For a defense this is
        # what opponents chose against it: positive means teams pass on it.
        "proe": p[p.wp.between(0.2, 0.8) & p.pass_oe.notna()].groupby(team).pass_oe.mean() / 100,
        "games": p.groupby(team).game_id.nunique(),
    })
    if f is not None:
        fd = f[f.qb_dropback == 1]
        blitzed = fd[fd.n_blitzers > 0]
        out["blitz_rate"] = fd.assign(x=fd.n_blitzers > 0).groupby(team).x.mean()
        out["epa_vs_blitz"] = blitzed.groupby(team).epa.mean()
        fr = f[f.rush == 1]
        out["stacked_box"] = fr.assign(x=fr.n_defense_box >= 8).groupby(team).x.mean()
        fp = f[f.pass_attempt == 1]
        out["play_action"] = fp.groupby(team).is_play_action.mean()
        out["screen"] = fp.groupby(team).is_screen_pass.mean()
        out["motion"] = f.groupby(team).is_motion.mean()
    # PFR counts are per player per game; pair them with dropbacks from the same games.
    covered = p if pd_def is None else p[p.game_id.isin(set(pd_def.game_id))]
    covered_dropbacks = covered[covered.qb_dropback == 1].groupby(team).size()
    if side == "defteam" and pd_def is not None:
        by_team = pd_def.groupby("team")
        out["pressure_rate"] = rate(by_team.def_pressures.sum(), covered_dropbacks)
        tackles = by_team.def_tackles_combined.sum()
        missed = by_team.def_missed_tackles.sum()
        out["missed_tackles"] = rate(missed, tackles + missed)
    if side == "posteam" and pd_pass is not None:
        covered = p[p.game_id.isin(set(pd_pass.game_id))]
        out["pressure_rate"] = rate(pd_pass.groupby("team").times_pressured.sum(),
                                    covered[covered.qb_dropback == 1].groupby(team).size())
    if side == "posteam" and ng is not None:
        weighted = ng.assign(w=ng.avg_time_to_throw * ng.attempts).groupby("team_abbr")
        out["time_to_throw"] = weighted.w.sum() / weighted.attempts.sum().where(lambda s: s > 0)
    return out


# key, label, group, format, offense direction, defense direction, help text.
# Direction: "high" = more is better for that unit, "low" = less is better,
# None = style, not quality (ranked by most, shown without good/bad color).
METRICS = [
    ("epa_play", "EPA per play", "Efficiency", "num2", "high", "low",
     "Expected points added per play. The best single measure of how well a unit plays."),
    ("success", "Success rate", "Efficiency", "pct", "high", "low",
     "Share of plays that gain enough yards to keep the offense on schedule."),
    ("epa_pass", "EPA per dropback", "Efficiency", "num2", "high", "low", "Efficiency on pass plays, sacks included."),
    ("epa_rush", "EPA per rush", "Efficiency", "num2", "high", "low", "Efficiency on designed runs."),
    ("explosive_pass", "Explosive pass rate", "Big plays", "pct", "high", "low", "Pass plays that gain 20+ yards."),
    ("explosive_rush", "Explosive run rate", "Big plays", "pct", "high", "low", "Runs that gain 10+ yards."),
    ("deep_epa", "EPA on deep throws", "Big plays", "num2", "high", "low", "Throws 20+ yards downfield."),
    ("pressure_rate", "Pressure rate", "Pass rush", "pct", "low", "high",
     "Dropbacks where the QB was hurried, hit or sacked (Pro Football Reference charting)."),
    ("sack_rate", "Sack rate", "Pass rush", "pct", "low", "high", "Dropbacks that end in a sack."),
    ("blitz_rate", "Blitz rate", "Pass rush", "pct", None, None,
     "Dropbacks where the defense sent at least one extra rusher (FTN charting)."),
    ("epa_vs_blitz", "EPA vs the blitz", "Pass rush", "num2", "high", "low",
     "Efficiency on dropbacks where the defense blitzed."),
    ("proe", "Pass rate over expected", "Tendencies", "pct", None, None,
     "How much more (or less) a team passes than game situation predicts. For a defense: what opponents choose against it. Positive = a pass funnel."),
    ("play_action", "Play-action rate", "Tendencies", "pct", None, None, "Pass attempts with a play fake (FTN)."),
    ("motion", "Motion rate", "Tendencies", "pct", None, None, "Plays with pre-snap motion (FTN)."),
    ("screen", "Screen rate", "Tendencies", "pct", None, None, "Pass attempts that are screens (FTN)."),
    ("stacked_box", "Stacked box rate", "Tendencies", "pct", None, None,
     "Runs into 8 or more defenders in the box (FTN)."),
    ("adot", "Average depth of target", "Tendencies", "num1", None, None, "Air yards per pass attempt."),
    ("time_to_throw", "Time to throw", "Tendencies", "sec", None, None, "Seconds from snap to throw (Next Gen Stats)."),
    ("yac", "Yards after catch", "Tackling", "num1", "high", "low", "Yards after the catch per completion."),
    ("missed_tackles", "Missed tackle rate", "Tackling", "pct", None, "low",
     "Missed tackles per tackle attempt (Pro Football Reference)."),
]


def clean(value, digits):
    return None if value is None or pd.isna(value) or not np.isfinite(value) else round(float(value), digits)


def window(weeks_kept):
    p = plays[plays.week.isin(weeks_kept)]
    f = None if ftn is None else ftn[ftn.week.isin(weeks_kept)]
    pd_def = None if pfr_def is None else pfr_def[pfr_def.week.isin(weeks_kept)]
    pd_pass = None if pfr_pass is None else pfr_pass[pfr_pass.week.isin(weeks_kept)]
    ng = None if ngs is None else ngs[ngs.week.isin(weeks_kept)]
    blank = lambda frame: None if frame is None or frame.empty else frame
    sides = {}
    for name, column in [("offense", "posteam"), ("defense", "defteam")]:
        frame = side_metrics(p, blank(f), blank(pd_def), blank(pd_pass), blank(ng), column)
        rows, league = {}, {}
        for key, _label, _group, fmt, off_dir, def_dir, _help in METRICS:
            if key not in frame or frame[key].isna().all():
                continue
            direction = off_dir if name == "offense" else def_dir
            digits = 4 if fmt == "pct" else 3
            values = frame[key]
            # Rank 1 = best for this unit; for style metrics, rank 1 = does it most.
            ranks = values.rank(ascending=direction == "low", method="min")
            league[key] = clean(values.mean(), digits)
            for team, value in values.items():
                rows.setdefault(team, {})[key] = {
                    "value": clean(value, digits), "rank": None if pd.isna(ranks[team]) else int(ranks[team])}
        for team, games in frame.games.items():
            rows.setdefault(team, {})["games"] = int(games)
        sides[name] = (rows, league)
    return sides


all_weeks = sorted(int(w) for w in plays.week.unique())
windows = {"season": window(all_weeks), "last4": window(all_weeks[-RECENT:])}
teams = sorted(set(plays.posteam) | set(plays.defteam))
report_teams = []
for team in teams:
    entry = {"team": team}
    for win, sides in windows.items():
        entry[win] = {name: sides[name][0].get(team, {}) for name in ("offense", "defense")}
    report_teams.append(entry)

present = {key for sides in windows.values() for name in sides for key in sides[name][1]}
report = {
    "season": season,
    "throughWeek": through_week,
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "sources": {
        "playByPlay": through_week,
        "ftnCharting": None if ftn is None else int(ftn.week.max()),
        "pfrAdvanced": None if pfr_def is None else int(pfr_def.week.max()),
        "nextGenStats": None if ngs is None else int(ngs[ngs.season == season].week.max()),
    },
    "metrics": [{"key": key, "label": label, "group": group, "format": fmt, "offense": off_dir, "defense": def_dir,
                 "help": help_text} for key, label, group, fmt, off_dir, def_dir, help_text in METRICS if key in present],
    "league": {win: {name: sides[name][1] for name in ("offense", "defense")} for win, sides in windows.items()},
    "teams": report_teams,
}
body = json.dumps({"kind": "matchups", "season": season, "week": through_week,
                   "generatedAt": report["generatedAt"], "payload": report}).encode()
print(f"{season} through week {through_week}: {len(report_teams)} teams, {len(report['metrics'])} metrics, "
      f"sources {report['sources']}; {len(body) / 1024:.0f} KB")
if OUT:
    json.dump(report, open(OUT, "w"), indent=1)

origin, token = os.environ.get("GRIDLINE_INGEST_URL"), os.environ.get("GRIDLINE_INGEST_TOKEN")
if not origin or not token:
    print("GRIDLINE_INGEST_URL/TOKEN not set: not sending.")
    sys.exit(0)
request = urllib.request.Request(f"{origin.rstrip('/')}/api/reports/ingest", data=body, method="POST", headers={
    "Content-Type": "application/json", "Authorization": f"Bearer {token}", "User-Agent": "gridline-matchup-report"})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        print("Sent:", response.status, response.read().decode()[:200])
except urllib.error.HTTPError as error:
    print(f"Upload failed: HTTP {error.code} {error.read().decode(errors='replace')[:500]}")
    sys.exit(1)
