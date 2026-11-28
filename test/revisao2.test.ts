// Revisão como cliente: mudar horário pela equipe, serviços salvos juntos no começo, uso sem cobrança ligada e sem CNPJ.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { publicShop } from '../src/domain/accounts.ts';
import { createBooking } from '../src/domain/booking.ts';
import { clock, resetRateLimits, localToUtc } from '../src/lib/core.ts';
import { http, NOW, THU, firstIds } from './helpers.ts';

const T = (d: string, hm: string) => localToUtc(d, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), 'America/Sao_Paulo').toISOString();

describe('revisão como cliente', () => {
  let db: Db, H: ReturnType<typeof http>, A: any, shop: any, ids: any, second = '';
  before(async () => {
    clock.now = () => NOW; resetRateLimits();
    db = await openDb(); H = http(createApp(db, { billing: null }));
    A = await H.signupShop('revisa');
    await H.req('/app/s/revisa/equipe', { cookie: A.cookie, form: { name: 'Bruno Navalha', title: '', commission: '40' } });
    shop = await publicShop(db, 'revisa'); ids = await firstIds(db, shop.id); second = ids.pros[1].id;
  });
  after(() => db.close());

  test('equipe muda o horário do cliente: mesmo preço, sem conflito, pode trocar de barbeiro e fica no histórico', async () => {
    const mk = (t: string, pro: string, name: string) => createBooking(db, shop, { serviceIds: [ids.services[0].id], professionalId: pro, startsAt: T(THU, t), name, phone: '1197777' + String(name.length).padStart(4, '0') }, { kind: 'customer' });
    const a = await mk('10:00', ids.pros[0].id, 'Caio');
    await mk('11:00', ids.pros[0].id, 'Davi Mota');
    const page = await H.req(`/app/s/revisa/reserva/${a.booking.id}/mudar`, { cookie: A.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Mudar horário/);
    assert.ok(page.text.includes(`value="${T(THU, '10:15')}"`), 'abre no dia do horário e o próprio horário não bloqueia');
    assert.ok(!page.text.includes(`value="${T(THU, '11:00')}"`));
    const busy = await H.req(`/app/s/revisa/reserva/${a.booking.id}/mudar`, { cookie: A.cookie, form: { t: T(THU, '11:00'), p: ids.pros[0].id } });
    assert.equal(busy.status, 409);
    const ok = await H.req(`/app/s/revisa/reserva/${a.booking.id}/mudar`, { cookie: A.cookie, form: { t: T(THU, '11:00'), p: second } });
    assert.equal(ok.status, 303);
    const row = await db.tenant(shop.id, (q) => q.one('select starts_at, professional_id, price_cents from bookings where id = $1', [a.booking.id]));
    assert.equal(new Date(row!.starts_at).toISOString(), T(THU, '11:00'));
    assert.equal(row!.professional_id, second); assert.equal(row!.price_cents, a.booking.price_cents);
    const det = await H.req(`/app/s/revisa/reserva/${a.booking.id}`, { cookie: A.cookie });
    assert.match(det.text, /Horário mudado: 03\/12 10:00 → 03\/12 11:00 com Bruno Navalha/);
    assert.match(det.text, /Mudar horário/);
  });

  test('novo horário pelo balcão: nome e WhatsApp do cliente não vão para o endereço', async () => {
    const page = await H.req('/app/s/revisa/novo', { cookie: A.cookie });
    assert.ok(page.text.includes('<form method="post" class="nb" action="/app/s/revisa/novo/horarios#horarios">'));
    const r = await H.req('/app/s/revisa/novo/horarios', { cookie: A.cookie, form: { name: 'Lia Privada', phone: '11977776666', s: ids.services[0].id, p: 'any', date: THU } });
    assert.equal(r.status, 200); assert.match(r.text, /Marcar horário/); assert.match(r.text, /Lia Privada/);
  });

  test('primeiros passos: os serviços são salvos juntos ao continuar (antes, mudar o preço sem clicar em cada "Salvar" perdia a mudança)', async () => {
    const svcs = await db.tenant(shop.id, (q) => q.all('select id, name, duration_min, price_cents from services where active order by sort'));
    const r = await H.req('/app/s/revisa/comecar/servicos', { cookie: A.cookie, form: {
      id: svcs.map((s) => s.id), name: svcs.map((s, i) => (i === 0 ? 'Corte social' : s.name)),
      duration: svcs.map((s) => String(s.duration_min)), price: svcs.map((s, i) => (i === 0 ? '50,00' : (s.price_cents / 100).toFixed(2).replace('.', ','))) } });
    assert.equal(r.status, 303); assert.match(r.location, /passo=3/);
    const after = await db.tenant(shop.id, (q) => q.one('select name, price_cents from services where id = $1', [svcs[0].id]));
    assert.equal(after!.name, 'Corte social'); assert.equal(after!.price_cents, 5000);
    // um preço inválido não salva nada pela metade
    const bad = await H.req('/app/s/revisa/comecar/servicos', { cookie: A.cookie, form: { id: [svcs[0].id, svcs[1].id], name: ['Corte X', 'B'], duration: ['30', '30'], price: ['10', '10'] }, headers: { referer: 'http://localhost/app/s/revisa/comecar?passo=2' } });
    assert.equal(bad.status, 303);
    assert.equal((await db.tenant(shop.id, (q) => q.one('select name from services where id = $1', [svcs[0].id])))!.name, 'Corte social');
    const step = await H.req('/app/s/revisa/comecar?passo=2', { cookie: A.cookie });
    assert.match(step.text, /Salvar e continuar/);
  });

  test('sem cobrança ligada: fim do teste leva a "fale com a gente", não a um botão de pagar que não funciona', async () => {
    await db.system((q) => q.exec(`update saas_subscriptions set trial_ends_at = $2 where shop_id = $1`, [shop.id, new Date(NOW.getTime() - 60_000)]));
    const r = await H.req('/app/s/revisa', { cookie: A.cookie });
    assert.equal(r.status, 402);
    assert.match(r.text, /Fale com a gente/); assert.match(r.text, /href="\/contato"/);
    assert.doesNotMatch(r.text, /Ver planos e pagar/);
    const sub = await H.req('/app/s/revisa/assinatura', { cookie: A.cookie });
    assert.match(sub.text, /fase de lançamento/);
  });

  test('termos e privacidade aceitam pessoa física (CPF) antes de abrir empresa', async () => {
    process.env.COMPANY_NAME = 'Fulano de Tal'; process.env.COMPANY_DOC = '123.456.789-09';
    try {
      const t = await H.req('/termos');
      assert.match(t.text, /oferecido por Fulano de Tal, CPF 123\.456\.789-09/);
      assert.doesNotMatch(t.text, /CNPJ \[/);
      delete process.env.COMPANY_DOC;
      assert.match((await H.req('/privacidade')).text, /Fulano de Tal, responsável pelo/);
    } finally { delete process.env.COMPANY_NAME; delete process.env.COMPANY_DOC; }
    const s = await H.req('/criar-conta');
    assert.match(s.text, /concorda com os <a href="\/termos"/);
    assert.doesNotMatch(s.text, /name="slug" required/, 'o endereço pode ficar em branco, como diz a dica');
  });
});
