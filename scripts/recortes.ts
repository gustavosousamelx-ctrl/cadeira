// Recortes nítidos das telas reais para o site (em vez de telas inteiras miniaturizadas).
// Uso: com `npm run telas` rodando, `node scripts/recortes.ts` → src/public/img/demo-*.jpg
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3100';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'public', 'img');
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function shot(o: { name: string; url: string; w: number; h: number; scale?: number; mobile?: boolean; sel?: string; clip?: { x: number; y: number; width: number; height: number } }) {
  const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.scale ?? 2, isMobile: !!o.mobile, hasTouch: !!o.mobile, locale: 'pt-BR' });
  const page = await ctx.newPage();
  await page.goto(BASE + o.url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const path = join(OUT, `demo-${o.name}.jpg`);
  if (o.sel) await page.locator(o.sel).first().screenshot({ path, type: 'jpeg', quality: 80 });
  else await page.screenshot({ path, type: 'jpeg', quality: 80, clip: o.clip });
  await ctx.close();
  console.log('ok', o.name);
}

const grab = async (url: string, re: RegExp) => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(BASE + url); const m = re.exec(await p.content()); await ctx.close(); return m?.[1]; };
const svc = await grab('/b/navalha', /name="s" value="([0-9a-f-]{36})"/);
const link = await grab('/app/s/navalha/lembretes?date=2026-12-03', /\/reserva\/([0-9a-f-]{36})/);

// painel no balcão: próximo cliente + resumo + linha do dia
await shot({ name: 'hoje', url: '/app/s/navalha', w: 1280, h: 900, clip: { x: 232, y: 0, width: 1048, height: 626 } });
// lembretes de amanhã
await shot({ name: 'lembretes', url: '/app/s/navalha/lembretes?date=2026-12-02', w: 1000, h: 900, sel: 'section.block:has(.reminders)' });
// fechamento da comanda (Pix, dinheiro, troco)
await shot({ name: 'comanda', url: process.env.COMANDA || '/app/s/navalha/caixa/comanda', w: 1280, h: 860, sel: '.co-side' });
// comissão do mês por barbeiro
await shot({ name: 'comissao', url: '/app/s/navalha/financeiro', w: 1280, h: 1100, sel: 'section.block:has(.comm)' });
// cliente escolhendo horário no celular
await shot({ name: 'cliente-horario', url: `/b/navalha?s=${svc}&p=any&d=2026-12-02`, w: 390, h: 844, scale: 2, mobile: true });
// cliente confirmando ou remarcando (link do lembrete; o servidor de telas mostra esse link ao subir)
if (process.env.CLIENT_LINK) await shot({ name: 'cliente-link', url: process.env.CLIENT_LINK.replace(/\?.*$/, ''), w: 390, h: 844, scale: 2, mobile: true });
// o mesmo painel no celular do barbeiro (versão do site para telas pequenas)
await shot({ name: 'hoje-celular', url: '/app/s/navalha', w: 390, h: 844, scale: 2, mobile: true });
await shot({ name: 'lembretes-celular', url: '/app/s/navalha/lembretes?date=2026-12-02', w: 390, h: 844, scale: 2, mobile: true });
void link;
await browser.close();
