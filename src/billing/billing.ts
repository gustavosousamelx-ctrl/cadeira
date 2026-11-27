import type { Db, Q } from '../db/db.ts';
import type { Ctx } from '../domain/accounts.ts';
import { must } from '../domain/accounts.ts';
import type { BillingProvider, PayEvent } from './providers.ts';
import { AppError, clock, invalid, notFound } from '../lib/core.ts';

/*
 * Assinatura SaaS: a barbearia paga a plataforma.
 *  Estados da assinatura: trialing → active ⇄ past_due → expired; active → canceled (no fim do período).
 *  Estados de cada cobrança: pending → confirmed | overdue | failed | canceled; confirmed → refunded.
 * A liberação acontece SÓ quando o provedor confirma por aviso autenticado (ou pela conciliação).
 * Voltar da página de pagamento com "sucesso" não muda nada.
 */
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export const SUB_LABEL: Record<SubStatus, string> = { trialing: 'Em teste', active: 'Ativa', past_due: 'Pagamento pendente', canceled: 'Cancelada', expired: 'Suspensa' };
export const PAY_LABEL: Record<string, string> = { pending: 'Aguardando pagamento', overdue: 'Vencida', failed: 'Recusada', confirmed: 'Paga', refunded: 'Estornada', canceled: 'Cancelada' };

const DAY = 86_400_000;
export function addMonth(d: Date) {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1); r.setUTCMonth(r.getUTCMonth() + 1);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
export async function settings(q: Q) {
  const rows = await q.all('select key, value from platform_settings');
  const get = (k: string, d: number) => Number(rows.find((r) => r.key === k)?.value ?? d);
  return { graceDays: get('grace_days', 5), renewDaysBefore: get('renew_days_before', 3) };
}

export async function loadSub(db: Db, shopId: string) {
  return db.system((q) => q.one(`select s.*, p.name plan_name, p.price_cents plan_price, p.max_professionals, p.features, pp.name pending_plan_name
    from saas_subscriptions s join plans p on p.id = s.plan_id left join plans pp on pp.id = s.pending_plan_id where s.shop_id = $1`, [shopId]));
}

export type Entitlement = { ok: boolean; level: 'ok' | 'warn' | 'blocked'; message: string };
const ddmm = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
/** O que a barbearia pode usar agora, calculado no servidor a partir do estado salvo. */
export function entitlement(sub: any, isDemo: boolean, now = clock.now()): Entitlement {
  if (isDemo || !sub) return { ok: true, level: 'ok', message: '' };
  const t = now.getTime();
  switch (sub.status as SubStatus) {
    case 'trialing': {
      const end = new Date(sub.trial_ends_at).getTime();
      if (end <= t) return { ok: false, level: 'blocked', message: 'O período de teste terminou. Escolha um plano para continuar usando o sistema.' };
      const left = Math.ceil((end - t) / DAY);
      return { ok: true, level: left <= 5 ? 'warn' : 'ok', message: `Seu teste termina em ${left} ${left === 1 ? 'dia' : 'dias'} (${ddmm(new Date(end))}).` };
    }
    case 'active':
      return sub.cancel_at_period_end ? { ok: true, level: 'warn', message: `Assinatura cancelada. O acesso continua até ${ddmm(new Date(sub.current_period_end))}.` } : { ok: true, level: 'ok', message: '' };
    case 'past_due':
      return sub.grace_until && new Date(sub.grace_until).getTime() > t
        ? { ok: true, level: 'warn', message: `Mensalidade em aberto. Pague até ${ddmm(new Date(sub.grace_until))} para não suspender o agendamento.` }
        : { ok: false, level: 'blocked', message: 'A assinatura está suspensa por falta de pagamento.' };
    default:
      if (sub.status === 'expired' && !sub.current_period_end) return { ok: false, level: 'blocked', message: 'O período de teste terminou. Escolha um plano para continuar usando o sistema.' };
      return { ok: false, level: 'blocked', message: sub.status === 'canceled' ? 'A assinatura foi cancelada. Reative escolhendo um plano.' : 'A assinatura está suspensa. Escolha um plano para reativar.' };
  }
}

