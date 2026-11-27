// Recuperação de senha (guia da OWASP): resposta igual para quem tem e quem não tem conta, link de uso único com validade,
// troca derruba as sessões abertas, link sai do PUBLIC_HOST e não do cabeçalho Host.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { memoryMailer, resendMailer } from '../src/lib/mail.ts';
import { clock, resetRateLimits } from '../src/lib/core.ts';
import { http, NOW } from './helpers.ts';

describe('esqueci minha senha', () => {
  let db: Db, mail: ReturnType<typeof memoryMailer>, H: ReturnType<typeof http>, cookie = '';
  before(async () => {
    clock.now = () => NOW; resetRateLimits();
    db = await openDb(); mail = memoryMailer();
    H = http(createApp(db, { billing: null, mailer: mail, publicHost: 'cadeira.exemplo.com' }));
    cookie = (await H.signupShop('senhas')).cookie;
  });
  after(() => db.close());

  const linkOf = (text: string) => /https:\/\/cadeira\.exemplo\.com(\/redefinir\/[\w-]+)/.exec(text)![1];

  test('mesma resposta exista ou não a conta; o link vem do PUBLIC_HOST', async () => {
    const yes = await H.req('/esqueci', { form: { email: 'SENHAS@teste.com.br' }, headers: { host: 'site-do-atacante.com' } });
    const no = await H.req('/esqueci', { form: { email: 'ninguem@teste.com.br' } });
    assert.equal(yes.status, 200); assert.equal(no.status, 200);
    const body = (t: string) => t.replace(/\s+/g, ' ').match(/<main[\s\S]*<\/main>/)![0];
    assert.equal(body(yes.text), body(no.text));
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'senhas@teste.com.br');
    assert.doesNotMatch(mail.sent[0].text, /site-do-atacante/);
    assert.match(mail.sent[0].text, /vale por 1 hora/);
    assert.equal((await H.req('/esqueci', { form: { email: 'nao-e-email' } })).status, 422);
  });

  test('senha nova: confere as duas, derruba sessões, link não funciona de novo e a senha antiga para de valer', async () => {
    const path = linkOf(mail.sent[0].text);
    const page = await H.req(path);
    assert.equal(page.status, 200); assert.match(page.text, /Crie uma senha nova/);
    assert.equal(page.res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await H.req(path, { form: { password: 'curta', confirm: 'curta' } })).status, 422);
    const diff = await H.req(path, { form: { password: 'uma-senha-nova', confirm: 'outra-senha-nova' } });
    assert.equal(diff.status, 422); assert.match(diff.text, /não são iguais/);
    assert.equal((await H.req('/app', { cookie })).status, 302, 'antes da troca a sessão vale');
    const ok = await H.req(path, { form: { password: 'uma-senha-nova', confirm: 'uma-senha-nova' } });
    assert.equal(ok.status, 303); assert.equal(ok.location, '/entrar?senha=1');
    assert.match((await H.req('/app', { cookie })).location, /\/entrar/, 'sessão antiga encerrada');
    assert.match((await H.req(path)).text, /Link vencido/);
    assert.equal((await H.req(path, { form: { password: 'mais-uma-senha', confirm: 'mais-uma-senha' } })).status, 422);
    assert.equal((await H.req('/entrar', { form: { email: 'senhas@teste.com.br', password: 'senha-forte-123' } })).status, 401);
    assert.ok(await H.loginAs('senhas@teste.com.br', 'uma-senha-nova'));
    assert.match(mail.sent.at(-1)!.subject, /foi alterada/);
    const audit = await db.system((q) => q.all(`select action from audit_log where action like 'auth.%' order by id`));
    assert.deepEqual(audit.map((a) => a.action), ['auth.reset_requested', 'auth.password_reset']);
  });

  test('link vencido não vale; pedir de novo invalida o anterior; excesso por e-mail fica silencioso', async () => {
    resetRateLimits();
    await H.req('/esqueci', { form: { email: 'senhas@teste.com.br' } });
    const first = linkOf(mail.sent.at(-1)!.text);
    await H.req('/esqueci', { form: { email: 'senhas@teste.com.br' } });
    const second = linkOf(mail.sent.at(-1)!.text);
    assert.notEqual(first, second);
    assert.match((await H.req(first)).text, /Link vencido/);
    await db.system((q) => q.exec(`update password_resets set expires_at = now() - interval '1 minute' where used_at is null`));
    assert.match((await H.req(second)).text, /Link vencido/);
    await H.req('/esqueci', { form: { email: 'senhas@teste.com.br' } }); // terceiro: ainda vale
    const n = mail.sent.length;
    const fourth = await H.req('/esqueci', { form: { email: 'senhas@teste.com.br' } });
    assert.equal(fourth.status, 200); assert.match(fourth.text, /Confira seu e-mail/);
    assert.equal(mail.sent.length, n, 'quarto pedido na hora: mesma tela, sem novo e-mail');
  });

  test('sem PUBLIC_HOST em produção não manda link montado a partir do cabeçalho Host', async () => {
    resetRateLimits();
    const m2 = memoryMailer();
    const H2 = http(createApp(db, { billing: null, mailer: m2, secureCookies: true }));
    const r = await H2.req('/esqueci', { form: { email: 'senhas@teste.com.br' }, headers: { host: 'site-do-atacante.com' } });
    assert.equal(r.status, 200);
    assert.equal(m2.sent.length, 0);
  });

  test('adaptador do Resend: endereço, autorização e corpo', async () => {
    let call: any;
    const m = resendMailer({ apiKey: 're_teste', from: 'Cadeira <nao-responda@exemplo.com>', fetchImpl: (async (url: string, init: any) => { call = { url, init }; return new Response('{"id":"1"}', { status: 200 }); }) as any });
    await m.send({ to: 'a@b.com', subject: 'Oi', text: 'Corpo' });
    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.init.headers.authorization, 'Bearer re_teste');
    assert.deepEqual(JSON.parse(call.init.body), { from: 'Cadeira <nao-responda@exemplo.com>', to: ['a@b.com'], subject: 'Oi', text: 'Corpo' });
    const bad = resendMailer({ apiKey: 'x', from: 'y', fetchImpl: (async () => new Response('nope', { status: 422 })) as any });
    await assert.rejects(bad.send({ to: 'a@b.com', subject: 's', text: 't' }), /422/);
  });
});
