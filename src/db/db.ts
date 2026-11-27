import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import pg from 'pg';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Row = Record<string, any>;
export interface Q {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}
export interface Db {
  /** Contexto de plataforma (sem RLS). Use só para autenticação, provisionamento e resolução de slug. */
  system<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  /** Contexto de um estabelecimento: RLS ativo, só enxerga linhas de shopId. */
  tenant<T>(shopId: string, fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Cópia completa do banco (compactada). Só no banco embutido; no Postgres gerenciado, use os backups do provedor. */
  backup(): Promise<Buffer>;
  kind: 'pglite' | 'postgres';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrations = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => [f, readFileSync(join(MIGRATIONS, f), 'utf8')] as const);

type Tx = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number; rowCount?: number | null }> };
const wrap = (tx: Tx): Q => ({
  async all(sql, params) { return (await tx.query(sql, params as any[])).rows; },
  async one(sql, params) { return (await tx.query(sql, params as any[])).rows[0]; },
  async exec(sql, params) { const r = await tx.query(sql, params as any[]); return r.affectedRows ?? r.rowCount ?? 0; },
});

/**
 * Banco embutido (PGlite). Bom para desenvolvimento, testes e começo de operação numa única instância.
 * O próprio projeto PGlite ainda se declara em fase inicial: para operação comercial, prefira DATABASE_URL (Postgres).
 * dataDir indefinido = banco em memória.
 */
export async function openDb(dataDir?: string, restoreFrom?: Blob): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  // Nesta versão do PGlite, extensões só carregam via PGlite.create({...}).
  const db = await PGlite.create({ dataDir, extensions: { btree_gist }, ...(restoreFrom ? { loadDataDir: restoreFrom } : {}) });
  await db.exec('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version));
  for (const [file, sql] of migrations()) {
    if (done.has(file)) continue;
    await db.transaction(async (tx) => { await tx.exec(sql); await tx.query('insert into schema_migrations (version) values ($1)', [file]); });
  }
  return {
    kind: 'pglite',
    system: (fn) => db.transaction((tx) => fn(wrap(tx))),
    tenant: (shopId, fn) => {
      if (!UUID.test(shopId)) throw new Error('shop id inválido');
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('app.shop_id', $1, true)`, [shopId]);
        await tx.query('set local role app_tenant');
        return fn(wrap(tx));
      });
    },
    close: () => db.close(),
    backup: async () => Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer()),
  };
}

// Mesmos tipos que o PGlite devolve: contagens (int8) como número.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Postgres de verdade (Neon, Supabase, RDS, Railway...): várias conexões, transações concorrentes e backups do provedor.
 * O mesmo SQL e as mesmas regras de RLS do banco embutido. O usuário da conexão precisa poder criar o papel app_tenant
 * e a extensão btree_gist (permitido nos provedores citados).
 */
export async function openPgDb(url: string, o: { max?: number; ssl?: boolean } = {}): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: o.max ?? 10, ssl: o.ssl ? { rejectUnauthorized: false } : undefined, idleTimeoutMillis: 30_000 });
  const tx = async <T>(fn: (q: Q) => Promise<T>, shopId?: string): Promise<T> => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (shopId) { await c.query(`select set_config('app.shop_id', $1, true)`, [shopId]); await c.query('set local role app_tenant'); }
      const r = await fn(wrap(c as unknown as Tx));
      await c.query('commit');
      return r;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
    finally { c.release(); }
  };
  // migrações com trava, para duas instâncias subindo juntas não aplicarem a mesma migração
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(727001)');
    await c.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version));
    for (const [file, sql] of migrations()) {
      if (done.has(file)) continue;
      await c.query('begin');
      try { await c.query(sql); await c.query('insert into schema_migrations (version) values ($1)', [file]); await c.query('commit'); }
      catch (e) { await c.query('rollback'); throw e; }
    }
  } finally { await c.query('select pg_advisory_unlock(727001)').catch(() => {}); c.release(); }
  return {
    kind: 'postgres',
    system: (fn) => tx(fn),
    tenant: (shopId, fn) => { if (!UUID.test(shopId)) throw new Error('shop id inválido'); return tx(fn, shopId); },
    close: () => pool.end(),
    backup: async () => { throw new Error('Com Postgres gerenciado, use os backups automáticos do provedor (ou pg_dump).'); },
  };
}
