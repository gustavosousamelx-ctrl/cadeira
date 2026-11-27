// Dá acesso à administração da plataforma a uma conta existente.
// Uso: node scripts/make-admin.ts email@exemplo.com   (com o servidor parado)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/db.ts';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('Informe o e-mail: node scripts/make-admin.ts voce@exemplo.com'); process.exit(1); }
const db = await openDb(process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pg'));
const u = await db.system((q) => q.one('update users set is_platform_admin = true where email = $1 returning id', [email]));
if (!u) { console.error('Nenhuma conta com esse e-mail. Crie a conta pelo site primeiro.'); process.exit(1); }
await db.system((q) => q.exec(`insert into audit_log (user_id, action, meta) values ($1,'admin.granted','{"via":"script"}')`, [u.id]));
console.log(`${email} agora é administrador da plataforma. Acesse /admin.`);
await db.close();
