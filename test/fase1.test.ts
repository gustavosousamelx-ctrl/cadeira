import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, firstIds, shopRow, THU, http } from './helpers.ts';
import { openDb } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { availability, createBooking, quote } from '../src/domain/booking.ts';
import { contextFor, publicShop } from '../src/domain/accounts.ts';
import { PRESETS, contrast } from '../src/domain/themes.ts';
import { localToUtc, toLocal } from '../src/lib/core.ts';
import { parseMoney } from '../src/domain/catalog.ts';

const T = (date: string, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return localToUtc(date, h * 60 + m, 'America/Sao_Paulo').toISOString(); };

describe('multiempresa', () => {
  let E: Awaited<ReturnType<typeof env>>, A: any, B: any;
  before(async () => { E = await env(); A = await E.signupShop('alfa'); B = await E.signupShop('beta'); });
  after(() => E.db.close());

  test('cadastro de dois estabelecimentos provisiona ambientes independentes', async () => {
    const a = await shopRow(E.db, 'alfa'), b = await shopRow(E.db, 'beta');
    assert.notEqual(a.id, b.id);
    const ia = await firstIds(E.db, a.id), ib = await firstIds(E.db, b.id);
    assert.equal(ia.services.length, 3); assert.equal(ib.services.length, 3);
    assert.equal(ia.pros.length, 1);
    assert.ok(!ia.services.some((s: any) => ib.services.some((t: any) => t.id === s.id)));
    const sub = await E.db.system((q) => q.one('select status, plan_id, trial_ends_at from saas_subscriptions where shop_id = $1', [a.id]));
    assert.equal(sub!.status, 'trialing');
    assert.equal(new Date(sub!.trial_ends_at).toISOString(), '2026-12-16T12:00:00.000Z');
    const home = await E.req('/app/s/alfa', { cookie: A.cookie });
    assert.equal(home.status, 200);
    assert.match(home.text, /Para começar a receber agendamentos/);
  });

  test('slug repetido e reservado são recusados', async () => {
    const r1 = await E.req('/criar-conta', { form: { name: 'Outro', email: 'outro@t.com', password: 'senha-forte-123', shopName: 'Xis', slug: 'alfa' } });
    assert.equal(r1.status, 409);
    const r2 = await E.req('/criar-conta', { form: { name: 'Outro', email: 'outro2@t.com', password: 'senha-forte-123', shopName: 'Xis', slug: 'admin' } });
    assert.equal(r2.status, 422);
  });

  test('acesso cruzado entre estabelecimentos é bloqueado (HTTP, domínio e banco)', async () => {
    const a = await shopRow(E.db, 'alfa'), b = await shopRow(E.db, 'beta');
    const ib = await firstIds(E.db, b.id);
    // painel de outra barbearia
    assert.equal((await E.req('/app/s/beta', { cookie: A.cookie })).status, 404);
    assert.equal((await E.req('/app/s/beta/servicos', { cookie: A.cookie })).status, 404);
    // usar o próprio painel com o id de um serviço da outra barbearia
    const r = await E.req(`/app/s/alfa/servicos/${ib.services[0].id}`, { cookie: A.cookie, form: { name: 'Hackeado', description: '', duration: '30', price: '1' } });
    assert.equal(r.status, 404);
    assert.equal((await firstIds(E.db, b.id)).services[0].name, ib.services[0].name);
    // reserva da beta não é alcançável pelo contexto da alfa
    const ctxB = await contextFor(E.db, { id: (await E.db.system((q) => q.one(`select id from users where email = 'beta@teste.com.br'`)))!.id } as any, 'beta');
    const bk = await createBooking(E.db, ctxB.shop, { serviceIds: [ib.services[0].id], professionalId: ib.pros[0].id, startsAt: T(THU, '10:00'), name: 'Cliente Beta', phone: '11999990000' }, { kind: 'staff', ctx: ctxB });
    assert.equal((await E.req(`/app/s/alfa/reserva/${bk.booking.id}`, { cookie: A.cookie })).status, 404);
    assert.equal((await E.req(`/app/s/alfa/reserva/${bk.booking.id}/status`, { cookie: A.cookie, form: { to: 'cancelled' } })).status, 404);
    // RLS: o contexto de banco da alfa não vê nem grava linhas da beta
    assert.equal((await E.db.tenant(a.id, (q) => q.all('select id from bookings'))).length, 0);
    assert.equal((await E.db.tenant(a.id, (q) => q.all('select id from customers'))).length, 0);
    await assert.rejects(E.db.tenant(a.id, (q) => q.exec(`insert into services (shop_id, name, duration_min, price_cents) values ($1,'x',30,100)`, [b.id])), /row-level security/);
    assert.equal(await E.db.tenant(a.id, (q) => q.exec(`update bookings set status = 'cancelled' where id = $1`, [bk.booking.id])), 0);
    // chave estrangeira composta impede apontar reserva da alfa para profissional da beta
    const ia = await firstIds(E.db, a.id);
    await assert.rejects(E.db.tenant(a.id, async (q) => {
      const c = await q.one(`insert into customers (shop_id, name, phone) values ($1,'C','11988887777') returning id`, [a.id]);
      await q.exec(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source) values ($1,$2,$3,now(),now()+interval '30 min',30,0,'confirmed','staff')`, [a.id, ib.pros[0].id, c!.id]);
    }));
    assert.ok(ia.pros.length);
  });

  test('personalização da página pública é independente', async () => {
    const save = await E.req('/app/s/alfa/pagina', { cookie: A.cookie, form: { name: 'Barbearia alfa', description: 'Desc', address: 'Rua A', phone: '', instagram: '@alfa.barber', theme: 'salao:bordo', min_notice_min: '60', max_days_ahead: '30', cancel_until_min: '120', slot_step_min: '15' } });
    assert.equal(save.status, 303);
    for (const s of ['alfa', 'beta']) assert.equal((await E.req(`/app/s/${s}/pagina/publicar`, { cookie: s === 'alfa' ? A.cookie : B.cookie, form: {} })).status, 303);
    const pa = await E.req('/b/alfa'), pb = await E.req('/b/beta');
    assert.match(pa.text, /--accent:#7A2232/);
    assert.doesNotMatch(pb.text, /--accent:#7A2232/);
    assert.match(pb.text, /--accent:#C41E30/);
    // tema fora da lista curada é recusado
    const bad = await E.req('/app/s/alfa/pagina', { cookie: A.cookie, form: { name: 'Barbearia alfa', theme: 'salao:#ff00ff', min_notice_min: '60', max_days_ahead: '30', cancel_until_min: '120', slot_step_min: '15', phone: '' }, headers: { referer: 'http://localhost/app/s/alfa/pagina' } });
    assert.equal(bad.status, 303);
    assert.match(Buffer.from(bad.cookies.find((c) => c.startsWith('f='))!.split(';')[0].slice(2), 'base64url').toString(), /Tema inválido/);
  });

  test('POST de outra origem é recusado (CSRF)', async () => {
    const r = await E.req('/app/s/alfa/pagina/despublicar', { cookie: A.cookie, form: {}, headers: { origin: 'https://site-malicioso.com' } });
    assert.equal(r.status, 403);
  });
});

describe('agenda e reservas', () => {
  let E: Awaited<ReturnType<typeof env>>, A: any, shop: any, ids: any;
  before(async () => {
    E = await env(); A = await E.signupShop('gama');
    await E.req('/app/s/gama/pagina/publicar', { cookie: A.cookie, form: {} });
    shop = await publicShop(E.db, 'gama'); ids = await firstIds(E.db, shop.id);
  });
  after(() => E.db.close());

  test('preço e duração somam e vêm do servidor', async () => {
    const q = await E.db.tenant(shop.id, (q) => quote(q, [ids.services[0].id, ids.services[1].id]));
    assert.equal(q.durationMin, 60); assert.equal(q.priceCents, 8000);
    const r = await createBooking(E.db, shop, { serviceIds: [ids.services[0].id, ids.services[1].id], professionalId: ids.pros[0].id, startsAt: T(THU, '14:00'), name: 'Ana Cliente', phone: '(11) 91234-5678', price_cents: 1 } as any, { kind: 'customer' });
    assert.equal(r.booking.price_cents, 8000); assert.equal(r.booking.duration_min, 60);
    assert.equal(new Date(r.booking.ends_at).toISOString(), T(THU, '15:00'));
    assert.equal(parseMoney('1.200,50'), 120050); assert.equal(parseMoney('45'), 4500); assert.equal(parseMoney('45.9'), 4590);
  });

  test('disponibilidade respeita expediente, duração, antecedência, bloqueio e fuso', async () => {
    const av = (date: string, s = [ids.services[2].id]) => E.db.tenant(shop.id, (q) => availability(q, shop, { date, serviceIds: s, professionalId: 'any' }));
    const thu = await av(THU);
    assert.equal(thu.slots[0].time, '09:00');
    assert.equal(thu.slots[0].startsAt, '2026-12-03T12:00:00.000Z'); // 09:00 em São Paulo = 12:00 UTC
    assert.equal(thu.slots.at(-1)!.time, '18:00'); // serviço de 60 min precisa terminar até 19:00
    assert.ok(!thu.slots.some((s) => s.time === '14:00' || s.time === '13:15')); // ocupado pela reserva anterior 14:00-15:00
    const wedToday = await av('2026-12-02');
    assert.equal(wedToday.slots[0].time, '10:00'); // agora 09:00 + 1h de antecedência mínima
    assert.equal((await av('2026-12-06')).slots.length, 0); // domingo fechado
    // bloqueio da casa inteira
    await E.req('/app/s/gama/horarios/bloqueios', { cookie: A.cookie, form: { professionalId: '', date: THU, start: '16:00', end: '17:00', reason: 'Reunião' } });
    const after = await av(THU);
    assert.ok(!after.slots.some((s) => s.time === '16:00' || s.time === '15:30'));
    assert.ok(after.slots.some((s) => s.time === '17:00'));
  });

  test('agendamento simultâneo do mesmo horário: só um vence', async () => {
    const mk = (n: number) => createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T(THU, '11:00'), name: 'Cliente ' + n, phone: '1190000000' + n }, { kind: 'customer' });
    const res = await Promise.allSettled([mk(1), mk(2), mk(3)]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of res.filter((r) => r.status === 'rejected')) assert.equal((r as any).reason.status, 409);
    const n = await E.db.tenant(shop.id, (q) => q.one(`select count(*)::int n from bookings where starts_at = $1 and status = 'confirmed'`, [T(THU, '11:00')]));
    assert.equal(n!.n, 1);
    // o banco também barra sobreposição parcial gravada por fora das regras do app
    await assert.rejects(E.db.tenant(shop.id, async (q) => {
      const c = await q.one(`select id from customers limit 1`);
      await q.exec(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source) values ($1,$2,$3,$4,$5,30,0,'confirmed','staff')`, [shop.id, ids.pros[0].id, c!.id, T(THU, '11:15'), T(THU, '11:45')]);
    }), /bookings_no_overlap/);
  });

  test('fluxo público: reservar, consultar com token, cancelar e liberar o horário', async () => {
    const r = await E.req('/b/gama/reservar', { form: { s: [ids.services[0].id], p: 'any', t: T(THU, '09:30'), name: 'Bruno Cliente', phone: '(11) 97777-6666', website: '' } });
    assert.equal(r.status, 303);
    const m = /\/b\/gama\/reserva\/([\w-]+)\?novo=1/.exec(r.location); assert.ok(m);
    const page = await E.req(r.location);
    assert.equal(page.status, 200); assert.match(page.text, /Horário reservado/); assert.equal(page.res.headers.get('referrer-policy'), 'no-referrer');
    // mesmo horário de novo: indisponível, com alternativas
    const again = await E.req('/b/gama/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T(THU, '09:30'), name: 'Outro', phone: '11966665555' } });
    assert.equal(again.status, 409); assert.match(again.text, /acabou de ser ocupado/);
    // token errado não revela nada
    assert.equal((await E.req('/b/gama/reserva/token-inventado')).status, 404);
    const c = await E.req(`/b/gama/reserva/${m![1]}/cancelar`, { form: {} });
    assert.equal(c.status, 303);
    const st = await E.db.tenant(shop.id, (q) => q.one(`select status from bookings where starts_at = $1 and source = 'online' order by created_at desc limit 1`, [T(THU, '09:30')]));
    assert.equal(st!.status, 'cancelled');
    const av = await E.db.tenant(shop.id, (q) => availability(q, shop, { date: THU, serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id }));
    assert.ok(av.slots.some((s) => s.time === '09:30'));
    // cancelar de novo: recusado
    assert.equal((await E.req(`/b/gama/reserva/${m![1]}/cancelar`, { form: {} })).status, 422);
  });

  test('cliente não cancela online depois do prazo; transições inválidas são recusadas', async () => {
    const r = await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T('2026-12-02', '10:30'), name: 'Carlos', phone: '11955554444' }, { kind: 'customer' });
    const late = await E.req(`/b/gama/reserva/${r.token}/cancelar`, { form: {} });
    assert.equal(late.status, 422); assert.match(late.text, /até 2h antes/);
    const base = `/app/s/gama/reserva/${r.booking.id}/status`;
    const ref = { referer: `http://localhost/app/s/gama/reserva/${r.booking.id}` };
    assert.equal((await E.req(base, { cookie: A.cookie, form: { to: 'cancelled' }, headers: ref })).status, 303);
    const bad = await E.req(base, { cookie: A.cookie, form: { to: 'completed' }, headers: ref });
    assert.match(Buffer.from(bad.cookies.find((c) => c.startsWith('f='))!.split(';')[0].slice(2), 'base64url').toString(), /Não dá para mudar/);
    const ev = await E.db.tenant(shop.id, (q) => q.all('select from_status, to_status, actor from booking_events where booking_id = $1 order by id', [r.booking.id]));
    assert.deepEqual(ev.map((e) => `${e.from_status ?? '-'}>${e.to_status}:${e.actor}`), ['->confirmed:customer', 'confirmed>cancelled:staff']);
  });

  test('robôs e excesso de tentativas são barrados no agendamento público', async () => {
    const bot = await E.req('/b/gama/reservar', { form: { s: [ids.services[0].id], p: 'any', t: T(THU, '17:30'), name: 'Bot', phone: '11911112222', website: 'http://spam' } });
    assert.equal(bot.status, 400);
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await E.req('/b/gama/reservar', { form: { s: [ids.services[0].id], p: 'any', t: 'invalido', name: 'X', phone: '1' } })).status;
    assert.equal(last, 429);
  });
});

