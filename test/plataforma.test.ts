import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db/db.ts';
import { sandboxProvider } from '../src/billing/providers.ts';
import { loadSub, sweep } from '../src/billing/billing.ts';
import { memoryMailer } from '../src/lib/mail.ts';
import { clock, resetRateLimits } from '../src/lib/core.ts';
import { http, NOW, shopRow } from './helpers.ts';

describe('operações da plataforma com dados de teste', () => {
  let db: Db, h: ReturnType<typeof http>, offline: ReturnType<typeof http>;
  let provider: ReturnType<typeof sandboxProvider>;
  let adminCookie: string;
  before(async () => {
    clock.now = () => NOW;
    resetRateLimits();
    db = await openDb();
    provider = sandboxProvider(db, 'simulacao-local');
    h = http(createApp(db, { billing: provider, mailer: memoryMailer() }));
    offline = http(createApp(db, { billing: null, mailer: memoryMailer() }));
    const admin = await h.signupShop('administracao', 'admin@example.test');
    adminCookie = admin.cookie;
    await db.system(q => q.exec("update users set is_platform_admin = true where email = 'admin@example.test'"));
  });
  after(() => db.close());

  test('desativar o plano padrão mantém o cadastro vinculado ao primeiro plano disponível', async () => {
    await db.system(q => q.exec("update plans set active = false where id = 'profissional'"));
    try {
      const owner = await h.signupShop('planoalternativo');
      const shop = await shopRow(db, owner.slug);
      assert.equal((await loadSub(db, shop.id))?.plan_id, 'essencial');
      assert.equal((await h.req('/app/s/planoalternativo/assinatura', { cookie: owner.cookie })).status, 200);
    } finally {
      await db.system(q => q.exec('update plans set active = true'));
    }
  });

  test('sem planos ativos, o cadastro informa a pausa e a tentativa não cria registros', async () => {
    await db.system(q => q.exec('update plans set active = false'));
    try {
      const page = await h.req('/criar-conta');
      assert.equal(page.status, 503);
      assert.match(page.text, /pausad|indisponív/i);
      const res = await h.req('/criar-conta', { form: { name: 'Pessoa fictícia', email: 'pausa@example.test',
        password: 'exemplo-local-ficticio', shopName: 'Loja em teste', slug: 'lojaemteste' } });
      assert.equal(res.status, 503);
      const user = await db.system(q => q.one("select id from users where email = 'pausa@example.test'"));
      assert.equal(user, undefined);
    } finally {
      await db.system(q => q.exec('update plans set active = true'));
    }
  });

  test('renovação no vencimento emite uma mensalidade e o pagamento reativa o acesso', async () => {
    const owner = await h.signupShop('renovacaozero');
    const shop = await shopRow(db, owner.slug);
    const base = '/app/s/renovacaozero/assinatura';
    const first = await h.req(base + '/contratar', { cookie: owner.cookie, form: { plan: 'essencial' } });
    assert.equal(first.status, 303);
    await h.req(first.location + '/confirmed', { form: {} });
    const previous = await loadSub(db, shop.id);
    const end = new Date(previous!.current_period_end);
    await db.system(q => q.exec("update platform_settings set value = '0' where key in ('renew_days_before','grace_days')"));
    clock.now = () => end;
    try {
      const run = await sweep(db, provider);
      assert.equal(run.renewalsCreated, 1);
      assert.equal((await sweep(db, provider)).renewalsCreated, 0);
      const pending = await db.system(q => q.one("select * from saas_payments where shop_id = $1 and kind = 'renewal'", [shop.id]));
      assert.equal(pending?.amount_cents, 4990);
      assert.equal((await loadSub(db, shop.id))?.status, 'expired');
      await h.req(pending!.checkout_url + '/confirmed', { form: {} });
      assert.equal((await loadSub(db, shop.id))?.status, 'active');
    } finally {
      clock.now = () => NOW;
    }
  });

  test('conciliação sem meio de pagamento explica indisponibilidade e não registra sucesso', async () => {
    const page = await offline.req('/admin/cobrancas', { cookie: adminCookie });
    assert.doesNotMatch(page.text, /<button[^>]*>Conciliar agora/);
    const post = await offline.req('/admin/conciliar', { cookie: adminCookie, form: {} });
    assert.equal(post.status, 503);
    const audit = await db.system(q => q.one("select 1 from audit_log where action = 'admin.reconcile'"));
    assert.equal(audit, undefined);
  });
});
