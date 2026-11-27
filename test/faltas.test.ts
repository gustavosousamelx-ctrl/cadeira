// Menos faltas: lembrete pelo WhatsApp com link, confirmação de presença e remarcação pelo próprio cliente.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, THU, firstIds } from './helpers.ts';
import { publicShop } from '../src/domain/accounts.ts';
import { localToUtc, sha256 } from '../src/lib/core.ts';
import { backfillLinks, manageToken, linkSecret } from '../src/domain/booking.ts';

const T = (d: string, hm: string) => localToUtc(d, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), 'America/Sao_Paulo').toISOString();
const WED = '2026-12-02';

describe('lembretes, confirmação e remarcação', () => {
  let E: Awaited<ReturnType<typeof env>>, A: any, shop: any, ids: any;
  before(async () => {
    E = await env(); A = await E.signupShop('lembra');
    await E.req('/app/s/lembra/pagina', { cookie: A.cookie, form: { name: 'Barbearia lembra', description: '', address: 'Rua B', phone: '', instagram: '', theme: 'salao:bordo', min_notice_min: '60', max_days_ahead: '30', cancel_until_min: '120', slot_step_min: '15' } });
    await E.req('/app/s/lembra/pagina/publicar', { cookie: A.cookie, form: {} });
    shop = await publicShop(E.db, 'lembra'); ids = await firstIds(E.db, shop.id);
  });
  after(() => E.db.close());
  let token = '', bookingId = '';

  test('lembrete: vale também para horário marcado no balcão, abre o WhatsApp com o link e registra o envio', async () => {
    const mk = await E.req('/app/s/lembra/novo', { cookie: A.cookie, form: { s: [ids.services[0].id], p: ids.pros[0].id, startsAt: T(THU, '10:00'), name: 'Carla Balcão', phone: '(11) 95555-4444' } });
    assert.equal(mk.status, 303);
    bookingId = /\/reserva\/([0-9a-f-]{36})/.exec(mk.location)![1];
    const list = await E.req('/app/s/lembra/lembretes', { cookie: A.cookie }); // padrão: amanhã
    assert.equal(list.status, 200);
    assert.match(list.text, /Carla Balcão/); assert.match(list.text, /Sem lembrete/);
    const send = await E.req(`/app/s/lembra/lembretes/${bookingId}`, { cookie: A.cookie, form: {} });
    assert.equal(send.status, 303);
    assert.ok(send.location.startsWith('https://wa.me/5511955554444?text='), send.location);
    const text = decodeURIComponent(send.location.split('?text=')[1]);
    assert.match(text, /Olá, Carla! .*amanhã às 10:00 na Barbearia lembra/);
    const m = /http:\/\/localhost(\/b\/lembra\/reserva\/([\w-]{32}))$/.exec(text);
    assert.ok(m, text);
    token = m![2];
    const page = await E.req(m![1]);
    assert.equal(page.status, 200); assert.match(page.text, /Confirmar presença/); assert.match(page.text, /Remarcar/);
    const after = (await E.req('/app/s/lembra/lembretes', { cookie: A.cookie })).text;
    assert.match(after, /Abertura solicitada/); assert.doesNotMatch(after, /Enviado/, 'o sistema só sabe que abriu o WhatsApp, não que a mensagem foi enviada');
    const row = await E.db.tenant(shop.id, (q) => q.one('select reminded_at from bookings where id = $1', [bookingId]));
    assert.ok(row!.reminded_at);
    // mesmo link de novo: é derivado da reserva, não muda a cada envio
    const again = await E.req(`/app/s/lembra/lembretes/${bookingId}`, { cookie: A.cookie, form: {} });
    assert.ok(decodeURIComponent(again.location).includes(token));
  });

  test('cliente confirma presença pelo link e o painel mostra', async () => {
    const r = await E.req(`/b/lembra/reserva/${token}/confirmar`, { form: {} });
    assert.equal(r.status, 303); assert.match(r.location, /ok=confirmado/);
    const page = await E.req(r.location);
    assert.match(page.text, /Presença confirmada/); assert.doesNotMatch(page.text, /Confirmar presença<\/button>/);
    assert.equal((await E.req(`/b/lembra/reserva/${token}/confirmar`, { form: {} })).status, 303, 'confirmar de novo não dá erro');
    const det = await E.req(`/app/s/lembra/reserva/${bookingId}`, { cookie: A.cookie });
    assert.match(det.text, /Cliente confirmou presença/);
    assert.match((await E.req('/app/s/lembra/lembretes', { cookie: A.cookie })).text, /Confirmou/);
    const ev = await E.db.tenant(shop.id, (q) => q.all(`select note from booking_events where booking_id = $1 and note is not null`, [bookingId]));
    assert.equal(ev.length, 1);
  });

  test('cliente remarca sozinho: só horário livre do mesmo profissional, dentro do prazo da casa', async () => {
    const b1 = await E.req('/b/lembra/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T(THU, '15:00'), name: 'Davi Online', phone: '11944443333', website: '' } });
    const tk = /reserva\/([\w-]+)\?novo=1/.exec(b1.location)![1];
    await E.req('/b/lembra/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T(THU, '16:00'), name: 'Eva Online', phone: '11933332222', website: '' } });
    const opts = await E.req(`/b/lembra/reserva/${tk}?remarcar=1&d=${THU}`);
    assert.equal(opts.status, 200);
    assert.ok(opts.text.includes(`value="${T(THU, '14:45')}"`), 'o horário atual não bloqueia o vizinho');
    assert.ok(!opts.text.includes(`value="${T(THU, '16:00')}"`), 'horário de outro cliente não aparece');
    const taken = await E.req(`/b/lembra/reserva/${tk}/remarcar`, { form: { t: T(THU, '16:00') } });
    assert.equal(taken.status, 409); assert.match(taken.text, /acabou de ser ocupado/);
    // confirma antes para ver que a remarcação zera a confirmação e o lembrete
    await E.req(`/b/lembra/reserva/${tk}/confirmar`, { form: {} });
    const ok = await E.req(`/b/lembra/reserva/${tk}/remarcar`, { form: { t: T(THU, '14:45') } });
    assert.equal(ok.status, 303); assert.match(ok.location, /ok=remarcado/);
    const row = await E.db.tenant(shop.id, (q) => q.one(`select b.id, b.starts_at, b.client_confirmed_at from bookings b where b.contact_name = 'Davi Online'`));
    assert.equal(new Date(row!.starts_at).toISOString(), T(THU, '14:45'));
    assert.equal(row!.client_confirmed_at, null);
    const note = await E.db.tenant(shop.id, (q) => q.one(`select note from booking_events where booking_id = $1 and note like 'Remarcado%'`, [row!.id]));
    assert.equal(note!.note, 'Remarcado pelo cliente: 03/12 15:00 → 03/12 14:45');
    assert.match((await E.req(ok.location)).text, /Horário remarcado/);
    // o horário antigo voltou a ficar livre
    const free = await E.req(`/b/lembra/reserva/${tk}?remarcar=1&d=${THU}`);
    assert.ok(free.text.includes(`value="${T(THU, '15:00')}"`));
  });

  test('fora do prazo de cancelamento não remarca; link adulterado não revela nada', async () => {
    const b = await E.req('/b/lembra/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T(WED, '10:30'), name: 'Fabio Hoje', phone: '11922221111', website: '' } });
    assert.equal(b.status, 303);
    const tk = /reserva\/([\w-]+)\?novo=1/.exec(b.location)![1];
    const page = await E.req(`/b/lembra/reserva/${tk}?remarcar=1`);
    assert.doesNotMatch(page.text, /Escolha o novo horário/); assert.match(page.text, /fale com a barbearia/);
    const r = await E.req(`/b/lembra/reserva/${tk}/remarcar`, { form: { t: T(THU, '17:00') } });
    assert.equal(r.status, 422); assert.match(r.text, /remarcação online vai até 2h antes/);
    assert.equal((await E.req(`/b/lembra/reserva/${tk}x/remarcar`, { form: { t: T(THU, '17:00') } })).status, 404);
    assert.equal((await E.req(`/b/lembra/reserva/${'a'.repeat(32)}/confirmar`, { form: {} })).status, 404);
  });

  test('horários antigos sem link ganham o link na subida; link aleatório já entregue continua valendo', async () => {
    const [legacy, online] = await E.db.tenant(shop.id, async (q) => {
      const c = await q.one(`select id from customers limit 1`);
      const ins = (t: string, hash: string | null) => q.one(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source, manage_token_hash) values ($1,$2,$3,$4,$5,30,0,'confirmed','staff',$6) returning id`, [shop.id, ids.pros[0].id, c!.id, T('2026-12-04', t), T('2026-12-04', t.replace(':00', ':30')), hash]);
      return [await ins('10:00', null), await ins('11:00', sha256('link-aleatorio-antigo'))];
    });
    assert.equal(await backfillLinks(E.db), 1);
    const tk = manageToken(await linkSecret(E.db), legacy!.id);
    assert.equal((await E.req(`/b/lembra/reserva/${tk}`)).status, 200);
    assert.equal((await E.req('/b/lembra/reserva/link-aleatorio-antigo')).status, 200);
    assert.equal(await backfillLinks(E.db), 0, 'roda de novo sem efeito');
    assert.ok(online);
  });

  test('lembrete de reserva de outra barbearia: 404', async () => {
    const B = await E.signupShop('outra');
    const r = await E.req(`/app/s/outra/lembretes/${bookingId}`, { cookie: B.cookie, form: {} });
    assert.equal(r.status, 404);
    assert.equal((await E.req(`/app/s/lembra/lembretes/${bookingId}`, { cookie: B.cookie, form: {} })).status, 404);
  });
});
