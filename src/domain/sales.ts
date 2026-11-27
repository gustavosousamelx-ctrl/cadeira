import type { Db, Q } from '../db/db.ts';
import type { Ctx } from './accounts.ts';
import { can, must } from './accounts.ts';
import { AppError, addDays, clock, digits, forbidden, invalid, isDate, localToUtc, notFound, toLocal } from '../lib/core.ts';
import { parseMoney } from './catalog.ts';

/*
 * Caixa: o que o cliente pagou à barbearia. Separado da assinatura SaaS.
 * Comissão = % do profissional sobre o valor do serviço já descontado (desconto rateado entre os itens).
 * A % fica congelada na venda: mudar a comissão depois não altera vendas passadas. Produtos não geram comissão.
 */
export const METHODS: Record<string, string> = { pix: 'Pix', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', outro: 'Outro' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr = (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(String);
const money = (s: unknown) => { const v = String(s ?? '').trim(); if (!v) return 0; const n = parseMoney(v); if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw invalid('Valor inválido.'); return n; };

export async function planHas(db: Db, shopId: string, feature: string) {
  const r = await db.system((q) => q.one(`select sh.is_demo, p.features from shops sh left join saas_subscriptions s on s.shop_id = sh.id left join plans p on p.id = s.plan_id where sh.id = $1`, [shopId]));
  return !!r && (r.is_demo || (Array.isArray(r.features) && r.features.includes(feature)));
}

/** Dados para a tela da comanda: itens do atendimento, serviços extras e profissionais. */
export async function checkoutData(db: Db, ctx: Ctx, bookingId?: string) {
  must(ctx, 'sales.create');
  return db.tenant(ctx.shop.id, async (q) => {
    let booking: any = null;
    if (bookingId) {
      if (!UUID.test(bookingId)) throw notFound();
      booking = await q.one(`select b.id, b.status, b.starts_at, b.professional_id, b.customer_id, b.price_cents, c.name customer, c.phone, p.name pro_name,
          (select s.paid_at from sales s where s.booking_id = b.id and s.status = 'paid') paid_at
        from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id where b.id = $1`, [bookingId]);
      if (!booking || (!can(ctx, 'agenda.all') && booking.professional_id !== ctx.professionalId)) throw notFound('Atendimento não encontrado.');
      booking.items = await q.all('select service_id, name, price_cents, duration_min from booking_items where booking_id = $1', [bookingId]);
    }
    const services = await q.all('select id, name, price_cents from services where active order by sort, name');
    const pros = await q.all(`select id, name from professionals where active ${can(ctx, 'agenda.all') ? '' : 'and id = $1'} order by sort, name`, can(ctx, 'agenda.all') ? [] : [ctx.professionalId]);
    const day = toLocal(clock.now(), ctx.shop.timezone).date;
    const closed = !!await q.one('select 1 from cash_closings where day = $1', [day]);
    return { booking, services, pros, closed };
  });
}

async function lockCashDay(q: Q, shop: string, day: string) {
  await q.one('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [shop, day]);
}

export async function createSale(db: Db, ctx: Ctx, f: Record<string, any>) {
  must(ctx, 'sales.create');
  const bookingId = String(f.bookingId || '');
  const requestKey = bookingId || !f.requestKey ? null : String(f.requestKey);
  if (requestKey && !UUID.test(requestKey)) throw invalid('Reabra a comanda para continuar.');
  const extraServices = [...new Set(arr(f.svc))];
  if (extraServices.some(id => !UUID.test(id))) throw invalid('Confira os serviços selecionados.');
  const names = arr(f.productName), prices = arr(f.productPrice);
  const products: { name: string; price: number }[] = [];
  for (let i = 0; i < Math.max(names.length, prices.length); i++) {
    const name = (names[i] || '').trim(), raw = (prices[i] || '').trim();
    if (!name && !raw) continue;
    const price = money(raw);
    if (!name || name.length > 80 || price === 0) throw invalid('Informe o nome e o preço de cada produto adicionado.');
    products.push({ name, price });
  }
  const discount = money(f.discount);
  const pays = [[f.method1, f.amount1], [f.method2, f.amount2]].map(([m, a]) => ({ method: String(m || ''), raw: String(a ?? '').trim() }));
  const now = clock.now();
  return db.tenant(ctx.shop.id, async (q) => {
    const day = toLocal(now, ctx.shop.timezone).date;
    await lockCashDay(q, ctx.shop.id, day);
    const previousSale = () => q.one('select id from sales where created_by = $1 and request_key = $2', [ctx.user.id, requestKey]);
    if (requestKey) {
      const previous = await previousSale();
      if (previous) return previous.id as string;
    }
    if (await q.one('select 1 from cash_closings where day = $1', [day])) throw invalid('O caixa deste dia já foi fechado.');
    let booking: any = null, proId: string | null = null, customerId: string | null = null;
    const items: { kind: 'service' | 'product'; service_id: string | null; name: string; unit: number; pro: string | null }[] = [];
    if (bookingId) {
      if (!UUID.test(bookingId)) throw notFound();
      booking = await q.one('select id, status, starts_at, professional_id, customer_id from bookings where id = $1 for update', [bookingId]);
      if (!booking || (!can(ctx, 'agenda.all') && booking.professional_id !== ctx.professionalId)) throw notFound('Atendimento não encontrado.');
      if (!['confirmed', 'completed'].includes(booking.status)) throw invalid('Só dá para fechar comanda de horário confirmado ou atendido.');
      if (await q.one(`select 1 from sales where booking_id = $1 and status = 'paid'`, [bookingId])) throw invalid('A comanda deste atendimento já foi fechada.');
      if (new Date(booking.starts_at).getTime() > now.getTime() + 30 * 60_000) throw invalid('A comanda abre a partir de 30 minutos antes do horário.');
      proId = booking.professional_id; customerId = booking.customer_id;
      for (const it of await q.all('select service_id, name, price_cents from booking_items where booking_id = $1', [bookingId])) items.push({ kind: 'service', service_id: it.service_id, name: it.name, unit: it.price_cents, pro: proId });
    } else {
      proId = String(f.professionalId || '');
      if (!UUID.test(proId) || !(await q.one('select 1 from professionals where id = $1 and active', [proId]))) throw invalid('Escolha o profissional.');
      if (!can(ctx, 'agenda.all') && proId !== ctx.professionalId) throw forbidden('Você só pode lançar vendas suas.');
      const phone = digits(f.customerPhone), name = String(f.customerName || '').trim();
      if (phone) {
        if (!/^\d{10,11}$/.test(phone)) throw invalid('WhatsApp do cliente inválido.');
        customerId = (await q.one('insert into customers (shop_id, name, phone) values ($1,$2,$3) on conflict (shop_id, phone) do update set phone = excluded.phone returning id', [ctx.shop.id, name.length >= 2 ? name : 'Cliente', phone]))!.id;
      }
    }
    if (extraServices.length) {
      const services = await q.all('select id, name, price_cents from services where id = any($1::uuid[]) and active order by sort, name, id', [extraServices]);
      if (services.length !== extraServices.length) throw invalid('Um serviço selecionado não está mais disponível. Revise a comanda.');
      for (const s of services) items.push({ kind: 'service', service_id: s.id, name: s.name, unit: s.price_cents, pro: proId });
    }
    for (const p of products) items.push({ kind: 'product', service_id: null, name: p.name, unit: p.price, pro: proId });
    if (!items.length) throw invalid('Adicione pelo menos um item à comanda.');
    const subtotal = items.reduce((s, i) => s + i.unit, 0);
    if (discount > subtotal) throw invalid('O desconto não pode ser maior que o total.');
    const total = subtotal - discount;
    // pagamento: o 1º método leva o restante quando o valor fica em branco (pagamento dividido)
    if (Boolean(pays[1].method) !== Boolean(pays[1].raw)) throw invalid('Informe a segunda forma de pagamento e o valor da parte.');
    const p2 = money(pays[1].raw);
    if (pays[1].method && (p2 <= 0 || p2 >= total || pays[1].method === pays[0].method)) throw invalid('Escolha duas formas diferentes e divida o total entre elas.');
    const p1 = pays[0].raw ? money(pays[0].raw) : total - p2;
    const payments = [{ method: pays[0].method, amount: p1 }, { method: pays[1].method, amount: p2 }].filter((p) => p.amount > 0);
    for (const p of payments) if (!METHODS[p.method]) throw invalid('Escolha a forma de pagamento.');
    if (total > 0 && !payments.length) throw invalid('Informe como o cliente pagou.');
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    if (paid !== total) throw invalid(`A soma dos pagamentos (${(paid / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) precisa ser igual ao total (${(total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`);
    const cash = payments.find(p => p.method === 'dinheiro');
    if (cash && String(f.cashReceived ?? '').trim() && money(f.cashReceived) < cash.amount) throw invalid('O dinheiro recebido é menor que a parte em dinheiro da comanda.');
    const pct = new Map((await q.all('select id, commission_pct::float pct from professionals where id = any($1::uuid[])', [[...new Set(items.map((i) => i.pro).filter(Boolean))]])).map((r) => [r.id, r.pct as number]));
    const sale = await q.one(`insert into sales (shop_id, booking_id, customer_id, status, subtotal_cents, discount_cents, total_cents, paid_at, created_by, request_key)
      values ($1,$2,$3,'paid',$4,$5,$6,$7,$8,$9) on conflict (shop_id,created_by,request_key) do nothing returning id`,
      [ctx.shop.id, booking?.id ?? null, customerId, subtotal, discount, total, now, ctx.user.id, requestKey]);
    if (!sale) return (await previousSale())!.id as string;
    // Arredonda o desconto acumulado para distribuir os centavos sem criar um item acima do preço original.
    let grossSoFar = 0, discountSoFar = 0;
    for (const it of items) {
      grossSoFar += it.unit;
      const cumulativeDiscount = Math.round(discount * grossSoFar / (subtotal || 1));
      const net = it.unit - (cumulativeDiscount - discountSoFar);
      discountSoFar = cumulativeDiscount;
      const p = it.kind === 'service' && it.pro ? pct.get(it.pro) ?? 0 : 0;
      await q.exec(`insert into sale_items (shop_id, sale_id, kind, service_id, name, unit_cents, total_cents, professional_id, commission_pct, commission_cents) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ctx.shop.id, sale.id, it.kind, it.service_id, it.name, it.unit, net, it.pro, p, Math.round((net * p) / 100)]);
    }
    for (const p of payments) await q.exec('insert into sale_payments (shop_id, sale_id, method, amount_cents) values ($1,$2,$3,$4)', [ctx.shop.id, sale.id, p.method, p.amount]);
    if (booking?.status === 'confirmed') {
      await q.exec(`update bookings set status = 'completed', updated_at = now() where id = $1`, [booking.id]);
      await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, actor_user_id, note) values ($1,$2,'confirmed','completed','staff',$3,'comanda fechada')`, [ctx.shop.id, booking.id, ctx.user.id]);
    }
    await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id, meta) values ($1,$2,'sale.created','sale',$3,$4)`, [ctx.shop.id, ctx.user.id, sale.id, JSON.stringify({ total_cents: total, discount_cents: discount })]);
    return sale.id as string;
  });
}

const dayRange = (ctx: Ctx, day: string) => [localToUtc(day, 0, ctx.shop.timezone), localToUtc(addDays(day, 1), 0, ctx.shop.timezone)];

export async function voidSale(db: Db, ctx: Ctx, id: string, reason: string) {
  must(ctx, 'sales.void');
  if (!UUID.test(id)) throw notFound();
  await db.tenant(ctx.shop.id, async (q) => {
    const s = await q.one('select id, status, paid_at from sales where id = $1 for update', [id]);
    if (!s) throw notFound('Venda não encontrada.');
    if (s.status !== 'paid') throw invalid('Esta venda já foi estornada.');
    const day = toLocal(new Date(s.paid_at), ctx.shop.timezone).date;
    await lockCashDay(q, ctx.shop.id, day);
    if (await q.one('select 1 from cash_closings where day = $1', [day])) throw invalid('O caixa deste dia já foi fechado. Estornos depois do fechamento não são permitidos.');
    await q.exec(`update sales set status = 'void', void_reason = $2 where id = $1`, [id, (reason || 'Estornada').slice(0, 140)]);
    await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id, meta) values ($1,$2,'sale.voided','sale',$3,$4)`, [ctx.shop.id, ctx.user.id, id, JSON.stringify({ reason: (reason || '').slice(0, 140) })]);
  });
}

