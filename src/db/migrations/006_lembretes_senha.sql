-- 006: menos faltas (lembrete enviado, presença confirmada pelo cliente) e recuperação de senha.

alter table bookings
  add column reminded_at timestamptz,          -- quando a barbearia mandou o lembrete
  add column client_confirmed_at timestamptz;  -- quando o cliente confirmou presença pelo link

-- Segredo dos links de reserva (o link de cada reserva é derivado dele por HMAC, então a barbearia
-- consegue reenviar o link num lembrete sem guardar o link em texto). APP_SECRET no ambiente tem prioridade.
insert into platform_settings values ('link_secret', to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')))
  on conflict (key) do nothing;

-- Recuperação de senha: guarda só o hash do token, vale 1 hora e uma vez.
create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_resets_user_idx on password_resets(user_id);
