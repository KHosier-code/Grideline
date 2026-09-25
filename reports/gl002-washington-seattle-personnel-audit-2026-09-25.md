# GL-002 Washington–Seattle personnel and projection audit

Development-only branch: `gl002-personnel-game-detail`, based on published
`b9b44fce38744fc43042dd3a40e0e4ec3a3b88ee`. Production was queried
read-only on September 25, 2026. The unpublished GL-003 candidate and its
database guards are outside this branch.

## What the saved model actually calculated

Game `401872955`: Seattle (`26`, away) at Washington (`28`, home),
September 27, 2026, 17:00 UTC. Latest stored pregame snapshot **223**,
`early-week`, was generated September 15 at **15:00:28.561 UTC**. It is not
flagged official. The published GL-002 consumer endpoint displays its raw
projection, but suppresses betting recommendations because required market
evidence is incomplete.

| Stored output | Value |
| --- | ---: |
| Seattle away score | 22.8403498658 |
| Washington home score | 22.1146140558 |
| Home margin (Washington − Seattle) | −0.7257358100 |
| Projected total | 44.9549639216 |
| Washington win probability | 34.32441401% |
| Seattle win probability | 65.67558599% |

Versioned models: spread `phase6-1-spread-01c85917b47c6e70c258fe02`
(linear regression), moneyline
`phase6-1-moneyline-917fa6e7417cccb45909ade4` (logistic regression),
totals `phase6-1-totals-749279b5856f1be1165c211d` (gradient
boosting); all use `pregame-v3`. The run metadata labels these
`refit_candidate`; the stored snapshot, not that label, is the evidence of
what the published game view currently shows.

Snapshot 223 preserved 27 numerical input values, in the saved feature
order. These are **home minus away model features**, not player names:

| Window | Defensive success | EPA/play | Explosive pass | Explosive rush | Offensive success | Red-zone TD | Turnover | Yards/play |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Last 3 | .019035 | −.012482 | −.008564 | .023925 | .030213 | .026603 | .010582 | −.020225 |
| Last 5 | −.038544 | −.080559 | .041679 | −.004876 | −.008229 | .189588 | .017092 | −.144256 |
| Last 8 | −.064663 | −.071625 | .058052 | .023140 | −.015397 | .100226 | .012273 | −.223461 |

The other inputs were `home_low_sample = 1`, `away_low_sample = 1`, and
`qb_confidence_difference = 0`. Both input rows were generated September 15
at about 14:51 UTC from source cutoff 14:51:28 UTC. The selected feature
audit retained in this snapshot has **no named QB or personnel context**.
No persisted DraftKings/FanDuel quote for this game predates the September
15 prediction timestamp; later odds first appear in the stored history.
Thus there was no point-in-time sportsbook price in this saved projection.

## QB chronology: modeled numbers versus current display

- Washington: the September 14 injury row marked Jayden Daniels active;
  Marcus Mariota was also active. September 17 Sleeper depth listed Daniels
  QB1 and Mariota QB2. By September 24, the injury feed reported Daniels
  **Out** (elbow) and Mariota **Active**, while mapped Sleeper depth had
  Mariota QB1 and Daniels QB2.
- Seattle: the September 15 injury snapshot had Sam Darnold **Doubtful**;
  by September 24 he was **Questionable** (lower body), with Drew Lock
  Active. Latest mapped depth lists Darnold QB1 and Lock QB2; the injury
  ambiguity should not be hidden by an unconditional "starter" label.
- A September 14 historical personnel-context record named **Russell
  Wilson** as a Seattle inferred starter from **2021** participation.
  That is stale history, not a credible 2026 QB assumption. The September
  15 numeric vector did **not** encode Russell Wilson, Daniels, Mariota,
  Darnold, or Lock as named inputs. Treating a current QB name displayed
  beside the projection as a numeric model adjustment would be false.

The injury and depth changes after September 15 cannot modify the saved
score or probabilities. The existing model consumes rolling team statistics
and the QB confidence difference, not an explicit injury or named-starter
feature. A supported post-snapshot QB change needs a prominent limitation
and a conservative recommendation gate; it does **not** justify an invented
point adjustment or rewriting snapshot 223. If the evidence cannot establish
which QB the numeric model represented, state that limitation instead of
claiming it represented a specific starter.

