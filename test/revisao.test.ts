// Testes das falhas encontradas na revisão da fase 1.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, firstIds, shopRow, THU } from './helpers.ts';
import { availability, availabilityRange, createBooking } from '../src/domain/booking.ts';
import { contextFor, publicShop } from '../src/domain/accounts.ts';
import { localToUtc } from '../src/lib/core.ts';

const T = (date: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return localToUtc(date, h * 60 + m, 'America/Sao_Paulo').toISOString(); };

describe('revisão da fase 1', () => {
  let E: Awaited<ReturnType<typeof env>>, A: any, shop: any, ids: any;
  before(async () => {
    E = await env(); A = await E.signupShop('zeta');
    await E.req('/app/s/zeta/pagina/publicar', { cookie: A.cookie, form: {} });
    shop = await publicShop(E.db, 'zeta'); ids = await firstIds(E.db, shop.id);
  });
  after(() => E.db.close());

  test('P1: a confirmação pública não revela o nome cadastrado de outro telefone', async () => {
    const owner = await E.db.system((q) => q.one(`select id from users where email = 'zeta@teste.com.br'`));
    const ctx = await contextFor(E.db, owner as any, 'zeta');
    await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T(THU, '09:00'), name: 'Carlos Verdadeiro', phone: '11977776666' }, { kind: 'staff', ctx });
    const r = await E.req('/b/zeta/reservar', { form: { s: [ids.services[0].id], p: 'any', t: T(THU, '10:00'), name: 'Fulano Curioso', phone: '11977776666' } });
    assert.equal(r.status, 303);
    const page = await E.req(r.location);
    assert.match(page.text, /Fulano/);
    assert.doesNotMatch(page.text, /Carlos/);
    // o painel mostra os dois nomes, para a equipe resolver
    const id = (await E.db.tenant(shop.id, (q) => q.one(`select id from bookings where contact_name = 'Fulano Curioso'`)))!.id;
    const det = await E.req(`/app/s/zeta/reserva/${id}`, { cookie: A.cookie });
    assert.match(det.text, /informou o nome <b>Fulano Curioso<\/b>/); assert.match(det.text, /Carlos Verdadeiro/);
  });

  test('P1: profissional com escala própria não recebe agendamento na folga', async () => {
    await E.req('/app/s/zeta/equipe', { cookie: A.cookie, form: { name: 'Só Quarta', title: '', commission: '30' } });
    const pid = (await firstIds(E.db, shop.id)).pros.find((p: any) => p.name === 'Só Quarta')!.id;
    const r = await E.req(`/app/s/zeta/equipe/${pid}/escala`, { cookie: A.cookie, form: { d3: '09:00-18:00' } });
    assert.equal(r.status, 303);
    const thu = await E.db.tenant(shop.id, (q) => availability(q, shop, { date: THU, serviceIds: [ids.services[0].id], professionalId: pid }));
    assert.equal(thu.slots.length, 0, 'quinta é folga');
    const wed = await E.db.tenant(shop.id, (q) => availability(q, shop, { date: '2026-12-09', serviceIds: [ids.services[0].id], professionalId: pid }));
    assert.ok(wed.slots.length > 0, 'quarta trabalha');
    await assert.rejects(createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: pid, startsAt: T(THU, '11:00'), name: 'Teste', phone: '11955550000' }, { kind: 'customer' }), (e: any) => e.status === 409);
    // na agenda do dia, a coluna dele aparece toda como folga e o "quem estiver livre" não o escala
    const any = await E.db.tenant(shop.id, (q) => availability(q, shop, { date: THU, serviceIds: [ids.services[0].id], professionalId: 'any' }));
    assert.ok(any.slots.every((s) => !s.professionalIds.includes(pid)));
  });

  test('disponibilidade em lote é idêntica à calculada dia a dia', async () => {
    const r = await E.db.tenant(shop.id, (q) => availabilityRange(q, shop, { from: '2026-12-02', days: 9, serviceIds: [ids.services[2].id], professionalId: 'any' }));
    for (const d of r.days) {
      const one = await E.db.tenant(shop.id, (q) => availability(q, shop, { date: d.date, serviceIds: [ids.services[2].id], professionalId: 'any' }));
      assert.deepEqual(d.slots, one.slots, d.date);
    }
  });

  test('acesso de equipe não vincula conta que já existe', async () => {
    await E.signupShop('eta');
    const r = await E.req('/app/s/zeta/equipe/acesso', { cookie: A.cookie, form: { professionalId: ids.pros[0].id, role: 'barber', name: 'Dono Eta', email: 'eta@teste.com.br', password: 'qualquer-coisa' }, headers: { referer: 'http://localhost/app/s/zeta/equipe' } });
    assert.match(Buffer.from(r.cookies.find((c) => c.startsWith('f='))!.split(';')[0].slice(2), 'base64url').toString(), /já tem uma conta/);
    const eta = await E.db.system((q) => q.all(`select s.slug from memberships m join users u on u.id = m.user_id join shops s on s.id = m.shop_id where u.email = 'eta@teste.com.br'`));
    assert.deepEqual(eta.map((x) => x.slug), ['eta']);
  });

  test('bloqueio com profissional de outra barbearia responde 404, não erro 500', async () => {
    const eta = await shopRow(E.db, 'eta');
    const foreign = (await firstIds(E.db, eta.id)).pros[0].id;
    const r = await E.req('/app/s/zeta/horarios/bloqueios', { cookie: A.cookie, form: { professionalId: foreign, date: THU, start: '', end: '', reason: '' } });
    assert.equal(r.status, 404);
  });

  test('cadastros simultâneos com o mesmo e-mail: um entra, o outro recebe 409', async () => {
    const f = (slug: string) => E.req('/criar-conta', { form: { name: 'Mesmo Dono', email: 'mesmo@t.com', password: 'senha-forte-123', shopName: 'Casa ' + slug, slug } });
    const res = await Promise.all([f('theta-um'), f('theta-dois')]);
    assert.deepEqual(res.map((r) => r.status).sort(), [303, 409]);
  });

  test('editor de semana: liga/desliga dias, horário e pausa opcional', async () => {
    const r = await E.req('/app/s/zeta/horarios', { cookie: A.cookie, form: { o2: '1', a2: '10:00', b2: '18:00', pa2: '12:00', pb2: '13:00', o6: '1', a6: '08:00', b6: '14:00', pa6: '', pb6: '' } });
    assert.equal(r.status, 303);
    const rows = await E.db.tenant(shop.id, (q) => q.all('select weekday, start_min, end_min from working_hours where professional_id is null order by weekday, start_min'));
    assert.deepEqual(rows.map((x) => `${x.weekday}:${x.start_min}-${x.end_min}`), ['2:600-720', '2:780-1080', '6:480-840']);
    // pausa fora do expediente é recusada com mensagem clara e nada muda
    const bad = await E.req('/app/s/zeta/horarios', { cookie: A.cookie, form: { o2: '1', a2: '10:00', b2: '18:00', pa2: '19:00', pb2: '20:00' }, headers: { referer: 'http://localhost/app/s/zeta/horarios' } });
    assert.match(Buffer.from(bad.cookies.find((c) => c.startsWith('f='))!.split(';')[0].slice(2), 'base64url').toString(), /Horário inválido em terça/);
    const after = await E.db.tenant(shop.id, (q) => q.one('select count(*)::int n from working_hours where professional_id is null'));
    assert.equal(after!.n, 3);
  });

  test('corpo de requisição grande demais é recusado', async () => {
    const r = await E.req('/entrar', { form: { email: 'a@b.com', password: 'x'.repeat(70_000) } });
    assert.equal(r.status, 413);
  });
});
