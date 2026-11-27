import { z } from 'zod';
import type { Db, Q } from '../db/db.ts';
import type { Ctx, Shop } from './accounts.ts';
import { can, must } from './accounts.ts';
import { createHmac, randomUUID } from 'node:crypto';
import { AppError, addDays, clock, digits, forbidden, hhmm, invalid, isDate, localToUtc, notFound, sha256, toLocal, weekdayOf } from '../lib/core.ts';

const ACTIVE = `('pending','confirmed','completed')`;

/* ---------- link da reserva ----------
 * O link de cada reserva é HMAC(segredo, id): a barbearia consegue reenviá-lo num lembrete, e o banco guarda só o hash.
 * O segredo vem de APP_SECRET ou, sem ela, de platform_settings (gerado na migração 006). Lido fora de transação de tenant. */
const secrets = new WeakMap<Db, string>();
export async function linkSecret(db: Db): Promise<string> {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) return process.env.APP_SECRET;
  let s = secrets.get(db);
  if (!s) { s = String((await db.system((q) => q.one(`select value from platform_settings where key = 'link_secret'`)))?.value ?? ''); if (s.length < 32) throw new Error('link_secret ausente'); secrets.set(db, s); }
  return s;
}
export const manageToken = (secret: string, bookingId: string) => createHmac('sha256', secret).update('reserva:' + bookingId).digest('base64url').slice(0, 32);
/** Reservas futuras sem link (marcadas no balcão antes da migração 006, ou criadas direto no banco) ganham o link derivado.
 *  As que já têm link aleatório (feitas online antes) continuam com ele: o cliente pode ter guardado. Roda na subida do servidor. */
export async function backfillLinks(db: Db) {
  const secret = await linkSecret(db);
  return db.system(async (q) => {
    const rows = await q.all<{ id: string }>(`select id from bookings where manage_token_hash is null and status in ('pending','confirmed') and starts_at > now() - interval '1 day'`);
    for (const r of rows) await q.exec('update bookings set manage_token_hash = $2 where id = $1 and manage_token_hash is null', [r.id, sha256(manageToken(secret, r.id))]);
    return rows.length;
  });
}

export interface Quote { items: { id: string; name: string; duration_min: number; price_cents: number }[]; durationMin: number; priceCents: number }
export interface Slot { min: number; time: string; startsAt: string; professionalIds: string[] }

/** Preço e duração vêm sempre do banco, nunca do navegador. */
export async function quote(q: Q, serviceIds: string[]): Promise<Quote> {
  const ids = [...new Set(serviceIds)];
  if (!ids.length || ids.length > 5) throw invalid('Escolha de 1 a 5 serviços.');
  // id malformado (link antigo ou adulterado) vira mensagem, não erro de banco
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw invalid('Algum serviço escolhido não está mais disponível.');
  const rows = await q.all('select id, name, duration_min, price_cents, sort from services where id = any($1::uuid[]) and active order by sort, name', [ids]);
  if (rows.length !== ids.length) throw invalid('Algum serviço escolhido não está mais disponível.');
  return { items: rows as Quote['items'], durationMin: rows.reduce((s, r) => s + r.duration_min, 0), priceCents: rows.reduce((s, r) => s + r.price_cents, 0) };
}

/**
 * Disponibilidade calculada no servidor: expediente, escala individual, folgas/bloqueios, reservas, antecedência, fuso.
 * Carrega os dados do período uma vez (4 consultas) em vez de repetir por dia.
 */