describe('papéis e permissões', () => {
  let E: Awaited<ReturnType<typeof env>>, A: any, shop: any, ids: any, barberCookie = '', recCookie = '', p2 = '';
  before(async () => {
    E = await env(); A = await E.signupShop('delta');
    shop = await publicShop(E.db, 'delta');
    await E.req('/app/s/delta/equipe', { cookie: A.cookie, form: { name: 'João Barbeiro', title: '', commission: '40' } });
    ids = await firstIds(E.db, shop.id); p2 = ids.pros.find((p: any) => p.name === 'João Barbeiro').id;
    await E.req('/app/s/delta/equipe/acesso', { cookie: A.cookie, form: { professionalId: p2, role: 'barber', name: 'João Barbeiro', email: 'joao@delta.com', password: 'provisoria-123' } });
    await E.req('/app/s/delta/equipe/acesso', { cookie: A.cookie, form: { professionalId: ids.pros[0].id, role: 'reception', name: 'Rita Recepção', email: 'rita@delta.com', password: 'provisoria-123' } });
    barberCookie = await E.loginAs('joao@delta.com', 'provisoria-123');
    recCookie = await E.loginAs('rita@delta.com', 'provisoria-123');
  });
  after(() => E.db.close());

  test('barbeiro só vê e mexe na própria agenda; não acessa gestão', async () => {
    const own = await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: p2, startsAt: T(THU, '10:00'), name: 'Do João', phone: '11933332222' }, { kind: 'customer' });
    const other = await createBooking(E.db, shop, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: T(THU, '10:00'), name: 'Do Dono', phone: '11933331111' }, { kind: 'customer' });
    const ag = await E.req(`/app/s/delta/agenda?date=${THU}`, { cookie: barberCookie });
    assert.equal(ag.status, 200); assert.match(ag.text, /Do João/); assert.doesNotMatch(ag.text, /Do Dono/);
    assert.equal((await E.req(`/app/s/delta/reserva/${other.booking.id}`, { cookie: barberCookie })).status, 404);
    assert.equal((await E.req(`/app/s/delta/reserva/${other.booking.id}/status`, { cookie: barberCookie, form: { to: 'cancelled' } })).status, 404);
    assert.equal((await E.req(`/app/s/delta/reserva/${own.booking.id}`, { cookie: barberCookie })).status, 200);
    for (const p of ['servicos', 'equipe', 'horarios', 'pagina']) assert.equal((await E.req(`/app/s/delta/${p}`, { cookie: barberCookie })).status, 403, p);
    assert.equal((await E.req('/app/s/delta/servicos', { cookie: barberCookie, form: { name: 'Novo', duration: '30', price: '10' } })).status, 403);
    assert.equal((await E.req('/app/s/delta/pagina/despublicar', { cookie: barberCookie, form: {} })).status, 403);
  });

  test('recepção vê a agenda de todos, mas não gerencia equipe nem acessos', async () => {
    const ag = await E.req(`/app/s/delta/agenda?date=${THU}`, { cookie: recCookie });
    assert.match(ag.text, /Do João/); assert.match(ag.text, /Do Dono/);
    assert.equal((await E.req('/app/s/delta/equipe', { cookie: recCookie })).status, 403);
    assert.equal((await E.req('/app/s/delta/equipe/acesso', { cookie: recCookie, form: { professionalId: p2, role: 'manager', name: 'X Y', email: 'x@y.com', password: '12345678' } })).status, 403);
  });

  test('limite de profissionais do plano é verificado no servidor', async () => {
    await E.db.system((q) => q.exec(`update saas_subscriptions set plan_id = 'essencial' where shop_id = $1`, [shop.id]));
    const r = await E.req('/app/s/delta/equipe', { cookie: A.cookie, form: { name: 'Terceiro', title: '', commission: '0' }, headers: { referer: 'http://localhost/app/s/delta/equipe' } });
    assert.match(Buffer.from(r.cookies.find((c) => c.startsWith('f='))!.split(';')[0].slice(2), 'base64url').toString(), /permite até 2/);
  });

  test('sem sessão, o painel redireciona para o login', async () => {
    const r = await E.req('/app/s/delta');
    assert.equal(r.status, 302); assert.equal(r.location, '/entrar');
  });
});

