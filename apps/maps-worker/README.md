# Map service

`ruimte-maps` at `maps.ruimte.app`: a Cloudflare Worker that puts TomTom's Orbis map display and search behind a
ticket from the address book. It holds the TomTom key and nothing else of value, stores nothing, has no database and logs
nothing (`observability` is off in `wrangler.jsonc`, since Workers Logs would record which area was looked at).

## Routes

Every route but `/health` needs `Authorization: Bearer <ticket>`, a ticket from `POST /v1/maps/ticket` of the address
book (`apps/pulsar-worker`). The ticket rides in a header, never the URL, so it is in no log or cache key.

| Route | What |
| --- | --- |
| `GET /health` | `{ ok: true }`, without a ticket |
| `GET /v1/style?theme=light\|dark` | The monochrome Orbis style, with every address in it pointed at this service and the key removed |
| `GET /v1/map/<path>` | A map resource of TomTom: only `maps/orbis/display/...` and `maps/orbis/assets/...` (tiles, TileJSON, sprites, glyphs). Any other path is `not-found` and never fetched |
| `POST /v1/geocode` | `{ query, language? }` to `{ results: [{ lat, lon, label }] }`, at most one, from TomTom's Orbis search |

Answers that fail are `{ error: { code, message } }` with `maps-unconfigured` (503), `bad-ticket` (401), `rate-limited`
(429, with `retry-after`), `not-found` (404), `bad-request` (400) or `upstream` (502). TomTom's own error body is never
passed on, since it may echo the key. A key without the Search right makes `/v1/geocode` answer `upstream`.

## What stays out

- The key is added to the upstream request and removed from every JSON or text body (`sanitizedText`); a body that still
  holds it after the rewrite is not sent at all.
- Upstream requests carry only `user-agent: ruimte-maps`, `accept` and the key: no client address, cookie, referer or
  `x-forwarded-for`. A `key` parameter in a client's query is dropped.
- Each ticket's subject is a keyed digest of the account, so a request is counted per account without anyone reading whose it is.
  The platform rate limit (`TICKET_LIMIT`, 600 a minute per subject) uses it as its key.

## Cache

A successful response is kept at the edge (`caches.default`) for no longer than TomTom's `Cache-Control` says (`s-maxage`
before `max-age`, less its `Age`), and not at all under `no-store`, `no-cache`, `private` or no header. The key of an entry is
the upstream path and the sorted query without the key, so no ticket or key is in it. The client gets `private, max-age=<remaining>`.
Whether TomTom's terms allow a shared cache is not verified; turning it off is replacing `deps.cache` by one that never hits.

## Secrets

| Secret | What |
| --- | --- |
| `TOMTOM_API_KEY` | A TomTom key with Map Display, Assets and Search (Orbis) rights |
| `MAP_TICKET_SECRET` | The same value as the address book's, at least 32 bytes in base64url |

```sh
cd apps/maps-worker
bunx wrangler@4.136.3 secret put TOMTOM_API_KEY
bunx wrangler@4.136.3 secret put MAP_TICKET_SECRET
```

Until both exist every route but `/health` answers `maps-unconfigured`. A push to `main` that touches this folder or
`packages/pulsar` deploys it (`.github/workflows/maps-worker.yml`, repository secret `CLOUDFLARE_API_TOKEN`); the custom
domain `maps.ruimte.app` is created by the first deploy when the zone is on the same account.

## Not verified against the live service

The style path (`maps/orbis/assets/styles/0.*/style`), the vector tile path and the search path
(`maps/orbis/places/search/<text>.json`) follow TomTom's documentation of 15 October 2026 but were never called with a key.
The allowlist accepts any `maps/orbis/display` or `maps/orbis/assets` path, so a different tile path in the live style still works.

## Development

`bun test` runs the handlers against a fake upstream and a fake cache. `bun run dev` serves them locally with secrets from
`.dev.vars` (ignored by git).
