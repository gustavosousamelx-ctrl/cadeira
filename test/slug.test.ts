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

  test('o campo do cadastro pede para o celular não corrigir e não exige o formato antigo', async () => {
    const H = http(createApp(db, { billing: null }));
    const page = await H.req('/criar-conta');
    assert.equal(page.status, 200);
    assert.match(page.text, /autocapitalize="off"/);
    assert.match(page.text, /autocorrect="off"/);
    assert.match(page.text, /spellcheck="false"/);
    assert.doesNotMatch(page.text, /name="slug"[^>]*pattern=/);
    assert.match(page.text, /Pode escrever com maiúscula ou colar o site/);
  });
});