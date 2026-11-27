// Varredura: abre cada tela, segue cada link interno e envia cada formulário como o navegador enviaria
// (valores padrão, opções marcadas, botões com formaction). Pega rota quebrada, nome de campo errado e erro 500.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { sandboxProvider } from '../src/billing/providers.ts';
import { createBooking, manageToken, linkSecret } from '../src/domain/booking.ts';
import { contextFor, publicShop } from '../src/domain/accounts.ts';
import { clock, resetRateLimits, localToUtc } from '../src/lib/core.ts';
import { http, NOW, THU, firstIds } from './helpers.ts';

const dec = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? dec(m[1]) : null; };
const has = (tag: string, name: string) => new RegExp(`\\s${name}(\\s|>|=|/)`).test(tag);

type Sub = { method: string; action: string; fields: [string, string][] };
function formsOf(html: string, page: string): Sub[] {
  const out: Sub[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const [, open, body] = m;
    const method = (attr('<f ' + open, 'method') ?? 'get').toLowerCase();
    const action = attr('<f ' + open, 'action') ?? page.split('?')[0];
    const fields: [string, string][] = [];
    for (const t of body.matchAll(/<input\b[^>]*>/g)) {
      const tag = t[0], name = attr(tag, 'name'); if (!name) continue;
      const type = (attr(tag, 'type') ?? 'text').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !has(tag, 'checked')) continue;
      fields.push([name, attr(tag, 'value') ?? (type === 'checkbox' ? 'on' : '')]);
    }
    for (const s of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const name = attr('<s ' + s[1], 'name'); if (!name) continue;
      const opts = [...s[2].matchAll(/<option\b([^>]*)>/g)].map((o) => o[1]);
      const sel = opts.find((o) => /\sselected/.test(' ' + o)) ?? opts[0];
      fields.push([name, sel ? attr('<o ' + sel, 'value') ?? '' : '']);
    }
    for (const t of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) { const name = attr('<t ' + t[1], 'name'); if (name) fields.push([name, dec(t[2])]); }
    out.push({ method, action, fields });
    for (const b of body.matchAll(/<button\b[^>]*formaction="([^"]+)"[^>]*>/g)) out.push({ method, action: dec(b[1]), fields });
  }
  return out;
}
const linksOf = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => dec(m[1])).filter((h) => h.startsWith('/') && !h.startsWith('//'));

let E: any, owner = '', barber = '', adminCookie = '', bookingId = '';
before(async () => {
  clock.now = () => NOW; resetRateLimits();
  const db = await openDb();
  const prov = sandboxProvider(db, 'x');
  const app = createApp(db, { billing: prov, staticRoot: 'src/public' });
  E = { db, app, ...http(app) };
  await db.system((q) => q.exec(`update plans set price_cents = case id when 'essencial' then 4990 when 'profissional' then 8990 else 14990 end`));
  const A = await E.signupShop('omega'); owner = A.cookie;
  await E.req('/app/s/omega/pagina/publicar', { cookie: owner, form: {} });
  await E.req('/app/s/omega/equipe', { cookie: owner, form: { name: 'Bruno Navalha', title: 'Barba', commission: '40' } });
  const shop = (await publicShop(db, 'omega'))!;
  const ids = await firstIds(db, shop.id);
  const bruno = ids.pros.find((p: any) => p.name === 'Bruno Navalha')!.id;
  await E.req('/app/s/omega/equipe/acesso', { cookie: owner, form: { professionalId: bruno, role: 'barber', name: 'Bruno Navalha', email: 'bruno@omega.com', password: 'provisoria-123' } });
  barber = await E.loginAs('bruno@omega.com', 'provisoria-123');
  const ownerRow: any = await db.system((q) => q.one(`select id from users where email = 'omega@teste.com.br'`));
  const ctx = await contextFor(db, { id: ownerRow.id } as any, 'omega');
  for (const [pro, t, name] of [[ids.pros[0].id, '10:00', 'Carlos Lima'], [bruno, '11:00', 'Davi Souza'], [ids.pros[0].id, '09:00', 'Edu Prado']] as const) {
    const r = await createBooking(db, shop, { serviceIds: [ids.services[0].id], professionalId: pro, startsAt: localToUtc(t === '09:00' ? '2026-12-02' : THU, (+t.slice(0, 2)) * 60 + (t === '09:00' ? 30 : 0), 'America/Sao_Paulo').toISOString(), name, phone: '1198765' + (4000 + name.length) }, { kind: 'staff', ctx });
    if (!bookingId) bookingId = r.booking.id;
  }
  await db.system((q: any) => q.exec(`update users set is_platform_admin = true where email = 'omega@teste.com.br'`));
  adminCookie = owner;
});
after(() => E.db.close());