## Both defenses: cross-check of current source rows

Read-only source comparison covered every defensive player with a 2026
week-1/2 `snap_counts` row for SEA/WAS, the latest Sleeper depth-role mapping,
current roster/injury records where available, and the existing published
game-detail response. A percentage below is a latest-game **defensive snap
share**, not proof of an upcoming start. Absence of a fresh injury report
is **unknown**, not verified availability.

**Seattle front and linebackers:** Byron Murphy (DE feed, 66%; Sleeper
NT/1), Jarran Reed (DE, 44%; RDE/1), Leonard Williams (DT, 70%; LDE/1),
Rylie Mills (DT, 30%; RDE/2), Brandon Pili (NT, 0%; NT/2,
Questionable), Ernest Jones (LB, 96%; RILB/1, Active), Drake Thomas
(LB, 94%; LILB/1, Active), DeMarcus Lawrence (LB, 60%; LOLB/1 but
**incompatible** identity/position mapping), Derick Hall (LB, 58%;
ROLB/2, **unmatched**), Uchenna Nwosu (LB, 48%; ROLB/1), Dante Fowler
(LB, 22%; LOLB/2), Tyrice Knight (LB, 14%; LILB/2), Chazz Surratt
(LB, 4%; LILB/3), Patrick O'Connell (LB, 4%; RILB/2), Connor O'Toole
(LB, 0%; ROLB/3). The existing UI displays only Byron Murphy, Brandon
Pili, DeMarcus Lawrence, Uchenna Nwosu, Dante Fowler and Julian Love
from the entire defense. A raw `LB` position does not establish whether
a scheme calls an outside player an edge defender; prefer verified
position/role evidence and mark ambiguous cases unconfirmed.

**Seattle secondary:** Devon Witherspoon (CB, 96%; LCB/1,
**unmatched** mapping), Josh Jobe (CB, 96%; RCB/1, unmatched),
Nehemiah Pritchett (CB, 76%; LCB/2, compatible), Julian Neal
(CB, 4%; RCB/2, unmatched), Avery Smith (CB, 0%; NB/2),
Rodney Thomas II (S, 100%; current injury Active but Sleeper FS/2
is unmatched), Julian Love (S, 96%; SS/1, **incompatible** DB
position mapping and Questionable), Nick Emmanwori (S, 18%; NB/1,
unmatched), AJ Finley (S, 4%; SS/2, unmatched). Ty Okada is in
Sleeper FS/1 but mapped unmatched and has a Questionable injury row.
**No corner** appears in the existing published compact defense despite
high-snap corner evidence. Do not convert unmatched DB names into
confirmed starters.

**Washington front and linebackers:** Charles Omenihu (DE, 53%;
Sleeper LDE/2, Questionable), Daron Payne (DT, 67%; RDE/1,
older Questionable report), Javon Kinlaw (DT, 56%; LDE/1,
Questionable), Shy Tuttle (DT, 31%; NT/2, Active), Tim Settle
(DT, 31%; NT/1, Active), Sonny Styles (LB, 100%; RILB/1,
Active), Leo Chenal (LB, 82%; RILB/2, Questionable), K'Lavon
Chaisson (LB, 65%; ROLB/1, older Questionable report), Odafe
Oweh (LB, 64%; LOLB/1, older Questionable report), Frankie
Luvu (LB, prior week 53%; LILB/1, Questionable), Dorance
Armstrong Jr. (LB, 44%; LOLB/2, Questionable), Javontae
Jean-Baptiste (LB, 24%; LOLB/3, unmatched), Jordan Magee
(LB, prior week 16%; LILB/2, Injured Reserve), Joshua
Josephs (LB, 13%; ROLB/2, unmatched), Ale Kaho and Kain
Medrano (LB, 0%; Kain LILB/3). Jer'Zhan Newton is marked
Injured Reserve; a historical depth slot cannot promote him.

