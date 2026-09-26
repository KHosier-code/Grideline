---
name: Production database identity
description: Establish deployed API and worker database identity without disclosing connection strings.
---

For a release gate, querying Replit's managed production read replica establishes what is in that replica, **not** which database the deployed API or worker actually uses. Correlate deployment-specific, non-sensitive evidence written by the live process (such as a unique build ID and check time) with its startup logs and rows in the managed database; separately correlate worker log times with its persisted run rows. Confirm the deployed code gives the API and worker the same inherited database environment. Do not call a matching database name by itself proof of instance identity.

**Why:** A deployment may be configured with a different database URL from the managed production replica even when both are reachable. Read-only catalog metadata cannot identify an application connection unless it is tied to a unique observed runtime event.

**How to apply:** During production read-only audits, collect metadata and live-build/worker correlations without printing credentials. If the correlations or shared-environment startup path are unavailable, mark app/worker identity unverified and stop before evaluating a managed-production schema migration as applicable.