/** Caixa do dia: vendas, totais por forma de pagamento, atendimentos sem comanda e fechamento. */
export async function cashDay(db: Db, ctx: Ctx, day: string) {
  must(ctx, 'cash.view');
  if (!isDate(day)) throw invalid('Data inválida.');
  const [a, b] = dayRange(ctx, day);
  return db.tenant(ctx.shop.id, async (q) => {
    const sales = await q.all(`select s.id, s.status, s.total_cents, s.discount_cents, s.paid_at, s.void_reason, s.booking_id, c.name customer,
        (select string_agg(i.name, ' + ' order by i.id) from sale_items i where i.sale_id = s.id) items,
        (select string_agg(distinct p.name, ', ') from sale_items i join professionals p on p.id = i.professional_id where i.sale_id = s.id) pros,
        (select json_agg(json_build_object('method', m.method, 'amount', m.amount_cents)) from sale_payments m where m.sale_id = s.id) pays
      from sales s left join customers c on c.id = s.customer_id where s.paid_at >= $1 and s.paid_at < $2 order by s.paid_at desc`, [a, b]);
    const byMethod: Record<string, number> = {};
    for (const s of sales.filter((x) => x.status === 'paid')) for (const p of s.pays ?? []) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    const total = Object.values(byMethod).reduce((x, y) => x + y, 0);
    const pending = await q.all(`select b.id, b.starts_at, b.status, b.price_cents, c.name customer, p.name pro_name from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id
      where b.starts_at >= $1 and b.starts_at < $2 and b.status in ('completed','confirmed') and b.starts_at <= $3
        and not exists (select 1 from sales s where s.booking_id = b.id and s.status = 'paid') order by b.starts_at`, [a, b, new Date(clock.now().getTime() + 30 * 60_000)]);
    const closing = await q.one('select * from cash_closings where day = $1', [day]);
    const today = toLocal(clock.now(), ctx.shop.timezone).date;
    const todayClosed = day === today ? !!closing : !!await q.one('select 1 from cash_closings where day = $1', [today]);
    return { sales, byMethod, total, count: sales.filter((x) => x.status === 'paid').length, pending, closing, todayClosed };
  });
}

