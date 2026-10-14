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
| `GET /v1/m/<grant>/<tail>` | A tile, sprite, glyph range or TileJSON the style named, and only that: see below |
| `POST /v1/geocode` | `{ query, language? }` to `{ results: [{ lat, lon, label }] }`, at most one, from TomTom's Orbis search |

Answers that fail are `{ error: { code, message } }` with `maps-unconfigured` (503), `bad-ticket` (401), `rate-limited`
(429, with `retry-after`), `not-found` (404), `bad-request` (400) or `upstream` (502). TomTom's own error body is never
passed on, since it may echo the key. A key without the Search right makes `/v1/geocode` answer `upstream`.

## What it serves

Nothing but the style and what the style names. While the style is rewritten, each TomTom address in the places a style keeps one
(`sprite`, `glyphs`, a source's `tiles` and `url`) becomes `/v1/m/<grant>/<tail>`. The grant is the address as TomTom wrote it,
placeholders such as `{z}` included, under a mark only this service can make (`signMapsPath`, a key derived from `MAP_TICKET_SECRET`). A
request names a grant and fills the placeholders in the tail: three numbers for a tile, a font stack and a range for glyphs
(`Noto%20Sans%20Regular%2CNoto%20Sans%20Italic/0-255.pbf`), `sprite[@2x].json|png` for a sprite. The tail is matched
against that shape as it was sent, never decoded, and the upstream path is checked once more before it leaves: it must be map display or
its assets, the URL parser must not change it, and a `%` may only be a space or a comma. A TomTom address anywhere else in a body is blanked.
A client's query is never forwarded. An upstream body is JSON (rewritten, then searched for the key) or a known binary type
(vector tile, protobuf, png, webp, jpeg, gif); any other type is refused.

## What stays out

- The key is added to the upstream request. A JSON body is rewritten and then searched for it, and a body that still holds it is not sent at all.
- Upstream requests carry only `user-agent: ruimte-maps`, `accept` and the key: no client address, cookie, referer or
  `x-forwarded-for`. A `key` parameter in a client's query is dropped.
- Each ticket's subject is a keyed digest of the account, so a request is counted per account without anyone reading whose it is.
  The platform rate limit (`TICKET_LIMIT`, 600 a minute per subject) uses it as its key.

## Cache

A successful response is kept at the edge (`caches.default`) for no longer than TomTom's `Cache-Control` says (`s-maxage`
before `max-age`, less its `Age`), and not at all under `no-store`, `no-cache`, `private` or no header. The key of an entry is
the upstream path and the sorted query without the key, so no ticket or key is in it. The client gets `private, max-age=<remaining>`.
Whether TomTom's terms allow a shared cache is not verified; turning it off is replacing `deps.cache` by one that never hits.

## Who calls it

The client asks the address book for a ticket with its session (`AddressBookClient.mapsTicket`), keeps it until five minutes before it ends and sends it as a header
on every request to this origin and no other (`apps/client/src/chat/map-source.ts`). The daemon asks as the machine (`apps/server/src/maps/geocoder.ts`). The page's
policy already lets `https:` be fetched and `blob:` workers run, which is all MapLibre needs (`packages/csp`).

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

The style path (`maps/orbis/assets/styles/0.*/style`) and the search path (`maps/orbis/places/search/<text>.json`) follow TomTom's
documentation of 15 October 2026 but were never called with a key. What the style names is served whatever its shape, as long as it is
map display or assets with the placeholders of a tile (`{z}/{x}/{y}`) or of glyphs (`{fontstack}/{range}`); another placeholder, such as
`{ratio}`, makes the address unservable and it is blanked from the style. The first deploy with a key shows whether the live style fits.

## Development

`bun test` runs the handlers against a fake upstream and a fake cache. `bun run dev` serves them locally with secrets from
`.dev.vars` (ignored by git).
