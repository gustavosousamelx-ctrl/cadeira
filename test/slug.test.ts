// Endereço da página no cadastro: aceita maiúscula, acento, site com .com.br, etc.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlug } from '../src/lib/core.ts';
import { signup } from '../src/domain/accounts.ts';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { http, shopRow } from './helpers.ts';

describe('endereço da página', () => {
  test('normaliza domínio, acentos e pontuação', () => {
    assert.equal(normalizeSlug('Teste1.com.br'), 'teste1');
    assert.equal(normalizeSlug('https://www.Navalha.com.br/'), 'navalha');
    assert.equal(normalizeSlug('HTTP://WWW.FOO.COM.BR/agenda?x=1'), 'foo');
    assert.equal(normalizeSlug('Barbearia do João'), 'barbearia-do-joao');
    assert.equal(normalizeSlug('Studio & Corte'), 'studio-e-corte');
    assert.equal(normalizeSlug('teste_1.com'), 'teste-1');
    assert.equal(normalizeSlug('Foo...Bar'), 'foo-bar');
    assert.equal(normalizeSlug('  Minha Barbearia  '), 'minha-barbearia');
    assert.equal(normalizeSlug('AB'), 'ab');
    assert.equal(normalizeSlug('ab.com'), 'ab');
    assert.equal(normalizeSlug('  '), '');
    assert.equal(normalizeSlug('alfa'), 'alfa');
  });

  let db: Db;
  before(async () => { db = await openDb(); });
  after(() => db.close());

  test('cadastro aceita Teste1.com.br e grava teste1', async () => {
    const { shop } = await signup(db, {
      name: 'Dona Teste',
      email: 'teste1combr@t.com',
      password: 'senha-forte-123',
      shopName: 'Barbearia Teste',
      slug: 'Teste1.com.br',
    });
    assert.equal(shop.slug, 'teste1');
    assert.equal((await shopRow(db, 'teste1')).name, 'Barbearia Teste');
  });

  test('só recusa se ainda ficar com menos de 3 caracteres ou se o endereço já existir', async () => {
    await assert.rejects(
      () => signup(db, { name: 'Outro', email: 'abcurto@t.com', password: 'senha-forte-123', shopName: 'Loja AB', slug: 'AB.com' }),
      (e: any) => e.status === 422 && /pelo menos 3/.test(e.message),
    );
    await assert.rejects(
      () => signup(db, { name: 'Outro', email: 'teste1b@t.com', password: 'senha-forte-123', shopName: 'Outra', slug: 'https://www.Teste1.com.br' }),
      (e: any) => e.status === 409 && e.code === 'slug_taken',
    );
  });

  test('o campo do cadastro não pede endereço do Chrome e empilha o prefixo', async () => {
    const H = http(createApp(db, { billing: null }));
    const page = await H.req('/criar-conta');
    assert.equal(page.status, 200);
    assert.match(page.text, /id="shop-slug"/);
    assert.match(page.text, /name="slug"/);
    assert.match(page.text, /autocomplete="off"/);
    assert.match(page.text, /data-lpignore="true"/);
    assert.match(page.text, /autocapitalize="off"/);
    assert.match(page.text, /autocorrect="off"/);
    assert.match(page.text, /spellcheck="false"/);
    assert.doesNotMatch(page.text, /name="slug"[^>]*pattern=/);
    assert.match(page.text, /Pode escrever com maiúscula ou colar o site/);
    assert.match(page.text, /<span>[^<]*\/b\/<\/span>/);
  });

  test('Testar grátis de cada plano leva o plano escolhido para o cadastro', async () => {
    const H = http(createApp(db, { billing: null }));
    const home = await H.req('/');
    const planos = await H.req('/planos');
    for (const id of ['essencial', 'profissional', 'gestao']) {
      assert.match(home.text, new RegExp(`/criar-conta\\?plano=${id}`));
      assert.match(planos.text, new RegExp(`/criar-conta\\?plano=${id}`));
    }
    const page = await H.req('/criar-conta?plano=profissional');
    assert.equal(page.status, 200);
    assert.match(page.text, /Plano escolhido: <b>Profissional<\/b>/);
    assert.match(page.text, /name="plano" value="profissional"/);
    const invalid = await H.req('/criar-conta?plano=nao-existe');
    assert.doesNotMatch(invalid.text, /Plano escolhido/);
  });

  test('cadastro pelo formulário normaliza o endereço, grava o plano e abre o painel', async () => {
    const H = http(createApp(db, { billing: null }));
    const r = await H.req('/criar-conta', { form: {
      name: 'Dono Jarvis Teste',
      email: 'jarvis-teste-v4@teste.com.br',
      password: 'senha-forte-123',
      shopName: 'Barbearia Jarvis Teste V4',
      slug: 'Teste-Jarvis.com.br',
      plano: 'gestao',
    } });
    assert.equal(r.status, 303);
    assert.equal(r.location, '/app/s/teste-jarvis/comecar');
    const shop = await shopRow(db, 'teste-jarvis');
    assert.equal(shop.name, 'Barbearia Jarvis Teste V4');
    const sub = await db.system((q) => q.one('select plan_id, status from saas_subscriptions where shop_id = $1', [shop.id]));
    assert.equal(sub!.plan_id, 'gestao');
    assert.equal(sub!.status, 'trialing');
    const sid = r.cookies.find((c) => c.startsWith('sid='))!.split(';')[0];
    const onboarding = await H.req('/app/s/teste-jarvis/comecar', { cookie: sid });
    assert.equal(onboarding.status, 200);
  });

  test('plano inválido no cadastro não quebra e usa o plano padrão', async () => {
    const H = http(createApp(db, { billing: null }));
    const r = await H.req('/criar-conta', { form: {
      name: 'Dono Padrao',
      email: 'jarvis-padrao-v4@teste.com.br',
      password: 'senha-forte-123',
      shopName: 'Barbearia Padrao V4',
      slug: 'jarvis-padrao-v4',
      plano: 'nao-existe',
    } });
    assert.equal(r.status, 303);
    const shop = await shopRow(db, 'jarvis-padrao-v4');
    const sub = await db.system((q) => q.one('select plan_id from saas_subscriptions where shop_id = $1', [shop.id]));
    assert.equal(sub!.plan_id, 'profissional');
  });
});