export async function closeCash(db: Db, ctx: Ctx, day: string, counted: string, note: string) {
  must(ctx, 'cash.manage');
  if (!isDate(day)) throw invalid('Data inválida.');
  if (day > toLocal(clock.now(), ctx.shop.timezone).date) throw invalid('Não dá para fechar o caixa de um dia que ainda não chegou.');
  const cnt = money(counted);
  const [start, end] = dayRange(ctx, day);
  try {
    await db.tenant(ctx.shop.id, async (q) => {
      await lockCashDay(q, ctx.shop.id, day);
      const totals = await q.one(`select coalesce(sum(p.amount_cents),0) total,
        coalesce(sum(p.amount_cents) filter (where p.method = 'dinheiro'),0) cash
        from sales s join sale_payments p on p.sale_id = s.id
        where s.status = 'paid' and s.paid_at >= $1 and s.paid_at < $2`, [start, end]);
      await q.exec('insert into cash_closings (shop_id, day, total_cents, expected_cash_cents, counted_cash_cents, note, closed_by) values ($1,$2,$3,$4,$5,$6,$7)', [ctx.shop.id, day, totals!.total, totals!.cash, cnt, String(note || '').slice(0, 200), ctx.user.id]);
      await q.exec(`insert into audit_log (shop_id, user_id, action, entity, meta) values ($1,$2,'cash.closed','cash',$3)`, [ctx.shop.id, ctx.user.id, JSON.stringify({ day, expected: totals!.cash, counted: cnt })]);
    });
  } catch (e: any) { if (e.code === '23505') throw invalid('O caixa deste dia já foi fechado.'); throw e; }
}