export async function availabilityRange(q: Q, shop: Shop, o: { from: string; days: number; serviceIds: string[]; professionalId: string | 'any'; staff?: boolean; fixedDuration?: number; exceptBooking?: string }, now = clock.now()) {
  if (!isDate(o.from)) throw invalid('Data inválida.');
  const days = Math.max(1, Math.min(31, o.days));
  // remarcação usa a duração já combinada na reserva (o serviço pode ter mudado ou saído do cardápio)
  const qt: Quote = o.fixedDuration ? { items: [], durationMin: o.fixedDuration, priceCents: 0 } : await quote(q, o.serviceIds);
  const tz = shop.timezone, pol = shop.policy;
  const today = toLocal(now, tz).date;
  const pros = await q.all<{ id: string }>(`select id from professionals where active ${o.professionalId === 'any' ? '' : 'and id = $1'} order by sort, name`, o.professionalId === 'any' ? [] : [o.professionalId]);
  if (o.professionalId !== 'any' && !pros.length) throw notFound('Profissional não encontrado.');
  const hours = await q.all('select professional_id, weekday, start_min, end_min from working_hours order by start_min');
  const rStart = localToUtc(o.from, 0, tz), rEnd = localToUtc(addDays(o.from, days), 0, tz);
  const busy = await q.all(`select professional_id, starts_at, ends_at from bookings where status in ${ACTIVE} and starts_at < $2 and ends_at > $1 ${o.exceptBooking ? 'and id <> $3' : ''}`, o.exceptBooking ? [rStart, rEnd, o.exceptBooking] : [rStart, rEnd]);
  const off = await q.all('select professional_id, starts_at, ends_at from time_off where starts_at < $2 and ends_at > $1', [rStart, rEnd]);
  const earliest = now.getTime() + (o.staff ? 0 : pol.min_notice_min * 60_000);
  const step = pol.slot_step_min, dur = qt.durationMin;
  const blocksOf = new Map(pros.map((p) => [p.id, [...busy.filter((b) => b.professional_id === p.id), ...off.filter((b) => b.professional_id === p.id || b.professional_id === null)]
    .map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()])]));
  const out: { date: string; open: boolean; slots: Slot[] }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(o.from, i), wd = weekdayOf(date);
    const dayHours = hours.filter((h) => h.weekday === wd);
    const open = dayHours.length > 0;
    if (date < today || (!o.staff && date > addDays(today, pol.max_days_ahead))) { out.push({ date, open, slots: [] }); continue; }
    const byMin = new Map<number, string[]>();
    for (const p of pros) {
      const own = dayHours.filter((h) => h.professional_id === p.id);
      // escala própria em algum dia da semana substitui o horário da casa em todos os dias
      const hasOwn = hours.some((h) => h.professional_id === p.id);
      const intervals = hasOwn ? own : dayHours.filter((h) => h.professional_id === null);
      const blocks = blocksOf.get(p.id)!;
      for (const iv of intervals) {
        for (let t = Math.ceil(iv.start_min / step) * step; t + dur <= iv.end_min; t += step) {
          const s = localToUtc(date, t, tz).getTime(), e = s + dur * 60_000;
          if (s < earliest) continue;
          if (blocks.some(([bs, be]) => s < be && bs < e)) continue;
          byMin.set(t, [...(byMin.get(t) || []), p.id]);
        }
      }
    }
    out.push({ date, open, slots: [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([m, ids]) => ({ min: m, time: hhmm(m), startsAt: localToUtc(date, m, tz).toISOString(), professionalIds: ids })) });
  }
  return { ...qt, days: out };
}
export async function availability(q: Q, shop: Shop, o: { date: string; serviceIds: string[]; professionalId: string | 'any'; staff?: boolean }, now = clock.now()) {
  const r = await availabilityRange(q, shop, { from: o.date, days: 1, serviceIds: o.serviceIds, professionalId: o.professionalId, staff: o.staff }, now);
  return { items: r.items, durationMin: r.durationMin, priceCents: r.priceCents, slots: r.days[0].slots };
}

/* ---------- criação de reserva ---------- */
export const bookingSchema = z.object({
  serviceIds: z.array(z.string().uuid()).min(1).max(5),
  professionalId: z.union([z.literal('any'), z.string().uuid()]),
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, 'Informe o nome.').max(80),
  phone: z.string().transform(digits).pipe(z.string().regex(/^\d{10,11}$/, 'Informe o WhatsApp com DDD.')),
  requestKey: z.string().regex(/^[\w-]{16,64}$/).optional(),
});

