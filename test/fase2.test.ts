// Fase 2: assinatura SaaS, cobrança, avisos do provedor, bloqueios e administração.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { sandboxProvider } from '../src/billing/providers.ts';
import { sweep, reconcile } from '../src/billing/billing.ts';
import { clock, resetRateLimits, localToUtc } from '../src/lib/core.ts';
import { http, NOW, firstIds } from './helpers.ts';

const DAY = 86_400_000;
const at = (d: Date) => { clock.now = () => d; };
const flashOf = (r: any) => Buffer.from((r.cookies.find((c: string) => c.startsWith('f=')) ?? 'f=').split(';')[0].slice(2), 'base64url').toString();

async function setup() {
  at(NOW); resetRateLimits();
  const db = await openDb();
  const prov = sandboxProvider(db, 'segredo-de-teste');
  const app = createApp(db, { billing: prov });
  await db.system((q) => q.exec(`update plans set price_cents = case id when 'essencial' then 4990 when 'profissional' then 8990 else 14990 end`));
  const H = http(app);
  const hook = async (body: string, sig?: string) => {
    const res = await app.request('/webhooks/billing/sandbox', { method: 'POST', body, headers: { host: 'localhost', 'content-type': 'application/json', 'x-sandbox-signature': sig ?? prov.sign(body) } });
    return { status: res.status, ...(await res.json()) as any };
  };
  return { db, prov, app, hook, ...H };
}
const sub = (db: Db, slug: string) => db.system((q) => q.one('select s.* from saas_subscriptions s join shops sh on sh.id = s.shop_id where sh.slug = $1', [slug]));
const payments = (db: Db, slug: string) => db.system((q) => q.all('select p.* from saas_payments p join shops sh on sh.id = p.shop_id where sh.slug = $1 order by p.created_at', [slug]));

