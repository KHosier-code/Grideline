# Moving Gridline off Replit (Railway + Neon)

This guide moves the live site at gridelineanalytics.com from Replit to:

- **Neon**: the Postgres database (free tier to start, about $19/month if you outgrow it)
- **Railway**: runs the API, the data worker and the website in one always-on service (about $5–10/month)

The repository already has what Railway needs: `Dockerfile`, `railway.json` and
`deploy/start.mjs`. The same image was built and started against a TLS Postgres
database during preparation. The database check, API, website and data worker
all started.

**Keep Replit running until step 6.** Nothing below affects the live site until
you move the domain.

---

## 1. Write down your Replit secrets

In Replit, open **Secrets**. Also open **Publishing → your deployment →
Secrets/Environment**, because production values can differ from development
values. Copy each of these that exists into a password manager:

| Name | What it is | Needed? |
|---|---|---|
| `DATABASE_URL` | Replit's database. You only need it for the export in step 3 | Export only |
| `CLERK_SECRET_KEY` | Sign-in (server side), starts with `sk_live_` | Yes |
| `CLERK_PUBLISHABLE_KEY` | Sign-in (public), starts with `pk_live_` | Yes |
| `VITE_CLERK_PUBLISHABLE_KEY` | Usually the same value as above | Yes |
| `VITE_CLERK_PROXY_URL` | Usually `https://gridelineanalytics.com/api/__clerk` | If present |
| `ODDS_API_KEY` | Sportsbook odds | Yes |
| `SPORTSDATAIO_API_KEY` | Depth charts | If present |
| `NWS_USER_AGENT` | Weather | If present |
| `ADMIN_USER_IDS` / `ADDITIONAL_ADMIN_USER_IDS` | Who can open Admin. Currently `user_3JKTsuZeSJyBHBDeKX1xOOK93nU` | Yes |
| `GRIDLINE_RED_ZONE_ENABLED` | Shows the Red Zone page when `1` | If present |

**About sign-in (Clerk):** Replit's "Users & Auth" set up Clerk for you. If you
can see the `sk_live_…` and `pk_live_…` keys, reuse them. Existing accounts and
your admin login then keep working, because the site stays on the same domain.
If Replit hides the keys, create a free account at clerk.com, add a production
instance for `gridelineanalytics.com` with the proxy path `/api/__clerk`, and
use its keys. In that case users (including you) sign up again. Afterwards, set
`ADDITIONAL_ADMIN_USER_IDS` to your new Clerk user ID so Admin still works.

## 2. Create the Neon database

1. Sign up at neon.tech and create a project named `gridline` on **Postgres 16**,
   in the US East region.
2. Copy the connection string. It looks like
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.
   Keep `?sslmode=require`, because the app refuses to start without TLS.

## 3. Copy the data from Replit to Neon (trial run)

In the Replit **Shell**, type the following, replacing the placeholder values.
Use the **production** database URL from Publishing, not the development one:

```
pg_dump "PASTE_REPLIT_PRODUCTION_DATABASE_URL" --no-owner --no-acl -Fc -f /tmp/gridline.dump
pg_restore --no-owner --no-acl -d "PASTE_NEON_URL" /tmp/gridline.dump
```

A few "already exists" warnings from `pg_restore` are normal. Saving the file
in `/tmp` keeps it out of Git. Never commit a database dump.

This is a trial copy for testing. You repeat it in step 6 so no data is lost.

## 4. Create the Railway service

1. Sign up at railway.com with GitHub, then choose **New Project → Deploy from
   GitHub repo → KHosier-code/Grideline**, branch `main`.
2. Railway finds `railway.json` and builds with the `Dockerfile`.
3. Under **Variables**, add:
   - `DATABASE_URL`: the **Neon** URL
   - every "Yes / If present" value from step 1
   - `PUBLIC_SITE_URL` = `https://gridelineanalytics.com`
   - **Do not** add `GRIDLINE_NEW_WORKER_APPROVED` yet. See step 6.
4. Deploy. When the deploy finishes, open **Settings → Networking → Generate
   Domain** to get a test URL (`something.up.railway.app`).
5. Check that `https://something.up.railway.app/api/healthz` shows `{"status":"ok"}`
   and that Games and Game Detail show your data. Sign-in may not work on the
   Railway test URL. That's expected, because Clerk is tied to your real domain.

## 5. Why only one copy of the worker

The data worker captures odds, locks picks before kickoff and grades them. Two
workers writing at the same time can collide, so only one may run.

- Railway: keep **Replicas = 1** (already set in `railway.json`).
- The worker stays off until `GRIDLINE_NEW_WORKER_APPROVED=1` is set.

## 6. Switch over (about 30 minutes, ideally Tuesday or Wednesday)

Pick a time with no games, because the worker should not be offline around kickoffs.

1. **Stop Replit.** In Replit Publishing, shut down or unpublish the
   deployment. Its worker must stop before the new one starts.
2. **Final data copy.** Repeat step 3. First empty the Neon database: in Neon,
   delete and recreate the `neondb` database, or create a fresh branch and use
   its URL.
3. **Turn on the worker.** In Railway Variables, add `GRIDLINE_NEW_WORKER_APPROVED` = `1`.
   Railway redeploys automatically.
4. **Move the domain.** In Railway, open **Settings → Networking → Custom Domain**
   and add `gridelineanalytics.com` (and `www.` if you use it). Railway shows the
   DNS records. At your domain registrar, replace Replit's records with
   Railway's. The change usually takes effect within minutes, but can take up to a few hours.
5. **Check it.** Once the domain loads from Railway:
   - https://gridelineanalytics.com/api/healthz returns `{"status":"ok"}`
   - you can sign in and open Admin
   - in Railway **Logs**, you see `Recurring data scheduler started`
   - in Admin → Data Health, new successful feed runs appear within a few hours

## 7. After a week of stable running

- Cancel the Replit deployment and plan.
- Make the GitHub repo private if you don't want the code public
  (GitHub → Settings → General → Danger Zone).

## If something goes wrong

Rolling back is quick while Replit still exists. Point the DNS back to Replit,
remove `GRIDLINE_NEW_WORKER_APPROVED` from Railway, and re-publish on Replit.
Only one worker should run at a time.

## Future database changes

Replit used to apply schema changes automatically when you published. Now that
the site is off Replit, a schema change has to be applied to Neon before the
new code is deployed (for example with `pnpm --filter @workspace/db run push`
against the Neon URL, after reviewing the diff). Ask for help the first time
this comes up.