**Washington secondary:** Amik Robertson (CB, 100%; NB/1,
compatible), Mike Sainristil (CB, 82%; RCB/1, **unmatched**),
Rasul Douglas (CB, 44%; LCB/2), Fabian Moreau (CB, 0%;
RCB/2), Nick Cross (S, 100%; SS/1, **unmatched**, currently
**Out**), Jeremy Reaves (S, 91%; FS/1, Active), Quan Martin
(S, 55%; FS/2, unmatched), Percy Butler (S, 0%; SS/2,
Questionable), Tyler Owens (S, 0%; NB/2, Active). Trey Amos
has Sleeper LCB/1 but is unmatched; Isaac Yiadom LCB/3 is
compatible but has no high-snap week-2 role evidence. The
published compact view includes Jeremy Reaves but **no corners**.

### Root cause and correction boundary

The current derivation combines ESPN team IDs (`28`/`26`), NFLverse
abbreviations (`WAS`/`SEA`), Sleeper-normalized teams (`WSH`/`SEA`),
and multiple player-ID systems. The latest Sleeper mapping has numerous
unmatched/incompatible `DB` corner/safety records, so safe identity
filtering drops legitimate-looking but unverified starters. The consumer
serializer then reclassifies positions separately from derivation and
merges current teams by `"home"`/`"away"` side without revalidating team
identity. It previously showed only rank-1/rank-2 fragments, offered no
stable player identity, and labeled any published rank-1 row a starter
without an injury/status check. These issues compound; merely changing
CSS or guessing starters from snap shares would not fix the data.

The development fix must use canonical team and player identity internally,
one normalized defensive-position classification for both derivation and
serialization, scheme-neutral groups (front, LB, CB, S), and explicit
unconfirmed/unavailable states. It must not expose unmatched/incompatible
names as confirmed starters. This audit is **not** an official model
retraining or a production data repair.

## Verification and release

Focused backend tests passed: 46 consumer route/matchup cases, including
replacement QB, RB committee versus lone lead, unavailable WR, 3–4/4–3
defensive grouping, cutoff-safe QB identity and recommendation gating;
the backend worker also ran 21 current-personnel tests. API and web
typechecks passed; the web production build succeeded (with an existing
large-chunk warning). The development API returned HTTP 200 after restart.

| View | Published GL-002 before | Development UI after |
| --- | --- | --- |
| Desktop role detail | [Before](../screenshots/gl002-personnel-published-before-desktop-roles.png) | [After — fixture preview](../screenshots/gl002-personnel-development-after-fixture-desktop-roles.png) |
| Mobile role detail | [Before](../screenshots/gl002-personnel-published-before-mobile-roles.png) | [After — fixture preview](../screenshots/gl002-personnel-development-after-fixture-mobile-roles.png) |

**Screenshot boundary:** the before screenshots are the public published
site. The after role screenshots render the *actual new development
component* against a temporary, browser-only adapter of a read-only public
production game payload. That adapter maps the old production contract to
the new fields for layout review; its names, role confidence and availability
are **illustrative and not a live execution of the revised backend on
production data**. The browser did not write a database. The separate
[development desktop](../screenshots/gl002-personnel-after-development-desktop.jpg)
and [development mobile](../screenshots/gl002-personnel-after-development-mobile.jpg)
views show the real local environment, where older/stale feeds and the
absence of a local saved projection correctly produce unavailable evidence.
Review the revised API against representative current-season data before
approving a release; neither a fixture screenshot nor a unit test is that
validation.

## Separate numerical-model challenger — not part of this branch

Making current injuries move the **score** requires a new, validated
personnel model, not a display overlay:

1. Persist trustworthy historical starter, absence, replacement and
   participation evidence with canonical player/team IDs and source
   timestamps. Establish what was knowable **before** each historical
   prediction cutoff; reject late injury/status updates and ambiguous
   mappings.
2. Define versioned features for QB starter/replacement and
   injury/depth availability, including missingness and confidence. Do not
   substitute a static injury-to-points coefficient or treat a doubtful
   report as an official scratch.
3. Train and backtest a separate challenger on multiple NFL seasons,
   retaining cutoff-safe inputs and immutable run identity. Compare against
   the active spread, moneyline and total baselines overall and on QB
   replacement, RB committee, missing WR and differing defensive-scheme
   segments. Check calibration, error, coverage and leakage.
4. Require independent review and explicit per-family promotion. Only a
   promoted version can create **new** snapshots; never recalculate
   September 15 snapshot 223 or rewrite saved history. Before promotion,
   keep the present UI warning and recommendation gate separate from the
   numerical model.

Keep this release separate from GL-003 and request its own review before
any publication.