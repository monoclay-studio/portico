-- Bind idempotency records to the caller that created them: a stored response (which may contain personal data)
-- is only ever replayed to the same actor; anyone else reusing the key is rejected.
alter table core.idempotency_keys add column actor_key text;
