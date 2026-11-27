import type { Db } from './db/db.ts';
import { provisionShop } from './domain/accounts.ts';
import { backfillLinks } from './domain/booking.ts';
import { hashPassword, newToken, localToUtc, toLocal, clock, addDays } from './lib/core.ts';

/**
 * Barbearia de demonstração (Navalha & Co.). Fica marcada com is_demo e aparece com aviso na página pública.
 * Os dados dela são separados dos estabelecimentos reais como qualquer outro tenant.
 */
export async function ensureDemo(db: Db, password = process.env.DEMO_PASSWORD) {
  if (await db.system((q) => q.one(`select 1 from shops where slug = 'navalha'`))) return null;
  const pw = password || newToken(9);
  const hash = await hashPassword(pw);
  const email = 'demo@navalha.exemplo';
  await db.system(async (q) => {
    const u = await q.one('insert into users (email, name, password_hash) values ($1,$2,$3) returning id', [email, 'Rafael Monteiro', hash]);
    const shop = await provisionShop(q, { name: 'Navalha & Co.', slug: 'navalha', ownerId: u!.id, ownerName: 'Rafael Monteiro', isDemo: true, planId: 'gestao' });
    const sid = shop.id;
    await q.exec(`update shops set published = true, theme = '{"preset":"oficio","accent":"vermelho"}', phone = '5511987654321', instagram = 'navalhaeco',
      address = 'Rua dos Pinheiros, 812 · Pinheiros, São Paulo', description = 'Barbearia clássica de bairro. Corte na tesoura ou máquina, barba com toalha quente.' where id = $1`, [sid]);
    await q.exec(`update professionals set title = 'Degradê e navalha', commission_pct = 50 where shop_id = $1`, [sid]);
    const p2 = await q.one(`insert into professionals (shop_id, name, title, commission_pct, sort) values ($1,'Diego Alves','Barba e visagismo',45,1) returning id`, [sid]);
    const p3 = await q.one(`insert into professionals (shop_id, name, title, commission_pct, sort) values ($1,'Thiago Rocha','Clássicos e infantil',40,2) returning id`, [sid]);
    await q.exec('delete from working_hours where shop_id = $1', [sid]);
    for (const wd of [2, 3, 4, 5]) { await q.exec('insert into working_hours (shop_id, weekday, start_min, end_min) values ($1,$2,540,720),($1,$2,780,1200)', [sid, wd]); }
    await q.exec('insert into working_hours (shop_id, weekday, start_min, end_min) values ($1,6,480,1080)', [sid]);
    // Thiago só trabalha de quarta a sábado à tarde
    for (const wd of [3, 4, 5, 6]) await q.exec('insert into working_hours (shop_id, professional_id, weekday, start_min, end_min) values ($1,$2,$3,780,1200)', [sid, p3!.id, wd]);
    await q.exec('delete from services where shop_id = $1', [sid]);
    const svcs: [string, string, number, number][] = [['Corte', 'Máquina ou tesoura, lavagem e finalização', 30, 4500], ['Corte e barba', 'O combo completo com toalha quente', 60, 7500], ['Barba', 'Toalha quente, navalha e balm', 30, 3500], ['Degradê navalhado', 'Fade com acabamento na navalha', 45, 5500], ['Sobrancelha', 'Limpeza com navalha', 15, 1500], ['Corte infantil', 'Até 12 anos', 30, 3500]];
    const ids: string[] = [];
    for (const [i, s] of svcs.entries()) ids.push((await q.one('insert into services (shop_id, name, description, duration_min, price_cents, sort) values ($1,$2,$3,$4,$5,$6) returning id', [sid, ...s, i]))!.id);
    // alguns horários de exemplo nos próximos dias, para a agenda não abrir vazia
    const pros = [(await q.one('select id from professionals where shop_id = $1 and sort = 0', [sid]))!.id, p2!.id];
    const names = ['Lucas Ferreira', 'Gabriel Souza', 'Matheus Lima', 'Caio Mendes', 'André Carvalho', 'Bruno Oliveira'];
    const today = toLocal(clock.now(), 'America/Sao_Paulo').date;
    let k = 0;
    for (let d = 0; d < 3; d++) {
      const date = addDays(today, d), wd = new Date(date + 'T12:00:00Z').getUTCDay();
      if (wd === 0 || wd === 1) continue;
      for (const [pi, t] of [[0, 600], [1, 660], [0, 840], [1, 900], [0, 960]] as const) {
        const si = k % 3, dur = svcs[si][2], price = svcs[si][3];
        const c = await q.one(`insert into customers (shop_id, name, phone) values ($1,$2,$3) on conflict (shop_id, phone) do update set phone = excluded.phone returning id`, [sid, names[k % names.length], '119' + String(70000000 + k * 1373).padStart(8, '0')]);
        const s = localToUtc(date, t, 'America/Sao_Paulo');
        const b = await q.one(`insert into bookings (shop_id, professional_id, customer_id, starts_at, ends_at, duration_min, price_cents, status, source) values ($1,$2,$3,$4,$5,$6,$7,$8,'staff') returning id`,
          [sid, pros[pi], c!.id, s, new Date(s.getTime() + dur * 60000), dur, price, s < clock.now() ? 'completed' : 'confirmed']);
        await q.exec('insert into booking_items (shop_id, booking_id, service_id, name, duration_min, price_cents) values ($1,$2,$3,$4,$5,$6)', [sid, b!.id, ids[si], svcs[si][0], dur, price]);
        await q.exec(`insert into booking_events (shop_id, booking_id, to_status, actor) values ($1,$2,'confirmed','system')`, [sid, b!.id]);
        k++;
      }
    }
  });
  await backfillLinks(db); // os horários de exemplo também ganham link para o cliente (lembrete, remarcar)
  return { email, password: pw };
}
