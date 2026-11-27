import { z } from 'zod';
import type { Db } from '../db/db.ts';
import type { User } from './accounts.ts';
import { forbidden, invalid, notFound, clock } from '../lib/core.ts';
import { parseMoney } from './catalog.ts';

/** Área do administrador da plataforma. Acesso só para usuários com is_platform_admin (verificado no servidor). */
export function mustAdmin(u: User | null): asserts u is User { if (!u?.is_platform_admin) throw notFound(); }

const DAY = 86_400_000;
/**
 * Métricas com definições explícitas (barbearias de demonstração ficam fora):
 *  - MRR contratado: soma do preço vigente das assinaturas ativas ou em atraso.
 *  - ARR estimado: MRR × 12 (projeção, não receita).
 *  - Recebido no mês: cobranças confirmadas com data de pagamento no mês corrente.
 *  - Conversão de testes: dos testes que terminaram nos últimos 30 dias, quantos estão ativos.
 */
export async function metrics(db: Db, now = clock.now()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return db.system(async (q) => {
    const real = `join shops sh on sh.id = s.shop_id and not sh.is_demo`;
    const one = async (sql: string, p: unknown[] = []) => (await q.one(sql, p))!;
    const mrr = await one(`select coalesce(sum(coalesce(s.price_cents, pl.price_cents)),0)::int v, count(*)::int n from saas_subscriptions s ${real} join plans pl on pl.id = s.plan_id where s.status in ('active','past_due')`);
    const received = await one(`select coalesce(sum(p.amount_cents),0)::int v, count(*)::int n from saas_payments p join shops sh on sh.id = p.shop_id and not sh.is_demo where p.status = 'confirmed' and p.paid_at >= $1`, [monthStart]);
    const open = await one(`select coalesce(sum(p.amount_cents),0)::int v, count(*)::int n from saas_payments p join shops sh on sh.id = p.shop_id and not sh.is_demo where p.status in ('pending','overdue','failed')`);
    const byStatus = await q.all(`select s.status, count(*)::int n from saas_subscriptions s ${real} group by 1`);
    const trialsActive = await one(`select count(*)::int n from saas_subscriptions s ${real} where s.status = 'trialing' and s.trial_ends_at > $1`, [now]);
    const conv = await one(`select count(*)::int ended, count(*) filter (where s.status in ('active','past_due'))::int converted from saas_subscriptions s ${real} where s.trial_ends_at between $1 and $2`, [new Date(now.getTime() - 30 * DAY), now]);
    const newSubs = await one(`select count(*)::int n from saas_payments p join shops sh on sh.id = p.shop_id and not sh.is_demo where p.kind = 'first' and p.status = 'confirmed' and p.paid_at >= $1`, [monthStart]);
    const cancels = await one(`select count(*)::int n from saas_subscriptions s ${real} where s.canceled_at >= $1`, [monthStart]);
    const shops = await one(`select count(*)::int n, count(*) filter (where created_at >= $1)::int in_month from shops where not is_demo`, [monthStart]);
    return { mrr: mrr.v, paying: mrr.n, arr: mrr.v * 12, received: received.v, receivedN: received.n, open: open.v, openN: open.n, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), trialsActive: trialsActive.n, convEnded: conv.ended, convConverted: conv.converted, newSubs: newSubs.n, cancels: cancels.n, shops: shops.n, shopsMonth: shops.in_month };
  });
}

export async function listShops(db: Db, o: { q?: string; status?: string }) {
  const where: string[] = [], p: unknown[] = [];
  if (o.q) { p.push(`%${o.q.toLowerCase()}%`); where.push(`(lower(sh.name) like $${p.length} or sh.slug like $${p.length} or lower(u.email) like $${p.length})`); }
  if (o.status && ['trialing', 'active', 'past_due', 'canceled', 'expired'].includes(o.status)) { p.push(o.status); where.push(`s.status = $${p.length}`); }
  return db.system((q) => q.all(`select sh.id, sh.slug, sh.name, sh.is_demo, sh.published, sh.created_at, s.status, s.trial_ends_at, s.current_period_end, pl.name plan_name, coalesce(s.price_cents, pl.price_cents) price_cents, u.email owner_email
    from shops sh left join saas_subscriptions s on s.shop_id = sh.id left join plans pl on pl.id = s.plan_id
    left join lateral (select uu.email from memberships m join users uu on uu.id = m.user_id where m.shop_id = sh.id and m.role = 'owner' limit 1) u on true
    ${where.length ? 'where ' + where.join(' and ') : ''} order by sh.created_at desc limit 200`, p));
}

