import { z } from 'zod';
import type { Db } from '../db/db.ts';
import type { Ctx } from './accounts.ts';
import { must } from './accounts.ts';
import { AppError, digits, invalid, isDate, localToUtc, notFound, parseHHMM } from '../lib/core.ts';
import { PRESETS } from './themes.ts';

const uuid = z.string().uuid();
/** Aceita "45", "45,90", "1.200,00" e "45.90". */
export const parseMoney = (s: string) => { s = s.replace(/[R$\s]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return Number.isFinite(n) && s !== '' ? Math.round(n * 100) : NaN; };
const money = z.string().trim().transform(parseMoney).pipe(z.number().int('Preço inválido.').min(0, 'Preço inválido.').max(10_000_000));
const first = (e: z.ZodError) => e.issues[0].message;
const audit = (q: any, ctx: Ctx, action: string, entity: string, id: string, meta: object = {}) =>
  q.exec('insert into audit_log (shop_id, user_id, action, entity, entity_id, meta) values ($1,$2,$3,$4,$5,$6)', [ctx.shop.id, ctx.user.id, action, entity, id, JSON.stringify(meta)]);

/* ---------- serviços ---------- */
const serviceSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto.').max(60),
  description: z.string().trim().max(140).default(''),
  duration: z.coerce.number().int().min(5).max(480).refine((n) => n % 5 === 0, 'Use múltiplos de 5 minutos.'),
  price: money,
});
export const listServices = (db: Db, shopId: string, onlyActive = false) =>
  db.tenant(shopId, (q) => q.all(`select id, name, description, duration_min, price_cents, active, sort from services ${onlyActive ? 'where active' : ''} order by active desc, sort, name`));
export async function saveService(db: Db, ctx: Ctx, id: string | null, raw: unknown) {
  must(ctx, 'catalog.manage');
  const p = serviceSchema.safeParse(raw); if (!p.success) throw invalid(first(p.error));
  const s = p.data;
  return db.tenant(ctx.shop.id, async (q) => {
    if (id) {
      if (!uuid.safeParse(id).success || !(await q.exec('update services set name=$2, description=$3, duration_min=$4, price_cents=$5 where id=$1', [id, s.name, s.description, s.duration, s.price]))) throw notFound();
      await audit(q, ctx, 'service.updated', 'service', id, { price_cents: s.price, duration_min: s.duration });
      return id;
    }
    const r = await q.one('insert into services (shop_id, name, description, duration_min, price_cents, sort) values ($1,$2,$3,$4,$5,(select coalesce(max(sort),0)+1 from services)) returning id', [ctx.shop.id, s.name, s.description, s.duration, s.price]);
    await audit(q, ctx, 'service.created', 'service', r!.id);
    return r!.id as string;
  });
}
/** Vários serviços de uma vez (primeiros passos): valida todos antes e grava tudo junto, ou nada. */
export async function saveServicesBulk(db: Db, ctx: Ctx, rows: { id: string; name: string; description?: string; duration: string; price: string }[]) {
  must(ctx, 'catalog.manage');
  if (rows.length > 60) throw invalid('Serviços demais de uma vez.');
  const parsed = rows.map((r) => {
    if (!uuid.safeParse(r.id).success) throw notFound();
    const p = serviceSchema.safeParse(r);
    if (!p.success) throw invalid(`${r.name || 'Serviço'}: ${first(p.error)}`);
    return { id: r.id, ...p.data };
  });
  return db.tenant(ctx.shop.id, async (q) => {
    for (const s of parsed) {
      const old = await q.one('select name, description, duration_min, price_cents from services where id = $1', [s.id]);
      if (!old) throw notFound();
      if (old.name === s.name && old.duration_min === s.duration && old.price_cents === s.price) continue; // só audita o que mudou
      await q.exec('update services set name=$2, duration_min=$3, price_cents=$4 where id=$1', [s.id, s.name, s.duration, s.price]);
      await audit(q, ctx, 'service.updated', 'service', s.id, { price_cents: s.price, duration_min: s.duration });
    }
    // conferir e manter os sugeridos também conta como etapa feita
    await audit(q, ctx, 'services.reviewed', 'service', ctx.shop.id, { count: parsed.length });
  });
}
/** Serviços não são apagados (o histórico de reservas aponta para eles): são arquivados. */
export async function setServiceActive(db: Db, ctx: Ctx, id: string, active: boolean) {
  must(ctx, 'catalog.manage');
  if (!uuid.safeParse(id).success) throw notFound();
  await db.tenant(ctx.shop.id, async (q) => {
    if (!active && Number((await q.one('select count(*) n from services where active and id <> $1', [id]))!.n) === 0) throw invalid('Mantenha pelo menos um serviço ativo.');
    if (!(await q.exec('update services set active = $2 where id = $1', [id, active]))) throw notFound();
    await audit(q, ctx, active ? 'service.restored' : 'service.archived', 'service', id);
  });
}

