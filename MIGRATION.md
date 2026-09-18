# Migration — velbaz7-1022 → managed Runable app (velbaz7)

Second port. `https://github.com/johnghost-j/velbaz7-1022.git` (template 0.7.0) was copied onto a freshly provisioned managed app scaffold (template **0.8.0**). Nothing from the repo was dropped: 524 repo files → 524 identical files in the app, plus the provisioned `.env`.

## What was verified (2026-09-11)

| Step                                            | Result                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| File-level completeness                         | 524/524 repo files present, byte-identical                                                                                     |
| Protected template files                        | 13/13 identical between 0.7.0 and 0.8.0 — only \_\_ports.cjs changed (now reads .runable/ports.json), kept from the new scaffold |
| Dependency install                              | ok (bun install, isolated per-package node\_modules)                                                                            |
| Schema push to Turso                            | ok (db:push → "Changes applied")                                                                                               |
| Full build                                      | ok (bun run build → tsc --noEmit + vite build, 2/2 packages, 1m41s)                                                            |
| Dev server                                      | ok on port 4200                                                                                                                |
| Routes / /login /dashboard /chat /editor /plans | all HTTP 200, rendered and screenshotted                                                                                       |
| /api/health                                     | HTTP 200 {"status":"ok"}                                                                                                       |
| Auth + DB write                                 | POST /api/auth/register then /api/auth/login → 200, user created with 5000-credit signup bonus (test user deleted afterwards)  |
| AI gateway                                      | ok (bun gw-check.ts → "GATEWAY OK")                                                                                            |
| Lint integrity                                  | 0 template-integrity / protected-file / asset-location violations                                                              |

## Managed infra provisioned (live in root `.env`)

New values, provisioned for this app — not the previous sandbox's keys:

`DATABASE_URL`, `DATABASE_AUTH_TOKEN` (Turso), `S3_*` (Tigris storage), `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY`, `BETTER_AUTH_SECRET`, `AUTUMN_SECRET_KEY`, `APPLICATION_ID`, `WEBSITE_URL`, `VITE_RUNABLE_AUTH_ISSUER`, `VITE_APPLICATION_ID`, `RUNABLE_URL`.

Ports are fixed in `.runable/ports.json` (web 4200, mobile 4300, desktop 4400).

## Optional integration keys NOT set

The code reads these; the app boots and runs without them. Every feature degrades honestly — it announces the missing key instead of faking a result — and stays inert until the key is supplied.

**Two ways to supply a key.** Keys marked **Admin Panel** are in `KNOWN_SECRETS` (`packages/web/src/api/secret-store.ts`): they are entered at runtime from Admin Panel → API Keys, stored AES-encrypted in the DB, and no restart or `.env` edit is needed. Keys marked **.env** are read straight from `process.env` and require an `.env` entry plus a restart.

### Payments — Stripe (`api/billing.ts`)

| Key                   | Where       | Effect if missing                                                                                                                                      |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STRIPE\_SECRET\_KEY     | Admin Panel | No real checkout. Plans page and credit packs stay visible but report that payment is unconfigured.                                                    |
| STRIPE\_WEBHOOK\_SECRET | Admin Panel | Optional even with Stripe live: /api/billing/webhook skips signature verification, and the return-to-site confirmation path still credits the account. |

### Custom domains (`api/domains.ts`)

Works with **zero keys**: real DNS verification (DNS-over-HTTPS, Cloudflare + Google fallback), domain uniqueness, and serving the published site on the customer's domain over **HTTP**.

| Key                  | Where       | Effect if missing                                                                                                                                                                                                                                               |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLOUDFLARE\_API\_TOKEN | Admin Panel | No automatic HTTPS/CDN on customer domains (Cloudflare for SaaS). Needs the "SSL and Certificates: Edit" permission. Domain still connects, verifies and serves over HTTP; the UI says so rather than advertising a nonexistent certificate (ssl: "unmanaged"). |
| CLOUDFLARE\_ZONE\_ID   | Admin Panel | Same. Required together with the token — the zone that hosts the custom hostnames.                                                                                                                                                                              |
| VELBAZ\_DOMAIN\_TARGET | Admin Panel | Optional override. CNAME target announced to customers. Default cname.velbaz.site.                                                                                                                                                                              |
| VELBAZ\_ROOT\_DOMAIN   | Admin Panel | Optional override. Hosting root domain used for \*.velbaz.site subdomains. Default velbaz.site.                                                                                                                                                                  |
| VELBAZ\_DEPLOY\_TOKEN  | Admin Panel | Optional external hosting provider token. Without it the site is still published on Velbaz's own hosting (/s/:subdomain).                                                                                                                                       |

A key present but **invalid** is distinguished from a key absent: the Cloudflare call is really made, its rejection is surfaced, and the state becomes `ssl: "failed"` (vs `"unmanaged"`).

### Domain purchase — registrar Namecheap (`api/index.ts`)

Availability search (RDAP, public) works without any key. The 4 below are required **together**; without them the purchase endpoint answers `501` and names the missing keys.

| Key                 | Where                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| NAMECHEAP\_API\_USER  | Admin Panel                                                                 |
| NAMECHEAP\_API\_KEY   | Admin Panel                                                                 |
| NAMECHEAP\_USERNAME  | Admin Panel                                                                 |
| NAMECHEAP\_CLIENT\_IP | Admin Panel — the server IP must be whitelisted in Namecheap's API settings |

### Error monitoring & self-healing — Sentry (`api/selfheal/sentry.ts`)

