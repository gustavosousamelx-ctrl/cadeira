import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import type { Db } from './db/db.ts';
import { AppError, PLATFORM, clock, rateLimit, slugify, toLocal, notFound, addDays, digits, isDate, localToUtc } from './lib/core.ts';

/** O campo de cliente sugere "Nome — (11) 98765-4321": separa nome e telefone quando o cliente vem da lista. */
function splitPick(name: string, phone: string): [string, string] {
  const i = name.indexOf(' — ');
  if (i < 0) return [name, phone];
  return [name.slice(0, i).trim(), digits(phone) ? phone : digits(name.slice(i + 3))];
}
import { signup, login, logout, userFromSession, contextFor, shopsOf, publicShop, createSession, grantStaffAccess, can, must, requestPasswordReset, resetTokenValid, resetPassword, type User, type Ctx } from './domain/accounts.ts';
import { mailerFromEnv, type Mailer } from './lib/mail.ts';
import { ICON_SVG } from './web/html.ts';
import { availability, availabilityRange, quote, createBooking, changeStatus, agendaDay, findByToken, cancelByCustomer, confirmByCustomer, rescheduleOptions, rescheduleByCustomer, staffMoveOptions, rescheduleByStaff, manageToken, linkSecret, remindersFor, markReminded, reminderText, waNumber } from './domain/booking.ts';
import { listServices, saveService, saveServicesBulk, setServiceActive, listPros, savePro, setProActive, saveHours, getHours, addTimeOff, removeTimeOff, upcomingTimeOff, savePage, setPublished } from './domain/catalog.ts';
import * as site from './web/site.ts';
import * as panel from './web/panel.ts';
import * as shopView from './web/shop.ts';
import * as billingView from './web/billing.ts';
import * as adminView from './web/admin.ts';
import type { BillingProvider } from './billing/providers.ts';
import { providerFromEnv } from './billing/providers.ts';
import { entitlement, loadSub, startCheckout, changePlan, cancelSubscription, resumeSubscription, handleWebhook, reconcile, paymentsOf, activePlans, type Entitlement } from './billing/billing.ts';
import * as admin from './domain/admin.ts';
import * as ops from './web/ops.ts';
import { checkoutData, createSale, voidSale, cashDay, closeCash, monthReport, planHas } from './domain/sales.ts';
import { listCustomers, customerDetail, saveCustomer, exportCustomer, anonymizeCustomer } from './domain/customers.ts';