/** Detalhe de um estabelecimento: assinatura, cobranças e números agregados. Sem dados pessoais dos clientes da barbearia. */
export async function shopDetail(db: Db, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const shop = await db.system((q) => q.one('select id, slug, name, is_demo, published, created_at from shops where id = $1', [id]));
  if (!shop) throw notFound();
  const sub = await db.system((q) => q.one('select s.*, p.name plan_name from saas_subscriptions s join plans p on p.id = s.plan_id where s.shop_id = $1', [id]));
  const payments = await db.system((q) => q.all('select * from saas_payments where shop_id = $1 order by created_at desc limit 30', [id]));
  const counts = await db.tenant(id, (q) => q.one(`select (select count(*) from professionals where active)::int pros, (select count(*) from services where active)::int services,
    (select count(*) from bookings where created_at > now() - interval '30 days')::int bookings30, (select count(*) from customers)::int customers`));
  const owner = await db.system((q) => q.one(`select u.name, u.email from memberships m join users u on u.id = m.user_id where m.shop_id = $1 and m.role = 'owner' limit 1`, [id]));
  return { shop, sub, payments, counts, owner };
}

const planSchema = z.object({
  name: z.string().trim().min(2).max(40),
  price: z.string().trim().transform(parseMoney).pipe(z.number().int().min(0).max(10_000_000)),
  trial_days: z.coerce.number().int().min(0).max(90),
  max_professionals: z.string().trim().transform((s) => (s === '' ? null : Number(s))).pipe(z.number().int().min(1).max(500).nullable()),
  active: z.string().optional(),
});
export async function savePlan(db: Db, admin: User, id: string, raw: unknown) {
  mustAdmin(admin);
  const p = planSchema.safeParse(raw); if (!p.success) throw invalid(p.error.issues[0].message);
  const v = p.data;
  await db.system(async (q) => {
    const before = await q.one('select name, price_cents, trial_days, max_professionals, active from plans where id = $1 for update', [id]);
    if (!before) throw notFound();
    await q.exec('update plans set name=$2, price_cents=$3, trial_days=$4, max_professionals=$5, active=$6 where id=$1', [id, v.name, v.price, v.trial_days, v.max_professionals, v.active === '1']);
    await q.exec(`insert into audit_log (user_id, action, entity, entity_id, meta) values ($1,'admin.plan_updated','plan',$2,$3)`, [admin.id, id, JSON.stringify({ before, after: { ...v, active: v.active === '1' } })]);
  });
}
export async function saveSettings(db: Db, admin: User, raw: any) {
  mustAdmin(admin);
  const g = Number(raw.grace_days), r = Number(raw.renew_days_before);
  if (!(Number.isInteger(g) && g >= 0 && g <= 30) || !(Number.isInteger(r) && r >= 0 && r <= 15)) throw invalid('Valores fora do permitido (tolerância 0–30 dias, renovação 0–15 dias).');
  await db.system(async (q) => {
    await q.exec(`update platform_settings set value = to_jsonb($1::int) where key = 'grace_days'`, [g]);
    await q.exec(`update platform_settings set value = to_jsonb($1::int) where key = 'renew_days_before'`, [r]);
    await q.exec(`insert into audit_log (user_id, action, entity, meta) values ($1,'admin.settings_updated','platform',$2)`, [admin.id, JSON.stringify({ grace_days: g, renew_days_before: r })]);
  });
}
/** Estende o teste de uma barbearia (ex.: negociação comercial). Ação sensível: auditada. */
export async function extendTrial(db: Db, admin: User, shopId: string, days: number) {
  mustAdmin(admin);
  if (!(Number.isInteger(days) && days >= 1 && days <= 60)) throw invalid('Informe de 1 a 60 dias.');
  await db.system(async (q) => {
    const s = await q.one('select id, status, trial_ends_at from saas_subscriptions where shop_id = $1 for update', [shopId]);
    if (!s) throw notFound();
    if (!['trialing', 'expired'].includes(s.status) || s.current_period_end) throw invalid('Só dá para estender o teste de quem ainda não pagou.');
    const base = Math.max(clock.now().getTime(), new Date(s.trial_ends_at).getTime());
    await q.exec(`update saas_subscriptions set status = 'trialing', trial_ends_at = $2, updated_at = now() where id = $1`, [s.id, new Date(base + days * DAY)]);
    await q.exec(`insert into audit_log (shop_id, user_id, action, entity, meta) values ($1,$2,'admin.trial_extended','subscription',$3)`, [shopId, admin.id, JSON.stringify({ days })]);
  });
}
export const billingEvents = (db: Db) => db.system((q) => q.all('select id, provider, event_id, type, provider_payment_id, received_at, processed_at, result from billing_events order by id desc limit 100'));
export const platformAudit = (db: Db) => db.system((q) => q.all(`select a.at, a.action, a.entity, a.entity_id, a.meta, u.email, s.name shop from audit_log a left join users u on u.id = a.user_id left join shops s on s.id = a.shop_id
  where a.action like 'admin.%' or a.action like 'billing.%' or a.action like 'access.%' or a.action = 'shop.provisioned' order by a.id desc limit 150`));
export const allPlans = (db: Db) => db.system((q) => q.all('select * from plans order by sort'));
// o segredo dos links nunca sai do servidor: só as configurações numéricas aparecem no admin
export async function getSettings(db: Db) { const r = await db.system((q) => q.all(`select key, value from platform_settings where key in ('grace_days','renew_days_before')`)); return Object.fromEntries(r.map((x) => [x.key, Number(x.value)])); }
export { forbidden };
