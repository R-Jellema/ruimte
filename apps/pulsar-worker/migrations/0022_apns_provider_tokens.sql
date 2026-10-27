-- One APNs provider token per environment, shared by every isolate. APNs answers 429 TooManyProviderTokenUpdates
-- when a provider's token changes more than once in 20 minutes, which a token per isolate did all day.
CREATE TABLE apns_provider_tokens (
    environment TEXT PRIMARY KEY,
    key_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    token TEXT NOT NULL
);
