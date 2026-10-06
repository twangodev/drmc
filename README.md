# DRMC

Connect Discord and Last.fm at `/app` to share your music as a Discord Listening
activity. The service runs entirely on Cloudflare Workers and Durable Objects,
including polling and the Discord connection after your browser closes.

## Development

Use Bun 1.4+ and Node.js 24+.

```sh
bun install
cp .dev.vars.example .dev.vars
openssl rand -hex 32
```

Set the generated value as `TOKEN_ENCRYPTION_KEY` in `.dev.vars`, along with your
Discord client ID/secret and Last.fm API key/shared secret. Register
`http://localhost:8787/auth/discord/callback` in the Discord Developer Portal and
`http://localhost:8787/auth/lastfm/callback` for your Last.fm API account. Set
`SERVICE_ENABLED=true`, then run `bun run dev` and open `http://localhost:8787/app`.
Last.fm uses its signed browser authorization flow, rather than OAuth2.

```sh
bun run check
bun run build
bun run test:worker
bun run test:web
```

Worker tests execute the deployment bundle in Miniflare/workerd with SQLite
Durable Objects and simulated providers. Browser tests use Chromium through
Wrangler; install it with `bunx playwright install chromium`. The service tests
exercise actual scheduled alarms, so the retry tests take about two minutes.
Run `bun run build:app` after frontend edits during local development.

## Deployment

The single `.github/workflows/svelte.yaml` checks types, builds a release, runs
Worker and browser tests, and deploys that exact artifact to `drmc.twango.dev`.
Main pushes and manual main runs deploy; pull requests run checks.

Configure these GitHub settings, preferably in the `production` environment:

| Kind | Name |
| --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` |
| Variable or secret | `CLOUDFLARE_ACCOUNT_ID` |
| Variable | `DISCORD_CLIENT_ID` |
| Variable | `SERVICE_ENABLED=true` |
| Secret | `DISCORD_CLIENT_SECRET` |
| Secret | `LASTFM_API_KEY` |
| Secret | `LASTFM_API_SECRET` |
| Secret | `TOKEN_ENCRYPTION_KEY` |

The Cloudflare token needs Workers deployment access and Workers Routes Write
for the `twango.dev` zone. Register these production callbacks:

- Discord: `https://drmc.twango.dev/auth/discord/callback`
- Last.fm: `https://drmc.twango.dev/auth/lastfm/callback`

Provider credentials are uploaded through a temporary private secrets file.
The encryption key must stay stable across deployments to read existing grants.
Run `APP_ORIGIN=https://drmc.twango.dev bun run check:deployment` locally for
hosted smoke checks; CI does not run hosted verification.

## Account lifecycle

A browser-bound, ten-minute, single-use authorization attempt protects each
provider callback. Discord establishes the browser session; Last.fm verifies the
account whose music will be shared. Browser sessions expire after 30 days.
Credentials and session cookies use AES-GCM, with account-bound encryption for
stored provider grants. Secrets never appear in account API responses.

Each account owns a SQLite Durable Object. It polls Last.fm approximately every
15–18 seconds, resolves album artwork, refreshes expiring Discord grants, and
heartbeats its OAuth Gateway connection. Every 15 minutes it verifies the Last.fm
session and stops sharing if that authorization was revoked. Alarms restore work after object eviction
or deployment. Reconnects use bounded backoff. Temporary Last.fm failures preserve
the most recent activity for about two minutes before clearing it.

Pause clears the activity and stops syncing. Resume restarts it. Signing out
invalidates the browser session while music sharing continues. Disconnect clears
the activity, removes the Last.fm credential, and revokes the Discord grant.
Failed revocations retain encrypted credentials only for scheduled cleanup retries;
the browser session is invalidated immediately. Last.fm permissions can also be
revoked from Last.fm settings.

The Discord OAuth Gateway protocol and artwork flow are adapted from
[Discord-Social-RPC 0.2.3](https://github.com/LeonLeBreton/Discord-Social-RPC/tree/b4996e61547505742b141378fe073650808adfd4).
Its MIT license is retained in the source and Worker bundle. The undocumented
transport passed a real cloud presence test; simulated tests do not replace
verification that music is visible in Discord. Outbound WebSockets keep active
Durable Objects running, so continuous listening consumes object duration.

## Presence probe

`/probe` remains an operator diagnostic. Enable `PROBE_ENABLED=true`, configure
`PROBE_ALLOWED_DISCORD_IDS` and a random `PROBE_ACCESS_KEY` of at least 32
characters, and register `/probe/callback` with Discord. The optional presence
experiment displays a test activity for 45 seconds, clears it, and revokes its
grant. Its JSON report contains sanitized lifecycle evidence, never tokens.
Use a separate test account/application when your regular music service is active:
revocation affects the application's authorization grant.

## Structure

Svelte 5, SvelteKit, and Tailwind 4 live at the project root. Pages prerender into
Workers Static Assets; `/api/*` and `/auth/*` run through the Worker. Provider and
credential abstractions live in `src/lib/server`. `worker/cloudflare` owns durable
storage and the outbound WebSocket adapter. The UI uses the reference projects'
warm neutrals, fine borders, self-hosted fonts, and light/dark themes.

[Apache License 2.0](LICENSE).
