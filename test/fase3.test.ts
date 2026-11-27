// Fase 3: caixa (comanda, pagamentos, comissões, fechamento), financeiro, clientes (LGPD) e primeiros passos.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, firstIds, THU } from './helpers.ts';
import { createBooking } from '../src/domain/booking.ts';
import { contextFor, publicShop } from '../src/domain/accounts.ts';
import { localToUtc } from '../src/lib/core.ts';

const T = (date: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return localToUtc(date, h * 60 + m, 'America/Sao_Paulo').toISOString(); };
const WED = '2026-12-02'; // NOW = quarta 09:00 em São Paulo
const flashOf = (r: any) => Buffer.from((r.cookies.find((c: string) => c.startsWith('f=')) ?? 'f=').split(';')[0].slice(2), 'base64url').toString();

describe('caixa e financeiro', () => {
  let E: any, A: any, shop: any, ids: any, ctx: any, bookingId = '', barberCookie = '', bruno = '';
  before(async () => {
    E = await env(); A = await E.signupShop('sigma');
    shop = (await publicShop(E.db, 'sigma'))!; ids = await firstIds(E.db, shop.id);
    await E.req(`/app/s/sigma/equipe/${ids.pros[0].id}`, { cookie: A.cookie, form: { name: 'Dono sigma', title: '', commission: '40' } });
    await E.req('/app/s/sigma/equipe', { cookie: A.cookie, form: { name: 'Bruno Lâmina', title: '', commission: '50' } });
    ids = await firstIds(E.db, shop.id); bruno = ids.pros.find((p: any) => p.name === 'Bruno Lâmina').id;
    await E.req('/app/s/sigma/equipe/acesso', { cookie: A.cookie, form: { professionalId: bruno, role: 'barber', name: 'Bruno Lâmina', email: 'bruno@sigma.com', password: 'provisoria-123' } });
    barberCookie = await E.loginAs('bruno@sigma.com', 'provisoria-123');
    const owner: any = await E.db.system((q: any) => q.one(`select id from users where email = 'sigma@teste.com.br'`));
    ctx = await contextFor(E.db, owner, 'sigma');
    bookingId = (await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T(WED, '09:15'), name: 'Paulo Cliente', phone: '11988776655' }, { kind: 'staff', ctx })).booking.id;
  });
  after(() => E.db.close());

  test('atendido leva direto para a comanda do atendimento', async () => {
    const r = await E.req(`/app/s/sigma/reserva/${bookingId}/status`, { cookie: A.cookie, form: { to: 'completed' } });
    assert.equal(r.status, 303); assert.equal(r.location, `/app/s/sigma/caixa/comanda?booking=${bookingId}`);
    const page = await E.req(r.location, { cookie: A.cookie });
    assert.equal(page.status, 200); assert.match(page.text, /Paulo Cliente/); assert.match(page.text, /R\$\s?45,00/);
    const caixa = await E.req('/app/s/sigma/caixa', { cookie: A.cookie });
    assert.match(caixa.text, /Atendimentos sem pagamento registrado/);
  });

  test('comanda: serviço extra, produto, desconto rateado, pagamento dividido e comissão congelada', async () => {
    const bad = await E.req('/app/s/sigma/caixa/comanda', { cookie: A.cookie, form: { bookingId, svc: ids.services[1].id, productName: ['Pomada', ''], productPrice: ['30,00', ''], discount: '10', method1: 'pix', amount1: '50', method2: 'dinheiro', amount2: '20' }, headers: { referer: 'http://localhost/app/s/sigma/caixa/comanda' } });
    assert.match(flashOf(bad), /precisa ser igual ao total/);
    const r = await E.req('/app/s/sigma/caixa/comanda', { cookie: A.cookie, form: { bookingId, svc: ids.services[1].id, productName: ['Pomada', ''], productPrice: ['30,00', ''], discount: '10', method1: 'pix', amount1: '', method2: 'dinheiro', amount2: '20' } });
    assert.equal(r.status, 303); assert.match(flashOf(r), /sale/);
    const sale = await E.db.tenant(shop.id, (q: any) => q.one('select * from sales where booking_id = $1', [bookingId]));
    assert.equal(sale.subtotal_cents, 11000); assert.equal(sale.discount_cents, 1000); assert.equal(sale.total_cents, 10000);
    const items = await E.db.tenant(shop.id, (q: any) => q.all('select kind, total_cents, commission_cents from sale_items where sale_id = $1 order by unit_cents desc', [sale.id]));
    assert.deepEqual(items.map((i: any) => i.total_cents), [4091, 3182, 2727]);
    assert.equal(items.reduce((s: number, i: any) => s + i.commission_cents, 0), 1636 + 1273); // 40% só sobre serviços
    const pays = await E.db.tenant(shop.id, (q: any) => q.all('select method, amount_cents from sale_payments where sale_id = $1 order by amount_cents desc', [sale.id]));
    assert.deepEqual(pays.map((p: any) => `${p.method}:${p.amount_cents}`), ['pix:8000', 'dinheiro:2000']);
    // mudar a comissão depois não altera venda passada
    await E.req(`/app/s/sigma/equipe/${ids.pros[0].id}`, { cookie: A.cookie, form: { name: 'Dono sigma', title: '', commission: '10' } });
    assert.equal((await E.db.tenant(shop.id, (q: any) => q.one('select sum(commission_cents)::int c from sale_items where sale_id = $1', [sale.id]))).c, 2909);
    // a mesma comanda não fecha duas vezes
    const twice = await E.req('/app/s/sigma/caixa/comanda', { cookie: A.cookie, form: { bookingId, method1: 'pix' }, headers: { referer: 'http://localhost/app/s/sigma/caixa' } });
    assert.match(flashOf(twice), /já foi fechada/);
  });

  test('barbeiro: fecha só a própria comanda, vê só as próprias comissões e não vê o caixa', async () => {
    assert.equal((await E.req(`/app/s/sigma/caixa/comanda?booking=${bookingId}`, { cookie: barberCookie })).status, 404);
    assert.equal((await E.req('/app/s/sigma/caixa', { cookie: barberCookie })).status, 403);
    assert.equal((await E.req('/app/s/sigma/financeiro', { cookie: barberCookie })).status, 403);
    assert.equal((await E.req('/app/s/sigma/clientes', { cookie: barberCookie })).status, 403);
    const other = await E.req('/app/s/sigma/caixa/comanda', { cookie: barberCookie, form: { professionalId: ids.pros[0].id, svc: ids.services[0].id, method1: 'pix' } });
    assert.equal(other.status, 403);
    const own = await E.req('/app/s/sigma/caixa/comanda', { cookie: barberCookie, form: { professionalId: bruno, svc: ids.services[2].id, method1: 'dinheiro', customerName: 'Avulso', customerPhone: '11911112222' } });
    assert.equal(own.status, 303); assert.equal(own.location, '/app/s/sigma');
    const mine = await E.req('/app/s/sigma/comissoes', { cookie: barberCookie });
    assert.equal(mine.status, 200); assert.match(mine.text, /R\$\s?37,50/); // 50% de R$ 75,00
    assert.doesNotMatch(mine.text, /R\$\s?29,09/);
  });

  test('caixa do dia: totais por forma, estorno e fechamento com diferença', async () => {
    const day = await E.req(`/app/s/sigma/caixa?date=${WED}`, { cookie: A.cookie });
    assert.match(day.text, /R\$\s?175,00/); // 100 + 75
    const avulsa = await E.db.tenant(shop.id, (q: any) => q.one(`select id from sales where booking_id is null`));
    const v = await E.req(`/app/s/sigma/caixa/venda/${avulsa.id}/estornar`, { cookie: A.cookie, form: { reason: 'lançada errado' } });
    assert.match(flashOf(v), /sale_void/);
    const close = await E.req('/app/s/sigma/caixa/fechar', { cookie: A.cookie, form: { day: WED, counted: '15,00', note: '' } });
    assert.match(flashOf(close), /cash_closed/);
    const c = await E.db.tenant(shop.id, (q: any) => q.one('select * from cash_closings where day = $1', [WED]));
    assert.equal(c.total_cents, 10000); assert.equal(c.expected_cash_cents, 2000); assert.equal(c.counted_cash_cents, 1500);
    const after = await E.req(`/app/s/sigma/caixa?date=${WED}`, { cookie: A.cookie });
    assert.match(after.text, /Faltou R\$\s?5,00/);
    const again = await E.req('/app/s/sigma/caixa/fechar', { cookie: A.cookie, form: { day: WED, counted: '20' }, headers: { referer: 'http://localhost/app/s/sigma/caixa' } });
    assert.match(flashOf(again), /já foi fechado/);
    const sale = await E.db.tenant(shop.id, (q: any) => q.one(`select id from sales where status = 'paid' limit 1`));
    const late = await E.req(`/app/s/sigma/caixa/venda/${sale.id}/estornar`, { cookie: A.cookie, form: { reason: 'x' }, headers: { referer: 'http://localhost/app/s/sigma/caixa' } });
    assert.match(flashOf(late), /já foi fechado/);
  });

  test('financeiro do mês com dados reais e comissões conforme o plano', async () => {
    const r = await E.req('/app/s/sigma/financeiro?mes=2026-12', { cookie: A.cookie });
    assert.equal(r.status, 200); assert.match(r.text, /R\$\s?100,00/); assert.match(r.text, /Comissões do mês/); assert.match(r.text, /R\$\s?29,09/);
    await E.db.system((q: any) => q.exec(`update saas_subscriptions set plan_id = 'essencial' where shop_id = $1`, [shop.id]));
    const ess = await E.req('/app/s/sigma/financeiro?mes=2026-12', { cookie: A.cookie });
    assert.doesNotMatch(ess.text, /Comissões do mês/); assert.match(ess.text, /faz parte do plano Profissional/);
    await E.db.system((q: any) => q.exec(`update saas_subscriptions set plan_id = 'profissional' where shop_id = $1`, [shop.id]));
  });

  test('clientes: números, busca, sumidos, edição e isolamento', async () => {
    const cust = await E.db.tenant(shop.id, (q: any) => q.one(`select id from customers where phone = '11988776655'`));
    // um cliente antigo que sumiu (última visita há 60 dias)
    await E.db.tenant(shop.id, async (q: any) => {
      const c = await q.one(`insert into customers (shop_id, name, phone) values ($1,'Rui Sumido','11977770000') returning id`, [shop.id]);
      const s = new Date(Date.parse(T(WED, '10:00')) - 60 * 86_400_000);
      await q.exec(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source) values ($1,$2,$3,$4,$5,30,4500,'completed','staff')`, [shop.id, ids.pros[0].id, c.id, s, new Date(s.getTime() + 1800_000)]);
    });
    const list = await E.req('/app/s/sigma/clientes', { cookie: A.cookie });
    assert.match(list.text, /Paulo Cliente/); assert.match(list.text, /R\$\s?100,00/);
    assert.match((await E.req('/app/s/sigma/clientes?q=8877', { cookie: A.cookie })).text, /Paulo Cliente/);
    const away = await E.req('/app/s/sigma/clientes?filtro=sumido', { cookie: A.cookie });
    assert.match(away.text, /Rui Sumido/); assert.doesNotMatch(away.text, /Paulo Cliente/); assert.match(away.text, /Chamar de volta/);
    const det = await E.req(`/app/s/sigma/clientes/${cust.id}`, { cookie: A.cookie });
    assert.equal(det.status, 200); assert.match(det.text, /Visitas atendidas/);
    const save = await E.req(`/app/s/sigma/clientes/${cust.id}`, { cookie: A.cookie, form: { name: 'Paulo Cliente', phone: '(11) 98877-6655', notes: 'Máquina 2 nas laterais' } });
    assert.match(flashOf(save), /customer_saved/);
    // outra barbearia não alcança o cliente
    const B = await E.signupShop('tau');
    assert.equal((await E.req(`/app/s/sigma/clientes/${cust.id}`, { cookie: B.cookie })).status, 404);
    assert.equal((await E.req(`/app/s/tau/clientes/${cust.id}`, { cookie: B.cookie })).status, 404);
  });

  test('LGPD: exportar e apagar dados pessoais (só o proprietário)', async () => {
    const cust = await E.db.tenant(shop.id, (q: any) => q.one(`select id from customers where phone = '11988776655'`));
    const exp = await E.req(`/app/s/sigma/clientes/${cust.id}/exportar`, { cookie: A.cookie });
    assert.equal(exp.status, 200); assert.match(exp.res.headers.get('content-disposition') ?? '', /attachment/);
    const data = JSON.parse(exp.text); assert.equal(data.cliente.nome, 'Paulo Cliente'); assert.equal(data.atendimentos.length, 1);
    await E.req('/app/s/sigma/equipe/acesso', { cookie: A.cookie, form: { professionalId: ids.pros[0].id, role: 'manager', name: 'Gerente', email: 'g@sigma.com', password: 'provisoria-123' } });
    const g = await E.loginAs('g@sigma.com', 'provisoria-123');
    assert.equal((await E.req(`/app/s/sigma/clientes/${cust.id}/exportar`, { cookie: g })).status, 403);
    // com horário futuro não apaga
    const fut = await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T(THU, '15:00'), name: 'Paulo Cliente', phone: '11988776655' }, { kind: 'staff', ctx });
    const refused = await E.req(`/app/s/sigma/clientes/${cust.id}/apagar`, { cookie: A.cookie, form: {}, headers: { referer: 'http://localhost/app/s/sigma/clientes' } });
    assert.match(flashOf(refused), /horário marcado/);
    await E.req(`/app/s/sigma/reserva/${fut.booking.id}/status`, { cookie: A.cookie, form: { to: 'cancelled' } });
    const ok = await E.req(`/app/s/sigma/clientes/${cust.id}/apagar`, { cookie: A.cookie, form: {} });
    assert.match(flashOf(ok), /customer_deleted/);
    const c = await E.db.tenant(shop.id, (q: any) => q.one('select name, phone, notes from customers where id = $1', [cust.id]));
    assert.equal(c.name, 'Cliente removido'); assert.notEqual(c.phone, '11988776655'); assert.equal(c.notes, '');
    assert.equal((await E.db.tenant(shop.id, (q: any) => q.one(`select count(*)::int n from sales where customer_id = $1 and status = 'paid'`, [cust.id]))).n, 1, 'histórico financeiro continua');
  });
});

describe('site e operação', () => {
  let E: any;
  before(async () => { E = await env(); });
  after(() => E.db.close());

  test('contato: mensagem válida chega ao admin; robô e dados inválidos não', async () => {
    assert.equal((await E.req('/contato')).status, 200);
    assert.equal((await E.req('/contato', { form: { name: 'Ana Dona', email: 'nao-e-email', message: 'Quero saber dos planos' } })).status, 422);
    assert.equal((await E.req('/contato', { form: { name: 'Bot', email: 'b@b.com', message: 'spam spam', site: 'http://x' } })).status, 303);
    const ok = await E.req('/contato', { form: { name: 'Ana Dona', email: 'ana@barbearia.com', phone: '(11) 91234-5678', shop: 'Barbearia da Ana', message: 'Quero saber dos planos' } });
    assert.equal(ok.location, '/contato?enviado=1');
    const msgs = await E.db.system((q: any) => q.all('select name, phone from contact_messages'));
    assert.deepEqual(msgs.map((m: any) => m.name), ['Ana Dona']); assert.equal(msgs[0].phone, '11912345678');
    const A = await E.signupShop('phi');
    assert.equal((await E.req('/admin/suporte', { cookie: A.cookie })).status, 404);
    await E.db.system((q: any) => q.exec(`update users set is_platform_admin = true where email = 'phi@teste.com.br'`));
    assert.match((await E.req('/admin/suporte', { cookie: A.cookie })).text, /Quero saber dos planos/);
  });

  test('termos, privacidade e verificação de saúde respondem', async () => {
    assert.match((await E.req('/termos')).text, /Termos de uso/);
    assert.match((await E.req('/privacidade')).text, /operadores/);
    const s = await E.req('/saude'); assert.equal(s.status, 200); assert.deepEqual(JSON.parse(s.text), { ok: true });
  });
});

test('cópia de segurança restaura o banco inteiro', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDb } = await import('../src/db/db.ts');
  const dir = mkdtempSync(join(tmpdir(), 'cadeira-bk-'));
  try {
    const E = await env(join(dir, 'a'));
    await E.signupShop('chi');
    const blob = new Blob([new Uint8Array(await E.db.backup())]);
    await E.db.close();
    const db2 = await openDb(join(dir, 'b'), blob);
    assert.equal((await db2.system((q) => q.one(`select name from shops where slug = 'chi'`)))!.name, 'Barbearia chi');
    await db2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

describe('primeiros passos', () => {
  let E: any;
  before(async () => { E = await env(); });
  after(() => E.db.close());

  test('cadastro abre o passo a passo; cada etapa salva e avança; destino externo é ignorado', async () => {
    const r = await E.req('/criar-conta', { form: { name: 'Nova Dona', email: 'nova@ups.com', password: 'senha-forte-123', shopName: 'Upsilon Barber', slug: 'upsilon' } });
    assert.equal(r.location, '/app/s/upsilon/comecar');
    const cookie = r.cookies.find((c: string) => c.startsWith('sid='))!.split(';')[0];
    for (let i = 1; i <= 5; i++) assert.equal((await E.req(`/app/s/upsilon/comecar?passo=${i}`, { cookie })).status, 200, `passo ${i}`);
    const h = await E.req('/app/s/upsilon/horarios', { cookie, form: { _next: '/app/s/upsilon/comecar?passo=2', o2: '1', a2: '09:00', b2: '19:00' } });
    assert.equal(h.location, '/app/s/upsilon/comecar?passo=2');
    const evil = await E.req('/app/s/upsilon/horarios', { cookie, form: { _next: '//site-ruim.com/x', o2: '1', a2: '09:00', b2: '19:00' } });
    assert.equal(evil.location, '/app/s/upsilon/horarios');
    const other = await E.req('/app/s/upsilon/horarios', { cookie, form: { _next: '/app/s/outra/comecar', o2: '1', a2: '09:00', b2: '19:00' } });
    assert.equal(other.location, '/app/s/upsilon/horarios');
    const pub = await E.req('/app/s/upsilon/pagina/publicar', { cookie, form: { _next: '/app/s/upsilon/comecar?passo=5' } });
    assert.equal(pub.location, '/app/s/upsilon/comecar?passo=5');
    assert.ok((await E.db.system((q: any) => q.one(`select onboarded_at from shops where slug = 'upsilon'`))).onboarded_at);
    assert.match((await E.req('/app/s/upsilon/comecar?passo=5', { cookie })).text, /Sua página já está no ar/);
  });
});