async function audit(q: Q, shopId: string | null, userId: string | null, action: string, meta: object = {}) {
  await q.exec('insert into audit_log (shop_id, user_id, action, entity, meta) values ($1,$2,$3,$4,$5)', [shopId, userId, action, 'subscription', JSON.stringify(meta)]);
}
async function proCount(db: Db, shopId: string) { return (await db.tenant(shopId, (q) => q.one('select count(*)::int n from professionals where active')))!.n as number; }

/* ---------- contratação / reativação: gera cobrança e devolve o link do provedor ---------- */
export async function startCheckout(db: Db, prov: BillingProvider | null, ctx: Ctx, planId: string, o: { document?: string } = {}) {
  must(ctx, 'billing.manage');
  if (!prov) throw new AppError(503, 'billing_off', 'A contratação online ainda não está disponível: o meio de pagamento não foi configurado.');
  const plan = await db.system((q) => q.one('select * from plans where id = $1 and active', [planId]));
  if (!plan) throw notFound('Plano não encontrado.');
  if (!(plan.price_cents > 0)) throw invalid('Este plano ainda não tem preço definido.');
  if (plan.max_professionals != null && (await proCount(db, ctx.shop.id)) > plan.max_professionals) throw invalid(`O plano ${plan.name} permite até ${plan.max_professionals} profissionais ativos. Desative alguém antes ou escolha outro plano.`);
  const sub = await loadSub(db, ctx.shop.id);
  if (!sub) throw notFound();
  if (sub.status === 'active') throw invalid('Sua assinatura já está ativa. Para mudar de plano, use “Trocar para este plano”.');
  const open = await db.system((q) => q.one(`select * from saas_payments where subscription_id = $1 and status in ('pending','overdue','failed')`, [sub.id]));
  if (sub.status === 'past_due' && open?.checkout_url) return open.checkout_url as string; // em atraso: paga a mensalidade em aberto
  if (open && open.plan_id === planId && open.status === 'pending' && open.checkout_url) return open.checkout_url as string; // reaproveita o mesmo link
  let customer = sub.provider_customer_id as string | null;
  if (!customer) {
    const owner = await db.system((q) => q.one(`select u.name, u.email from memberships m join users u on u.id = m.user_id where m.shop_id = $1 and m.role = 'owner' limit 1`, [ctx.shop.id]));
    customer = await prov.createCustomer({ name: ctx.shop.name, email: owner?.email ?? ctx.user.email, shopId: ctx.shop.id, document: o.document });
    await db.system((q) => q.exec('update saas_subscriptions set provider_customer_id = $2, provider = $3 where id = $1', [sub.id, customer, prov.id]));
  }
  const now = clock.now();
  const charge = await prov.createCharge({ customerId: customer, amountCents: plan.price_cents, dueAt: now, description: `${plan.name} · ${ctx.shop.name} · 1 mês`, externalRef: sub.id });
  await db.system(async (q) => {
    if (open) await q.exec(`update saas_payments set status = 'canceled', updated_at = now() where id = $1 and status in ('pending','overdue','failed')`, [open.id]);
    await q.exec(`insert into saas_payments (subscription_id, shop_id, plan_id, kind, amount_cents, period_start, period_end, due_at, status, provider, provider_payment_id, checkout_url)
      values ($1,$2,$3,'first',$4,$5,$6,$5,'pending',$7,$8,$9)`, [sub.id, ctx.shop.id, plan.id, plan.price_cents, now, addMonth(now), prov.id, charge.id, charge.checkoutUrl]);
    await audit(q, ctx.shop.id, ctx.user.id, 'billing.checkout_started', { plan: plan.id, amount_cents: plan.price_cents });
  });
  return charge.checkoutUrl;
}

