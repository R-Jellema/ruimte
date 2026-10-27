# APNs on the shared Pulsar Worker

Development and production devices use the same Worker and database. The registered
APNs environment selects both the Apple endpoint and the credential pair. It does not
select a different broker, TURN server, Worker hostname or Apple team.

| Device environment | Private-key secret | Key-ID secret | Current key ID |
| --- | --- | --- | --- |
| `sandbox` | `APNS_SANDBOX_KEY` | `APNS_SANDBOX_KEY_ID` | `Q39B5735J7` |
| `production` | `APNS_PRODUCTION_KEY` | `APNS_PRODUCTION_KEY_ID` | `9X8N3H3LXC` |

`APNS_TEAM_ID=7RGV9KKX87` and `APNS_TOPIC=app.ruimte.mobile` are shared configuration
in `wrangler.jsonc`. Normal notifications and Live Activities use the same selected
key.

Each environment has its own JWT cache. Missing credentials reject registration and
delivery for that environment with HTTP 503; the Worker never substitutes the other
key. Device records are unique per account session and environment, so registering a
production device does not overwrite its sandbox counterpart.

## Local custody

The original files are stored on Bas's Mac in `~/.private/ruimte/apns/`:

- `AuthKey_Q39B5735J7.p8`
- `AuthKey_9X8N3H3LXC.p8`

The directory has mode 700 and files have mode 600. Both were validated as P-256
private keys before the Downloads copies were removed. Local parsing cannot prove a
key's Apple-side permissions or environment scope. There is no off-machine backup.

Never commit key contents or include them in command arguments, logs or reports.
Cloudflare receives them as Worker secrets, separately from the nonsecret team and
topic configuration. Deploying with `--keep-vars` preserves the other provider
secrets on the shared Worker.

## What the Worker relays

The daemon decides every alert, read receipt and Live Activity update
(`apps/server/README.md#push-notifications`); the Worker checks the account and the
signature and relays. A read receipt goes out as a silent push with priority 5 under a
collapse key of its own, so it never replaces a pending alert. An automatic Live Activity accepts
only the fixed machine-summary collapse ID, and a token registration must match the
work round that started the activity, so a late one from an older round changes nothing.
Live Activity requests append `.push-type.liveactivity` to the topic.

Every isolate signs with one provider token per environment, kept in `apns_provider_tokens`
for 50 minutes. APNs answers `429 TooManyProviderTokenUpdates` when the token changes more
than once in 20 minutes, which a token per isolate did all day. While D1 does not answer, an
isolate signs a token of its own so the push still goes out.

## Open

Delivery to a production-signed app has never been tested. A sandbox test does not
establish it, so it needs a production-signed build and its device token. The check is
in [`docs/ACCEPTANCE.md`](../../docs/ACCEPTANCE.md#push-notifications).
