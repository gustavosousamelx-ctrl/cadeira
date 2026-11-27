import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/db.ts';
import { clock, localToUtc, sha256 } from '../src/lib/core.ts';
import { memoryMailer } from '../src/lib/mail.ts';
import { firstIds, http, NOW, THU } from './helpers.ts';

describe('jornada pública de quem agenda', () => {
  const base = '/b/jornada';
  const panel = '/app/s/jornada';
  let db: Db, h: ReturnType<typeof http>, owner: string, shopId: string, service: string, pro: string;
  before(async () => {
    clock.now = () => NOW;
    db = await openDb();
    h = http(createApp(db, { billing: null, mailer: memoryMailer() }));
    owner = (await h.signupShop('jornada', 'dono@example.test')).cookie;
    await h.req(panel + '/pagina/publicar', { cookie: owner, form: {} });
    shopId = (await db.system(q => q.one("select id from shops where slug='jornada'")))!.id;
    const ids = await firstIds(db, shopId);
    service = ids.services[0].id;
    pro = ids.pros[0].id;
  });
  after(() => db.close());
  const at = (day: string, minutes: number) => localToUtc(day, minutes, 'America/Sao_Paulo').toISOString();
  const reserve = (t: string) => h.req(base + '/reservar', { form: { s: service, p: pro, t, name: 'Cliente de Teste', phone: '11900000000' } });

  test('o passo Serviço permite editar uma seleção anterior', async () => {
    const next = await h.req(base + '?s=' + service + '&pro=1');
    assert.ok(next.text.includes('<h2>Com quem?</h2>'));
    const back = /<a href="([^"]+)">Serviço<\/a>/.exec(next.text);
    assert.ok(back);
    const menu = await h.req(back[1].replaceAll('&amp;', '&'));
    assert.ok(menu.text.includes('<h2>Escolha o serviço</h2>'));
    assert.ok(menu.text.includes('value="' + service + '" checked'));
  });

  test('seleção vazia ou acima do limite mantém o cliente no cardápio com um motivo', async () => {
    const blank = await h.req(base + '?pro=1');
    assert.ok(blank.text.includes('role="alert"'));
    for (let i = 1; i <= 4; i++) {
      await h.req(panel + '/servicos', { cookie: owner, form: { name: 'Extra ' + i, duration: '15', price: '10,00' } });
    }
    const ids = (await firstIds(db, shopId)).services.slice(0, 6);
    assert.equal(ids.length, 6);
    const params = new URLSearchParams({ pro: '1' });
    ids.forEach(i => params.append('s', i.id));
    const over = await h.req(base + '?' + params);
    assert.ok(over.text.includes('<h2>Escolha o serviço</h2>'));
    assert.ok(over.text.includes('role="alert"'));
    for (const i of ids) assert.ok(over.text.includes('value="' + i.id + '" checked'));
  });

  test('calendário público e remarcação alcançam o prazo configurado', async () => {
    const later = '2026-12-23';
    const slots = await h.req(base + '?s=' + service + '&p=any&d=' + later);
    assert.ok(slots.text.includes('d=' + later + '&amp;t='));
    const book = await reserve(at(later, 600));
    assert.equal(book.status, 303);
    const receipt = book.location.split('?')[0];
    const move = await h.req(receipt + '?remarcar=1');
    assert.ok(move.text.includes('d=' + later + '#remarcar" aria-current="date"'));
    assert.ok(!move.text.includes('value="' + at(later, 600) + '"'));
  });

  test('repetir uma remarcação preserva a presença e o histórico', async () => {
    const book = await reserve(at(THU, 600));
    const receipt = book.location.split('?')[0];
    const to = { form: { t: at(THU, 660) } };
    assert.equal((await h.req(receipt + '/remarcar', to)).status, 303);
    assert.equal((await h.req(receipt + '/confirmar', { form: {} })).status, 303);
    await h.req(receipt + '/remarcar', to);
    assert.ok((await h.req(receipt)).text.includes('Presença confirmada'));
    const actions = await db.tenant(shopId, q => q.one("select count(*)::int n from booking_events where note like 'Remarcado pelo cliente%'"));
    assert.equal(actions!.n, 1);
    assert.equal((await h.req(receipt + '/cancelar', { form: {} })).status, 303);
    assert.ok((await h.req(receipt)).text.includes('Esta reserva foi cancelada.'));
  });

  test('consultar lembretes e abrir o WhatsApp preserva o link antigo do cliente', async () => {
    const b = await reserve(at(THU, 780));
    assert.equal(b.status, 303);
    const oldLink = 'reserva-antiga-desta-fixture';
    const id = await db.tenant(shopId, q => q.one('update bookings set manage_token_hash = $1 where starts_at = $2 returning id', [sha256(oldLink), at(THU, 780)]));
    assert.ok(id);
    const receipt = base + '/reserva/' + oldLink;
    assert.equal((await h.req(receipt)).status, 200);
    await h.req(panel + '/lembretes?date=' + THU, { cookie: owner });
    assert.equal((await h.req(receipt)).status, 200);
    const notice = await h.req(panel + '/lembretes/' + id.id, { cookie: owner, form: {} });
    assert.equal(notice.status, 303);
    assert.equal((await h.req(receipt)).status, 200);
    const message = new URL(notice.location).searchParams.get('text')!;
    const updated = new URL(message.match(/https?:\/\/[^\s]+/)![0]);
    assert.equal((await h.req(updated.pathname)).status, 200);
  });
});
