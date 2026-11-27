import { serve } from '@hono/node-server';
import { join, relative, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, openPgDb } from './db/db.ts';
import { createApp } from './app.ts';
import { ensureDemo } from './demo.ts';
import { providerFromEnv } from './billing/providers.ts';
import { sweep, reconcile } from './billing/billing.ts';
import { PLATFORM } from './lib/core.ts';
import { cleanupAuth } from './domain/accounts.ts';
import { backfillLinks } from './domain/booking.ts';
import { mailerFromEnv } from './lib/mail.ts';

const here = dirname(fileURLToPath(import.meta.url));
// DATABASE_URL = Postgres de verdade (recomendado para operação comercial). Sem ela, usa o banco embutido em DATA_DIR.
const db = process.env.DATABASE_URL
  ? await openPgDb(process.env.DATABASE_URL, { ssl: process.env.DATABASE_SSL !== '0', max: Number(process.env.DATABASE_POOL || 10) })
  : await openDb(process.env.DATA_DIR || join(here, '..', 'data', 'pg'));
console.log(db.kind === 'postgres' ? 'Banco: Postgres (DATABASE_URL)' : 'Banco: embutido (PGlite). Para operação comercial, configure DATABASE_URL.');
// DEMO=0 desliga a barbearia de demonstração (recomendado em produção, ou defina DEMO_PASSWORD)
const demo = process.env.DEMO === '0' ? null : await ensureDemo(db);
// ADMIN_EMAIL: quem administra a plataforma (útil onde não há terminal, como no plano grátis do Render).
// Só promove uma conta que já existe; crie a conta pelo site e reinicie.
if (process.env.ADMIN_EMAIL) {
  const n = await db.system((q) => q.exec('update users set is_platform_admin = true where email = $1 and not is_platform_admin', [process.env.ADMIN_EMAIL!.trim().toLowerCase()]));
  if (n) console.log('Administrador da plataforma definido por ADMIN_EMAIL.');
}
if (process.env.NODE_ENV === 'production' && !process.env.SUPPORT_EMAIL) console.warn('Atenção: defina SUPPORT_EMAIL. Sem ele, o site mostra um e-mail de suporte de exemplo.');
const filled = await backfillLinks(db);
if (filled) console.log(`${filled} horário(s) futuro(s) ganharam link para o cliente confirmar, remarcar ou cancelar.`);
// a senha só aparece no log quando foi gerada aqui; se veio de DEMO_PASSWORD, quem configurou já sabe
if (demo) console.log(process.env.DEMO_PASSWORD ? `Barbearia de demonstração criada. Painel: ${demo.email} (senha de DEMO_PASSWORD)` : `Barbearia de demonstração criada. Painel: ${demo.email} / ${demo.password} (guarde agora; não será mostrada de novo)`);

const billing = providerFromEnv(db);
console.log(billing ? `Cobrança: provedor "${billing.id}"${billing.id === 'sandbox' ? ' (simulador, nada é cobrado)' : ''}` : 'Cobrança: nenhum provedor configurado (contratação online desligada)');
// rotina de cobrança: fim de teste, renovações, atrasos e suspensões a cada 10 min; conciliação a cada hora
const runSweep = () => { sweep(db, billing).catch((e) => console.error('sweep', e)); cleanupAuth(db).catch((e) => console.error('limpeza de sessões', e)); };
setInterval(runSweep, 10 * 60_000).unref(); runSweep();
if (billing) setInterval(() => reconcile(db, billing).catch((e) => console.error('reconcile', e)), 60 * 60_000).unref();

// cópia de segurança diária do banco (guarda as 14 mais recentes). Em produção, BACKUP_DIR deve ficar no volume persistente.
// Com Postgres gerenciado, os backups ficam por conta do provedor.
if (process.env.BACKUP_DIR && db.kind === 'pglite') {
  const dir = process.env.BACKUP_DIR;
  const runBackup = async () => {
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `cadeira-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.tar.gz`);
      writeFileSync(file, await db.backup());
      const old = readdirSync(dir).filter((f) => f.startsWith('cadeira-') && f.endsWith('.tar.gz')).sort().slice(0, -14);
      for (const f of old) rmSync(join(dir, f));
      console.log('Backup salvo:', file);
    } catch (e) { console.error('backup falhou', e); }
  };
  setInterval(runBackup, 24 * 60 * 60_000).unref();
  setTimeout(runBackup, 60_000).unref();
}

const mailer = mailerFromEnv();
console.log(mailer.id === 'resend' ? 'E-mail: Resend' : 'E-mail: sem provedor (configure RESEND_API_KEY e MAIL_FROM para enviar recuperação de senha)');
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_HOST && !process.env.RENDER_EXTERNAL_HOSTNAME) console.warn('Atenção: defina PUBLIC_HOST (ex.: cadeira.app). Sem ele, os links por e-mail não são enviados.');
const app = createApp(db, {
  billing,
  mailer,
  secureCookies: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  // no Render, o endereço público vem pronto em RENDER_EXTERNAL_HOSTNAME (ex.: cadeira.onrender.com)
  publicHost: process.env.PUBLIC_HOST || process.env.RENDER_EXTERNAL_HOSTNAME,
  staticRoot: relative(process.cwd(), join(here, 'public')).replace(/\\/g, '/'),
});
const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, () => console.log(`${PLATFORM.name} rodando em http://localhost:${port}`));
const stop = async () => { await db.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
