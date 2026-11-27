import { openDb, type Db } from '../src/db/db.ts';
import { createApp } from '../src/app.ts';
import { clock, resetRateLimits } from '../src/lib/core.ts';

/** Quarta-feira, 2 de dezembro de 2026, 09:00 em São Paulo. */
export const NOW = new Date('2026-12-02T12:00:00Z');
export const THU = '2026-12-03';

export async function env(dataDir?: string) {
  clock.now = () => NOW;
  resetRateLimits();
  const db = await openDb(dataDir);
  const app = createApp(db);
  return { db, app, ...http(app) };
}

export function http(app: ReturnType<typeof createApp>) {
  async function req(path: string, o: { method?: string; cookie?: string; form?: Record<string, string | string[]>; headers?: Record<string, string> } = {}) {
    const body = o.form ? new URLSearchParams(Object.entries(o.form).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))) : undefined;
    const res = await app.request(path, { method: o.method ?? (o.form ? 'POST' : 'GET'), body, headers: { host: 'localhost', ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers } });
    return { res, status: res.status, text: await res.text(), location: res.headers.get('location') ?? '', cookies: res.headers.getSetCookie() };
  }
  /** Cria conta + barbearia pelo fluxo real de cadastro e devolve o cookie de sessão. */
  async function signupShop(slug: string, email = `${slug}@teste.com.br`) {
    const r = await req('/criar-conta', { form: { name: 'Dono ' + slug, email, password: 'senha-forte-123', shopName: 'Barbearia ' + slug, slug } });
    if (r.status !== 303) throw new Error('cadastro falhou: ' + r.status + r.text.slice(0, 300));
    const sid = r.cookies.find((c) => c.startsWith('sid='))!.split(';')[0];
    return { cookie: sid, slug };
  }
  async function loginAs(email: string, password: string) {
    const r = await req('/entrar', { form: { email, password } });
    const sid = r.cookies.find((c) => c.startsWith('sid='));
    if (!sid) throw new Error('login falhou: ' + r.status);
    return sid.split(';')[0];
  }
  return { req, signupShop, loginAs };
}

export async function shopRow(db: Db, slug: string) {
  return (await db.system((q) => q.one('select * from shops where slug = $1', [slug])))!;
}
export async function firstIds(db: Db, shopId: string) {
  return db.tenant(shopId, async (q) => ({
    services: (await q.all('select id, name, duration_min, price_cents from services order by sort')),
    pros: (await q.all('select id, name from professionals order by sort')),
  }));
}
