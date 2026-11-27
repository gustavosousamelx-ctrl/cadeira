import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

/* ---------- configuração ---------- */
export const PLATFORM = {
  // Marca provisória da plataforma. Trocar aqui (ou via env) muda todo o site comercial e o painel.
  name: process.env.PLATFORM_NAME || 'Cadeira',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  supportPhone: process.env.SUPPORT_WHATSAPP || '',
};
export const RESERVED_SLUGS = new Set(['app', 'api', 'admin', 'b', 'static', 'entrar', 'sair', 'criar-conta', 'planos', 'ajuda', 'suporte', 'termos', 'privacidade', 'www', 'demo']);

/** Relógio injetável: testes fixam o "agora". */
export const clock = { now: () => new Date() };

/* ---------- erros de domínio ---------- */
export class AppError extends Error {
  status: number; code: string; extra?: unknown;
  constructor(status: number, code: string, message: string, extra?: unknown) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const notFound = (m = 'Não encontrado.') => new AppError(404, 'not_found', m);
export const forbidden = (m = 'Você não tem permissão para isso.') => new AppError(403, 'forbidden', m);
export const invalid = (m: string, extra?: unknown) => new AppError(422, 'invalid', m, extra);

/* ---------- senhas, tokens ---------- */
const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64url'), 32, SCRYPT);
  const want = Buffer.from(k, 'base64url');
  return want.length === key.length && timingSafeEqual(want, key);
}
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

/* ---------- fuso horário (horário local do estabelecimento <-> UTC) ---------- */
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); dtfCache.set(tz, f); }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function toLocal(d: Date, tz: string) {
  const p = Object.fromEntries(dtf(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, weekday: WD[p.weekday], offsetMin: (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000 };
}
/** Data local (YYYY-MM-DD) + minutos desde a meia-noite local -> instante UTC. */
export function localToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - toLocal(new Date(guess), tz).offsetMin * 60000;
  const off2 = toLocal(new Date(t), tz).offsetMin;
  t = guess - off2 * 60000;
  return new Date(t);
}
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export function addDays(date: string, n: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const parseHHMM = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); if (!m) return NaN; const v = +m[1] * 60 + +m[2]; return +m[2] < 60 && v <= 1440 ? v : NaN; };

/* ---------- formatação ---------- */
export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export function fmtPhone(p: string) { p = digits(p); if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`; if (p.length === 10) return `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`; return p; }
export function slugify(s: string) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

/* ---------- limite de requisições (memória; trocar por Redis com várias instâncias) ---------- */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now(), b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++b.n > max) throw new AppError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
}
export const resetRateLimits = () => buckets.clear();