/* ---------- troca de plano ---------- */
export async function changePlan(db: Db, ctx: Ctx, planId: string) {
  must(ctx, 'billing.manage');
  const [sub, plan] = [await loadSub(db, ctx.shop.id), await db.system((q) => q.one('select * from plans where id = $1 and active', [planId]))];
  if (!sub || !plan) throw notFound('Plano não encontrado.');
  if (sub.plan_id === planId && !sub.pending_plan_id) throw invalid('Esse já é o seu plano.');
  if (!(plan.price_cents > 0) && sub.status !== 'trialing') throw invalid('Este plano ainda não tem preço definido.');
  if (!['trialing', 'active', 'past_due'].includes(sub.status)) throw invalid('Reative a assinatura escolhendo um plano.');
  if (plan.max_professionals != null && (await proCount(db, ctx.shop.id)) > plan.max_professionals) throw invalid(`O plano ${plan.name} permite até ${plan.max_professionals} profissionais ativos. Desative alguém antes de trocar.`);
  const current = sub.price_cents ?? sub.plan_price;
  return db.system(async (q) => {
    if (sub.status === 'trialing') {
      await q.exec('update saas_subscriptions set plan_id = $2, pending_plan_id = null, updated_at = now() where id = $1', [sub.id, planId]);
      await audit(q, ctx.shop.id, ctx.user.id, 'billing.plan_changed', { from: sub.plan_id, to: planId, when: 'now' });
      return 'now';
    }
    if (sub.plan_id === planId) { // desfaz um downgrade agendado
      await q.exec('update saas_subscriptions set pending_plan_id = null, updated_at = now() where id = $1', [sub.id]);
      await audit(q, ctx.shop.id, ctx.user.id, 'billing.downgrade_undone', {});
      return 'undone';
    }
    if (plan.price_cents >= current) {
      // upgrade: libera na hora; a próxima mensalidade já vem com o novo valor (sem cobrança proporcional)
      await q.exec('update saas_subscriptions set plan_id = $2, price_cents = $3, pending_plan_id = null, updated_at = now() where id = $1', [sub.id, planId, plan.price_cents]);
      await audit(q, ctx.shop.id, ctx.user.id, 'billing.plan_changed', { from: sub.plan_id, to: planId, when: 'now' });
      return 'now';
    }
    // downgrade: vale a partir da próxima renovação
    await q.exec('update saas_subscriptions set pending_plan_id = $2, updated_at = now() where id = $1', [sub.id, planId]);
    await audit(q, ctx.shop.id, ctx.user.id, 'billing.downgrade_scheduled', { from: sub.plan_id, to: planId });
    return 'scheduled';
  });
}

export async function cancelSubscription(db: Db, ctx: Ctx) {
  must(ctx, 'billing.manage');
  const sub = await loadSub(db, ctx.shop.id);
  if (!sub) throw notFound();
  await db.system(async (q) => {
    if (sub.status === 'trialing') await q.exec(`update saas_subscriptions set status = 'canceled', canceled_at = $2, updated_at = now() where id = $1`, [sub.id, clock.now()]);
    else if (['active', 'past_due'].includes(sub.status)) await q.exec('update saas_subscriptions set cancel_at_period_end = true, updated_at = now() where id = $1', [sub.id]);
    else throw invalid('A assinatura já está encerrada.');
    await audit(q, ctx.shop.id, ctx.user.id, 'billing.cancel_requested', { status: sub.status });
  });
}
export async function resumeSubscription(db: Db, ctx: Ctx) {
  must(ctx, 'billing.manage');
  const sub = await loadSub(db, ctx.shop.id);
  if (!sub || sub.status !== 'active' || !sub.cancel_at_period_end) throw invalid('Não há cancelamento para desfazer.');
  await db.system(async (q) => { await q.exec('update saas_subscriptions set cancel_at_period_end = false, updated_at = now() where id = $1', [sub.id]); await audit(q, ctx.shop.id, ctx.user.id, 'billing.cancel_undone'); });
}

/* ---------- avisos do provedor (webhook) ---------- */
const NEXT: Record<string, string[]> = {
  pending: ['confirmed', 'overdue', 'failed', 'canceled'], overdue: ['confirmed', 'failed', 'canceled'], failed: ['confirmed', 'overdue', 'canceled'],
  confirmed: ['refunded'], refunded: [], canceled: ['confirmed'], // dinheiro recebido num link antigo ainda vale
};

export async function handleWebhook(db: Db, prov: BillingProvider, headers: Record<string, string | undefined>, raw: string) {
  if (!prov.verify(headers, raw)) return { status: 401, result: 'invalid_signature' };
  let ev: PayEvent;
  try { ev = prov.parse(raw); } catch { return { status: 400, result: 'bad_payload' }; }
  return recordAndApply(db, prov.id, ev);
}

