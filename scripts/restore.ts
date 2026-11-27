// Restaura uma cópia de segurança num diretório de dados NOVO (com o servidor parado).
// Uso: node scripts/restore.ts data/backups/cadeira-2026-12-01-03-00-00.tar.gz data/pg-restaurado
// Depois aponte DATA_DIR para o diretório restaurado e suba o servidor.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { openDb } from '../src/db/db.ts';

const [file, target] = process.argv.slice(2);
if (!file || !target) { console.error('Uso: node scripts/restore.ts <arquivo.tar.gz> <diretório-novo>'); process.exit(1); }
if (existsSync(target) && readdirSync(target).length) { console.error('O diretório de destino precisa estar vazio, para não sobrescrever dados.'); process.exit(1); }
const db = await openDb(target, new Blob([new Uint8Array(readFileSync(file))]));
const n = await db.system((q) => q.one('select (select count(*) from shops)::int shops, (select count(*) from users)::int users'));
console.log(`Restaurado em ${target}: ${n!.shops} barbearias, ${n!.users} usuários.`);
await db.close();
