-- A peer statement lets one machine of an account work in another. `machine_id` is the machine worked in, `device_public_key` the peer key.
ALTER TABLE statement_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'client';
ALTER TABLE statement_log ADD COLUMN peer_machine_id TEXT;
