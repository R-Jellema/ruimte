# Usage dashboard

`ruimte-stats` at `stats.ruimte.app`: a Cloudflare Worker that draws the anonymous usage statistics on one page for Bas,
and rolls them up every night. The address book (`apps/pulsar-worker`) takes the batches and writes them to the Analytics
Engine dataset `ruimte_usage`; its README has the wire and the layout of a data point. This worker only reads.

## Who gets in

Cloudflare Access stands in front of the domain, with an application for `stats.ruimte.app` that lets in one email.
The worker does not trust that alone: every request must carry `Cf-Access-Jwt-Assertion`, an RS256 token signed by one
of the team's keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), for the application's AUD tag, from the
team's issuer, within its times, and for `ACCESS_EMAIL`. Anything else is a 403. Without `ACCESS_TEAM_DOMAIN` and
`ACCESS_AUD` every request is a 503, so a worker deployed before its Access application shows nothing.

## What it reads

- `usage_daily` in the address book's D1 database (`ruimte-pulsar`, migration `0017_usage_daily.sql`): one total per
  day, metric and, for presence, segment value. The nightly cron (`40 2 * * *`) reads the last nine finished days from
  Analytics Engine again and replaces them whole, so a day that arrived up to eight days late is in it, and running it
  twice changes nothing. Analytics Engine keeps three months; this table keeps the rest.
- Analytics Engine itself, through the SQL API, for the last nine days and today, on every view. Each query's answer is
  kept in the Cache API for ten minutes, so the page costs at most ten reads per ten minutes.

Every query weighs by `_sample_interval` and leaves out versions that start with `0.0.0`, the version of a test batch.
The queries are built from the layout table in `packages/pulsar/src/usage.ts` (`src/queries.ts`), so the dashboard reads
the columns the address book writes.

## What it shows

Daily active machines (a machine that sent a day), weekly and monthly active machines (the sums of `firstThisWeek` per
ISO week and `firstThisMonth` per calendar month), versions over the last 7 days, platform, architecture, how the
daemon runs and the signed-in share over the last 28 days, feature counts, chats and turns per provider, retention per
cohort week (the share of a cohort active in each week after its first), and the desktop startup time (the median and
90th percentile per day over the machines' daily medians).

## Secrets

| Secret | What |
| --- | --- |
| `ANALYTICS_API_TOKEN` | A Cloudflare API token with Account, `Account Analytics`, Read, and nothing else |
| `ACCESS_TEAM_DOMAIN` | The Zero Trust team domain, such as `ruimte.cloudflareaccess.com` |
| `ACCESS_AUD` | The Application Audience (AUD) tag of the Access application for `stats.ruimte.app` |

```sh
cd apps/stats-worker
bunx wrangler@4.136.3 secret put ANALYTICS_API_TOKEN
bunx wrangler@4.136.3 secret put ACCESS_TEAM_DOMAIN
bunx wrangler@4.136.3 secret put ACCESS_AUD
```

Without `ANALYTICS_API_TOKEN` the page shows the rollups only and the cron skips the rollup.

## Deploying

A push to `main` that touches this folder or `packages/pulsar` deploys it (`.github/workflows/stats-worker.yml`, the
repository secret `CLOUDFLARE_API_TOKEN`). By hand: `bun run deploy` in this folder. The rollup table's migration ships
with the address book's deploy.
