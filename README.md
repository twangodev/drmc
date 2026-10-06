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
in Discord **User Settings → Authorized Apps**. Also remove it if the callback
is interrupted or an upstream token response cannot be validated. A successful
probe deliberately revokes the whole grant, so use a dedicated development app.

## Checks

```sh
bun run check
bun run test
bun run audit:discord
```

The tests build the deployment bundle and execute it through Miniflare/workerd
with SQLite Durable Objects. Discord responses are mocked; these tests do not
establish real Discord publishing support. `audit:discord` performs read-only
fetches of Discord's official stable and preview API specifications and lists
presence/activity route candidates. API specifications alone are not a complete
statement of application eligibility or transport support.

`bun run build` performs Wrangler's deployment dry run and writes ignored
artifacts to `dist/`. It does not deploy anything. Miniflare needs permission to
bind local loopback ports.

## Hosted experiment

Use an HTTPS `APP_ORIGIN` and register the matching `/probe/callback` redirect in
Discord. Set the client secret and operator key with Wrangler secrets. Keep the
probe disabled until test accounts are configured. Deploy only for a controlled
OAuth experiment; it still cannot publish presence. See the feasibility document
for the additional evidence needed before implementing the full service.

## Code organization

`src/discord` contains provider calls using injected standard `fetch`.
`src/oauth` defines the portable authorization-attempt contract. `src/probe`
handles configuration, request validation, and evidence reporting.
`src/cloudflare` implements durable storage; `src/index.ts` connects the adapter
to the Worker entrypoint. Provider code and probe behavior have no Cloudflare
imports or Bun runtime dependencies.

## License

[Apache License 2.0](LICENSE).
