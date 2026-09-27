---
name: App Storage server credentials
description: Credential source needed by server-side Google Cloud Storage clients in this workspace
---

Server-side App Storage access in this Replit workspace needs the local Replit sidecar external-account credential configuration, not a default Google Cloud Storage client.

**Why:** A direct Storage client using application default credentials failed despite successful bucket provisioning and environment configuration. The provided App Storage template uses a sidecar credential and token exchange endpoint; that configuration worked for streaming uploads and reads.

**How to apply:** When adding another server-side App Storage client, inspect the current Replit object-storage template and use its sidecar credential configuration. Do not copy credential values or assume the presence of application default credentials.