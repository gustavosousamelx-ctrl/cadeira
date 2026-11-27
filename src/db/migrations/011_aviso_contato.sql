alter table contact_messages add column notify_to text, add column notified_at timestamptz,
  add column notify_attempts integer not null default 0, add column notify_after timestamptz not null default now();
