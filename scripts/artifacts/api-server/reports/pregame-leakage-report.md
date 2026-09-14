# Pregame leakage regression report

Feature version: `pregame-v3`

- **PASS** — 2021 current game excluded
- **PASS** — 2021 future games excluded
- **PASS** — 2021 rolling 3/5/8 windows use prior games
- **PASS** — 2021 season-to-date excludes current game
- **PASS** — 2021 fallback ordering excludes same-kickoff future
- **PASS** — 2021 opponent-adjusted inputs use prior opponent rows
- **PASS** — 2022 current game excluded
- **PASS** — 2022 future games excluded
- **PASS** — 2022 rolling 3/5/8 windows use prior games
- **PASS** — 2022 season-to-date excludes current game
- **PASS** — 2022 fallback ordering excludes same-kickoff future
- **PASS** — 2022 opponent-adjusted inputs use prior opponent rows
- **PASS** — 2023 current game excluded
- **PASS** — 2023 future games excluded
- **PASS** — 2023 rolling 3/5/8 windows use prior games
- **PASS** — 2023 season-to-date excludes current game
- **PASS** — 2023 fallback ordering excludes same-kickoff future
- **PASS** — 2023 opponent-adjusted inputs use prior opponent rows
- **PASS** — 2024 current game excluded
- **PASS** — 2024 future games excluded
- **PASS** — 2024 rolling 3/5/8 windows use prior games
- **PASS** — 2024 season-to-date excludes current game
- **PASS** — 2024 fallback ordering excludes same-kickoff future
- **PASS** — 2024 opponent-adjusted inputs use prior opponent rows
- **PASS** — 2025 current game excluded
- **PASS** — 2025 future games excluded
- **PASS** — 2025 rolling 3/5/8 windows use prior games
- **PASS** — 2025 season-to-date excludes current game
- **PASS** — 2025 fallback ordering excludes same-kickoff future
- **PASS** — 2025 opponent-adjusted inputs use prior opponent rows
- **PASS** — 2026 current game excluded
- **PASS** — 2026 future games excluded
- **PASS** — 2026 rolling 3/5/8 windows use prior games
- **PASS** — 2026 season-to-date excludes current game
- **PASS** — 2026 fallback ordering excludes same-kickoff future
- **PASS** — 2026 opponent-adjusted inputs use prior opponent rows
- **PASS** — post-kickoff injury snapshots excluded
- **PASS** — post-kickoff sportsbook snapshots excluded

The runtime feature set does not join injury or sportsbook snapshots; those sources therefore cannot leak into these rows.