async function recordAndApply(db: Db, providerId: string, ev: PayEvent) {
  return db.system(async (q) => {
    const ins = await q.one(`insert into billing_events (provider, event_id, type, provider_payment_id, payload) values ($1,$2,$3,$4,$5::jsonb)
      on conflict (provider, event_id) do nothing returning id`, [providerId, ev.eventId, ev.type, ev.providerPaymentId, ev.raw]);
    if (!ins) return { status: 200, result: 'duplicate' }; // idempotência: o mesmo aviso nunca é aplicado duas vezes
    const result = await applyEvent(q, providerId, ev, clock.now());
    await q.exec('update billing_events set processed_at = now(), result = $2 where id = $1', [ins.id, result]);
    return { status: 200, result };
  });
}

async function applyEvent(q: Q, providerId: string, ev: PayEvent, now: Date): Promise<string> {
  if (ev.type === 'ignored' || !ev.providerPaymentId) return 'ignored';
  const p = await q.one('select * from saas_payments where provider = $1 and provider_payment_id = $2 for update', [providerId, ev.providerPaymentId]);
  if (!p) return 'unknown_payment'; // fica registrado para conciliação manual
  if (p.status === ev.type) return 'no_change';
  if (!NEXT[p.status]?.includes(ev.type)) return `out_of_order:${p.status}->${ev.type}`; // aviso atrasado não desfaz um estado mais avançado
  await q.exec(`update saas_payments set status = $2, paid_at = case when $2 = 'confirmed' then $3::timestamptz else paid_at end, updated_at = now() where id = $1`, [p.id, ev.type, now]);
  const sub = await q.one('select * from saas_subscriptions where id = $1 for update', [p.subscription_id]);
  const { graceDays } = await settings(q);
  if (ev.type === 'confirmed') {
    if (p.kind === 'first') {
      await q.exec(`update saas_subscriptions set status = 'active', plan_id = $2, price_cents = $3, current_period_end = $4, grace_until = null, cancel_at_period_end = false, canceled_at = null, pending_plan_id = null, updated_at = now() where id = $1`,
        [sub!.id, p.plan_id, p.amount_cents, p.period_end]);
    } else {
      await q.exec(`update saas_subscriptions set status = case when status in ('past_due','expired','active') then 'active' else status end, current_period_end = greatest(coalesce(current_period_end, $2), $2), grace_until = null, updated_at = now() where id = $1`, [sub!.id, p.period_end]);
    }
  } else if ((ev.type === 'overdue' || ev.type === 'failed') && p.kind === 'renewal' && sub!.status === 'active' && new Date(sub!.current_period_end).getTime() <= now.getTime()) {
    await q.exec(`update saas_subscriptions set status = 'past_due', grace_until = $2, updated_at = now() where id = $1`, [sub!.id, new Date(new Date(p.due_at).getTime() + graceDays * DAY)]);
  } else if (ev.type === 'refunded' && new Date(p.period_end).getTime() >= new Date(sub!.current_period_end ?? 0).getTime()) {
    await q.exec(`update saas_subscriptions set status = 'canceled', canceled_at = $2, updated_at = now() where id = $1`, [sub!.id, now]);
  }
  await audit(q, p.shop_id, null, `billing.payment_${ev.type}`, { payment: p.id, amount_cents: p.amount_cents });
  return `applied:${ev.type}`;
}

