# DRMC

DRMC is intended to link Discord and Last.fm accounts and display Last.fm music
as a Discord Listening activity, with all service execution on Cloudflare Workers.

**The repository currently implements the Discord OAuth feasibility probe. The
music synchronization service is gated on a supported cloud-only publishing
transport.** Successful OAuth authorization does not establish that transport.

## Run the probe locally

Use Bun 1.4+ and Node.js 24+. Bun manages dependencies and scripts; Wrangler and
the integration test runner use Node. The deployed code uses Workers APIs.

```sh
bun install
cp .dev.vars.example .dev.vars
```

Create a dedicated development application in the
[Discord Developer Portal](https://discord.com/developers/applications). Register
`http://localhost:8787/probe/callback` as its OAuth redirect URI. Configure these
values in the ignored `.dev.vars` file:

| Setting | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | The application's public ID |
| `DISCORD_CLIENT_SECRET` | Its OAuth client secret |
| `PROBE_ALLOWED_DISCORD_IDS` | Comma-separated test account IDs |
| `PROBE_ACCESS_KEY` | A random operator secret of at least 32 characters |
| `PROBE_ENABLED` | `true` to permit experiments |
| `APP_ORIGIN` | `http://localhost:8787` locally; an HTTPS origin when hosted |

Generate an operator secret locally with `openssl rand -hex 32`. Never commit
secrets or put them in a URL. `PROBE_ENABLED` defaults to `false`, and an empty
test-account allowlist prevents the probe from starting.

```sh
bun run dev
```

Open `http://localhost:8787/probe`, enter the operator key, and review Discord's
authorization screen. The probe requests `identify`, `openid`, and
`sdk.social_layer_presence`. The latter covers more social features than music
publishing alone; this experiment should use development accounts.

The callback checks the authorized application and allowlisted user, refreshes
the token, inspects the new authorization, and revokes the obtained grant.
The JSON report lists scopes and lifecycle results. It never returns tokens,
authorization codes, or the operator key. Every report retains
`gate: "unverified"` and `publication: "not_tested"`.

Tokens exist only in the callback's memory. Browser-bound, ten-minute, one-use
authorization attempts use SQLite Durable Objects and are deleted on consumption
or expiry. No Last.fm account is linked and no music polling runs yet.

If cleanup reports `failed`, remove the development application's authorization
in Discord **User Settings → Authorized Apps**. `cleanupFailure` contains a
sanitized error code and HTTP status for diagnosis. On HTTP 429 it also includes
safe `rateLimit` metadata: response format, retry delay, scope, and global flag
when supplied by Discord. Revocation retries once after Discord's specified wait
if that wait is at most five seconds. Longer or unspecified waits require manual
revocation; tokens are never persisted for a background retry. Also remove it if
the callback is interrupted or an upstream token response cannot be validated. A successful
probe deliberately revokes the whole grant, so use a dedicated development app.

## Checks

```sh
bun run check
bun run test
bun run test:web
bun run audit:discord
```

The tests build the deployment bundle and execute it through Miniflare/workerd
with SQLite Durable Objects. Discord responses are mocked; these tests do not
establish real Discord publishing support. `audit:discord` performs read-only
fetches of Discord's official stable and preview API specifications and lists
presence/activity route candidates. API specifications alone are not a complete
statement of application eligibility or transport support.

`bun run build` performs Wrangler's deployment dry run and writes ignored
Worker artifacts to `dist/` and prerendered SvelteKit assets to `build/`.
It does not deploy anything. Miniflare needs permission to
bind local loopback ports.

`test:web` runs Chromium against the built app through Wrangler, checking the
publishing gate, responsive layout, theme persistence, CSP hydration, and probe
readiness. Run `bun run build` first and install Playwright's Chromium if it is
not already available (`bunx playwright install chromium`).

`bun run dev` builds the frontend before starting Wrangler. After frontend edits,
run `bun run build:app` to refresh the assets served by the local Worker. The
frontend and OAuth routes use the same origin; no second application server is
needed. The frontend never receives the Discord client secret or operator key
from the server.

## Hosted experiment

The single `.github/workflows/svelte.yaml` workflow checks types, builds one
release artifact, runs Worker and browser tests, and deploys that artifact to
Cloudflare. Hosted verification can be run locally with `bun run check:deployment`.
Pushes to `main` and manual runs on `main` deploy; pull requests only run checks.

Set these repository or `production` environment settings in GitHub:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Workers deployment access and Workers Routes Write for the `twango.dev` zone |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | The target Cloudflare account ID |
| Optional variable | `APP_ORIGIN` | Override the production origin, `https://drmc.twango.dev` |

Wrangler attaches `drmc.twango.dev` as the Worker's custom domain and manages its
DNS and certificate. The first deployment serves the UI with the probe disabled.
To enable a controlled OAuth experiment, register
`https://drmc.twango.dev/probe/callback` in Discord,
set GitHub variables `DISCORD_CLIENT_ID`, `PROBE_ALLOWED_DISCORD_IDS`, and
`PROBE_ENABLED=true`, and secrets `DISCORD_CLIENT_SECRET` and `PROBE_ACCESS_KEY`.
Deployment validates this configuration before uploading. Provider secrets are
uploaded through a temporary private file, never as command-line arguments.
Successful OAuth still does not establish presence publishing support.

For a manual deployment using an authenticated Wrangler session:

```sh
bun run build:release
APP_ORIGIN='https://drmc.twango.dev' CLOUDFLARE_ACCOUNT_ID='<account_id>' bun run deploy
APP_ORIGIN='https://drmc.twango.dev' bun run check:deployment
```

Use the actual origin and account ID in place of the placeholders. The deploy
command uploads the already-built Worker and assets; it does not rebuild them.

## Code organization

The root project uses Svelte 5 / SvelteKit with Tailwind 4. Pages are rendered at
build time and served by Workers Static Assets. Dynamic API and OAuth paths run
through the Worker first. `/api/probe` reports only probe readiness; credential
validation remains in the backend. The authorization form submits directly to
the Worker, and the callback retains its sanitized JSON evidence report.

The UI follows the typography, warm neutral palette, fine borders, and compact
controls of the `twangodev` and `sdocx` references. It supports light and dark
themes with a local preference. Fonts are self-hosted with their original
licenses in `static/fonts/`; application components are written for DRMC.

`src/lib/server/discord` contains provider calls using injected standard `fetch`.
`src/lib/server/oauth` defines the portable authorization-attempt contract. `src/lib/server/probe`
handles configuration, request validation, and evidence reporting.
`worker/cloudflare` implements durable storage; `worker/index.ts` connects the adapter
to the Worker entrypoint. Provider code and probe behavior have no Cloudflare
imports or Bun runtime dependencies.

## License

[Apache License 2.0](LICENSE).