export async function createBooking(db: Db, shop: Shop, raw: unknown, actor: { kind: 'customer' } | { kind: 'staff'; ctx: Ctx }) {
  const p = bookingSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  const i = p.data, staff = actor.kind === 'staff';
  if (staff) {
    const ctx = actor.ctx;
    if (!can(ctx, 'agenda.all') && !(i.professionalId === ctx.professionalId)) throw forbidden('Você só pode marcar na sua própria agenda.');
  }
  const startsAt = new Date(i.startsAt);
  const date = toLocal(startsAt, shop.timezone).date;
  // id gerado aqui para derivar o link da reserva antes de gravar (vale também para horários marcados pela equipe)
  const id = randomUUID(), token = manageToken(await linkSecret(db), id);
  return db.tenant(shop.id, async (q) => {
    // revalidação definitiva dentro da transação
    const av = await availability(q, shop, { date, serviceIds: i.serviceIds, professionalId: i.professionalId, staff }, clock.now());
    const slot = av.slots.find((s) => s.startsAt === startsAt.toISOString());
    const unavailable = () => new AppError(409, 'slot_unavailable', 'Esse horário acabou de ser ocupado. Escolha outro.', { alternatives: av.slots.filter((s) => Math.abs(s.min - toLocal(startsAt, shop.timezone).minutes) <= 120).slice(0, 6).map((s) => ({ time: s.time, startsAt: s.startsAt })) });
    if (!slot) throw unavailable();
    const cust = await q.one(
      staff ? 'insert into customers (shop_id, name, phone) values ($1,$2,$3) on conflict (shop_id, phone) do update set name = excluded.name returning id'
            : 'insert into customers (shop_id, name, phone) values ($1,$2,$3) on conflict (shop_id, phone) do update set phone = excluded.phone returning id',
      [shop.id, i.name, i.phone]);
    // "quem estiver livre": tenta o profissional com menos horários no dia
    let candidates = slot.professionalIds;
    if (i.professionalId === 'any' && candidates.length > 1) {
      const load = await q.all(`select professional_id, count(*)::int n from bookings where status in ${ACTIVE} and starts_at >= $1 and starts_at < $2 group by 1`, [localToUtc(date, 0, shop.timezone), localToUtc(addDays(date, 1), 0, shop.timezone)]);
      const n = (id: string) => load.find((l) => l.professional_id === id)?.n ?? 0;
      candidates = [...candidates].sort((a, b) => n(a) - n(b));
    }
    const endsAt = new Date(startsAt.getTime() + av.durationMin * 60_000);
    let booking: any;
    for (const pid of candidates) {
      await q.exec('savepoint try_slot');
      try {
        booking = await q.one(`insert into bookings (id, shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source, manage_token_hash, created_by, contact_name, request_key)
          values ($12,$1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$11,$13) returning id, professional_id, starts_at, ends_at, price_cents, duration_min, status`,
          [shop.id, pid, cust!.id, startsAt, endsAt, av.durationMin, av.priceCents, staff ? 'staff' : 'online', sha256(token), staff ? actor.ctx.user.id : null, i.name, id, i.requestKey ? sha256(i.requestKey) : null]);
        await q.exec('release savepoint try_slot');
        break;
      } catch (e: any) {
        await q.exec('rollback to savepoint try_slot');
        if (e.code !== '23P01') throw e; // 23P01 = violação da restrição de exclusão (horário sobreposto)
      }
    }
    if (!booking) throw unavailable();
    for (const it of av.items) await q.exec('insert into booking_items (shop_id, booking_id, service_id, name, duration_min, price_cents) values ($1,$2,$3,$4,$5,$6)', [shop.id, booking.id, it.id, it.name, it.duration_min, it.price_cents]);
    await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, actor_user_id) values ($1,$2,null,'confirmed',$3,$4)`, [shop.id, booking.id, staff ? 'staff' : 'customer', staff ? actor.ctx.user.id : null]);
    return { booking, token, items: av.items };
  });
}

/* ---------- mudanças de status ---------- */
export const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Atendido', no_show: 'Não veio', cancelled: 'Cancelado' };
export const TRANSITIONS: Record<string, string[]> = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'no_show', 'cancelled'], no_show: ['confirmed'], completed: [], cancelled: [] };

export async function changeStatus(db: Db, ctx: Ctx, bookingId: string, to: string, note?: string) {
  if (!z.string().uuid().safeParse(bookingId).success) throw notFound();
  return db.tenant(ctx.shop.id, async (q) => {
    const b = await q.one('select id, status, professional_id, starts_at from bookings where id = $1 for update', [bookingId]);
    if (!b) throw notFound('Agendamento não encontrado.');
    if (!can(ctx, 'agenda.all') && b.professional_id !== ctx.professionalId) throw notFound('Agendamento não encontrado.');
    if (!TRANSITIONS[b.status]?.includes(to)) throw invalid(`Não dá para mudar de “${STATUS_LABEL[b.status]}” para “${STATUS_LABEL[to] ?? to}”.`);
    if ((to === 'completed' || to === 'no_show') && new Date(b.starts_at).getTime() > clock.now().getTime() + 30 * 60_000) throw invalid('Só dá para marcar como atendido ou falta a partir de 30 minutos antes do horário.');
    try {
      await q.exec('savepoint st');
      await q.exec(`update bookings set status = $2, cancel_reason = $3, updated_at = now() where id = $1`, [b.id, to, to === 'cancelled' ? (note || 'Cancelado pela barbearia').slice(0, 140) : null]);
      await q.exec('release savepoint st');
    } catch (e: any) {
      await q.exec('rollback to savepoint st');
      if (e.code === '23P01') throw new AppError(409, 'slot_unavailable', 'Outro cliente já ocupa esse horário.');
      throw e;
    }
    await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, actor_user_id, note) values ($1,$2,$3,$4,'staff',$5,$6)`, [ctx.shop.id, b.id, b.status, to, ctx.user.id, note ?? null]);
    return to;
  });
}

