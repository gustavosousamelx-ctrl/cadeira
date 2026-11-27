// O adaptador de Postgres de verdade (driver "pg", protocolo de rede) roda as migrações e as regras principais.
// Sem Postgres instalado, o teste usa o PGlite servindo o protocolo do Postgres por socket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { openPgDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { sandboxProvider } from '../src/billing/providers.ts';
import { createBooking } from '../src/domain/booking.ts';
import { publicShop } from '../src/domain/accounts.ts';
import { clock, resetRateLimits, localToUtc } from '../src/lib/core.ts';
import { http, NOW, THU, firstIds } from './helpers.ts';

let server: PGLiteSocketServer, raw: PGlite, db: Db;
before(async () => {
  clock.now = () => NOW; resetRateLimits();
  raw = await PGlite.create({ extensions: { btree_gist } });
  const port = 54000 + Math.floor(Math.random() * 1000);
  server = new PGLiteSocketServer({ db: raw, port, host: '127.0.0.1', maxConnections: 1 });
  await server.start();
  db = await openPgDb(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1 });
});
after(async () => { await db.close(); await server.stop(); await raw.close(); });

test('Postgres: migrações, cadastro, isolamento, conflito de horário e aviso de pagamento pelo driver pg', async () => {
  assert.equal(db.kind, 'postgres');
  const migs = await db.system((q) => q.all('select version from schema_migrations order by 1'));
  assert.ok(migs.length >= 5);
  const prov = sandboxProvider(db, 'segredo');
  const app = createApp(db, { billing: prov });
  const H = http(app);
  const A = await H.signupShop('pgum'), B = await H.signupShop('pgdois');
  assert.equal((await H.req('/app/s/pgdois', { cookie: A.cookie })).status, 404);
  const a = (await publicShop(db, 'pgum'))!, b = (await publicShop(db, 'pgdois'))!;
  await assert.rejects(db.tenant(a.id, (q) => q.exec(`insert into services (shop_id, name, duration_min, price_cents) values ($1,'x',30,100)`, [b.id])), /row-level security/);
  const n = await db.tenant(a.id, (q) => q.one<{ n: number }>('select count(*) n from services'));
  assert.equal(typeof n!.n, 'number', 'contagens voltam como número, igual ao banco embutido');
  const ids = await firstIds(db, a.id);
  const mk = (i: number) => createBooking(db, a, { serviceIds: [ids.services[0].id], professionalId: ids.pros[0].id, startsAt: localToUtc(THU, 600, 'America/Sao_Paulo').toISOString(), name: 'Cliente ' + i, phone: '1190000000' + i }, { kind: 'customer' });
  const res = await Promise.allSettled([mk(1), mk(2)]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  await db.system((q) => q.exec(`update plans set price_cents = 4990 where id = 'essencial'`));
  const r = await H.req('/app/s/pgum/assinatura/contratar', { cookie: A.cookie, form: { plan: 'essencial' } });
  const body = await prov.settle(r.location.split('/').pop()!, 'confirmed');
  const hook = (bd: string) => app.request('/webhooks/billing/sandbox', { method: 'POST', body: bd, headers: { host: 'localhost', 'x-sandbox-signature': prov.sign(bd) } });
  assert.equal(((await (await hook(body)).json()) as any).result, 'applied:confirmed');
  assert.equal(((await (await hook(body)).json()) as any).result, 'duplicate');
  assert.ok(B.cookie);
});