| Key | Where | Effect if missing |
|-----|-------|-------------------|
| `SENTRY_DSN` | Admin Panel | Errors are not sent to Sentry. Self-healing falls back to the internal `error_logs` stream. |
| `SENTRY_AUTH_TOKEN` | Admin Panel | Self-healing cannot READ issues back from the Sentry API. |
| `SENTRY_ORG` | Admin Panel | Required with the auth token (org slug). |
| `SENTRY_PROJECT` | Admin Panel | Required with the auth token (project slug). |
| `SENTRY_API_URL` | Admin Panel | Optional. Only for self-hosted Sentry; defaults to `sentry.io`. |

Note: no Sentry value is stored in the repo or in the root `.env` — the five keys
are entered in the Admin Panel (encrypted secret store) when you want Sentry on.
`SELFHEAL_DISABLED=1` (env) turns self-healing off entirely.

### Email (`api/email.ts`)

| Key                  | Where       | Effect if missing                                               |
| -------------------- | ----------- | --------------------------------------------------------------- |
| RESEND\_API\_KEY       | Admin Panel | No transactional email is sent.                                 |
| RESEND\_FROM          | Admin Panel | Default "from" address, e.g. Velbaz <no-reply@ton-domaine.com>. |
| EMAIL\_WEBHOOK\_SECRET | Admin Panel | Incoming email webhooks are not signature-verified.             |

### Media generation — Higgsfield (`api/higgsfield.ts`)

| Key                                                            | Where       | Effect if missing                                                     |
| -------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| HF\_API\_KEY / HF\_API\_SECRET                                     | Admin Panel | Image/video generation via Higgsfield is unavailable.                 |
| HF\_CREDENTIALS                                                 | Admin Panel | Alternative combined form (key:secret).                               |
| HIGGSFIELD\_KEY\_ID / HIGGSFIELD\_KEY\_SECRET / HF\_KEY / HF\_SECRET | .env        | Legacy env fallbacks, read only if the Admin Panel values are absent. |
| HF\_BASE\_URL                                                    | .env        | Optional API base override.                                           |

### GitHub export (`api/github.ts`)

| Key          | Where       | Effect if missing                           |
| ------------ | ----------- | ------------------------------------------- |
| GITHUB\_TOKEN | Admin Panel | Projects cannot be exported to GitHub.      |
| GITHUB\_OWNER | Admin Panel | Target account/organization for the export. |

### Builder & AI extras

| Key                                                                                                                             | Where | Effect if missing                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| TWENTY\_FIRST\_API\_KEY                                                                                                            | .env  | No 21st.dev premium React components; the builder falls back to its own generated components.        |
| FIRECRAWL\_API\_KEY                                                                                                               | .env  | Web scraping uses the local headless browser instead of Firecrawl.                                   |
| OPENROUTER\_API\_KEY                                                                                                              | .env  | OpenRouter routing unavailable (an openrouter provider key in the secret store also satisfies this). |
| AI\_MODEL, IMAGE\_MODEL, UNCENSORED\_MODEL, TIER\_MODEL\_LITE/\_PRO/\_MAX, BUILDER\_REPAIR\_MODEL, SELFHEAL\_MODEL, COMMS\_REASONING\_MODEL | .env  | Model overrides. Built-in defaults are used.                                                         |
| AI\_CREDITS\_PER\_USD                                                                                                              | .env  | Credit-to-USD conversion rate. Default applies.                                                      |
| SELFHEAL\_DISABLED                                                                                                               | .env  | Set to disable automatic self-healing.                                                               |

### Social publishing (`api/social/`)

OAuth client pairs, all **.env**. Each platform's publishing stays disabled until its pair is set: `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_BOT_TOKEN`, `INSTAGRAM_CLIENT_ID`/`INSTAGRAM_CLIENT_SECRET`, `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`, `TWITTER_CLIENT_ID`/`TWITTER_CLIENT_SECRET`, plus `OAUTH_REDIRECT_BASE`, `OAUTH_STATE_SECRET` and `X_LIVE_ENABLED`.

### Platform / operational

| Key                                                                                  | Where | Effect if missing                                                                                   |
| ------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------- |
| SECRET\_STORE\_KEY                                                                     | .env  | The API-key vault falls back to BETTER\_AUTH\_SECRET for encryption. Set it explicitly in production. |
| ADMIN\_EMAILS                                                                         | .env  | Falls back to the built-in default admin address — set it to control who reaches the admin pages.   |
| BETA\_PUBLIC\_CODE, BETA\_ADMIN\_CODE, BETA\_MAX\_TESTERS                                  | .env  | Beta access codes and tester cap; defaults apply (VELBAZ-BETA).                                     |
| PUBLIC\_BASE\_URL / APP\_BASE\_URL / VELBAZ\_URL / VELBAZ\_API\_URL                         | .env  | Absolute-URL generation falls back to WEBSITE\_URL.                                                  |
| VELBAZ\_APPS\_ROOT, CHIMERA\_ASSETS\_DIR, MAX\_AUTO\_RELAUNCH\_PER\_BOOT, DISABLE\_SERVER\_JSX | .env  | Builder runtime paths and limits; defaults apply.                                                   |

## Known inherited debt

`bun run lint` reports 595 errors, all pre-existing in the copied source (579 on 0.7.0; the extra 16 come from newer rules in 0.8.0). Breakdown: `no-unused-vars` (156), `react-hooks/exhaustive-deps` (43), `max-lines` (5), misc unicorn/eslint. Build and runtime are unaffected.

## Commands

```
bun run dev      # web on 4200
bun run build    # build all packages
bun run start    # pm2 production server
cd packages/web && bun run db:push
```
