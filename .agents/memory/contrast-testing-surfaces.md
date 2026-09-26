---
name: Contrast testing surfaces
description: Limits of DOM style contrast measurements on the consumer and Admin themes.
---

For theme regression checks, composite transparent foregrounds and backgrounds onto the nearest opaque surface. Do not treat a computed transparent background as black, or silently substitute an ancestor color when a gradient or image intervenes.

**Why:** A text element may have no own fill, while its enclosing shell uses layered gradients. Sampling the shell's plain background property misses the painted gradient and can falsely certify contrast. Chart data may also be unavailable even when its theme palette is configured.

**How to apply:** Target representative opaque cards for deterministic text checks. For a gradient or image, use image-aware pixel sampling or a separately justified worst-case palette test. Check chart palette on a known surface independently of whether seasonal records happen to render plotted points.