async function crawl(cookie: string, pages: string[], opts: { skipActions?: RegExp } = {}) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    const r = await E.req(page, { cookie });
    if (r.status >= 500 || r.status === 404) { problems.push(`GET ${page} → ${r.status}`); continue; }
    for (const href of linksOf(r.text)) {
      if (seen.has(href) || href.startsWith('/static') || href === '/sair') continue;
      seen.add(href);
      const l = await E.req(href, { cookie });
      if (l.status >= 500 || l.status === 404) problems.push(`link ${href} (em ${page}) → ${l.status}`);
    }
    for (const f of formsOf(r.text, page)) {
      if (f.action === '/sair' || opts.skipActions?.test(f.action)) continue;
      const key = f.method + f.action + JSON.stringify(f.fields);
      if (seen.has(key)) continue; seen.add(key);
      let res;
      if (f.method === 'get') { const qs = new URLSearchParams(f.fields).toString(); res = await E.req(f.action.split('#')[0] + (qs ? '?' + qs : ''), { cookie }); }
      else {
        const form: Record<string, string[]> = {};
        for (const [k, v] of f.fields) (form[k] ??= []).push(v);
        res = await E.req(f.action, { cookie, form, headers: { referer: 'http://localhost' + page } });
      }
      if (res.status >= 500 || res.status === 404) problems.push(`${f.method.toUpperCase()} ${f.action} (em ${page}) → ${res.status} ${res.text.slice(0, 120).replace(/\s+/g, ' ')}`);
      if (/Algo deu errado/.test(res.text)) problems.push(`${f.method.toUpperCase()} ${f.action} (em ${page}) → página de erro interno`);
    }
  }
  return problems;
}

test('proprietário: todas as telas, links e formulários funcionam', async () => {
  const base = '/app/s/omega';
  const pages = [base, `${base}/agenda`, `${base}/agenda?date=${THU}`, `${base}/reserva/${bookingId}`, `${base}/novo`, `${base}/novo?name=Fulano+Teste&phone=11999990000&s=x&p=any&date=${THU}`,
    `${base}/caixa/comanda?booking=${bookingId}`, `${base}/caixa/comanda`, `${base}/caixa`, `${base}/caixa?date=2026-12-02`, `${base}/financeiro`, `${base}/clientes`, `${base}/clientes?filtro=sumido`,
    `${base}/comecar?passo=1`, `${base}/comecar?passo=2`, `${base}/comecar?passo=3`, `${base}/comecar?passo=4`, `${base}/comecar?passo=5`,
    `${base}/servicos`, `${base}/equipe`, `${base}/horarios`, `${base}/pagina`, `${base}/menu`, `${base}/assinatura`, `${base}/lembretes`, `${base}/lembretes?date=2026-12-02`];
  const cust: any = await E.db.tenant((await publicShop(E.db, 'omega'))!.id, (q: any) => q.one('select id from customers limit 1'));
  pages.push(`${base}/clientes/${cust.id}`);
  // ações que encerram o acesso ou apagam dados ficam em testes próprios
  const problems = await crawl(owner, pages, { skipActions: /\/assinatura\/cancelar$|\/pagina\/despublicar$|\/apagar$/ });
  assert.deepEqual(problems, []);
});

test('barbeiro: só vê o que pode e nada quebra', async () => {
  const base = '/app/s/omega';
  const problems = await crawl(barber, [base, `${base}/agenda`, `${base}/agenda?date=${THU}`, `${base}/novo`, `${base}/menu`, `${base}/comissoes`, `${base}/caixa/comanda`, `${base}/lembretes`]);
  // o barbeiro só vê os lembretes da própria agenda
  const r = await E.req(`${base}/lembretes`, { cookie: barber });
  assert.match(r.text, /Davi Souza/); assert.doesNotMatch(r.text, /Carlos Lima/);
  assert.equal((await E.req(`${base}/lembretes/${bookingId}`, { cookie: barber, form: {} })).status, 404);
  assert.deepEqual(problems, []);
});

test('administração: telas, links e formulários funcionam', async () => {
  const shop = (await publicShop(E.db, 'omega'))!;
  await E.db.system((q: any) => q.exec(`insert into contact_messages (name, email, message) values ('Teste','t@t.com','Mensagem de teste')`));
  const problems = await crawl(adminCookie, ['/admin', '/admin/barbearias', `/admin/barbearias/${shop.id}`, '/admin/planos', '/admin/cobrancas', '/admin/suporte', '/admin/auditoria']);
  assert.deepEqual(problems, []);
});

test('site e página pública: telas e links funcionam', async () => {
  // link da reserva marcada no balcão (derivado, como vai no lembrete); a tela de remarcar vem antes porque a varredura também envia "cancelar"
  const tk = manageToken(await linkSecret(E.db), bookingId);
  const problems = await crawl('', ['/', '/planos', '/entrar', '/esqueci', '/redefinir/link-que-nao-existe', `/b/omega/reserva/${tk}?remarcar=1`, `/b/omega/reserva/${tk}`, '/criar-conta', '/b/omega', '/contato', '/termos', '/privacidade']);
  // imagens do site: os prints referenciados precisam existir
  const home = await E.req('/');
  for (const src of [...home.text.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])) { const r = await E.app.request(src); if (r.status !== 200) problems.push(`imagem ${src} → ${r.status}`); }
  assert.deepEqual(problems.filter((p) => !p.includes('/criar-conta') && !p.includes('/entrar')), []);
});