/* ---------- profissionais e escala ---------- */
const proSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto.').max(60),
  title: z.string().trim().max(60).default(''),
  commission: z.coerce.number().min(0).max(100).default(0),
});
export const listPros = (db: Db, shopId: string, onlyActive = false) =>
  db.tenant(shopId, (q) => q.all(`select id, name, title, commission_pct::float commission_pct, active from professionals ${onlyActive ? 'where active' : ''} order by active desc, sort, name`));
export async function savePro(db: Db, ctx: Ctx, id: string | null, raw: unknown) {
  must(ctx, 'team.manage');
  const p = proSchema.safeParse(raw); if (!p.success) throw invalid(first(p.error));
  const v = p.data;
  // checado antes de abrir a transação: o PGlite executa uma transação por vez (aninhar travaria)
  if (!id) await assertPlanAllowsPro(db, ctx);
  return db.tenant(ctx.shop.id, async (q) => {
    if (id) {
      if (!uuid.safeParse(id).success || !(await q.exec('update professionals set name=$2, title=$3, commission_pct=$4 where id=$1', [id, v.name, v.title, v.commission]))) throw notFound();
      await audit(q, ctx, 'professional.updated', 'professional', id, { commission_pct: v.commission });
      return id;
    }
    const r = await q.one('insert into professionals (shop_id, name, title, commission_pct, sort) values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from professionals)) returning id', [ctx.shop.id, v.name, v.title, v.commission]);
    await audit(q, ctx, 'professional.created', 'professional', r!.id);
    return r!.id as string;
  });
}
/** Limite de profissionais vem do plano da assinatura, lido no servidor. */
async function assertPlanAllowsPro(db: Db, ctx: Ctx) {
  const lim = await db.system((q) => q.one('select p.max_professionals, p.name from saas_subscriptions s join plans p on p.id = s.plan_id where s.shop_id = $1', [ctx.shop.id]));
  if (!lim || lim.max_professionals == null) return;
  const n = await db.tenant(ctx.shop.id, (q) => q.one('select count(*)::int n from professionals where active'));
  if (n!.n >= lim.max_professionals) throw new AppError(402, 'plan_limit', `O plano ${lim.name} permite até ${lim.max_professionals} profissionais ativos.`);
}
export async function setProActive(db: Db, ctx: Ctx, id: string, active: boolean) {
  must(ctx, 'team.manage');
  if (!uuid.safeParse(id).success) throw notFound();
  if (active) await assertPlanAllowsPro(db, ctx);
  await db.tenant(ctx.shop.id, async (q) => {
    if (!active) {
      const n = await q.one(`select count(*)::int n from bookings where professional_id = $1 and status in ('pending','confirmed') and starts_at > now()`, [id]);
      if (n!.n) throw invalid(`Esse profissional tem ${n!.n} horário(s) marcado(s). Remaneje ou cancele antes de desativar.`);
    }
    if (!(await q.exec('update professionals set active = $2 where id = $1', [id, active]))) throw notFound();
    await audit(q, ctx, active ? 'professional.activated' : 'professional.deactivated', 'professional', id);
  });
}

/* ---------- expediente ---------- */
/** Recebe por dia uma lista "09:00-12:00, 13:00-19:00" (vazio = fechado). professionalId nulo = horário da casa. */
export async function saveHours(db: Db, ctx: Ctx, professionalId: string | null, byDay: Record<string, string>, useShopHours = false) {
  must(ctx, professionalId ? 'team.manage' : 'catalog.manage');
  if (professionalId && !uuid.safeParse(professionalId).success) throw notFound();
  const rows: [number, number, number][] = [];
  if (!useShopHours) for (let wd = 0; wd < 7; wd++) {
    const txt = String(byDay[String(wd)] ?? '').trim();
    if (!txt) continue;
    const parts = txt.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const ivs = parts.map((s) => { const [a, b] = s.split(/\s*[-–a]\s*/); return [parseHHMM(a), parseHHMM(b)]; });
    for (const [a, b] of ivs) if (!(a < b)) throw invalid(`Horário inválido em ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][wd]}. Use o formato 09:00-19:00.`);
    ivs.sort((x, y) => x[0] - y[0]);
    for (let k = 1; k < ivs.length; k++) if (ivs[k][0] < ivs[k - 1][1]) throw invalid('Os intervalos de um mesmo dia não podem se sobrepor.');
    for (const [a, b] of ivs) rows.push([wd, a, b]);
  }
  await db.tenant(ctx.shop.id, async (q) => {
    if (professionalId && !(await q.one('select 1 from professionals where id = $1', [professionalId]))) throw notFound();
    await q.exec(`delete from working_hours where ${professionalId ? 'professional_id = $1' : 'professional_id is null'}`, professionalId ? [professionalId] : []);
    for (const [wd, a, b] of rows) await q.exec('insert into working_hours (shop_id, professional_id, weekday, start_min, end_min) values ($1,$2,$3,$4,$5)', [ctx.shop.id, professionalId, wd, a, b]);
    await audit(q, ctx, 'hours.updated', professionalId ? 'professional' : 'shop', professionalId || ctx.shop.id);
  });
}
export const getHours = (db: Db, shopId: string) => db.tenant(shopId, (q) => q.all('select professional_id, weekday, start_min, end_min from working_hours order by weekday, start_min'));

