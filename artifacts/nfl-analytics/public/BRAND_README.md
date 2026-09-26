# Gridline Brand Assets

This directory contains the official Gridline brand assets for use in the NFL Analytics app.

## Authoritative Assets
These assets should be used in the production UI:
- `logo-wordmark.png`: Authoritative wordmark logo. Use for primary branding and headers.
- `logo-icon.png`: Authoritative compact icon. Use for favicons, small app icons, and tight UI spaces.
- `gridline-auth-field.svg`: Decorative, original field-and-football illustration for sign-in and sign-up. It is not a product screenshot or evidence of a live pick; keep it free of players, teams, game data, probabilities and model-status claims.
- `gridline-share.png`: Public 1200×630 share card composed from the approved Gridline wordmark on a plain background; no third-party/team/player imagery.

## Reference / Inspiration Assets
- `dashboard-inspiration.png`: Layout inspiration/reference only. Do NOT display fake teams, stats, or imagery from this file in the production application. It serves as a visual system reference for spacing, typography, and density.
- `control-room-hero.png`: Retired authentication concept, **not approved for display**. It contains invented dashboard output, capability claims and player imagery; do not reuse it in public UI or marketing.

## Missing / optional imagery
- No identity- and rights-verified player or coach portrait library is supplied today. Player identity areas use the illustrated fallback; do not replace it with a guessed photo. Coach portraits are not supported.
- Player cards may render only the `headshotUrl` returned by the Game Detail consumer API for the **same player ID**. The server's verified-imagery pipeline reconciles the roster image to a unique GSIS identity (including typed crosswalk IDs), rejects conflicting mappings and URLs, and requires an explicit display-rights approval for the image host. A roster data license does **not** license linked photographs. The current server rights review records no permission for NFL-hosted photos, so it returns null; do not bypass that gate in the browser or add a host merely because its images are publicly reachable. The admin verified-imagery report records source versions, unresolved identities, conflicts, and rights status.
- Before activating any portrait source, document the provider, asset identity/source evidence, permission covering public display and any relevant expiry/revocation terms in the server's rights review; verify unique player IDs and conflicting source rows in the admin report. Remove approval when permission is revoked. For missing, conflicting, revoked, or failed image URLs, keep the illustrated fallback. The card uses a fixed 44×44 crop at `center 20%` and announces a verified image as `Portrait of [player name]`.
- No locally maintained, rights-verified collection of team marks is supplied. Team abbreviations remain readable without optional remote logo URLs.
- `dashboard-inspiration.png` is unused in the live UI by design.
- Authentication artwork is illustrative only. Home may show a single eligible official weekly winner or an unavailable state; no auth visual should imply a pick is always present.