/* ---------- rotina periódica: fim de teste, renovação, atraso, suspensão, cancelamento ---------- */
export async function sweep(db: Db, prov: BillingProvider | null, now = clock.now()) {
  const out = { trialsEnded: 0, canceled: 0, renewalsCreated: 0, pastDue: 0, suspended: 0, downgradesApplied: 0 };
  const { graceDays, renewDaysBefore } = await db.system(settings);
  await db.system(async (q) => {
    out.trialsEnded = await q.exec(`update saas_subscriptions set status = 'expired', updated_at = now() where status = 'trialing' and trial_ends_at <= $1`, [now]);
    const ending = await q.all(`select id, shop_id from saas_subscriptions where status in ('active','past_due') and cancel_at_period_end and current_period_end <= $1`, [now]);
    for (const s of ending) {
      await q.exec(`update saas_subscriptions set status = 'canceled', canceled_at = $2, updated_at = now() where id = $1`, [s.id, now]);
      await q.exec(`update saas_payments set status = 'canceled', updated_at = now() where subscription_id = $1 and status in ('pending','overdue','failed')`, [s.id]);
      await audit(q, s.shop_id, null, 'billing.canceled_at_period_end');
    }
    out.canceled = ending.length;
    // período acabou sem renovação paga (a confirmação estende current_period_end): entra em atraso com tolerância
    const late = await q.all(`select s.id, s.current_period_end from saas_subscriptions s where s.status = 'active' and not s.cancel_at_period_end and s.current_period_end <= $1`, [now]);
    for (const s of late) await q.exec(`update saas_subscriptions set status = 'past_due', grace_until = $2, updated_at = now() where id = $1`, [s.id, new Date(new Date(s.current_period_end).getTime() + graceDays * DAY)]);
    out.pastDue = late.length;
    out.suspended = await q.exec(`update saas_subscriptions set status = 'expired', updated_at = now() where status = 'past_due' and grace_until <= $1`, [now]);
  });
  if (!prov) return out;
  // renovações: cria a cobrança do próximo período alguns dias antes do vencimento
  const due = await db.system((q) => q.all(`select s.*, p.price_cents plan_price, pp.price_cents pending_price from saas_subscriptions s join plans p on p.id = s.plan_id left join plans pp on pp.id = s.pending_plan_id
    where s.status in ('active','past_due','expired') and s.provider_customer_id is not null
      and not s.cancel_at_period_end and s.current_period_end <= $1
      and s.current_period_end + interval '1 month' > $2
      and not exists (select 1 from saas_payments x where x.subscription_id = s.id and (x.status in ('pending','overdue','failed') or (x.status = 'confirmed' and x.period_start >= s.current_period_end)))`,
    [new Date(now.getTime() + renewDaysBefore * DAY), now]));
  for (const s of due) {
    const planId = s.pending_plan_id ?? s.plan_id;
    const amount = s.pending_plan_id ? s.pending_price : (s.price_cents ?? s.plan_price);
    if (!(amount > 0)) continue;
    const start = new Date(s.current_period_end), end = addMonth(start);
    const charge = await prov.createCharge({ customerId: s.provider_customer_id, amountCents: amount, dueAt: start, description: `Mensalidade · ${end.toISOString().slice(0, 10)}`, externalRef: s.id });
    await db.system(async (q) => {
      if (s.pending_plan_id) {
        await q.exec('update saas_subscriptions set plan_id = $2, price_cents = $3, pending_plan_id = null, updated_at = now() where id = $1', [s.id, planId, amount]);
        out.downgradesApplied++;
      }
      await q.exec(`insert into saas_payments (subscription_id, shop_id, plan_id, kind, amount_cents, period_start, period_end, due_at, status, provider, provider_payment_id, checkout_url)
        values ($1,$2,$3,'renewal',$4,$5,$6,$5,'pending',$7,$8,$9) on conflict do nothing`, [s.id, s.shop_id, planId, amount, start, end, prov.id, charge.id, charge.checkoutUrl]);
    });
    out.renewalsCreated++;
  }
  return out;
}

/** Conciliação: pergunta ao provedor o status das cobranças em aberto e aplica o que mudou (avisos perdidos). */
export async function reconcile(db: Db, prov: BillingProvider) {
  if (!prov.status) return 0;
  const open = await db.system((q) => q.all(`select provider_payment_id, status from saas_payments where provider = $1 and status in ('pending','overdue','failed')`, [prov.id]));
  let n = 0;
  for (const p of open) {
    const st = await prov.status(p.provider_payment_id);
    if (st && st !== p.status && st !== 'ignored') { await recordAndApply(db, prov.id, { eventId: `reconcile:${p.provider_payment_id}:${st}`, type: st, providerPaymentId: p.provider_payment_id, raw: JSON.stringify({ reconcile: true, status: st }) }); n++; }
  }
  return n;
}

export const paymentsOf = (db: Db, shopId: string) => db.system((q) => q.all('select p.*, pl.name plan_name from saas_payments p join plans pl on pl.id = p.plan_id where p.shop_id = $1 order by p.created_at desc limit 24', [shopId]));
export const activePlans = (db: Db) => db.system((q) => q.all('select * from plans where active order by sort'));
