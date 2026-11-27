// Auditoria automática das telas: acessibilidade (axe), erros no console, rolagem lateral, tempo e peso de cada página,
// em celular, tablet e computador. Usa o Edge instalado (playwright-core não baixa navegador).
// Uso: com `npm run telas` rodando, `node scripts/auditoria.ts [pasta-para-fotos]`
import { chromium, type Page } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3100';
const shotsDir = process.argv[2];
const axeSrc = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const VIEWS = {
  celular: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  computador: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
} as const;

async function pages(page: Page) {
  // descobre ids reais (agendamento, cliente, barbearia, link do cliente) a partir das telas
  const grab = async (url: string, re: RegExp) => { await page.goto(BASE + url); return (re.exec(await page.content()) ?? [])[1]; };
  const booking = await grab('/app/s/navalha/agenda?date=2026-12-03', /\/reserva\/([0-9a-f-]{36})/);
  const customer = await grab('/app/s/navalha/clientes', /\/clientes\/([0-9a-f-]{36})/);
  const shop = await grab('/admin/barbearias', /\/admin\/barbearias\/([0-9a-f-]{36})/);
  const svc = await grab('/b/navalha', /name="s" value="([0-9a-f-]{36})"/);
  const p = '/app/s/navalha';
  return [
    '/', '/planos', '/criar-conta', '/entrar', '/esqueci', '/contato', '/termos', '/privacidade',
    p, `${p}/agenda`, `${p}/reserva/${booking}`, `${p}/reserva/${booking}/mudar`, `${p}/novo`, `${p}/lembretes`, `${p}/caixa`, `${p}/caixa/comanda`,
    `${p}/financeiro`, `${p}/clientes`, `${p}/clientes/${customer}`, `${p}/comecar?passo=1`, `${p}/comecar?passo=2`, `${p}/comecar?passo=4`,
    `${p}/servicos`, `${p}/equipe`, `${p}/horarios`, `${p}/pagina`, `${p}/assinatura`, `${p}/menu`,
    '/b/navalha', `/b/navalha?s=${svc}&pro=1`, `/b/navalha?s=${svc}&p=any`,
    '/admin', '/admin/barbearias', `/admin/barbearias/${shop}`, '/admin/planos', '/admin/cobrancas', '/admin/suporte', '/admin/auditoria',
  ];
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report: any[] = [];
let list: string[] = [];
for (const [name, view] of Object.entries(VIEWS)) {
  const ctx = await browser.newContext({ ...view, bypassCSP: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  if (!list.length) list = await pages(page);
  for (const url of list) {
    const errors: string[] = [];
    const onConsole = (m: any) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); };
    const onError = (e: Error) => errors.push('pageerror: ' + e.message.slice(0, 140));
    page.on('console', onConsole); page.on('pageerror', onError);
    const res = await page.goto(BASE + url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
        kb: Math.round((nav.encodedBodySize + res.reduce((s, r) => s + (r.encodedBodySize || 0), 0)) / 1024),
        requests: res.length + 1,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    await page.addScriptTag({ content: axeSrc });
    const axe: any = await page.evaluate(() => (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    const bad = axe.violations.filter((v: any) => ['serious', 'critical'].includes(v.impact)).map((v: any) => `${v.id}(${v.nodes.length}: ${v.nodes.slice(0, 2).map((n: any) => n.target.join(' ') + (n.any?.[0]?.data?.contrastRatio ? ` ${n.any[0].data.contrastRatio}:1 ${n.any[0].data.fgColor}/${n.any[0].data.bgColor}` : '')).join(' ; ')})`);
    const minor = axe.violations.filter((v: any) => !['serious', 'critical'].includes(v.impact)).map((v: any) => `${v.id}(${v.nodes.length})`);
    if (shotsDir) { mkdirSync(join(shotsDir, name), { recursive: true }); await page.screenshot({ path: join(shotsDir, name, url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + '.png'), fullPage: true }); }
    report.push({ view: name, url: url.replace(/[0-9a-f-]{36}/g, ':id'), status: res?.status(), ...m, axeSerious: bad.join(' '), axeMinor: minor.join(' '), errors: errors.join(' | ') });
    page.off('console', onConsole); page.off('pageerror', onError);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(process.cwd(), 'auditoria.json'), JSON.stringify(report, null, 1));
const problems = report.filter((r) => r.status >= 400 && r.status !== 402 || r.overflow || r.axeSerious || r.errors);
console.log(`${report.length} telas verificadas (${list.length} endereços × ${Object.keys(VIEWS).length} tamanhos)`);
console.log(`maior tempo até carregar: ${Math.max(...report.map((r) => r.load))} ms · mais pesada: ${Math.max(...report.map((r) => r.kb))} KB`);
for (const r of problems) console.log(`${r.view.padEnd(10)} ${r.url.padEnd(44)} ${r.status} ${r.overflow ? 'ROLAGEM-LATERAL ' : ''}${r.axeSerious ? 'axe: ' + r.axeSerious + ' ' : ''}${r.errors ? 'erros: ' + r.errors : ''}`);
if (!problems.length) console.log('nenhum problema sério encontrado');
