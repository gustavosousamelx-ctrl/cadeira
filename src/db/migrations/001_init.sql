-- 001: base multiempresa, agenda e assinatura SaaS (estado mínimo para provisionamento)
create extension if not exists btree_gist;

-- ---------- plataforma (sem tenant) ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and position('@' in email) > 1),
  name text not null check (length(name) between 2 and 80),
  password_hash text not null,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);

-- planos comerciais: editáveis por admin da plataforma (fase 2), nunca fixos no código
create table plans (
  id text primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  trial_days integer not null default 14 check (trial_days between 0 and 90),
  max_professionals integer check (max_professionals is null or max_professionals > 0),
  features jsonb not null default '[]',
  active boolean not null default true,
  sort integer not null default 0
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(name) between 2 and 60),
  timezone text not null default 'America/Sao_Paulo',
  description text not null default '' check (length(description) <= 400),
  address text not null default '' check (length(address) <= 160),
  phone text not null default '' check (phone ~ '^[0-9]{0,13}$'),
  instagram text not null default '' check (instagram ~ '^[A-Za-z0-9._]{0,30}$'),
  theme jsonb not null default '{"preset":"oficio"}',
  policy jsonb not null default '{"slot_step_min":15,"min_notice_min":60,"max_days_ahead":30,"cancel_until_min":120}',
  published boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','manager','reception','barber')),
  professional_id uuid,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- assinatura SaaS (barbearia -> plataforma). Separada de qualquer cobrança de clientes finais.
create table saas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references shops(id) on delete cascade,
  plan_id text not null references plans(id),
  status text not null check (status in ('trialing','active','past_due','canceled','expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  provider text,
  provider_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  shop_id uuid references shops(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);

-- ---------- dados de cada barbearia (tenant) ----------
create table professionals (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  title text not null default '' check (length(title) <= 60),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, id)
);
alter table memberships add foreign key (shop_id, professional_id) references professionals(shop_id, id) on delete set null (professional_id);

-- expediente: professional_id nulo = horário da casa. Vários intervalos por dia representam pausas.
create table working_hours (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  professional_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  check (start_min < end_min),
  foreign key (shop_id, professional_id) references professionals(shop_id, id) on delete cascade
);
create index working_hours_shop_idx on working_hours(shop_id, professional_id, weekday);

create table services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  description text not null default '' check (length(description) <= 140),
  duration_min integer not null check (duration_min between 5 and 480 and duration_min % 5 = 0),
  price_cents integer not null check (price_cents between 0 and 10000000),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, id)
);

-- folgas e bloqueios: professional_id nulo bloqueia a casa toda
create table time_off (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  professional_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (length(reason) <= 80),
  check (ends_at > starts_at),
  foreign key (shop_id, professional_id) references professionals(shop_id, id) on delete cascade
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  phone text not null check (phone ~ '^[0-9]{10,13}$'),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (shop_id, phone),
  unique (shop_id, id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  professional_id uuid not null,
  customer_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_min integer not null check (duration_min > 0),
  price_cents integer not null check (price_cents >= 0),
  status text not null check (status in ('pending','confirmed','completed','no_show','cancelled')),
  source text not null check (source in ('online','staff')),
  manage_token_hash text unique,
  cancel_reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (shop_id, professional_id) references professionals(shop_id, id),
  foreign key (shop_id, customer_id) references customers(shop_id, id),
  unique (shop_id, id),
  -- garantia transacional contra conflito: o mesmo profissional nunca tem dois horários ativos sobrepostos
  constraint bookings_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending','confirmed','completed'))
);
create index bookings_shop_time_idx on bookings(shop_id, starts_at);

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  booking_id uuid not null,
  service_id uuid,
  name text not null,
  duration_min integer not null,
  price_cents integer not null,
  foreign key (shop_id, booking_id) references bookings(shop_id, id) on delete cascade
);

create table booking_events (
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  booking_id uuid not null,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('staff','customer','system')),
  actor_user_id uuid references users(id) on delete set null,
  note text,
  at timestamptz not null default now(),
  foreign key (shop_id, booking_id) references bookings(shop_id, id) on delete cascade
);

-- ---------- isolamento: Row-Level Security ----------
-- O app abre transações de tenant com SET LOCAL ROLE app_tenant + app.shop_id.
-- Sem app.shop_id definido, nenhuma linha é visível.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_tenant') then
    create role app_tenant nologin;
  end if;
end $$;

grant usage on schema public to app_tenant;
grant select on shops to app_tenant;
grant select, insert, update, delete on professionals, working_hours, services, time_off, customers, bookings, booking_items to app_tenant;
grant select, insert on booking_events, audit_log to app_tenant;
grant usage, select on all sequences in schema public to app_tenant;
grant update (name, description, address, phone, instagram, theme, policy, published) on shops to app_tenant;

create function app_shop_id() returns uuid language sql stable as
$$ select nullif(current_setting('app.shop_id', true), '')::uuid $$;

alter table shops enable row level security;
create policy shops_tenant on shops using (id = app_shop_id()) with check (id = app_shop_id());

do $$
declare t text;
begin
  foreach t in array array['professionals','working_hours','services','time_off','customers','bookings','booking_items','booking_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I using (shop_id = app_shop_id()) with check (shop_id = app_shop_id())', t || '_tenant', t);
  end loop;
end $$;

alter table audit_log enable row level security;
create policy audit_tenant_insert on audit_log for insert with check (shop_id = app_shop_id());
create policy audit_tenant_read on audit_log for select using (shop_id = app_shop_id());

-- planos provisórios (valores a validar com custos reais; editáveis sem alterar código)
insert into plans (id, name, price_cents, trial_days, max_professionals, features, sort) values
  ('essencial',    'Essencial',    0, 14, 2,    '["agenda","pagina_publica","servicos","equipe"]', 1),
  ('profissional', 'Profissional', 0, 14, 6,    '["agenda","pagina_publica","servicos","equipe","comissoes","fidelidade","lembretes"]', 2),
  ('gestao',       'Gestão',       0, 14, null, '["agenda","pagina_publica","servicos","equipe","comissoes","fidelidade","lembretes","relatorios_avancados","multiusuario_avancado"]', 3);
