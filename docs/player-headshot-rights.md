# Player headshot rights review

Reviewed September 26, 2026. Scope: public display of player portraits on Gridline's Game Detail. This review does **not** approve team logos; those have separate controls.

| Source / host | Evidence and permitted use | Gridline decision |
| --- | --- | --- |
| `nflverse-data` 2026 roster CSV | Roster data is published under [CC BY 4.0](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md). The `headshot_url` field is a link, not a sublicense of the image at that address. | Use the URL only as source evidence for review; no image-display approval follows from the CSV license. |
| `static.www.nfl.com` | The September 26 roster release contains 2,904 non-empty headshot URLs on this host (of 2,999 rows). [NFL terms, §1.1 and §1.3](https://www.nfl.com/legal/terms/) reserve rights in photographs, prohibit display absent an express grant, and restrict use to individual non-commercial informational purposes absent prior written consent. No written grant for this app is on file. | **Not approved** for public display, hotlinking, caching, or redistribution. |
| Any other roster headshot host | No host-specific license or approved asset mapping has been established. | **Not approved** by default, including newly introduced hosts. |

**Approved player headshot hosts and uses: none.** The API returns `null` for player portraits even when identity is confidently reconciled. The client displays its accessible player placeholder. This applies to fresh and stale source evidence alike; it does not guess a replacement image or use an ESPN image instead.

To enable portraits later, first obtain a documented grant or licensed alternative that explicitly permits the intended public display, delivery method and retention. Verify image-to-player identity with authoritative identifiers, review each permitted host and use, update the allowlist and rights notice together, and test the public response before release. Attribution to nflverse alone is not a substitute for image permission.