describe('assinatura SaaS', () => {
  let E: Awaited<ReturnType<typeof setup>>, A: any;
  before(async () => { E = await setup(); A = await E.signupShop('kappa'); await E.req('/app/s/kappa/pagina/publicar', { cookie: A.cookie, form: {} }); });
  after(() => E.db.close());

  test('contratação só libera com aviso autenticado; voltar da página de pagamento não libera', async () => {
    const r = await E.req('/app/s/kappa/assinatura/contratar', { cookie: A.cookie, form: { plan: 'profissional' } });
    assert.equal(r.status, 303); assert.match(r.location, /^\/sandbox\/pagar\/pay_/);
    const back = await E.req('/app/s/kappa/assinatura?retorno=1', { cookie: A.cookie });
    assert.match(back.text, /liberada assim que o meio de pagamento confirmar/);
    assert.equal((await sub(E.db, 'kappa'))!.status, 'trialing');
    // aviso com assinatura inválida é recusado e nem fica registrado
    const chargeId = r.location.split('/').pop()!;
    const forged = JSON.stringify({ id: 'evt_falso', type: 'payment.confirmed', payment_id: chargeId });
    assert.equal((await E.hook(forged, 'assinatura-errada')).status, 401);
    assert.equal((await E.db.system((q) => q.one(`select count(*)::int n from billing_events where event_id = 'evt_falso'`)))!.n, 0);
    assert.equal((await sub(E.db, 'kappa'))!.status, 'trialing');
    // aviso verdadeiro
    const body = await E.prov.settle(chargeId, 'confirmed');
    const ok = await E.hook(body);
    assert.equal(ok.result, 'applied:confirmed');
    const s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.status, 'active'); assert.equal(s.plan_id, 'profissional'); assert.equal(s.price_cents, 8990);
    assert.equal(new Date(s.current_period_end).toISOString(), '2027-01-02T12:00:00.000Z');
    // o mesmo aviso de novo: ignorado, nada é estendido duas vezes
    assert.equal((await E.hook(body)).result, 'duplicate');
    assert.equal(new Date((await sub(E.db, 'kappa'))!.current_period_end).toISOString(), '2027-01-02T12:00:00.000Z');
    // aviso atrasado/fora de ordem (venceu) não desfaz o pagamento confirmado
    const late = JSON.stringify({ id: 'evt_atrasado', type: 'payment.overdue', payment_id: chargeId });
    assert.match((await E.hook(late)).result, /^out_of_order/);
    assert.equal((await sub(E.db, 'kappa'))!.status, 'active');
  });

  test('renovação: cobrança gerada antes do vencimento e período estendido ao pagar', async () => {
    at(new Date(Date.parse('2027-01-02T12:00:00Z') - 2 * DAY));
    const r1 = await sweep(E.db, E.prov);
    assert.equal(r1.renewalsCreated, 1);
    assert.equal((await sweep(E.db, E.prov)).renewalsCreated, 0, 'não duplica a cobrança');
    const ren = (await payments(E.db, 'kappa')).find((p) => p.kind === 'renewal')!;
    assert.equal(ren.status, 'pending'); assert.equal(ren.amount_cents, 8990);
    assert.equal((await E.hook(await E.prov.settle(ren.provider_payment_id, 'confirmed'))).result, 'applied:confirmed');
    assert.equal(new Date((await sub(E.db, 'kappa'))!.current_period_end).toISOString(), '2027-02-02T12:00:00.000Z');
  });

  test('atraso: tolerância, suspensão do agendamento e reativação ao pagar', async () => {
    at(new Date(Date.parse('2027-02-02T12:00:00Z') - 2 * DAY)); await sweep(E.db, E.prov);
    const ren = (await payments(E.db, 'kappa')).find((p) => p.status === 'pending')!;
    assert.equal((await E.hook(await E.prov.settle(ren.provider_payment_id, 'failed'))).result, 'applied:failed');
    assert.equal((await sub(E.db, 'kappa'))!.status, 'active', 'recusa antes do vencimento não suspende');
    at(new Date(Date.parse('2027-02-02T12:00:00Z') + 3600_000)); await sweep(E.db, E.prov);
    let s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.status, 'past_due'); assert.equal(new Date(s.grace_until).toISOString(), '2027-02-07T12:00:00.000Z');
    const home = await E.req('/app/s/kappa', { cookie: A.cookie });
    assert.equal(home.status, 200); assert.match(home.text, /Mensalidade em aberto/);
    assert.equal((await E.req('/b/kappa')).status, 200, 'na tolerância a página continua no ar');
    at(new Date(Date.parse('2027-02-08T12:00:00Z'))); await sweep(E.db, E.prov);
    assert.equal((await sub(E.db, 'kappa'))!.status, 'expired');
    assert.equal((await E.req('/app/s/kappa', { cookie: A.cookie })).status, 402);
    assert.equal((await E.req('/app/s/kappa/servicos', { cookie: A.cookie })).status, 402);
    assert.equal((await E.req('/app/s/kappa/assinatura', { cookie: A.cookie })).status, 200);
    assert.equal((await E.req('/b/kappa')).status, 503);
    const ids = await firstIds(E.db, (await E.db.system((q) => q.one(`select id from shops where slug = 'kappa'`)))!.id);
    const post = await E.req('/b/kappa/reservar', { form: { s: [ids.services[0].id], p: 'any', t: localToUtc('2027-02-09', 600, 'America/Sao_Paulo').toISOString(), name: 'Cliente', phone: '11999998888' } });
    assert.equal(post.status, 503, 'bloqueio vale no servidor, não só na tela');
    // paga a mensalidade em aberto (provedor confirma): volta a funcionar
    const open = (await payments(E.db, 'kappa')).find((p) => ['pending', 'failed', 'overdue'].includes(p.status))!;
    assert.equal((await E.hook(await E.prov.settle(open.provider_payment_id, 'confirmed'))).result, 'applied:confirmed');
    s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.status, 'active'); assert.equal(new Date(s.current_period_end).toISOString(), '2027-03-02T12:00:00.000Z');
    assert.equal((await E.req('/b/kappa')).status, 200);
  });

  test('troca de plano: upgrade na hora, downgrade na renovação, limite de equipe respeitado', async () => {
    const up = await E.req('/app/s/kappa/assinatura/trocar', { cookie: A.cookie, form: { plan: 'gestao' } });
    assert.match(flashOf(up), /plan_changed/);
    let s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.plan_id, 'gestao'); assert.equal(s.price_cents, 14990);
    // com 3 profissionais ativos o Essencial (até 2) é recusado
    for (const n of ['Dois', 'Três']) await E.req('/app/s/kappa/equipe', { cookie: A.cookie, form: { name: 'Barbeiro ' + n, title: '', commission: '0' } });
    const refused = await E.req('/app/s/kappa/assinatura/trocar', { cookie: A.cookie, form: { plan: 'essencial' }, headers: { referer: 'http://localhost/app/s/kappa/assinatura' } });
    assert.match(flashOf(refused), /permite até 2 profissionais/);
    const pros = await E.db.system((q) => q.all(`select p.id from professionals p join shops s on s.id = p.shop_id where s.slug = 'kappa' and p.name like 'Barbeiro%'`));
    for (const p of pros) await E.req(`/app/s/kappa/equipe/${p.id}/desativar`, { cookie: A.cookie, form: {} });
    const down = await E.req('/app/s/kappa/assinatura/trocar', { cookie: A.cookie, form: { plan: 'essencial' } });
    assert.match(flashOf(down), /plan_scheduled/);
    s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.plan_id, 'gestao'); assert.equal(s.pending_plan_id, 'essencial');
    at(new Date(Date.parse('2027-03-02T12:00:00Z') - DAY)); await sweep(E.db, E.prov);
    s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.plan_id, 'essencial'); assert.equal(s.pending_plan_id, null);
    const ren = (await payments(E.db, 'kappa')).find((p) => p.status === 'pending')!;
    assert.equal(ren.amount_cents, 4990); assert.equal(ren.plan_id, 'essencial');
    await E.hook(await E.prov.settle(ren.provider_payment_id, 'confirmed'));
  });

  test('cancelamento no fim do período e reativação', async () => {
    const c = await E.req('/app/s/kappa/assinatura/cancelar', { cookie: A.cookie, form: {} });
    assert.match(flashOf(c), /sub_canceled/);
    let s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.status, 'active'); assert.equal(s.cancel_at_period_end, true);
    at(new Date(Date.parse(s.current_period_end) - 2 * DAY));
    assert.equal((await sweep(E.db, E.prov)).renewalsCreated, 0, 'cancelada não gera renovação');
    at(new Date(Date.parse(s.current_period_end) + 3600_000)); await sweep(E.db, E.prov);
    assert.equal((await sub(E.db, 'kappa'))!.status, 'canceled');
    assert.equal((await E.req('/b/kappa')).status, 503);
    const r = await E.req('/app/s/kappa/assinatura/contratar', { cookie: A.cookie, form: { plan: 'profissional' } });
    assert.equal(r.status, 303);
    await E.hook(await E.prov.settle(r.location.split('/').pop()!, 'confirmed'));
    s = (await sub(E.db, 'kappa'))!;
    assert.equal(s.status, 'active'); assert.equal(s.plan_id, 'profissional'); assert.equal(s.cancel_at_period_end, false);
    assert.equal((await E.req('/b/kappa')).status, 200);
  });
});