test('persistência: dados continuam após fechar e reabrir o banco', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cadeira-'));
  try {
    let E = await env(dir);
    await E.signupShop('epsilon');
    await E.db.close();
    const db = await openDb(dir);
    const H = http(createApp(db));
    assert.equal((await shopRow(db, 'epsilon')).name, 'Barbearia epsilon');
    const cookie = await H.loginAs('epsilon@teste.com.br', 'senha-forte-123');
    assert.equal((await H.req('/app/s/epsilon', { cookie })).status, 200);
    await db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('todas as combinações de tema mantêm contraste legível', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.ok(contrast(p.ink, p.bg) >= 7, `${id} texto`);
    assert.ok(contrast(p.muted, p.bg) >= 4.5, `${id} texto secundário`);
    assert.ok(contrast(p.muted, p.surface) >= 4.5, `${id} secundário no cartão`);
    for (const [aid, a] of Object.entries(p.accents)) {
      const on = contrast(a.color, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#111214';
      assert.ok(contrast(a.color, on) >= 4.5, `${id}/${aid} botão`);
      assert.ok(contrast(a.color, p.bg) >= 3, `${id}/${aid} destaque sobre o fundo`);
    }
  }
});

test('conversão de fuso: horário local de São Paulo', () => {
  assert.equal(localToUtc('2026-12-03', 9 * 60, 'America/Sao_Paulo').toISOString(), '2026-12-03T12:00:00.000Z');
  assert.deepEqual(toLocal(new Date('2026-12-03T02:30:00Z'), 'America/Sao_Paulo').date, '2026-12-02');
  assert.equal(localToUtc('2026-07-10', 600, 'Europe/Lisbon').toISOString(), '2026-07-10T09:00:00.000Z');
});
