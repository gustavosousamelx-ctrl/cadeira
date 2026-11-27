import { randomInt } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Ctx } from './accounts.ts';
import { must } from './accounts.ts';
import { clock, digits, invalid, notFound } from '../lib/core.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AWAY_DAYS = 45;

/** Lista de clientes com números reais: visitas atendidas, última visita, quanto já pagou (comandas) e faltas. */
export async function listCustomers(db: Db, ctx: Ctx, o: { q?: string; filtro?: string }) {
  must(ctx, 'customers.view');
  const q = String(o.q ?? '').trim().slice(0, 60);
  const p: unknown[] = [clock.now()];
  let where = `c.name <> 'Cliente removido'`;
  if (q) {
    p.push(`%${q.toLowerCase()}%`);
    const d = digits(q);
    if (d.length >= 3) { p.push(`%${d}%`); where += ` and (lower(c.name) like $2 or c.phone like $3)`; } else where += ` and lower(c.name) like $2`;
  }
  const rows = await db.tenant(ctx.shop.id, (x) => x.all(`select * from (
      select c.id, c.name, c.phone, c.created_at,
        count(b.id) filter (where b.status = 'completed')::int visits,
        count(b.id) filter (where b.status = 'no_show')::int noshows,
        max(b.starts_at) filter (where b.status = 'completed') last_visit,
        min(b.starts_at) filter (where b.status in ('confirmed','pending') and b.starts_at > $1) next_visit,
        coalesce((select sum(s.total_cents) from sales s where s.customer_id = c.id and s.status = 'paid'), 0)::int spent
      from customers c left join bookings b on b.customer_id = c.id where ${where} group by c.id) t
    order by coalesce(next_visit, last_visit, created_at) desc limit 300`, p));
  const away = new Date(clock.now().getTime() - AWAY_DAYS * 86_400_000);
  const tag = (r: any) => (r.next_visit ? 'agendado' : r.visits === 0 ? 'novo' : r.last_visit && new Date(r.last_visit) < away ? 'sumido' : 'ativo');
  const all = rows.map((r) => ({ ...r, tag: tag(r) }));
  const counts = { todos: all.length, sumido: all.filter((r) => r.tag === 'sumido').length, agendado: all.filter((r) => r.tag === 'agendado').length, novo: all.filter((r) => r.tag === 'novo').length };
  const f = ['sumido', 'agendado', 'novo'].includes(String(o.filtro)) ? String(o.filtro) : '';
  return { list: f ? all.filter((r) => r.tag === f) : all, counts, filtro: f, q };
}

export async function customerDetail(db: Db, ctx: Ctx, id: string, fullHistory = false) {
  must(ctx, 'customers.view');
  if (!UUID.test(id)) throw notFound();
  return db.tenant(ctx.shop.id, async (q) => {
    const c = await q.one('select id, name, phone, notes, created_at from customers where id = $1', [id]);
    if (!c) throw notFound('Cliente não encontrado.');
    c.bookings = await q.all(`select b.id, b.starts_at, b.status, b.price_cents, p.name pro_name, (select string_agg(i.name, ' + ' order by i.id) from booking_items i where i.booking_id = b.id) services
      from bookings b join professionals p on p.id = b.professional_id where b.customer_id = $1 order by b.starts_at desc, b.id ${fullHistory ? '' : 'limit 60'}`, [id]);
    const s = await q.one(`select coalesce(sum(total_cents),0)::int spent, count(*)::int n from sales where customer_id = $1 and status = 'paid'`, [id]);
    c.spent = s!.spent; c.salesN = s!.n;
    const stats = await q.one(`select count(*)::int total, count(*) filter (where status = 'completed')::int visits,
      count(*) filter (where status = 'no_show')::int noshows, min(starts_at) filter (where status = 'completed') first_visit,
      max(starts_at) filter (where status = 'completed') last_visit from bookings where customer_id = $1`, [id]);
    c.visits = stats!.visits; c.noshows = stats!.noshows; c.historySize = stats!.total;
    c.every = c.visits > 1 ? Math.round((new Date(stats!.last_visit).getTime() - new Date(stats!.first_visit).getTime()) / (c.visits - 1) / 86_400_000) : null;
    return c;
  });
}

export async function saveCustomer(db: Db, ctx: Ctx, id: string, f: Record<string, any>) {
  must(ctx, 'customers.view');
  if (!UUID.test(id)) throw notFound();
  const name = String(f.name ?? '').trim(), notes = String(f.notes ?? '').trim(), phone = digits(f.phone);
  if (name.length < 2 || name.length > 80) throw invalid('Informe o nome (2 a 80 letras).');
  if (!/^\d{10,11}$/.test(phone)) throw invalid('WhatsApp inválido. Use DDD + número.');
  if (notes.length > 1000) throw invalid('Anotação muito longa (até 1000 caracteres).');
  await db.tenant(ctx.shop.id, async (q) => {
    if (await q.one('select 1 from customers where phone = $1 and id <> $2', [phone, id])) throw invalid('Já existe outro cliente com esse WhatsApp.');
    if (!(await q.exec('update customers set name = $2, phone = $3, notes = $4 where id = $1', [id, name, phone, notes]))) throw notFound();
  });
}

/** LGPD: tudo que a barbearia guarda sobre a pessoa, em formato legível por máquina. */
export async function exportCustomer(db: Db, ctx: Ctx, id: string) {
  must(ctx, 'customers.privacy');
  const c = await customerDetail(db, ctx, id, true);
  await db.tenant(ctx.shop.id, (q) => q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id) values ($1,$2,'customer.exported','customer',$3)`, [ctx.shop.id, ctx.user.id, id]));
  return { estabelecimento: ctx.shop.name, gerado_em: clock.now().toISOString(), cliente: { nome: c.name, whatsapp: c.phone, anotacoes: c.notes, cadastrado_em: c.created_at },
    atendimentos: c.bookings.map((b: any) => ({ data: b.starts_at, servicos: b.services, profissional: b.pro_name, situacao: b.status, valor_centavos: b.price_cents })) };
}

/**
 * LGPD: apaga os dados pessoais mantendo o histórico financeiro e de agenda (anonimização).
 * Nome vira "Cliente removido", WhatsApp é trocado por um número inválido aleatório, anotações somem.
 */
export async function anonymizeCustomer(db: Db, ctx: Ctx, id: string) {
  must(ctx, 'customers.privacy');
  if (!UUID.test(id)) throw notFound();
  await db.tenant(ctx.shop.id, async (q) => {
    if (!(await q.one('select 1 from customers where id = $1', [id]))) throw notFound();
    const fut = await q.one(`select count(*)::int n from bookings where customer_id = $1 and status in ('pending','confirmed') and starts_at > $2`, [id, clock.now()]);
    if (fut!.n) throw invalid('Este cliente tem horário marcado. Cancele antes de apagar os dados.');
    const fake = '00' + Array.from({ length: 11 }, () => randomInt(10)).join('');
    await q.exec(`update customers set name = 'Cliente removido', phone = $2, notes = '' where id = $1`, [id, fake]);
    await q.exec('update bookings set contact_name = null where customer_id = $1', [id]);
    await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id) values ($1,$2,'customer.anonymized','customer',$3)`, [ctx.shop.id, ctx.user.id, id]);
  });
}
