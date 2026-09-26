# Public metadata and rendering check

The current published origin is `https://gridelineanalytics.com` (verified from the deployment service during implementation). `PUBLIC_SITE_URL` may override that origin if the primary published domain changes. `BASE_PATH` is included in every canonical, share-image URL and sitemap location. Keep `robots.txt`'s sitemap URL and disallow paths in sync if publishing at another base path.

The production web service serves Vite's built assets and inserts route metadata into the HTML response. It verifies a game ID against the public consumer game API before adding game-specific metadata. A missing ID returns 404/noindex; an API failure returns 503/noindex. Private and unsupported pages receive noindex and no canonical URL. The sitemap lists only stable public routes, not guessed game IDs.

The web service checks the API over the local artifact proxy (`http://127.0.0.1:80`) by default and falls back to the configured published origin if that proxy is unreachable. `INTERNAL_API_ORIGIN` can select another trusted reachable API origin (no trailing API path); never derive the fetch target from an incoming Host header.

The methodology wording follows the persisted consumer evidence labels on Home, Games, Game Detail, Props and Performance, plus the player forecast readiness and historical limitations recorded in `GRIDLINE_PROJECT_CONTROL.md`. The page deliberately does not embed a numerical performance or readiness count: those are read live from the corresponding public views, where unavailable and partial states are explicit.

Check the **raw response** (what a typical social unfurler sees), not just browser DevTools:

```sh
curl -sSL https://gridelineanalytics.com/methodology | grep -E '<title>|description|robots|canonical|og:image|og:url'
curl -sSL https://gridelineanalytics.com/games | grep -E '<title>|canonical'
curl -sSL -o /dev/null -w '%{http_code}\n' https://gridelineanalytics.com/games/not-a-real-game
curl -sSL https://gridelineanalytics.com/admin | grep -E 'robots|canonical'
curl -sSL https://gridelineanalytics.com/sitemap.xml
```

Use a **real game ID from the Games page** to verify `/games/<id>` returns its actual matchup name in the raw title and OG description. Compare the response to the rendered `<head>` after client navigation and after a full reload. The raw HTML has metadata but not the React-rendered article text: the main content still needs JavaScript and is not guaranteed to be indexed by text-only crawlers. Social previews can use the HTML head without rendering JavaScript. Do not mistake a client-only title change for a crawler-visible title. Repeat against a deployed build after publishing; development preview checks alone cannot prove production routing.