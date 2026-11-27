-- 004: caixa da barbearia (dinheiro do cliente final -> barbearia), separado da assinatura SaaS.
-- comanda (sales) -> itens (sale_items, com comissão congelada no momento da venda) -> pagamentos (sale_payments).

create table sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  booking_id uuid,
  customer_id uuid,
  status text not null check (status in ('paid','void')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  paid_at timestamptz not null,
  void_reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (total_cents = subtotal_cents - discount_cents),
  unique (shop_id, id),
  foreign key (shop_id, booking_id) references bookings(shop_id, id),
  foreign key (shop_id, customer_id) references customers(shop_id, id) on delete set null (customer_id)
);
-- um atendimento só pode ter uma comanda paga (estornada libera para refazer)
create unique index sales_one_paid_per_booking on sales(booking_id) where booking_id is not null and status = 'paid';
create index sales_shop_day_idx on sales(shop_id, paid_at);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  sale_id uuid not null,
  kind text not null check (kind in ('service','product')),
  service_id uuid,
  name text not null check (length(name) between 1 and 80),
  qty integer not null default 1 check (qty between 1 and 99),
  unit_cents integer not null check (unit_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  professional_id uuid,
  commission_pct numeric(5,2) not null default 0,
  commission_cents integer not null default 0 check (commission_cents >= 0),
  foreign key (shop_id, sale_id) references sales(shop_id, id) on delete cascade,
  foreign key (shop_id, professional_id) references professionals(shop_id, id)
);

create table sale_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  sale_id uuid not null,
  method text not null check (method in ('pix','dinheiro','debito','credito','outro')),
  amount_cents integer not null check (amount_cents > 0),
  foreign key (shop_id, sale_id) references sales(shop_id, id) on delete cascade
);

-- fechamento do caixa do dia: dinheiro esperado x contado
create table cash_closings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  day date not null,
  total_cents integer not null,
  expected_cash_cents integer not null,
  counted_cash_cents integer not null check (counted_cash_cents >= 0),
  note text not null default '' check (length(note) <= 200),
  closed_by uuid references users(id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (shop_id, day)
);

alter table shops add column onboarded_at timestamptz;

grant select, insert, update on sales, sale_items, sale_payments, cash_closings to app_tenant;
grant update (onboarded_at) on shops to app_tenant;
do $$
declare t text;
begin
  foreach t in array array['sales','sale_items','sale_payments','cash_closings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I using (shop_id = app_shop_id()) with check (shop_id = app_shop_id())', t || '_tenant', t);
  end loop;
end $$;

-- mensagens do formulário de contato do site (nível plataforma)
create table contact_messages (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 2 and 80),
  email text not null check (length(email) <= 120),
  phone text not null default '' check (phone ~ '^[0-9]{0,13}$'),
  shop_name text not null default '' check (length(shop_name) <= 80),
  message text not null check (length(message) between 5 and 2000),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

-- caixa e clientes fazem parte de todos os planos
update plans set features = features || '["caixa","clientes"]'::jsonb where not features @> '["caixa"]'::jsonb;