/* ---------- folgas e bloqueios ---------- */
const offSchema = z.object({
  professionalId: z.union([z.literal(''), uuid]).default(''),
  date: z.string().refine(isDate, 'Data inválida.'),
  start: z.string().default(''), end: z.string().default(''),
  reason: z.string().trim().max(80).default(''),
});
export async function addTimeOff(db: Db, ctx: Ctx, raw: unknown) {
  must(ctx, 'catalog.manage');
  const p = offSchema.safeParse(raw); if (!p.success) throw invalid(first(p.error));
  const v = p.data, tz = ctx.shop.timezone;
  const a = v.start ? parseHHMM(v.start) : 0, b = v.end ? parseHHMM(v.end) : 1440;
  if (!(a < b)) throw invalid('O fim precisa ser depois do início.');
  await db.tenant(ctx.shop.id, async (q) => {
    if (v.professionalId && !(await q.one('select 1 from professionals where id = $1', [v.professionalId]))) throw notFound('Profissional não encontrado.');
    const r = await q.one('insert into time_off (shop_id, professional_id, starts_at, ends_at, reason) values ($1,$2,$3,$4,$5) returning id', [ctx.shop.id, v.professionalId || null, localToUtc(v.date, a, tz), localToUtc(v.date, b, tz), v.reason]);
    await audit(q, ctx, 'timeoff.created', 'time_off', r!.id);
  });
}
export async function removeTimeOff(db: Db, ctx: Ctx, id: string) {
  must(ctx, 'catalog.manage');
  if (!uuid.safeParse(id).success) throw notFound();
  await db.tenant(ctx.shop.id, async (q) => { if (!(await q.exec('delete from time_off where id = $1', [id]))) throw notFound(); await audit(q, ctx, 'timeoff.deleted', 'time_off', id); });
}
export const upcomingTimeOff = (db: Db, shopId: string) => db.tenant(shopId, (q) => q.all('select t.id, t.starts_at, t.ends_at, t.reason, p.name pro from time_off t left join professionals p on p.id = t.professional_id where t.ends_at > now() order by t.starts_at limit 50'));

/* ---------- página pública e políticas ---------- */
const pageSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(400).default(''),
  address: z.string().trim().max(160).default(''),
  phone: z.string().transform(digits).pipe(z.string().max(13)),
  instagram: z.string().default(''),
  preset: z.string(), accent: z.string(),
  min_notice_min: z.coerce.number().int().min(0).max(2880),
  max_days_ahead: z.coerce.number().int().min(1).max(120),
  cancel_until_min: z.coerce.number().int().min(0).max(2880),
  slot_step_min: z.coerce.number().refine((n) => [10, 15, 20, 30].includes(n), 'Intervalo inválido.'),
});
export async function savePage(db: Db, ctx: Ctx, raw: any) {
  must(ctx, 'page.manage');
  const p = pageSchema.safeParse(raw); if (!p.success) throw invalid(first(p.error));
  const v = p.data;
  const ig = String(v.instagram || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9._]{0,30}$/.test(ig)) throw invalid('Instagram inválido. Use só o @usuário.');
  const preset = PRESETS[v.preset as keyof typeof PRESETS];
  if (!preset || !(v.accent in preset.accents)) throw invalid('Tema inválido.');
  const policy = { slot_step_min: v.slot_step_min, min_notice_min: v.min_notice_min, max_days_ahead: v.max_days_ahead, cancel_until_min: v.cancel_until_min };
  await db.tenant(ctx.shop.id, async (q) => {
    await q.exec('update shops set name=$2, description=$3, address=$4, phone=$5, instagram=$6, theme=$7, policy=$8 where id=$1', [ctx.shop.id, v.name, v.description, v.address, v.phone, ig, JSON.stringify({ preset: v.preset, accent: v.accent }), JSON.stringify(policy)]);
    await audit(q, ctx, 'page.updated', 'shop', ctx.shop.id);
  });
}
export async function setPublished(db: Db, ctx: Ctx, published: boolean) {
  must(ctx, 'page.manage');
  await db.tenant(ctx.shop.id, async (q) => {
    if (published) {
      const s = await q.one('select (select count(*) from services where active)::int s, (select count(*) from professionals where active)::int p, (select count(*) from working_hours)::int h');
      if (!s!.s || !s!.p || !s!.h) throw invalid('Antes de publicar, cadastre ao menos um serviço, um profissional e o horário de funcionamento.');
    }
    await q.exec('update shops set published = $2, onboarded_at = coalesce(onboarded_at, case when $2 then now() end) where id = $1', [ctx.shop.id, published]);
    await audit(q, ctx, published ? 'page.published' : 'page.unpublished', 'shop', ctx.shop.id);
  });
}