type Env = { Variables: { user: User | null } };
type C = Context<Env>;
export interface AppOptions { secureCookies?: boolean; trustProxy?: boolean; publicHost?: string; staticRoot?: string; billing?: BillingProvider | null; mailer?: Mailer }
/** Painel bloqueado (teste encerrado, assinatura suspensa): só a tela de assinatura continua acessível. */
class Blocked extends Error { ctx: Ctx; constructor(ctx: Ctx) { super('blocked'); this.ctx = ctx; } }

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = new Hono<Env>();
  // HTML e CSS comprimidos (gzip/br): páginas carregam mais rápido no 4G
  app.use('*', compress());
  // corpo de requisição limitado: nenhum formulário do sistema chega perto de 64 KB
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.text('Requisição grande demais.', 413) }));
  if (opts.staticRoot) app.use('/static/*', serveStatic({ root: opts.staticRoot, rewriteRequestPath: (p) => p.replace(/^\/static/, ''), onFound: (_p, c) => {
    // CSS e JS levam ?v= (muda a cada publicação): podem ficar em cache por um ano. Imagens, um dia.
    c.header('Cache-Control', c.req.query('v') ? 'public, max-age=31536000, immutable' : /\.(jpg|png|webp|svg)$/.test(c.req.path) ? 'public, max-age=86400' : 'public, max-age=300');
  } }));

  /* ---------- segurança transversal ---------- */
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      // CSRF: além de SameSite=Lax, recusa POST vindo de outra origem
      const origin = c.req.header('origin'), site = c.req.header('sec-fetch-site');
      const host = c.req.header('host');
      if ((origin && origin !== 'null' && host && new URL(origin).host !== host) || site === 'cross-site') return c.text('Origem não permitida.', 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    // HTTPS obrigatório por 1 ano depois da primeira visita (só em produção, onde há HTTPS)
    if (opts.secureCookies) c.header('Strict-Transport-Security', 'max-age=31536000');
    if (!c.res.headers.get('Referrer-Policy')) c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; form-action 'self' https://wa.me https://api.whatsapp.com; frame-ancestors 'none'; base-uri 'none'");
  });
  app.use('*', async (c, next) => { c.set('user', await userFromSession(db, getCookie(c, 'sid'))); await next(); });

  const ip = (c: C) => {
    if (opts.trustProxy) { const f = c.req.header('x-forwarded-for'); if (f) return f.split(',')[0].trim(); }
    try { return getConnInfo(c).remote.address ?? 'local'; } catch { return 'local'; }
  };
  const cookie = { httpOnly: true, sameSite: 'Lax' as const, secure: !!opts.secureCookies, path: '/' };
  const setSession = (c: C, token: string) => setCookie(c, 'sid', token, { ...cookie, maxAge: 30 * 86400 });
  type Flash = { ok?: string; err?: string };
  const go = (c: C, url: string, f?: Flash) => { if (f) setCookie(c, 'f', Buffer.from(JSON.stringify(f)).toString('base64url'), { ...cookie, maxAge: 60 }); return c.redirect(url, 303); };
  const takeFlash = (c: C): Flash => { const v = getCookie(c, 'f'); if (!v) return {}; deleteCookie(c, 'f', { path: '/' }); try { const o = JSON.parse(Buffer.from(v, 'base64url').toString()); return { ok: typeof o.ok === 'string' ? o.ok : undefined, err: typeof o.err === 'string' ? o.err.slice(0, 300) : undefined }; } catch { return {}; } };
  const form = async (c: C) => { const b = await c.req.parseBody({ all: true }); const o: Record<string, any> = {}; for (const [k, v] of Object.entries(b)) o[k] = Array.isArray(v) ? v.map(String) : String(v); return o; };
  /** Converte o editor de semana (o/a/b/pa/pb por dia) no formato de intervalos; aceita também d0..d6 em texto. */
  const hoursFromForm = (f: Record<string, any>) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => {
    if (f['d' + d] !== undefined) return [String(d), f['d' + d]];
    if (f['o' + d] !== '1') return [String(d), ''];
    const a = f['a' + d], b = f['b' + d], pa = f['pa' + d], pb = f['pb' + d];
    return [String(d), pa && pb ? `${a}-${pa}, ${pb}-${b}` : `${a}-${b}`];
  }));
  /** Destino depois de salvar: o onboarding manda "_next"; só aceita caminhos do próprio painel (sem redirecionamento aberto). */
  const nx = (ctx: Ctx, f: Record<string, any>, fallback: string) => { const n = String(f?._next ?? ''); return n.startsWith(`/app/s/${ctx.shop.slug}/`) && !n.includes('//') && !/[\r\n\\]/.test(n) ? n : fallback; };
  const host = (c: C) => opts.publicHost || c.req.header('host') || 'localhost';
  /** Endereço completo para links enviados fora do sistema (WhatsApp, e-mail). Em produção, PUBLIC_HOST evita depender do cabeçalho Host. */
  const abs = (c: C, path: string) => `${opts.publicHost || opts.secureCookies ? 'https' : new URL(c.req.url).protocol.replace(':', '')}://${host(c)}${path}`;

  const prov = opts.billing === undefined ? providerFromEnv(db) : opts.billing;
  const mailer = opts.mailer ?? mailerFromEnv();
  app.onError((e, c) => {
    if (e instanceof Blocked) return c.html(billingView.blockedPage(e.ctx, !!prov), 402);
    if (e instanceof AppError) {
      const back = c.req.header('referer');
      if (c.req.method === 'POST' && back && c.req.path.startsWith('/app/')) { try { const u = new URL(back); if (u.host === c.req.header('host')) return go(c as C, u.pathname + u.search, { err: e.message }); } catch { /* segue */ } }
      return c.html(site.errorPage(e.status, e.message), e.status as any);
    }
    console.error(e);
    return c.html(site.errorPage(500, 'Tente de novo em instantes.'), 500);
  });
  app.notFound((c) => c.html(site.errorPage(404, 'O endereço pode estar errado ou a página foi removida.'), 404));

  /* ---------- site da plataforma ---------- */
  app.get('/', async (c) => {
    const p = await db.system((q) => q.one(`select trial_days from plans where id = 'profissional'`));
    return c.html(site.home({ trialDays: p?.trial_days ?? 14, user: !!c.get('user'), plans: await activePlans(db) }));
  });
  app.get('/entrar', (c) => c.get('user') ? c.redirect('/app') : c.html(site.loginPage({ ok: c.req.query('senha') === '1' ? 'Senha alterada. Entre com a senha nova.' : undefined })));

  /* recuperação de senha */
  // o link vai por e-mail: em produção sai sempre de PUBLIC_HOST, nunca do cabeçalho Host (que um atacante controla)
  const mailBase = (c: C) => opts.publicHost ? `https://${opts.publicHost}` : opts.secureCookies ? null : abs(c, '');
  /** Aviso ao dono e gerentes quando o cliente mexe na agenda pela página (sem bloquear a resposta ao cliente). */
  async function notifyShop(c: C, shop: any, what: 'novo' | 'remarcado' | 'cancelado', bookingId: string) {
    if (shop.notify_email === false) return;
    const base = mailBase(c); if (!base) return;
    try {
      const b = await db.tenant(shop.id, (q) => q.one(`select b.starts_at, coalesce(b.contact_name, c.name) customer, p.name pro,
          (select string_agg(i.name, ' + ' order by i.id) from booking_items i where i.booking_id = b.id) services
        from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id where b.id = $1`, [bookingId]));
      if (!b) return;
      const L = toLocal(new Date(b.starts_at), shop.timezone), when = `${L.date.slice(8)}/${L.date.slice(5, 7)} às ${String(Math.floor(L.minutes / 60)).padStart(2, '0')}:${String(L.minutes % 60).padStart(2, '0')}`;
      const title = { novo: 'Novo horário pela página', remarcado: 'Cliente remarcou', cancelado: 'Cliente cancelou' }[what];
      const to = await db.system((q) => q.all(`select u.email from memberships m join users u on u.id = m.user_id where m.shop_id = $1 and m.role in ('owner','manager')`, [shop.id]));
      for (const r of to) void mailer.send({ to: r.email, subject: `${title}: ${b.customer}, ${when}`,
        text: `${title} na ${shop.name}.\n\n${b.customer} · ${b.services ?? ''} · ${when} com ${b.pro}${what === 'cancelado' ? '\nO horário já voltou a ficar livre na agenda.' : ''}\n\nVer no painel: ${base}/app/s/${shop.slug}/reserva/${bookingId}\n\nPara não receber estes avisos: Página pública → Avisar por e-mail.` }).catch((e) => console.error('aviso por e-mail falhou', e));
    } catch (e) { console.error('aviso por e-mail', e); }
  }
  app.get('/esqueci', (c) => c.html(site.forgotPage({})));
  app.post('/esqueci', async (c) => {
    const f = await form(c);
    try {
      const r = await requestPasswordReset(db, f.email, ip(c));
      if (r) {
        const base = mailBase(c);
        if (!base) console.error('PUBLIC_HOST não configurado: link de recuperação de senha não enviado.');
        // sem await: o tempo de resposta não revela se o e-mail tem conta
        else void mailer.send({ to: r.email, subject: `Sua senha no ${PLATFORM.name}`, text: `Olá, ${r.name.split(' ')[0]}.\n\nPara criar uma senha nova, abra o link abaixo. Ele vale por 1 hora e funciona uma vez só.\n\n${base}/redefinir/${r.token}\n\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.\n\n${PLATFORM.name}` }).catch((e) => console.error('e-mail falhou', e));
      }
      return c.html(site.forgotPage({ sent: true }));
    } catch (e) { if (e instanceof AppError) return c.html(site.forgotPage({ email: f.email, error: e.message }), e.status as any); throw e; }
  });
  app.get('/redefinir/:token', async (c) => {
    c.header('Referrer-Policy', 'no-referrer'); c.header('Cache-Control', 'no-store');
    const token = c.req.param('token');
    return c.html(site.resetPage({ token, valid: await resetTokenValid(db, token) }));
  });
  app.post('/redefinir/:token', async (c) => {
    c.header('Referrer-Policy', 'no-referrer'); c.header('Cache-Control', 'no-store');
    const token = c.req.param('token'), f = await form(c);
    try {
      rateLimit(`reset-use:${ip(c)}`, 20, 15 * 60_000);
      const u = await resetPassword(db, token, f.password, f.confirm);
      void mailer.send({ to: u.email, subject: `Sua senha do ${PLATFORM.name} foi alterada`, text: `Olá, ${u.name.split(' ')[0]}.\n\nA senha da sua conta acabou de ser alterada e todas as sessões abertas foram encerradas.\n\nSe não foi você, responda este e-mail ou fale com ${PLATFORM.supportEmail} agora.\n\n${PLATFORM.name}` }).catch((e) => console.error('e-mail falhou', e));
      deleteCookie(c, 'sid', { path: '/' });
      return c.redirect('/entrar?senha=1', 303);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return c.html(site.resetPage({ token, valid: await resetTokenValid(db, token), error: e.message }), e.status as any);
    }
  });
  app.post('/entrar', async (c) => {
    const f = await form(c);
    try { setSession(c, await login(db, f.email, f.password, ip(c))); return go(c, '/app'); }
    catch (e) { if (e instanceof AppError) return c.html(site.loginPage({ email: f.email, error: e.message }), e.status as any); throw e; }
  });
  app.get('/criar-conta', (c) => c.html(site.signupPage({ host: host(c) })));
  app.post('/criar-conta', async (c) => {
    const f = await form(c);
    if (!f.slug && f.shopName) f.slug = slugify(f.shopName);
    try {
      rateLimit(`signup:${ip(c)}`, 5, 60 * 60_000);
      const { user, shop } = await signup(db, f);
      setSession(c, await createSession(db, user.id));
      return go(c, `/app/s/${shop.slug}/comecar`, { ok: 'welcome' });
    } catch (e) {
      if (e instanceof AppError) return c.html(site.signupPage({ v: { ...f, password: '' }, errors: (e.extra as any) ?? {}, error: e.message, host: host(c) }), e.status as any);
      throw e;
    }
  });
  app.post('/sair', async (c) => { const t = getCookie(c, 'sid'); if (t) await logout(db, t); deleteCookie(c, 'sid', { path: '/' }); return c.redirect('/', 303); });

  /* ---------- painel do estabelecimento ---------- */
  app.use('/app/*', async (c, next) => { if (!c.get('user')) return c.redirect('/entrar'); await next(); });
  app.get('/app', async (c) => {
    const shops = await shopsOf(db, c.get('user')!.id);
    return shops.length === 1 ? c.redirect(`/app/s/${shops[0].slug}`) : c.html(site.choosePage(shops));
  });
  const ctxOf = async (c: C) => {
    const ctx = await contextFor(db, c.get('user')!, c.req.param('slug')!);
    ctx.ent = entitlement(await loadSub(db, ctx.shop.id), ctx.shop.is_demo);
    if (!ctx.ent.ok && !/\/assinatura(\/|$)|\/menu$/.test(c.req.path)) throw new Blocked(ctx);
    return ctx;
  };
  const today = (ctx: Ctx) => toLocal(clock.now(), ctx.shop.timezone).date;
  const P = (path: string) => `/app/s/:slug${path}`;

  app.get(P(''), async (c) => {
    const ctx = await ctxOf(c), date = today(ctx);
    const day = await agendaDay(db, ctx, date);
    const svcs = await listServices(db, ctx.shop.id, true);
    const shortest = [...svcs].sort((a, b) => a.duration_min - b.duration_min)[0];
    const nextFree = shortest ? await db.tenant(ctx.shop.id, async (q) => Promise.all(day.pros.map(async (p: any) => {
      const av = await availability(q, ctx.shop, { date, serviceIds: [shortest.id], professionalId: p.id, staff: true });
      return { name: p.name, time: av.slots[0]?.time ?? null };
    }))) : [];
    let checklist = null;
    if (!ctx.shop.published && can(ctx, 'page.manage')) {
      const acts = new Set((await db.tenant(ctx.shop.id, (q) => q.all('select distinct action from audit_log'))).map((r) => r.action));
      const b = `/app/s/${ctx.shop.slug}`;
      checklist = [
        { label: 'Conferir o horário de funcionamento', done: acts.has('hours.updated'), href: `${b}/comecar?passo=1` },
        { label: 'Ajustar serviços e preços', done: acts.has('service.updated') || acts.has('service.created') || acts.has('services.reviewed'), href: `${b}/comecar?passo=2` },
        { label: 'Cadastrar a equipe e as comissões', done: acts.has('professional.updated') || acts.has('professional.created'), href: `${b}/comecar?passo=3` },
        { label: 'Escolher a aparência da página', done: acts.has('page.updated'), href: `${b}/comecar?passo=4` },
        { label: 'Publicar a página de agendamento', done: false, href: `${b}/comecar?passo=5` },
      ];
    }
    return c.html(panel.todayPage(ctx, { date, day, nextFree, checklist }, takeFlash(c)));
  });
  app.get(P('/menu'), async (c) => c.html(panel.menuPage(await ctxOf(c))));

  app.get(P('/agenda'), async (c) => {
    const ctx = await ctxOf(c);
    let date = c.req.query('date') || today(ctx);
    if (!isDate(date)) date = today(ctx);
    // faixa da semana (segunda a domingo) com o número de horários de cada dia
    const wd = new Date(date + 'T12:00:00Z').getUTCDay(), monday = addDays(date, -((wd + 6) % 7)), tz = ctx.shop.timezone;
    const all = can(ctx, 'agenda.all');
    const rows = await db.tenant(ctx.shop.id, (q) => q.all(`select starts_at from bookings where status <> 'cancelled' and starts_at >= $1 and starts_at < $2 ${all ? '' : 'and professional_id = $3'}`,
      all ? [localToUtc(monday, 0, tz), localToUtc(addDays(monday, 7), 0, tz)] : [localToUtc(monday, 0, tz), localToUtc(addDays(monday, 7), 0, tz), ctx.professionalId]));
    const week = Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return { date: d, n: rows.filter((r) => toLocal(new Date(r.starts_at), tz).date === d).length }; });
    return c.html(panel.agendaPage(ctx, date, await agendaDay(db, ctx, date), takeFlash(c), week));
  });
  app.get(P('/reserva/:id'), async (c) => {
    const ctx = await ctxOf(c), id = c.req.param('id')!;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const b = await db.tenant(ctx.shop.id, async (q) => {
      const b = await q.one('select b.id, b.professional_id, b.customer_id, b.starts_at, b.ends_at, b.duration_min, b.price_cents, b.status, b.source, b.cancel_reason, b.contact_name, b.reminded_at, b.client_confirmed_at, c.name customer, c.phone, p.name pro_name from bookings b join customers c on c.id = b.customer_id join professionals p on p.id = b.professional_id where b.id = $1', [id]);
      if (!b || (!can(ctx, 'agenda.all') && b.professional_id !== ctx.professionalId)) return null;
      const v = await q.one(`select count(*) filter (where status = 'completed')::int visits, max(starts_at) filter (where status = 'completed' and id <> $2) last_visit from bookings where customer_id = $1`, [b.customer_id, b.id]);
      b.visits = v?.visits ?? 0; b.last_visit = v?.last_visit ?? null;
      const order = await q.all('select id from professionals where active order by sort, name');
      b.pro_color = panel.proColor(order, b.professional_id);
      b.items = await q.all('select name, price_cents, duration_min from booking_items where booking_id = $1', [id]);
      b.services = b.items.map((i: any) => i.name).join(' + ');
      b.events = await q.all('select from_status, to_status, actor, actor_user_id, note, at from booking_events where booking_id = $1 order by at, id', [id]);
      return b;
    });
    if (!b) throw notFound('Agendamento não encontrado.');
    const names = await db.system((q) => q.all('select id, name from users where id = any($1::uuid[])', [b.events.map((e: any) => e.actor_user_id).filter(Boolean)]));
    b.events.forEach((e: any) => { e.actor_name = names.find((n) => n.id === e.actor_user_id)?.name.split(' ')[0]; });
    return c.html(panel.bookingPage(ctx, b, takeFlash(c)));
  });
  // mudar o horário (cliente ligou pedindo): mesma duração e preço, outro dia/hora e, para quem vê a agenda de todos, outro profissional
  app.get(P('/reserva/:id/mudar'), async (c) => {
    const ctx = await ctxOf(c), id = c.req.param('id')!;
    const d = c.req.query('d') || '', p = c.req.query('p') || undefined;
    let date = isDate(d) ? d : today(ctx);
    let r = await staffMoveOptions(db, ctx, id, date, p);
    // sem dia escolhido: abre no dia do próprio horário
    const own = toLocal(new Date(r.booking.starts_at), ctx.shop.timezone).date;
    if (!isDate(d) && own !== date && own >= today(ctx)) { date = own; r = await staffMoveOptions(db, ctx, id, date, p); }
    const pros = can(ctx, 'agenda.all') ? await listPros(db, ctx.shop.id, true) : [];
    return c.html(panel.movePage(ctx, { booking: r.booking, date, pid: r.professionalId, pros, slots: r.slots }, takeFlash(c)));
  });
  app.post(P('/reserva/:id/mudar'), async (c) => {
    const ctx = await ctxOf(c), id = c.req.param('id')!, f = await form(c);
    await rescheduleByStaff(db, ctx, id, f.t, f.p || undefined);
    return go(c, `/app/s/${ctx.shop.slug}/reserva/${id}`, { ok: 'moved' });
  });
  app.post(P('/reserva/:id/status'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c), id = c.req.param('id')!;
    await changeStatus(db, ctx, id, f.to, f.note);
    // atendido: segue direto para a comanda, para registrar o pagamento (pode voltar sem receber)
    if (f.to === 'completed' && can(ctx, 'sales.create')) return go(c, `/app/s/${ctx.shop.slug}/caixa/comanda?booking=${id}`, { ok: 'status' });
    return go(c, f.back === 'hoje' ? `/app/s/${ctx.shop.slug}` : `/app/s/${ctx.shop.slug}/reserva/${id}`, { ok: 'status' });
  });

  app.get(P('/novo'), async (c) => {
    const ctx = await ctxOf(c);
    const services = await listServices(db, ctx.shop.id, true);
    const allPros = await listPros(db, ctx.shop.id, true);
    const pros = can(ctx, 'agenda.all') ? allPros : allPros.filter((p) => p.id === ctx.professionalId);
    const s = c.req.queries('s') ?? [];
    const [pickedName, pickedPhone] = splitPick(c.req.query('name') || '', c.req.query('phone') || '');
    const sel = { s, p: c.req.query('p') || (can(ctx, 'agenda.all') ? 'any' : ctx.professionalId || ''), date: c.req.query('date') || today(ctx), name: pickedName, phone: pickedPhone };
    const customers = await db.tenant(ctx.shop.id, (q) => q.all('select c.name, c.phone from customers c order by (select max(starts_at) from bookings b where b.customer_id = c.id) desc nulls last limit 300'));
    let slots = null, qt = null, err: string | undefined;
    if (s.length && c.req.query('name') !== undefined) {
      try { const av = await db.tenant(ctx.shop.id, (q) => availability(q, ctx.shop, { date: sel.date, serviceIds: s, professionalId: sel.p, staff: true })); slots = av.slots; qt = av; }
      catch (e) { if (e instanceof AppError) err = e.message; else throw e; }
    } else if (c.req.query('name') !== undefined) err = 'Escolha ao menos um serviço.';
    const fl = takeFlash(c);
    return c.html(panel.newBookingPage(ctx, { services, pros, customers, sel, slots, quote: qt }, { ...fl, err: err ?? fl.err }));
  });
  app.post(P('/novo'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    const [name, phone] = splitPick(f.name ?? '', f.phone ?? '');
    const r = await createBooking(db, ctx.shop, { serviceIds: [].concat(f.s ?? []), professionalId: f.p, startsAt: f.startsAt, name, phone }, { kind: 'staff', ctx });
    return go(c, `/app/s/${ctx.shop.slug}/reserva/${r.booking.id}`, { ok: 'booked' });
  });

  /* lembretes (contra faltas): a barbearia manda pelo próprio WhatsApp, com o link para o cliente confirmar, remarcar ou cancelar */
  app.get(P('/lembretes'), async (c) => {
    const ctx = await ctxOf(c);
    let date = c.req.query('date') || addDays(today(ctx), 1); if (!isDate(date)) date = addDays(today(ctx), 1);
    return c.html(panel.remindersPage(ctx, date, today(ctx), await remindersFor(db, ctx, date), takeFlash(c)));
  });
  app.post(P('/lembretes/:id'), async (c) => {
    const ctx = await ctxOf(c);
    const r = await markReminded(db, ctx, c.req.param('id')!);
    const text = reminderText(ctx.shop, r, abs(c, `/b/${ctx.shop.slug}/reserva/${r.token}`));
    return c.redirect(`https://wa.me/${waNumber(r.phone)}?text=${encodeURIComponent(text)}`, 303);
  });

  /* serviços */
  app.get(P('/servicos'), async (c) => { const ctx = await ctxOf(c); must(ctx, 'catalog.manage'); return c.html(panel.servicesPage(ctx, await listServices(db, ctx.shop.id), takeFlash(c))); });
  app.post(P('/servicos'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await saveService(db, ctx, null, f); return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/servicos`), { ok: 'created' }); });
  app.post(P('/servicos/:id'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await saveService(db, ctx, c.req.param('id')!, f); return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/servicos`), { ok: 'saved' }); });
  app.post(P('/servicos/:id/arquivar'), async (c) => { const ctx = await ctxOf(c); await setServiceActive(db, ctx, c.req.param('id')!, false); return go(c, `/app/s/${ctx.shop.slug}/servicos`, { ok: 'archived' }); });
  app.post(P('/servicos/:id/reativar'), async (c) => { const ctx = await ctxOf(c); await setServiceActive(db, ctx, c.req.param('id')!, true); return go(c, `/app/s/${ctx.shop.slug}/servicos`, { ok: 'restored' }); });

  /* equipe */
  app.get(P('/equipe'), async (c) => {
    const ctx = await ctxOf(c); must(ctx, 'team.manage');
    const [pros, hours] = [await listPros(db, ctx.shop.id), await getHours(db, ctx.shop.id)];
    const members = can(ctx, 'access.manage') ? await db.system((q) => q.all('select u.name, u.email, m.role, p.name pro_name from memberships m join users u on u.id = m.user_id left join professionals p on p.id = m.professional_id where m.shop_id = $1 order by m.created_at', [ctx.shop.id])) : [];
    const plan = await db.system((q) => q.one('select p.name, p.max_professionals from saas_subscriptions s join plans p on p.id = s.plan_id where s.shop_id = $1', [ctx.shop.id]));
    return c.html(panel.teamPage(ctx, { pros, hours, members, plan }, takeFlash(c)));
  });
  app.post(P('/equipe'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await savePro(db, ctx, null, f); return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/equipe`), { ok: 'created' }); });
  app.post(P('/equipe/acesso'), async (c) => { const ctx = await ctxOf(c); await grantStaffAccess(db, ctx, await form(c)); return go(c, `/app/s/${ctx.shop.slug}/equipe`, { ok: 'access' }); });
  app.post(P('/equipe/:id'), async (c) => { const ctx = await ctxOf(c); await savePro(db, ctx, c.req.param('id')!, await form(c)); return go(c, `/app/s/${ctx.shop.slug}/equipe`, { ok: 'saved' }); });
  app.post(P('/equipe/:id/desativar'), async (c) => { const ctx = await ctxOf(c); await setProActive(db, ctx, c.req.param('id')!, false); return go(c, `/app/s/${ctx.shop.slug}/equipe`, { ok: 'saved' }); });
  app.post(P('/equipe/:id/ativar'), async (c) => { const ctx = await ctxOf(c); await setProActive(db, ctx, c.req.param('id')!, true); return go(c, `/app/s/${ctx.shop.slug}/equipe`, { ok: 'saved' }); });
  app.post(P('/equipe/:id/escala'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c), id = c.req.param('id')!;
    await saveHours(db, ctx, id, hoursFromForm(f), f.useShop === '1');
    return go(c, `/app/s/${ctx.shop.slug}/equipe#p-${id}`, { ok: 'saved' });
  });

  /* horários e bloqueios */
  app.get(P('/horarios'), async (c) => {
    const ctx = await ctxOf(c); must(ctx, 'catalog.manage');
    return c.html(panel.hoursPage(ctx, { hours: await getHours(db, ctx.shop.id), off: await upcomingTimeOff(db, ctx.shop.id), pros: await listPros(db, ctx.shop.id, true), today: today(ctx) }, takeFlash(c)));
  });
  app.post(P('/horarios'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await saveHours(db, ctx, null, hoursFromForm(f)); return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/horarios`), { ok: 'saved' }); });
  app.post(P('/horarios/bloqueios'), async (c) => { const ctx = await ctxOf(c); await addTimeOff(db, ctx, await form(c)); return go(c, `/app/s/${ctx.shop.slug}/horarios#bloqueio`, { ok: 'blocked' }); });
  app.post(P('/horarios/bloqueios/:id/remover'), async (c) => { const ctx = await ctxOf(c); await removeTimeOff(db, ctx, c.req.param('id')!); return go(c, `/app/s/${ctx.shop.slug}/horarios#bloqueio`, { ok: 'unblocked' }); });

  /* página pública */
  app.get(P('/pagina'), async (c) => { const ctx = await ctxOf(c); must(ctx, 'page.manage'); return c.html(panel.pageSettings(ctx, takeFlash(c), `${host(c)}/b/${ctx.shop.slug}`)); });
  app.post(P('/pagina'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    const [preset, accent] = String(f.theme || '').split(':');
    await savePage(db, ctx, { ...f, preset, accent });
    return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/pagina`), { ok: 'saved' });
  });
  app.post(P('/pagina/publicar'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await setPublished(db, ctx, true); return go(c, nx(ctx, f, `/app/s/${ctx.shop.slug}/pagina`), { ok: 'published' }); });
  app.post(P('/pagina/avisos'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c); must(ctx, 'page.manage');
    const on = f.on === '1';
    await db.tenant(ctx.shop.id, async (q) => {
      await q.exec('update shops set notify_email = $2 where id = $1', [ctx.shop.id, on]);
      await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id, meta) values ($1,$2,'page.notify_updated','shop',$3,$4)`, [ctx.shop.id, ctx.user.id, ctx.shop.id, JSON.stringify({ on })]);
    });
    return go(c, `/app/s/${ctx.shop.slug}/pagina`, { ok: 'saved' });
  });
  app.post(P('/pagina/despublicar'), async (c) => { const ctx = await ctxOf(c); await setPublished(db, ctx, false); return go(c, `/app/s/${ctx.shop.slug}/pagina`, { ok: 'unpublished' }); });

  /* ---------- página pública de cada barbearia ---------- */
  async function loadShop(c: C) {
    const shop = await publicShop(db, c.req.param('slug')!);
    if (!shop) throw notFound('Barbearia não encontrada.');
    if (!shop.published) {
      const u = c.get('user');
      const member = u && (await db.system((q) => q.one('select 1 from memberships where shop_id = $1 and user_id = $2', [shop.id, u.id])));
      if (!member) return null;
    }
    const [services, pros, hours] = await db.tenant(shop.id, async (q) => [
      await q.all('select id, name, description, duration_min, price_cents from services where active order by sort, name'),
      await q.all('select id, name, title from professionals where active order by sort, name'),
      await q.all('select professional_id, weekday, start_min, end_min from working_hours order by weekday, start_min'),
    ]);
    const ent = entitlement(await loadSub(db, shop.id), shop.is_demo);
    return { shop, services, pros, hours, ent } as shopView.ShopData & { ent: Entitlement };
  }
  async function flowData(d: shopView.ShopData, sel: shopView.Sel) {
    const out: any = {};
    sel.s = sel.s.filter((id) => d.services.some((x) => x.id === id)).slice(0, 5);
    if (!sel.s.length) return out;
    out.quote = await db.tenant(d.shop.id, (q) => quote(q, sel.s));
    if (sel.p && sel.p !== 'any' && !d.pros.some((p) => p.id === sel.p)) sel.p = undefined;
    if (sel.p && (!sel.t)) {
      const t0 = toLocal(clock.now(), d.shop.timezone).date;
      const n = Math.min(14, d.shop.policy.max_days_ahead + 1);
      // uma única leitura do período inteiro (antes eram ~5 consultas por dia)
      const r = await db.tenant(d.shop.id, (q) => availabilityRange(q, d.shop, { from: t0, days: n, serviceIds: sel.s, professionalId: sel.p! }));
      out.days = r.days.map((x) => ({ ...x, n: x.slots.length }));
      if (!sel.d || !out.days.some((x: any) => x.date === sel.d)) sel.d = out.days.find((x: any) => x.n)?.date ?? t0;
      out.slots = out.days.find((x: any) => x.date === sel.d)?.slots ?? [];
    }
    return out;
  }
  const readSel = (c: C): shopView.Sel & { pro?: boolean } => ({ s: (c.req.queries('s') ?? []).slice(0, 5), p: c.req.query('p') || undefined, d: c.req.query('d') || undefined, t: c.req.query('t') || undefined, pro: c.req.query('pro') === '1' });

  app.get('/b/:slug', async (c) => {
    rateLimit(`view:${ip(c)}`, 240, 60_000); // página pública calcula agenda: limita abuso
    const d = await loadShop(c);
    if (!d) return c.html(shopView.notPublished(c.req.param('slug')), 404);
    if (!(d as any).ent.ok) return c.html(shopView.unavailable(d.shop.name), 503);
    const sel = readSel(c);
    const extra = await flowData(d, sel);
    if (sel.t) {
      // horário escolhido: confere se ainda está livre antes de pedir os dados
      const date = toLocal(new Date(sel.t), d.shop.timezone).date;
      if (Number.isNaN(Date.parse(sel.t))) sel.t = undefined;
      else {
        const av = await db.tenant(d.shop.id, (q) => availability(q, d.shop, { date, serviceIds: sel.s, professionalId: sel.p || 'any' }));
        if (!av.slots.some((x) => x.startsAt === new Date(sel.t!).toISOString())) {
          sel.t = undefined; sel.d = date;
          Object.assign(extra, await flowData(d, sel), { error: 'Esse horário acabou de ser ocupado. Escolha outro.' });
        }
      }
    }
    return c.html(shopView.bookingFlow(d, sel, { ...extra, url: abs(c, `/b/${d.shop.slug}`) }));
  });
  app.post('/b/:slug/reservar', async (c) => {
    const d = await loadShop(c);
    if (!d) throw notFound();
    if (!(d as any).ent.ok) return c.html(shopView.unavailable(d.shop.name), 503); // bloqueio também no servidor, não só na tela
    const f = await form(c);
    const sel: shopView.Sel = { s: [].concat(f.s ?? []), p: f.p, t: f.t && !Number.isNaN(Date.parse(f.t)) ? f.t : undefined };
    if (f.website) return c.text('Não foi possível concluir.', 400); // armadilha para robôs
    try {
      rateLimit(`book:${ip(c)}:${d.shop.id}`, 6, 10 * 60_000);
      const r = await createBooking(db, d.shop, { serviceIds: sel.s, professionalId: sel.p, startsAt: f.t, name: f.name, phone: f.phone }, { kind: 'customer' });
      void notifyShop(c, d.shop, 'novo', r.booking.id);
      return c.redirect(`/b/${d.shop.slug}/reserva/${r.token}?novo=1`, 303);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code === 'slot_unavailable') {
        // toque duplo / reenvio: o mesmo WhatsApp acabou de marcar este horário → mostra a reserva feita, não "ocupado"
        const mine = f.t && !Number.isNaN(Date.parse(f.t)) ? await db.tenant(d.shop.id, (q) => q.one(`select b.id from bookings b join customers c on c.id = b.customer_id
          where c.phone = $1 and b.starts_at = $2 and b.status in ('pending','confirmed') and b.created_at > now() - interval '15 minutes'`, [digits(String(f.phone ?? '')), new Date(f.t)])) : null;
        if (mine) return c.redirect(`/b/${d.shop.slug}/reserva/${manageToken(await linkSecret(db), mine.id)}?novo=1`, 303);
        sel.d = toLocal(new Date(f.t), d.shop.timezone).date; sel.t = undefined;
        const extra = await flowData(d, sel);
        return c.html(shopView.bookingFlow(d, sel, { ...extra, error: e.message }), 409);
      }
      const extra = await flowData(d, { ...sel, t: undefined }).catch(() => ({}));
      return c.html(shopView.bookingFlow(d, sel, { quote: (extra as any).quote, error: e.message, form: { name: f.name ?? '', phone: f.phone ?? '' } }), e.status as any);
    }
  });
  app.get('/b/:slug/reserva/:token', async (c) => {
    const shop = await publicShop(db, c.req.param('slug'));
    if (!shop) throw notFound();
    const b = await findByToken(db, shop, c.req.param('token'));
    if (!b) throw notFound('Reserva não encontrada.');
    const d = await shopDataAny(shop);
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    const move = c.req.query('remarcar') === '1' && b.canChange ? await moveData(shop, b, c.req.query('d')) : undefined;
    const q = c.req.query('ok');
    return c.html(shopView.managePage(d, b, c.req.param('token'), { fresh: c.req.query('novo') === '1', cancelled: c.req.query('cancelado') === '1', confirmed: q === 'confirmado', moved: q === 'remarcado', move }));
  });
  /** Dias e horários livres para remarcar (mesmo profissional, mesma duração). */
  async function moveData(shop: any, b: any, d?: string) {
    const ent = entitlement(await loadSub(db, shop.id), shop.is_demo);
    if (!ent.ok) return { blocked: true, days: [], slots: [], d: '' };
    const t0 = toLocal(clock.now(), shop.timezone).date;
    const r = await rescheduleOptions(db, shop, b, t0, Math.min(14, shop.policy.max_days_ahead + 1));
    const days = r.days.map((x) => ({ date: x.date, open: x.open, n: x.slots.length }));
    // abre no dia do horário atual (quem remarca costuma mudar a hora, não o dia)
    const own = toLocal(new Date(b.starts_at), shop.timezone).date;
    const sel = d && days.some((x) => x.date === d) ? d : days.some((x) => x.date === own && x.n) ? own : days.find((x) => x.n)?.date ?? t0;
    return { blocked: false, days, d: sel, slots: r.days.find((x) => x.date === sel)?.slots ?? [] };
  }
  app.post('/b/:slug/reserva/:token/confirmar', async (c) => {
    const shop = await publicShop(db, c.req.param('slug'));
    if (!shop) throw notFound();
    const token = c.req.param('token');
    rateLimit(`manage:${ip(c)}`, 30, 10 * 60_000);
    try { await confirmByCustomer(db, shop, token); }
    catch (e) {
      if (!(e instanceof AppError)) throw e;
      const b = await findByToken(db, shop, token); if (!b) throw e;
      return c.html(shopView.managePage(await shopDataAny(shop), b, token, { error: e.message }), e.status as any);
    }
    return c.redirect(`/b/${shop.slug}/reserva/${token}?ok=confirmado`, 303);
  });
  app.post('/b/:slug/reserva/:token/remarcar', async (c) => {
    const shop = await publicShop(db, c.req.param('slug'));
    if (!shop) throw notFound();
    const token = c.req.param('token'), f = await form(c);
    rateLimit(`manage:${ip(c)}`, 30, 10 * 60_000);
    try {
      if (!entitlement(await loadSub(db, shop.id), shop.is_demo).ok) throw new AppError(503, 'unavailable', 'A remarcação online está indisponível agora. Fale com a barbearia.');
      await rescheduleByCustomer(db, shop, token, f.t);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      const b = await findByToken(db, shop, token); if (!b) throw e;
      const day = f.t && !Number.isNaN(Date.parse(f.t)) ? toLocal(new Date(f.t), shop.timezone).date : undefined;
      return c.html(shopView.managePage(await shopDataAny(shop), b, token, { error: e.message, move: b.canChange ? await moveData(shop, b, day) : undefined }), e.status as any);
    }
    { const b = await findByToken(db, shop, token); if (b) void notifyShop(c, shop, 'remarcado', b.id); }
    return c.redirect(`/b/${shop.slug}/reserva/${token}?ok=remarcado`, 303);
  });
  app.post('/b/:slug/reserva/:token/cancelar', async (c) => {
    const shop = await publicShop(db, c.req.param('slug'));
    if (!shop) throw notFound();
    const token = c.req.param('token');
    rateLimit(`cancel:${ip(c)}`, 20, 10 * 60_000);
    try { await cancelByCustomer(db, shop, token); }
    catch (e) {
      if (!(e instanceof AppError)) throw e;
      const b = await findByToken(db, shop, token); if (!b) throw e;
      return c.html(shopView.managePage(await shopDataAny(shop), b, token, { error: e.message }), e.status as any);
    }
    { const b = await findByToken(db, shop, token); if (b) void notifyShop(c, shop, 'cancelado', b.id); }
    return c.redirect(`/b/${shop.slug}/reserva/${token}?cancelado=1`, 303);
  });
  async function shopDataAny(shop: any): Promise<shopView.ShopData> {
    const [services, pros, hours] = await db.tenant(shop.id, async (q) => [[], [], await q.all('select professional_id, weekday, start_min, end_min from working_hours order by weekday, start_min')]);
    return { shop, services, pros, hours };
  }

  /* ---------- caixa ---------- */
  app.get(P('/caixa'), async (c) => {
    const ctx = await ctxOf(c);
    let day = c.req.query('date') || today(ctx); if (!isDate(day)) day = today(ctx);
    return c.html(ops.cashPage(ctx, day, await cashDay(db, ctx, day), takeFlash(c)));
  });
  app.get(P('/caixa/comanda'), async (c) => {
    const ctx = await ctxOf(c);
    return c.html(ops.checkoutPage(ctx, await checkoutData(db, ctx, c.req.query('booking') || undefined), takeFlash(c)));
  });
  app.post(P('/caixa/comanda'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    await createSale(db, ctx, f);
    return go(c, can(ctx, 'cash.view') ? `/app/s/${ctx.shop.slug}/caixa` : `/app/s/${ctx.shop.slug}`, { ok: 'sale' });
  });
  app.post(P('/caixa/venda/:id/estornar'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await voidSale(db, ctx, c.req.param('id')!, f.reason ?? ''); return go(c, `/app/s/${ctx.shop.slug}/caixa`, { ok: 'sale_void' }); });
  app.post(P('/caixa/fechar'), async (c) => { const ctx = await ctxOf(c), f = await form(c); await closeCash(db, ctx, f.day, f.counted, f.note); return go(c, `/app/s/${ctx.shop.slug}/caixa?date=${f.day}`, { ok: 'cash_closed' }); });
  const monthOf = (c: C, ctx: Ctx) => { const m = c.req.query('mes') || ''; return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today(ctx).slice(0, 7); };
  app.get(P('/financeiro'), async (c) => {
    const ctx = await ctxOf(c); must(ctx, 'reports.view');
    return c.html(ops.reportPage(ctx, await monthReport(db, ctx, monthOf(c, ctx)), await planHas(db, ctx.shop.id, 'comissoes'), takeFlash(c)));
  });
  app.get(P('/comissoes'), async (c) => {
    const ctx = await ctxOf(c);
    if (can(ctx, 'reports.view')) return c.redirect(`/app/s/${ctx.shop.slug}/financeiro`);
    if (!ctx.professionalId) throw notFound();
    return c.html(ops.myCommissionsPage(ctx, await monthReport(db, ctx, monthOf(c, ctx), ctx.professionalId), await planHas(db, ctx.shop.id, 'comissoes'), takeFlash(c)));
  });

  /* ---------- clientes ---------- */
  app.get(P('/clientes'), async (c) => { const ctx = await ctxOf(c); return c.html(ops.customersPage(ctx, await listCustomers(db, ctx, { q: c.req.query('q'), filtro: c.req.query('filtro') }), takeFlash(c))); });
  app.get(P('/clientes/:id'), async (c) => { const ctx = await ctxOf(c); return c.html(ops.customerPage(ctx, await customerDetail(db, ctx, c.req.param('id')!), takeFlash(c))); });
  app.post(P('/clientes/:id'), async (c) => { const ctx = await ctxOf(c); await saveCustomer(db, ctx, c.req.param('id')!, await form(c)); return go(c, `/app/s/${ctx.shop.slug}/clientes/${c.req.param('id')}`, { ok: 'customer_saved' }); });
  app.get(P('/clientes/:id/exportar'), async (c) => {
    const ctx = await ctxOf(c);
    const data = await exportCustomer(db, ctx, c.req.param('id')!);
    c.header('Content-Disposition', `attachment; filename="cliente-${c.req.param('id')!.slice(0, 8)}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(data);
  });
  app.post(P('/clientes/:id/apagar'), async (c) => { const ctx = await ctxOf(c); await anonymizeCustomer(db, ctx, c.req.param('id')!); return go(c, `/app/s/${ctx.shop.slug}/clientes`, { ok: 'customer_deleted' }); });

  /* ---------- primeiros passos ---------- */
  app.get(P('/comecar'), async (c) => {
    const ctx = await ctxOf(c); must(ctx, 'page.manage');
    const step = Math.min(5, Math.max(1, Number(c.req.query('passo')) || 1));
    const acts = new Set((await db.tenant(ctx.shop.id, (q) => q.all('select distinct action from audit_log'))).map((r) => r.action));
    const done = [acts.has('hours.updated'), acts.has('service.updated') || acts.has('service.created') || acts.has('services.reviewed'), acts.has('professional.created') || acts.has('professional.updated'), acts.has('page.updated'), ctx.shop.published];
    return c.html(ops.onboardingPage(ctx, step, { done, hours: await getHours(db, ctx.shop.id), services: await listServices(db, ctx.shop.id), pros: await listPros(db, ctx.shop.id), url: `${host(c)}/b/${ctx.shop.slug}` }, takeFlash(c)));
  });
  app.post(P('/comecar/servicos'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    const list = (k: string) => ([] as string[]).concat(f[k] ?? []);
    const ids = list('id'), names = list('name'), durs = list('duration'), prices = list('price');
    await saveServicesBulk(db, ctx, ids.map((id, i) => ({ id, name: names[i] ?? '', duration: durs[i] ?? '', price: prices[i] ?? '' })));
    return go(c, `/app/s/${ctx.shop.slug}/comecar?passo=3`, { ok: 'saved' });
  });

  /* ---------- assinatura da barbearia (dono) ---------- */
  app.get(P('/assinatura'), async (c) => {
    const ctx = await ctxOf(c); must(ctx, 'billing.manage');
    const sub = await loadSub(db, ctx.shop.id);
    if (!sub) throw notFound();
    return c.html(billingView.billingPage(ctx, { sub, plans: await activePlans(db), payments: await paymentsOf(db, ctx.shop.id), provider: prov?.id ?? null, returning: c.req.query('retorno') === '1' }, takeFlash(c)));
  });
  app.post(P('/assinatura/contratar'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    const doc = digits(f.document);
    if (prov?.id === 'asaas' && !/^(\d{11}|\d{14})$/.test(doc)) throw new AppError(422, 'invalid', 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
    const url = await startCheckout(db, prov, ctx, String(f.plan || ''), { document: doc || undefined });
    return c.redirect(url, 303);
  });
  app.post(P('/assinatura/trocar'), async (c) => {
    const ctx = await ctxOf(c), f = await form(c);
    const r = await changePlan(db, ctx, String(f.plan || ''));
    return go(c, `/app/s/${ctx.shop.slug}/assinatura`, { ok: r === 'scheduled' ? 'plan_scheduled' : 'plan_changed' });
  });
  app.post(P('/assinatura/cancelar'), async (c) => { const ctx = await ctxOf(c); await cancelSubscription(db, ctx); return go(c, `/app/s/${ctx.shop.slug}/assinatura`, { ok: 'sub_canceled' }); });
  app.post(P('/assinatura/retomar'), async (c) => { const ctx = await ctxOf(c); await resumeSubscription(db, ctx); return go(c, `/app/s/${ctx.shop.slug}/assinatura`, { ok: 'sub_resumed' }); });

  /* ---------- avisos do provedor de pagamento ---------- */
  app.post('/webhooks/billing/:provider', async (c) => {
    if (!prov || c.req.param('provider') !== prov.id) return c.json({ ok: false }, 404);
    rateLimit(`webhook:${ip(c)}`, 600, 60_000);
    const raw = await c.req.text();
    const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    const r = await handleWebhook(db, prov, headers, raw);
    return c.json({ ok: r.status === 200, result: r.result }, r.status as any);
  });

  /* ---------- página de pagamento de TESTE (só com o simulador) ---------- */
  if (prov?.id === 'sandbox') {
    const sb = prov as ReturnType<typeof import('./billing/providers.ts').sandboxProvider>;
    const chargeInfo = (id: string) => db.system((q) => q.one(`select c.id, c.amount_cents, c.status, s.slug, s.name from sandbox_charges c join saas_payments p on p.provider = 'sandbox' and p.provider_payment_id = c.id join shops s on s.id = p.shop_id where c.id = $1`, [id]));
    app.get('/sandbox/pagar/:id', async (c) => {
      const ch = await chargeInfo(c.req.param('id'));
      if (!ch) throw notFound();
      return c.html(site.sandboxCheckout(ch));
    });
    app.post('/sandbox/pagar/:id/:result', async (c) => {
      const ch = await chargeInfo(c.req.param('id'));
      const result = c.req.param('result') as any;
      if (!ch || !['confirmed', 'failed'].includes(result)) throw notFound();
      // o simulador age como o provedor: muda a cobrança e chama nosso webhook com assinatura válida
      const body = await sb.settle(ch.id, result);
      await handleWebhook(db, sb, { 'x-sandbox-signature': sb.sign(body) }, body);
      return c.redirect(`/app/s/${ch.slug}/assinatura?retorno=1`, 303);
    });
  }

  /* ---------- administração da plataforma ---------- */
  app.use('/admin/*', async (c, next) => { admin.mustAdmin(c.get('user')); await next(); });
  app.use('/admin', async (c, next) => { admin.mustAdmin(c.get('user')); await next(); });
  const adminGo = (c: C, url: string, f: Flash) => go(c, url, f);
  app.get('/admin', async (c) => c.html(adminView.overview(c.get('user')!, await admin.metrics(db), takeFlash(c))));
  app.get('/admin/barbearias', async (c) => { const q = { q: c.req.query('q') || '', status: c.req.query('status') || '' }; return c.html(adminView.shopsPage(c.get('user')!, await admin.listShops(db, q), q, takeFlash(c))); });
  app.get('/admin/barbearias/:id', async (c) => c.html(adminView.shopPage(c.get('user')!, await admin.shopDetail(db, c.req.param('id')), takeFlash(c))));
  app.post('/admin/barbearias/:id/estender', async (c) => { const f = await form(c); await admin.extendTrial(db, c.get('user')!, c.req.param('id'), Number(f.days)); return adminGo(c, `/admin/barbearias/${c.req.param('id')}`, { ok: 'saved' }); });
  app.get('/admin/planos', async (c) => c.html(adminView.plansPage(c.get('user')!, await admin.allPlans(db), await admin.getSettings(db), takeFlash(c))));
  app.post('/admin/planos/:id', async (c) => { await admin.savePlan(db, c.get('user')!, c.req.param('id'), await form(c)); return adminGo(c, '/admin/planos', { ok: 'saved' }); });
  app.post('/admin/configuracoes', async (c) => { await admin.saveSettings(db, c.get('user')!, await form(c)); return adminGo(c, '/admin/planos', { ok: 'saved' }); });
  app.get('/admin/cobrancas', async (c) => c.html(adminView.eventsPage(c.get('user')!, await admin.billingEvents(db), takeFlash(c))));
  app.post('/admin/conciliar', async (c) => { const n = prov ? await reconcile(db, prov) : 0; await db.system((q) => q.exec(`insert into audit_log (user_id, action, meta) values ($1,'admin.reconcile',$2)`, [c.get('user')!.id, JSON.stringify({ updated: n })])); return adminGo(c, '/admin/cobrancas', { ok: 'saved' }); });
  app.get('/admin/suporte', async (c) => c.html(adminView.supportPage(c.get('user')!, await db.system((q) => q.all('select * from contact_messages order by handled_at nulls first, created_at desc limit 200')), takeFlash(c))));
  app.post('/admin/suporte/:id/respondida', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) throw notFound();
    await db.system(async (q) => { await q.exec('update contact_messages set handled_at = now() where id = $1 and handled_at is null', [id]); await q.exec(`insert into audit_log (user_id, action, entity, entity_id) values ($1,'admin.message_handled','contact_message',$2)`, [c.get('user')!.id, String(id)]); });
    return adminGo(c, '/admin/suporte', { ok: 'saved' });
  });
  app.get('/admin/auditoria', async (c) => c.html(adminView.auditPage(c.get('user')!, await admin.platformAudit(db))));

  // "ver exemplo": leva à barbearia de demonstração se ela existir; senão, aos planos (nunca a uma página quebrada)
  app.get('/exemplo', async (c) => {
    const d = await db.system((q) => q.one(`select slug from shops where is_demo and published order by created_at limit 1`));
    return c.redirect(d ? `/b/${d.slug}` : '/planos', 302);
  });
  // painel instalável no celular (tela inicial, sem barra do navegador)
  app.get('/manifest.webmanifest', (c) => c.body(JSON.stringify({
    name: PLATFORM.name, short_name: PLATFORM.name, description: 'Agenda, caixa e clientes da barbearia.', lang: 'pt-BR',
    start_url: '/app', scope: '/', display: 'standalone', background_color: '#FFFFFF', theme_color: '#17130F',
    icons: [
      { src: '/static/img/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/static/img/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/static/img/icone-mascara-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), 200, { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=86400' }));
  // buscadores: só o site e as páginas públicas das barbearias; painel, links de reserva e de senha ficam de fora
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /app/\nDisallow: /admin/\nDisallow: /sandbox/\nDisallow: /redefinir/\nDisallow: /b/*/reserva/\n', 200, { 'cache-control': 'public, max-age=86400' }));
  app.get('/favicon.ico', (c) => c.body(ICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' }));

  /* ---------- contato, termos, privacidade, saúde ---------- */
  app.get('/contato', (c) => c.html(site.contactPage({ sent: c.req.query('enviado') === '1', user: !!c.get('user') })));
  app.post('/contato', async (c) => {
    const f = await form(c);
    if (f.site) return c.redirect('/contato?enviado=1', 303); // robô: finge sucesso
    const v = { name: String(f.name ?? '').trim(), email: String(f.email ?? '').trim().toLowerCase(), phone: digits(f.phone).slice(0, 13), shop: String(f.shop ?? '').trim().slice(0, 80), message: String(f.message ?? '').trim() };
    const err = v.name.length < 2 ? 'Informe seu nome.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 120 ? 'Informe um e-mail válido.' : v.message.length < 5 ? 'Escreva a mensagem.' : v.message.length > 2000 ? 'Mensagem muito longa (até 2000 caracteres).' : '';
    if (err) return c.html(site.contactPage({ error: err, v: { ...v }, user: !!c.get('user') }), 422);
    try { rateLimit(`contact:${ip(c)}`, 5, 60 * 60_000); } catch (e) { if (e instanceof AppError) return c.html(site.contactPage({ error: e.message, v, user: !!c.get('user') }), 429); throw e; }
    await db.system((q) => q.exec('insert into contact_messages (name, email, phone, shop_name, message) values ($1,$2,$3,$4,$5)', [v.name.slice(0, 80), v.email, v.phone, v.shop, v.message]));
    return c.redirect('/contato?enviado=1', 303);
  });
  app.get('/termos', (c) => c.html(site.termsPage(!!c.get('user'))));
  app.get('/privacidade', (c) => c.html(site.privacyPage(!!c.get('user'))));
  // verificação de saúde para a hospedagem (sem dados sensíveis)
  app.get('/saude', async (c) => { await db.system((q) => q.one('select 1 ok')); return c.json({ ok: true }); });

  /* ---------- planos no site ---------- */
  app.get('/planos', async (c) => c.html(site.plansPage(await activePlans(db), !!c.get('user'))));

  return app;
}
export { digits };
