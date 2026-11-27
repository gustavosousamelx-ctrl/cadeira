// Adaptador do Asaas contra uma API simulada que segue a documentação oficial (docs.asaas.com).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asaasProvider, ASAAS_URLS } from '../src/billing/providers.ts';
import { openDb } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { clock, resetRateLimits } from '../src/lib/core.ts';
import { http, NOW } from './helpers.ts';

const TOKEN = 'token-do-webhook-com-mais-de-32-caracteres-123';
function fakeAsaas() {
  const calls: { method: string; url: string; headers: any; body: any }[] = [];
  const customers: any[] = [];
  const impl = (async (url: any, init: any) => {
    const u = String(url), body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, url: u, headers: init.headers, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/customers?')) { const ref = new URL(u).searchParams.get('externalReference'); return json({ data: customers.filter((c) => c.externalReference === ref) }); }
    if (u.endsWith('/customers')) { if (!body.cpfCnpj) return json({ errors: [{ code: 'invalid_cpfCnpj' }] }, 400); const c = { id: 'cus_' + (customers.length + 1), ...body }; customers.push(c); return json(c); }
    if (u.endsWith('/payments')) return json({ id: 'pay_080225913252', invoiceUrl: 'https://www.asaas.com/i/080225913252', status: 'PENDING', value: body.value });
    if (u.endsWith('/status')) return json({ status: 'RECEIVED' });
    return json({}, 404);
  }) as typeof fetch;
  return { impl, calls };
}

test('adaptador: URLs, headers, CPF obrigatório, sem cliente duplicado, valores em reais', async () => {
  const F = fakeAsaas();
  const p = asaasProvider({ apiKey: 'chave', webhookToken: TOKEN, sandbox: true, fetchImpl: F.impl });
  await assert.rejects(p.createCustomer({ name: 'Barbearia', email: 'a@b.com', shopId: 'shop-1' }), /CPF ou CNPJ/);
  const c1 = await p.createCustomer({ name: 'Barbearia', email: 'a@b.com', shopId: 'shop-1', document: '12345678909' });
  const c2 = await p.createCustomer({ name: 'Barbearia', email: 'a@b.com', shopId: 'shop-1', document: '12345678909' });
  assert.equal(c1, c2, 'reaproveita o cliente já cadastrado');
  const ch = await p.createCharge({ customerId: c1, amountCents: 8990, dueAt: new Date('2026-12-02T12:00:00Z'), description: 'Profissional', externalRef: 'sub-1' });
  assert.equal(ch.checkoutUrl, 'https://www.asaas.com/i/080225913252');
  const pay = F.calls.find((c) => c.url.endsWith('/payments'))!;
  assert.ok(pay.url.startsWith(ASAAS_URLS.sandbox)); assert.equal(ASAAS_URLS.sandbox, 'https://api-sandbox.asaas.com/v3');
  assert.equal(pay.headers.access_token, 'chave');
  assert.deepEqual({ billingType: pay.body.billingType, value: pay.body.value, dueDate: pay.body.dueDate }, { billingType: 'UNDEFINED', value: 89.9, dueDate: '2026-12-02' });
  assert.equal(await p.status!('pay_080225913252'), 'confirmed');
});

test('adaptador: token do webhook segue as regras do Asaas; eventos e campos desconhecidos não quebram', () => {
  assert.throws(() => asaasProvider({ apiKey: 'x', webhookToken: 'curto', sandbox: true }), /32 a 255/);
  const p = asaasProvider({ apiKey: 'x', webhookToken: TOKEN, sandbox: true });
  assert.equal(p.verify({ 'asaas-access-token': TOKEN }, ''), true);
  assert.equal(p.verify({ 'asaas-access-token': TOKEN + 'x' }, ''), false);
  assert.equal(p.verify({}, ''), false);
  const ev = p.parse(JSON.stringify({ id: 'evt_1', event: 'PAYMENT_RECEIVED', dateCreated: '2026-12-02 10:00:00', account: { id: 'a' }, campoNovo: { x: 1 }, payment: { id: 'pay_1', status: 'RECEIVED' } }));
  assert.deepEqual([ev.eventId, ev.type, ev.providerPaymentId], ['evt_1', 'confirmed', 'pay_1']);
  assert.equal(p.parse(JSON.stringify({ id: 'evt_2', event: 'PAYMENT_BANK_SLIP_VIEWED', payment: { id: 'pay_1' } })).type, 'ignored');
});

test('webhook do Asaas de ponta a ponta: Pix confirmado e recebido, reenvio e token inválido', async () => {
  clock.now = () => NOW; resetRateLimits();
  const db = await openDb();
  const F = fakeAsaas();
  const app = createApp(db, { billing: asaasProvider({ apiKey: 'chave', webhookToken: TOKEN, sandbox: true, fetchImpl: F.impl }) });
  const H = http(app);
  await db.system((q) => q.exec(`update plans set price_cents = 8990 where id = 'profissional'`));
  const A = await H.signupShop('asaas-teste');
  // contratação exige CPF/CNPJ com o Asaas
  const noDoc = await H.req('/app/s/asaas-teste/assinatura/contratar', { cookie: A.cookie, form: { plan: 'profissional' } });
  assert.equal(noDoc.status, 422);
  const r = await H.req('/app/s/asaas-teste/assinatura/contratar', { cookie: A.cookie, form: { plan: 'profissional', document: '123.456.789-09' } });
  assert.equal(r.location, 'https://www.asaas.com/i/080225913252');
  const send = (body: object, token = TOKEN) => app.request('/webhooks/billing/asaas', { method: 'POST', body: JSON.stringify(body), headers: { host: 'localhost', 'content-type': 'application/json', 'asaas-access-token': token } });
  assert.equal((await send({ id: 'evt_x', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_080225913252' } }, 'token-errado-com-mais-de-32-caracteres-000')).status, 401);
  const first = await send({ id: 'evt_a', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_080225913252' } });
  assert.equal(first.status, 200); // o Asaas só considera entregue com 200
  assert.equal((await first.json() as any).result, 'applied:confirmed');
  assert.equal((await (await send({ id: 'evt_a', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_080225913252' } })).json() as any).result, 'duplicate');
  assert.equal((await (await send({ id: 'evt_b', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_080225913252' } })).json() as any).result, 'no_change');
  const s = await db.system((q) => q.one(`select s.status from saas_subscriptions s join shops sh on sh.id = s.shop_id where sh.slug = 'asaas-teste'`));
  assert.equal(s!.status, 'active');
  await db.close();
});
