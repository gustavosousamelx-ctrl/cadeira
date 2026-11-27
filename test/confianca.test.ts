// Toque duplo no "Confirmar horário" e aviso por e-mail ao dono.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { memoryMailer } from '../src/lib/mail.ts';
import { publicShop } from '../src/domain/accounts.ts';
import { clock, resetRateLimits, localToUtc } from '../src/lib/core.ts';
import { http, NOW, THU, firstIds } from './helpers.ts';

const T = (hm: string) => localToUtc(THU, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), 'America/Sao_Paulo').toISOString();

describe('confiança no agendamento', () => {
  let db: Db, H: ReturnType<typeof http>, A: any, ids: any, mail: ReturnType<typeof memoryMailer>;
  before(async () => {
    clock.now = () => NOW; resetRateLimits();
    db = await openDb(); mail = memoryMailer();
    H = http(createApp(db, { billing: null, mailer: mail, publicHost: 'cadeira.exemplo.com' }));
    A = await H.signupShop('confia');
    await H.req('/app/s/confia/pagina/publicar', { cookie: A.cookie, form: {} });
    ids = await firstIds(db, (await publicShop(db, 'confia'))!.id);
  });
  after(() => db.close());

  test('toque duplo: o segundo envio leva à reserva já feita, não a "horário ocupado"', async () => {
    const form = { s: [ids.services[0].id], p: ids.pros[0].id, t: T('10:00'), name: 'Igor Duplo', phone: '(11) 95555-1212', website: '', k: 'chave-do-formulario-0001' };
    const a = await H.req('/b/confia/reservar', { form });
    const b = await H.req('/b/confia/reservar', { form });
    assert.equal(a.status, 303); assert.equal(b.status, 303);
    assert.equal(a.location, b.location);
    // outra pessoa no mesmo horário continua vendo "ocupado"
    const other = await H.req('/b/confia/reservar', { form: { ...form, name: 'Outro', phone: '11944443333', k: 'outra-chave-0000000002' } });
    assert.equal(other.status, 409);
    // privacidade: quem sabe o WhatsApp e o horário de outro cliente, mas não tem o formulário dele, não cai na reserva alheia
    const snoop = await H.req('/b/confia/reservar', { form: { ...form, name: 'Curioso', k: 'chave-de-outra-pessoa-03' } });
    assert.equal(snoop.status, 409); assert.doesNotMatch(snoop.text, /Igor Duplo/);
    const nokey = await H.req('/b/confia/reservar', { form: { ...form, k: '' } });
    assert.equal(nokey.status, 409);
    assert.match((await H.req(`/b/confia?s=${ids.services[0].id}&p=any&t=${encodeURIComponent(T('16:00'))}`)).text, /name="k" value="[\w-]{24}"/);
    const n = await db.system((q) => q.one(`select count(*)::int n from bookings where starts_at = $1`, [T('10:00')]));
    assert.equal(n!.n, 1);
  });

  test('dono recebe aviso de horário novo, remarcado e cancelado, e pode desligar', async () => {
    const before = mail.sent.length;
    const r = await H.req('/b/confia/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T('11:00'), name: 'Júlia Aviso', phone: '11933332222', website: '' } });
    const link = r.location.replace('?novo=1', '');
    await H.req(link + '/remarcar', { form: { t: T('11:30') } });
    await H.req(link + '/cancelar', { form: {} });
    await new Promise((ok) => setTimeout(ok, 50));
    const got = mail.sent.slice(before).map((m) => m.subject);
    assert.deepEqual(got.map((s) => s.split(':')[0]), ['Novo horário pela página', 'Cliente remarcou', 'Cliente cancelou']);
    assert.ok(got[0].includes('Júlia Aviso') && got[0].includes('03/12 às 11:00'));
    assert.match(mail.sent.at(-1)!.text, /https:\/\/cadeira\.exemplo\.com\/app\/s\/confia\/reserva\//);
    await H.req('/app/s/confia/pagina/avisos', { cookie: A.cookie, form: {} });
    const n = mail.sent.length;
    await H.req('/b/confia/reservar', { form: { s: [ids.services[0].id], p: ids.pros[0].id, t: T('14:00'), name: 'Sem Aviso', phone: '11922221111', website: '' } });
    await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(mail.sent.length, n, 'aviso desligado');
    assert.match((await H.req('/app/s/confia/pagina', { cookie: A.cookie })).text, /name="on" value="1" >/);
  });

  test('reenvio com dois profissionais livres recupera o mesmo link', async () => {
    await H.req('/app/s/confia/equipe', { cookie: A.cookie, form: {name:'Segundo profissional', commission:'0'} });
    resetRateLimits();
    const form = { s: ids.services[0].id, p:'any', t:T('16:00'), name:'Teste Duplo', phone:'11900000000', k:'pedido-ficticio-com-dois' };
    const first = await H.req('/b/confia/reservar', { form });
    const retry = await H.req('/b/confia/reservar', { form });
    assert.equal(first.status, 303);
    assert.equal(retry.status, 303);
    assert.equal(first.location, retry.location);
  });

  test('formulário do cliente diz o que é feito com o nome e o WhatsApp', async () => {
    const r = await H.req(`/b/confia?s=${ids.services[0].id}&p=any&t=${encodeURIComponent(T('15:00'))}`);
    assert.match(r.text, /ficam só com a Barbearia confia/);
    assert.match(r.text, /forms\.js/);
  });
});

describe('revisão externa', () => {
  test('"Chamar de volta" leva o link de agendamento; contato avisa o suporte', async () => {
    clock.now = () => NOW; resetRateLimits();
    const db = await openDb(); const mail = memoryMailer();
    const H = http(createApp(db, { billing: null, mailer: mail, publicHost: 'cadeira.exemplo.com' }));
    const A = await H.signupShop('volta');
    const shop = (await publicShop(db, 'volta'))!;
    // cliente que sumiu: última visita atendida há mais de 45 dias
    await db.tenant(shop.id, async (q) => {
      const c = await q.one(`insert into customers (shop_id, name, phone) values ($1,'Rui Sumido','11911110000') returning id`, [shop.id]);
      const p = await q.one('select id from professionals limit 1');
      await q.exec(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source) values ($1,$2,$3,$4,$5,30,4500,'completed','staff')`, [shop.id, p!.id, c!.id, new Date(NOW.getTime() - 80 * 864e5), new Date(NOW.getTime() - 80 * 864e5 + 18e5)]);
    });
    const list = await H.req('/app/s/volta/clientes?filtro=sumido', { cookie: A.cookie });
    const wa = /href="(https:\/\/wa\.me\/[^"]+)">Chamar de volta/.exec(list.text);
    assert.ok(wa, 'botão aparece');
    assert.match(decodeURIComponent(wa![1].replace(/&amp;/g, '&')), /Agende por aqui: https:\/\/cadeira\.exemplo\.com\/b\/volta$/);
    process.env.SUPPORT_EMAIL = 'suporte@teste.com.br';
    try {
      await H.req('/contato', { form: { name: 'Fulano', email: 'f@teste.com.br', message: 'Quero saber dos planos' } });
      await new Promise((ok) => setTimeout(ok, 30));
      assert.equal(mail.sent.at(-1)!.to, 'suporte@teste.com.br'); assert.match(mail.sent.at(-1)!.text, /Quero saber dos planos/);
    } finally { delete process.env.SUPPORT_EMAIL; await db.close(); }
  });
});