describe('teste grátis, conciliação, permissões e administração', () => {
  let E: Awaited<ReturnType<typeof setup>>, A: any;
  before(async () => { E = await setup(); A = await E.signupShop('lambda'); });
  after(() => E.db.close());

  test('pagamento recusado na contratação mantém o teste; nova tentativa substitui a cobrança', async () => {
    const r = await E.req('/app/s/lambda/assinatura/contratar', { cookie: A.cookie, form: { plan: 'essencial' } });
    await E.hook(await E.prov.settle(r.location.split('/').pop()!, 'failed'));
    assert.equal((await sub(E.db, 'lambda'))!.status, 'trialing');
    const r2 = await E.req('/app/s/lambda/assinatura/contratar', { cookie: A.cookie, form: { plan: 'essencial' } });
    assert.notEqual(r2.location, r.location);
    const ps = await payments(E.db, 'lambda');
    assert.deepEqual(ps.map((p) => p.status), ['canceled', 'pending']);
  });

  test('conciliação aplica pagamento cujo aviso se perdeu', async () => {
    const p = (await payments(E.db, 'lambda')).find((x) => x.status === 'pending')!;
    await E.prov.settle(p.provider_payment_id, 'confirmed'); // provedor mudou, mas o aviso não chegou
    assert.equal((await sub(E.db, 'lambda'))!.status, 'trialing');
    assert.equal(await reconcile(E.db, E.prov), 1);
    assert.equal((await sub(E.db, 'lambda'))!.status, 'active');
  });

  test('fim do teste sem pagamento suspende o painel e a página', async () => {
    const B = await E.signupShop('mumu');
    await E.req('/app/s/mumu/pagina/publicar', { cookie: B.cookie, form: {} });
    at(new Date(NOW.getTime() + 15 * DAY)); await sweep(E.db, E.prov);
    assert.equal((await sub(E.db, 'mumu'))!.status, 'expired');
    const p = await E.req('/app/s/mumu', { cookie: B.cookie });
    assert.equal(p.status, 402); assert.match(p.text, /O período de teste terminou/);
    assert.equal((await E.req('/b/mumu')).status, 503);
    at(NOW);
  });

  test('só o proprietário mexe na assinatura; dados de cobrança ficam fora do alcance do tenant', async () => {
    const shop = (await E.db.system((q) => q.one(`select id from shops where slug = 'lambda'`)))!;
    const pro = (await firstIds(E.db, shop.id)).pros[0].id;
    await E.req('/app/s/lambda/equipe/acesso', { cookie: A.cookie, form: { professionalId: pro, role: 'manager', name: 'Gerente Lambda', email: 'gerente@lambda.com', password: 'provisoria-123' } });
    const g = await E.loginAs('gerente@lambda.com', 'provisoria-123');
    assert.equal((await E.req('/app/s/lambda/assinatura', { cookie: g })).status, 403);
    assert.equal((await E.req('/app/s/lambda/assinatura/cancelar', { cookie: g, form: {} })).status, 403);
    await assert.rejects(E.db.tenant(shop.id, (q) => q.all('select * from saas_payments')), /permission denied/);
    await assert.rejects(E.db.tenant(shop.id, (q) => q.all('select * from saas_subscriptions')), /permission denied/);
  });

  test('administração: acesso restrito, métricas reais e mudança de preço auditada', async () => {
    assert.equal((await E.req('/admin', { cookie: A.cookie })).status, 404);
    await E.db.system((q) => q.exec(`update users set is_platform_admin = true where email = 'lambda@teste.com.br'`));
    const ov = await E.req('/admin', { cookie: A.cookie });
    assert.equal(ov.status, 200);
    assert.match(ov.text, /R\$\s?49,90/); // MRR = a única assinatura ativa (Essencial)
    const list = await E.req('/admin/barbearias?status=expired', { cookie: A.cookie });
    assert.match(list.text, /Barbearia mumu/); assert.doesNotMatch(list.text, /Barbearia lambda/);
    const save = await E.req('/admin/planos/essencial', { cookie: A.cookie, form: { name: 'Essencial', price: '59,90', trial_days: '7', max_professionals: '2', active: '1' } });
    assert.equal(save.status, 303);
    const plan = (await E.db.system((q) => q.one(`select price_cents, trial_days from plans where id = 'essencial'`)))!;
    assert.equal(plan.price_cents, 5990); assert.equal(plan.trial_days, 7);
    const log = await E.db.system((q) => q.one(`select meta from audit_log where action = 'admin.plan_updated' order by id desc limit 1`));
    assert.equal(log!.meta.before.price_cents, 4990);
    // quem já assina mantém o preço contratado
    assert.equal((await sub(E.db, 'lambda'))!.price_cents, 4990);
    // admin não vê dados pessoais de clientes das barbearias na tela da loja
    const shop = (await E.db.system((q) => q.one(`select id from shops where slug = 'lambda'`)))!;
    const det = await E.req(`/admin/barbearias/${shop.id}`, { cookie: A.cookie });
    assert.equal(det.status, 200); assert.match(det.text, /Dados pessoais dos clientes da barbearia não aparecem aqui/);
  });
});