/** Financeiro do mês (dados reais das comandas pagas). Profissional sem permissão de relatório vê só o que é dele. */
export async function monthReport(db: Db, ctx: Ctx, month: string, onlyPro?: string | null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('Mês inválido.');
  if (!onlyPro) must(ctx, 'reports.view');
  const first = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const a = localToUtc(first, 0, ctx.shop.timezone), b = localToUtc(next, 0, ctx.shop.timezone);
  return db.tenant(ctx.shop.id, async (q) => {
    const P = onlyPro ? [a, b, onlyPro] : [a, b];
    const proFilter = onlyPro ? 'and i.professional_id = $3' : '';
    const items = await q.all(`select i.kind, i.name, i.total_cents, i.commission_cents, i.professional_id, s.paid_at, s.id sale_id from sale_items i join sales s on s.id = i.sale_id
      where s.status = 'paid' and s.paid_at >= $1 and s.paid_at < $2 ${proFilter}`, P);
    const pros = await q.all('select id, name, commission_pct::float pct from professionals order by sort, name');
    const pays = onlyPro ? [] : await q.all(`select m.method, sum(m.amount_cents)::int v from sale_payments m join sales s on s.id = m.sale_id where s.status = 'paid' and s.paid_at >= $1 and s.paid_at < $2 group by 1 order by 2 desc`, [a, b]);
    const bk = await q.one(`select count(*) filter (where status = 'completed')::int done, count(*) filter (where status = 'no_show')::int noshow from bookings where starts_at >= $1 and starts_at < $2 ${onlyPro ? 'and professional_id = $3' : ''}`, P);
    const revenue = items.reduce((s, i) => s + i.total_cents, 0);
    const salesN = new Set(items.map((i) => i.sale_id)).size;
    const byPro = pros.map((p) => { const mine = items.filter((i) => i.professional_id === p.id); return { id: p.id, name: p.name, pct: p.pct, services: mine.filter((i) => i.kind === 'service').reduce((s, i) => s + i.total_cents, 0), products: mine.filter((i) => i.kind === 'product').reduce((s, i) => s + i.total_cents, 0), commission: mine.reduce((s, i) => s + i.commission_cents, 0), count: new Set(mine.map((i) => i.sale_id)).size }; }).filter((p) => (onlyPro ? p.id === onlyPro : p.count > 0));
    const bySvc = new Map<string, { n: number; v: number }>();
    for (const i of items) { const k = i.name; const x = bySvc.get(k) ?? { n: 0, v: 0 }; x.n++; x.v += i.total_cents; bySvc.set(k, x); }
    const days: { day: string; v: number }[] = [];
    for (let d = first; d < next; d = addDays(d, 1)) days.push({ day: d, v: 0 });
    for (const i of items) { const d = toLocal(new Date(i.paid_at), ctx.shop.timezone).date; const x = days.find((z) => z.day === d); if (x) x.v += i.total_cents; }
    return { month, revenue, salesN, ticket: salesN ? Math.round(revenue / salesN) : 0, pays, byPro, bySvc: [...bySvc.entries()].map(([name, x]) => ({ name, ...x })).sort((p, q2) => q2.v - p.v), days, done: bk!.done, noshow: bk!.noshow, commissionTotal: items.reduce((s, i) => s + i.commission_cents, 0) };
  });
}
export { AppError };
