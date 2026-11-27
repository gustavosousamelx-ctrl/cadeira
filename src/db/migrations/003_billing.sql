-- 003: cobrança da assinatura SaaS (barbearia -> plataforma).
-- Estado da ASSINATURA (saas_subscriptions.status) é separado do estado de cada COBRANÇA (saas_payments.status).
-- Nenhuma destas tabelas é acessível ao papel app_tenant: só o contexto de plataforma lê e grava.

create table platform_settings (key text primary key, value jsonb not null);
insert into platform_settings values
  ('grace_days', '5'),          -- tolerância após o vencimento antes de suspender
  ('renew_days_before', '3');   -- cria a cobrança de renovação N dias antes do fim do período

alter table saas_subscriptions
  add column price_cents integer check (price_cents is null or price_cents >= 0), -- preço contratado vigente
  add column cancel_at_period_end boolean not null default false,
  add column pending_plan_id text references plans(id),                            -- downgrade agendado
  add column canceled_at timestamptz,
  add column provider_customer_id text;

create table saas_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references saas_subscriptions(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  plan_id text not null references plans(id),
  kind text not null check (kind in ('first','renewal')),
  amount_cents integer not null check (amount_cents > 0),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  due_at timestamptz not null,
  status text not null check (status in ('pending','overdue','failed','confirmed','refunded','canceled')),
  provider text not null,
  provider_payment_id text,
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
-- no máximo uma cobrança em aberto por assinatura (evita cobrar duas vezes o mesmo período)
create unique index saas_payments_one_open on saas_payments(subscription_id) where status in ('pending','overdue','failed');
create index saas_payments_shop_idx on saas_payments(shop_id, created_at desc);

-- caixa de entrada dos avisos do provedor: a chave única garante idempotência
create table billing_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  type text not null,
  provider_payment_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  unique (provider, event_id)
);

-- simulador de provedor (somente em desenvolvimento/testes)
create table sandbox_charges (
  id text primary key,
  customer_id text not null,
  amount_cents integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
