// Servidor de demonstração para gerar as imagens do site: banco em memória, barbearia de exemplo
// e relógio parado numa terça às 14:20 (dia de movimento). Nada aqui toca os dados reais.
// Uso: node scripts/telas.ts   → http://localhost:3100  (login: demo@navalha.exemplo / telas-demo-123)
import { serve } from '@hono/node-server';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { ensureDemo } from '../src/demo.ts';
import { contextFor, publicShop, createSession } from '../src/domain/accounts.ts';
import { createSale } from '../src/domain/sales.ts';
import { manageToken, linkSecret } from '../src/domain/booking.ts';
import { clock, localToUtc } from '../src/lib/core.ts';

const DAY = '2026-12-01';
clock.now = () => localToUtc(DAY, 14 * 60 + 20, 'America/Sao_Paulo');
const db = await openDb();
await ensureDemo(db, 'telas-demo-123');
const shop = (await publicShop(db, 'navalha'))!;
const owner: any = await db.system((q) => q.one(`select id from users where email = 'demo@navalha.exemplo'`));
const ctx = await contextFor(db, owner, 'navalha');
// só neste servidor de demonstração em memória: o dono de exemplo também vê a administração da plataforma (para fotos e auditoria)
await db.system((q) => q.exec('update users set is_platform_admin = true where id = $1', [owner.id]));
// comandas das manhãs já atendidas, para o caixa e o financeiro terem números
const done = await db.tenant(shop.id, (q) => q.all(`select id from bookings where status = 'completed' order by starts_at`));
for (const [i, b] of done.entries()) await createSale(db, ctx, { bookingId: b.id, method1: i % 2 ? 'dinheiro' : 'pix', productName: i === 0 ? 'Pomada modeladora' : '', productPrice: i === 0 ? '38,00' : '' });
const next: any = await db.tenant(shop.id, (q) => q.one(`select id from bookings where status = 'confirmed' and starts_at > $1 order by starts_at limit 1`, [clock.now()]));
console.log(`comanda de exemplo: /app/s/navalha/caixa/comanda?booking=${next?.id}`);
const later: any = await db.tenant(shop.id, (q) => q.one(`select id from bookings where status = 'confirmed' and starts_at > $1 order by starts_at desc limit 1`, [clock.now()]));
if (later) console.log(`link do cliente (remarcar): /b/navalha/reserva/${manageToken(await linkSecret(db), later.id)}?remarcar=1`);
const pub = relative(process.cwd(), join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'public')).replace(/\\/g, '/');
const app = createApp(db, { staticRoot: pub, billing: null });
// sessão fixa só neste servidor de demonstração em memória: o navegador sem interface já entra logado para tirar as fotos
const sid = await createSession(db, owner.id);
// só no painel: o site e a página pública aparecem como para um visitante
const fetchLogged = (req: Request) => { const h = new Headers(req.headers); if (/^\/(app|admin)(\/|$)/.test(new URL(req.url).pathname) &&!h.get('cookie')?.includes('sid=')) h.set('cookie', `sid=${sid}`); return app.fetch(new Request(req, { headers: h })); };
serve({ fetch: fetchLogged, hostname: '127.0.0.1', port: Number(process.env.PORT || 3100) }, (i) => console.log(`telas em http://localhost:${i.port}`));