/** Cancelamento pelo cliente: exige o token secreto do link da reserva (não basta saber o telefone). */
export async function findByToken(db: Db, shop: Shop, token: string): Promise<any> {
  if (!token || token.length > 64) return null;
  return db.tenant(shop.id, async (q) => {
    const b = await q.one(`select b.id, b.status, b.starts_at, b.ends_at, b.price_cents, b.duration_min, b.professional_id, b.client_confirmed_at, p.name pro_name, b.contact_name customer_name
      from bookings b join professionals p on p.id = b.professional_id join customers c on c.id = b.customer_id where b.manage_token_hash = $1`, [sha256(token)]);
    if (!b) return null;
    const items = await q.all('select name, price_cents, duration_min from booking_items where booking_id = $1', [b.id]);
    const ahead = new Date(b.starts_at).getTime() - clock.now().getTime();
    const open = ['pending', 'confirmed'].includes(b.status);
    // cancelar e remarcar seguem o mesmo prazo da política da casa
    const canCancel = open && ahead >= shop.policy.cancel_until_min * 60_000;
    return { ...b, items, canCancel, canChange: canCancel, canConfirm: open && ahead > 0 && !b.client_confirmed_at };
  });
}
const lateMsg = (shop: Shop, what: string) => `${what} online vai até ${shop.policy.cancel_until_min >= 1440 ? Math.round(shop.policy.cancel_until_min / 1440) + ' dia(s)' : shop.policy.cancel_until_min / 60 + 'h'} antes. Fale com a barbearia.`;
export async function cancelByCustomer(db: Db, shop: Shop, token: string) {
  const b = await findByToken(db, shop, token);
  if (!b) throw notFound('Reserva não encontrada.');
  if (!b.canCancel) throw invalid(b.status === 'cancelled' ? 'Esta reserva já foi cancelada.' : lateMsg(shop, 'O cancelamento'));
  await db.tenant(shop.id, async (q) => {
    await q.exec(`update bookings set status = 'cancelled', cancel_reason = 'Cancelado pelo cliente', updated_at = now() where id = $1 and status in ('pending','confirmed')`, [b.id]);
    await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor) values ($1,$2,$3,'cancelled','customer')`, [shop.id, b.id, b.status]);
  });
}
/** O cliente confirma presença pelo link (normalmente depois do lembrete). */
export async function confirmByCustomer(db: Db, shop: Shop, token: string) {
  const b = await findByToken(db, shop, token);
  if (!b) throw notFound('Reserva não encontrada.');
  if (b.client_confirmed_at) return;
  if (!b.canConfirm) throw invalid(b.status === 'cancelled' ? 'Esta reserva foi cancelada.' : 'Não dá mais para confirmar esta reserva.');
  await db.tenant(shop.id, async (q) => {
    const n = await q.exec(`update bookings set client_confirmed_at = now(), updated_at = now() where id = $1 and status in ('pending','confirmed') and client_confirmed_at is null`, [b.id]);
    if (n) await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, note) values ($1,$2,$3,$3,'customer','Cliente confirmou presença')`, [shop.id, b.id, b.status]);
  });
}
/** Horários para remarcar: mesmo profissional e mesma duração combinada; o próprio horário atual não conta como ocupado. */
export async function rescheduleOptions(db: Db, shop: Shop, b: any, from: string, days: number) {
  return db.tenant(shop.id, (q) => availabilityRange(q, shop, { from, days, serviceIds: [], professionalId: b.professional_id, fixedDuration: b.duration_min, exceptBooking: b.id }));
}
export async function rescheduleByCustomer(db: Db, shop: Shop, token: string, startsAtRaw: string) {
  const b = await findByToken(db, shop, token);
  if (!b) throw notFound('Reserva não encontrada.');
  if (!b.canChange) throw invalid(b.status === 'cancelled' ? 'Esta reserva foi cancelada.' : lateMsg(shop, 'A remarcação'));
  if (!startsAtRaw || Number.isNaN(Date.parse(startsAtRaw))) throw invalid('Escolha um horário.');
  const startsAt = new Date(startsAtRaw), tz = shop.timezone;
  const date = toLocal(startsAt, tz).date;
  return db.tenant(shop.id, async (q) => {
    const av = await availabilityRange(q, shop, { from: date, days: 1, serviceIds: [], professionalId: b.professional_id, fixedDuration: b.duration_min, exceptBooking: b.id });
    if (!av.days[0].slots.some((s) => s.startsAt === startsAt.toISOString())) throw new AppError(409, 'slot_unavailable', 'Esse horário acabou de ser ocupado. Escolha outro.');
    const old = toLocal(new Date(b.starts_at), tz);
    await q.exec('savepoint mv');
    try {
      const n = await q.exec(`update bookings set starts_at = $2, ends_at = $3, reminded_at = null, client_confirmed_at = null, updated_at = now() where id = $1 and status in ('pending','confirmed')`,
        [b.id, startsAt, new Date(startsAt.getTime() + b.duration_min * 60_000)]);
      if (!n) throw invalid('Esta reserva não pode mais ser remarcada.');
      await q.exec('release savepoint mv');
    } catch (e: any) {
      await q.exec('rollback to savepoint mv');
      if (e.code === '23P01') throw new AppError(409, 'slot_unavailable', 'Esse horário acabou de ser ocupado. Escolha outro.');
      throw e;
    }
    const nw = toLocal(startsAt, tz);
    await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, note) values ($1,$2,$3,$3,'customer',$4)`,
      [shop.id, b.id, b.status, `Remarcado pelo cliente: ${old.date.slice(8)}/${old.date.slice(5, 7)} ${hhmm(old.minutes)} → ${nw.date.slice(8)}/${nw.date.slice(5, 7)} ${hhmm(nw.minutes)}`]);
    return { startsAt };
  });
}

/* ---------- remarcação pela equipe (cliente ligou pedindo para mudar) ---------- */
async function staffBooking(q: Q, ctx: Ctx, bookingId: string) {
  if (!z.string().uuid().safeParse(bookingId).success) throw notFound();
  const b = await q.one(`select b.id, b.status, b.starts_at, b.duration_min, b.professional_id, coalesce(b.contact_name, c.name) customer
    from bookings b join customers c on c.id = b.customer_id where b.id = $1`, [bookingId]);
  if (!b || (!can(ctx, 'agenda.all') && b.professional_id !== ctx.professionalId)) throw notFound('Agendamento não encontrado.');
  if (!['pending', 'confirmed'].includes(b.status)) throw invalid('Só dá para mudar o horário de um agendamento marcado.');
  return b;
}
/** Horários para mudar: equipe não tem antecedência mínima nem limite de dias; pode trocar de profissional se vê a agenda de todos. */
export async function staffMoveOptions(db: Db, ctx: Ctx, bookingId: string, date: string, professionalId?: string) {
  must(ctx, 'agenda.own');
  return db.tenant(ctx.shop.id, async (q) => {
    const b = await staffBooking(q, ctx, bookingId);
    const pid = professionalId && can(ctx, 'agenda.all') ? professionalId : b.professional_id;
    const r = await availabilityRange(q, ctx.shop, { from: date, days: 1, serviceIds: [], professionalId: pid, staff: true, fixedDuration: b.duration_min, exceptBooking: b.id });
    return { booking: b, professionalId: pid, slots: r.days[0].slots };
  });
}
export async function rescheduleByStaff(db: Db, ctx: Ctx, bookingId: string, startsAtRaw: string, professionalId?: string) {
  must(ctx, 'agenda.own');
  if (!startsAtRaw || Number.isNaN(Date.parse(startsAtRaw))) throw invalid('Escolha um horário.');
  const startsAt = new Date(startsAtRaw), tz = ctx.shop.timezone;
  return db.tenant(ctx.shop.id, async (q) => {
    const b = await staffBooking(q, ctx, bookingId);
    const pid = professionalId && can(ctx, 'agenda.all') ? professionalId : b.professional_id;
    if (!z.string().uuid().safeParse(pid).success) throw invalid('Profissional inválido.');
    const av = await availabilityRange(q, ctx.shop, { from: toLocal(startsAt, tz).date, days: 1, serviceIds: [], professionalId: pid, staff: true, fixedDuration: b.duration_min, exceptBooking: b.id });
    if (!av.days[0].slots.some((s) => s.startsAt === startsAt.toISOString())) throw new AppError(409, 'slot_unavailable', 'Esse horário não está livre. Escolha outro.');
    await q.exec('savepoint mv');
    try {
      await q.exec(`update bookings set starts_at = $2, ends_at = $3, professional_id = $4, reminded_at = null, client_confirmed_at = null, updated_at = now() where id = $1`,
        [b.id, startsAt, new Date(startsAt.getTime() + b.duration_min * 60_000), pid]);
      await q.exec('release savepoint mv');
    } catch (e: any) {
      await q.exec('rollback to savepoint mv');
      if (e.code === '23P01') throw new AppError(409, 'slot_unavailable', 'Esse horário acabou de ser ocupado. Escolha outro.');
      throw e;
    }
    const old = toLocal(new Date(b.starts_at), tz), nw = toLocal(startsAt, tz);
    const proNote = pid !== b.professional_id ? ` com ${(await q.one('select name from professionals where id = $1', [pid]))?.name ?? 'outro profissional'}` : '';
    await q.exec(`insert into booking_events (shop_id, booking_id, from_status, to_status, actor, actor_user_id, note) values ($1,$2,$3,$3,'staff',$4,$5)`,
      [ctx.shop.id, b.id, b.status, ctx.user.id, `Horário mudado: ${old.date.slice(8)}/${old.date.slice(5, 7)} ${hhmm(old.minutes)} → ${nw.date.slice(8)}/${nw.date.slice(5, 7)} ${hhmm(nw.minutes)}${proNote}`]);
    return { startsAt };
  });
}

/* ---------- lembretes ---------- */
/** Reservas de um dia para lembrar por WhatsApp, com o link de cada uma (derivado, então funciona também para quem marcou pelo balcão). */
export async function remindersFor(db: Db, ctx: Ctx, date: string) {
  if (!isDate(date)) throw invalid('Data inválida.');
  must(ctx, 'agenda.own');
  const all = can(ctx, 'agenda.all'), tz = ctx.shop.timezone, secret = await linkSecret(db);
  return db.tenant(ctx.shop.id, async (q) => {
    const rows = await q.all(`select b.id, b.starts_at, b.status, b.reminded_at, b.client_confirmed_at, b.manage_token_hash, b.professional_id, coalesce(b.contact_name, c.name) customer, c.phone, p.name pro_name,
        (select string_agg(i.name, ' + ' order by i.id) from booking_items i where i.booking_id = b.id) services
      from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id
      where b.status in ('pending','confirmed') and b.starts_at >= $1 and b.starts_at < $2 ${all ? '' : 'and b.professional_id = $3'} order by b.starts_at`,
      all ? [localToUtc(date, 0, tz), localToUtc(addDays(date, 1), 0, tz)] : [localToUtc(date, 0, tz), localToUtc(addDays(date, 1), 0, tz), ctx.professionalId]);
    for (const r of rows) {
      r.token = manageToken(secret, r.id);
      // reservas antigas (link aleatório ou sem link) passam a usar o link derivado
      if (r.manage_token_hash !== sha256(r.token)) await q.exec('update bookings set manage_token_hash = $2 where id = $1', [r.id, sha256(r.token)]);
      delete r.manage_token_hash;
      r.startMin = toLocal(new Date(r.starts_at), tz).minutes;
    }
    return rows;
  });
}
export function reminderText(shop: Shop, r: { customer: string; starts_at: any; pro_name: string; services: string | null }, link: string) {
  const L = toLocal(new Date(r.starts_at), shop.timezone), today = toLocal(clock.now(), shop.timezone).date;
  const when = L.date === today ? 'hoje' : L.date === addDays(today, 1) ? 'amanhã' : `dia ${L.date.slice(8)}/${L.date.slice(5, 7)}`;
  return `Olá, ${r.customer.split(' ')[0]}! Passando para lembrar do seu horário ${when} às ${hhmm(L.minutes)} na ${shop.name}${r.services ? ` (${r.services})` : ''} com ${r.pro_name}.\n\nConfirme, remarque ou cancele por aqui: ${link}`;
}
export async function markReminded(db: Db, ctx: Ctx, bookingId: string) {
  if (!z.string().uuid().safeParse(bookingId).success) throw notFound();
  must(ctx, 'agenda.own');
  const secret = await linkSecret(db);
  return db.tenant(ctx.shop.id, async (q): Promise<{ id: string; phone: string; customer: string; starts_at: any; pro_name: string; services: string | null; token: string }> => {
    const b = await q.one<any>(`select b.id, b.professional_id, b.starts_at, b.manage_token_hash, coalesce(b.contact_name, c.name) customer, c.phone, p.name pro_name,
        (select string_agg(i.name, ' + ' order by i.id) from booking_items i where i.booking_id = b.id) services
      from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id where b.id = $1 and b.status in ('pending','confirmed')`, [bookingId]);
    if (!b || (!can(ctx, 'agenda.all') && b.professional_id !== ctx.professionalId)) throw notFound('Agendamento não encontrado.');
    const token = manageToken(secret, b.id);
    await q.exec('update bookings set reminded_at = now(), manage_token_hash = $2 where id = $1', [b.id, sha256(token)]);
    return { ...b, token };
  });
}
/** wa.me exige o número com DDI; os telefones do sistema são guardados com DDD (10–11 dígitos). */
export const waNumber = (phone: string) => (phone.length <= 11 ? '55' + phone : phone);

/* ---------- leitura da agenda ---------- */
export async function agendaDay(db: Db, ctx: Ctx, date: string) {
  if (!isDate(date)) throw invalid('Data inválida.');
  const tz = ctx.shop.timezone;
  const all = can(ctx, 'agenda.all');
  must(ctx, 'agenda.own');
  return db.tenant(ctx.shop.id, async (q) => {
    const pros = await q.all(`select id, name, title from professionals where active ${all ? '' : 'and id = $1'} order by sort, name`, all ? [] : [ctx.professionalId]);
    const rows = await q.all(`select b.id, b.professional_id, b.starts_at, b.ends_at, b.status, b.price_cents, b.duration_min, b.source, b.client_confirmed_at, b.reminded_at, c.name customer, c.phone,
        (select string_agg(i.name, ' + ' order by i.id) from booking_items i where i.booking_id = b.id) services
      from bookings b join customers c on c.id = b.customer_id
      where b.starts_at >= $1 and b.starts_at < $2 ${all ? '' : 'and b.professional_id = $3'} order by b.starts_at`,
      all ? [localToUtc(date, 0, tz), localToUtc(addDays(date, 1), 0, tz)] : [localToUtc(date, 0, tz), localToUtc(addDays(date, 1), 0, tz), ctx.professionalId]);
    const hours = await q.all('select professional_id, start_min, end_min from working_hours where weekday = $1 order by start_min', [weekdayOf(date)]);
    // quem tem escala própria não herda o horário da casa nos dias de folga
    const ownPros = (await q.all('select distinct professional_id from working_hours where professional_id is not null')).map((r) => r.professional_id as string);
    const off = await q.all('select id, professional_id, starts_at, ends_at, reason from time_off where starts_at < $2 and ends_at > $1', [localToUtc(date, 0, tz), localToUtc(addDays(date, 1), 0, tz)]);
    return { pros, bookings: rows.map((r) => ({ ...r, startMin: toLocal(new Date(r.starts_at), tz).minutes })), hours, off, ownPros };
  });
}
