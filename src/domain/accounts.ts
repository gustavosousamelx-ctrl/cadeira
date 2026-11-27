import { z } from 'zod';
import type { Db, Q } from '../db/db.ts';
import { AppError, RESERVED_SLUGS, clock, forbidden, hashPassword, invalid, newToken, notFound, sha256, verifyPassword, rateLimit, normalizeSlug } from '../lib/core.ts';

/* ---------- papéis e permissões (verificados sempre no servidor) ---------- */
export type Role = 'owner' | 'manager' | 'reception' | 'barber';
export const ROLE_LABEL: Record<Role, string> = { owner: 'Proprietário', manager: 'Gerente', reception: 'Recepção', barber: 'Barbeiro' };
const ALL: Role[] = ['owner', 'manager', 'reception', 'barber'];
export const PERMS = {
  'agenda.all': ['owner', 'manager', 'reception'],      // ver e mexer na agenda de toda a equipe
  'agenda.own': ALL,                                      // ver e mexer na própria agenda
  'catalog.manage': ['owner', 'manager'],                 // serviços, horários, bloqueios
  'team.manage': ['owner', 'manager'],                    // profissionais e escalas
  'access.manage': ['owner'],                             // logins e papéis
  'page.manage': ['owner', 'manager'],                    // página pública e políticas
  'billing.manage': ['owner'],                            // assinatura da plataforma
  'customers.view': ['owner', 'manager', 'reception'],    // lista e ficha de clientes
  'customers.privacy': ['owner'],                         // exportar e apagar dados pessoais (LGPD)
  'sales.create': ALL,                                    // fechar comanda (barbeiro: só a própria)
  'cash.view': ['owner', 'manager', 'reception'],         // caixa do dia
  'cash.manage': ['owner', 'manager', 'reception'],       // fechar o caixa
  'sales.void': ['owner', 'manager'],                     // estornar venda
  'reports.view': ['owner', 'manager'],                   // financeiro e comissões de todos
} satisfies Record<string, Role[]>;
export type Perm = keyof typeof PERMS;

export interface Shop { id: string; slug: string; name: string; timezone: string; description: string; address: string; phone: string; instagram: string; theme: any; policy: Policy; published: boolean; is_demo: boolean; notify_email?: boolean }
export interface Policy { slot_step_min: number; min_notice_min: number; max_days_ahead: number; cancel_until_min: number }
export interface User { id: string; email: string; name: string; is_platform_admin: boolean }
export interface Ctx { user: User; shop: Shop; role: Role; professionalId: string | null; ent?: { ok: boolean; level: 'ok' | 'warn' | 'blocked'; message: string } }

export const can = (ctx: Ctx, p: Perm) => (PERMS[p] as Role[]).includes(ctx.role);
export function must(ctx: Ctx, p: Perm) { if (!can(ctx, p)) throw forbidden(); }

const SHOP_COLS = 'id, slug, name, timezone, description, address, phone, instagram, theme, policy, published, is_demo, notify_email';

/* ---------- cadastro: cria conta + estabelecimento já provisionado ---------- */
export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(120),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
  shopName: z.string().trim().min(2, 'Informe o nome da barbearia.').max(60),
  slug: z.string().transform(normalizeSlug).pipe(z.string().min(3, 'Use pelo menos 3 letras ou números.')),
});
export type SignupInput = z.infer<typeof signupSchema>;

export async function signup(db: Db, raw: unknown) {
  const p = signupSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message, fieldErrors(p.error));
  const input = p.data;
  if (RESERVED_SLUGS.has(input.slug)) throw invalid('Esse endereço é reservado. Escolha outro.', { slug: 'Endereço reservado.' });
  const hash = await hashPassword(input.password);
  const emailTaken = () => new AppError(409, 'email_taken', 'Já existe uma conta com esse e-mail. Entre com sua senha.', { email: 'E-mail já cadastrado.' });
  const slugTaken = () => new AppError(409, 'slug_taken', 'Esse endereço já está em uso.', { slug: 'Endereço já em uso.' });
  try {
    return await db.system(async (q) => {
      if (await q.one('select 1 from users where email = $1', [input.email])) throw emailTaken();
      if (await q.one('select 1 from shops where slug = $1', [input.slug])) throw slugTaken();
      const user = await q.one<User>('insert into users (email, name, password_hash) values ($1,$2,$3) returning id, email, name, is_platform_admin', [input.email, input.name, hash]);
      const shop = await provisionShop(q, { name: input.shopName, slug: input.slug, ownerId: user!.id, ownerName: input.name });
      return { user: user!, shop };
    });
  } catch (e: any) {
    // dois cadastros simultâneos com o mesmo e-mail/endereço: o banco decide, e respondemos 409 em vez de erro 500
    if (e.code === '23505') throw String(e.constraint || e.message).includes('slug') ? slugTaken() : emailTaken();
    throw e;
  }
}

/** Provisiona um estabelecimento novo: dono, profissional, horários, serviços iniciais e teste do plano. */
export async function provisionShop(q: Q, o: { name: string; slug: string; ownerId: string; ownerName: string; isDemo?: boolean; planId?: string }) {
  const plan = await q.one(`select id, trial_days from plans where active or $2::boolean
    order by (id = $1) desc, sort, id limit 1`, [o.planId || 'profissional', !!o.isDemo]);
  if (!plan) throw new AppError(503, 'signup_paused', 'Os cadastros estão temporariamente pausados.');
  const shop = await q.one<Shop>(`insert into shops (slug, name, is_demo) values ($1,$2,$3) returning ${SHOP_COLS}`, [o.slug, o.name, !!o.isDemo]);
  const sid = shop!.id;
  const pro = await q.one('insert into professionals (shop_id, name, title, sort) values ($1,$2,$3,0) returning id', [sid, o.ownerName, 'Proprietário']);
  await q.exec(`insert into memberships (shop_id, user_id, role, professional_id) values ($1,$2,'owner',$3)`, [sid, o.ownerId, pro!.id]);
  // expediente sugerido da casa: ter-sex 9h-19h, sáb 8h-17h (editável no onboarding)
  for (const wd of [2, 3, 4, 5]) await q.exec('insert into working_hours (shop_id, weekday, start_min, end_min) values ($1,$2,540,1140)', [sid, wd]);
  await q.exec('insert into working_hours (shop_id, weekday, start_min, end_min) values ($1,6,480,1020)', [sid]);
  const starters: [string, string, number, number][] = [['Corte', 'Máquina ou tesoura, com finalização', 30, 4500], ['Barba', 'Toalha quente e navalha', 30, 3500], ['Corte e barba', 'Os dois no mesmo horário', 60, 7500]];
  for (const [i, s] of starters.entries()) await q.exec('insert into services (shop_id, name, description, duration_min, price_cents, sort) values ($1,$2,$3,$4,$5,$6)', [sid, ...s, i]);
  await q.exec(`insert into saas_subscriptions (shop_id, plan_id, status, trial_ends_at) values ($1,$2,'trialing', $3::timestamptz + make_interval(days => $4))`, [sid, plan.id, clock.now().toISOString(), plan.trial_days]);
  await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id) values ($1,$2,'shop.provisioned','shop',$3)`, [sid, o.ownerId, sid]);
  return shop!;
}

/* ---------- login e sessão ---------- */
const SESSION_DAYS = 30;
export async function login(db: Db, email: string, password: string, ip: string) {
  email = String(email || '').trim().toLowerCase();
  rateLimit(`login:${ip}:${email}`, 8, 15 * 60_000);
  rateLimit(`login-email:${email}`, 30, 60 * 60_000); // tentativas distribuídas em vários IPs contra a mesma conta
  const u = await db.system((q) => q.one('select id, password_hash from users where email = $1', [email]));
  // compara mesmo quando o e-mail não existe, para não revelar quais e-mails têm conta pelo tempo de resposta
  const ok = await verifyPassword(String(password || ''), u?.password_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!u || !ok) throw new AppError(401, 'bad_credentials', 'E-mail ou senha incorretos.');
  return createSession(db, u.id);
}
export async function createSession(db: Db, userId: string) {
  const token = newToken();
  await db.system((q) => q.exec(`insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]));
  return token;
}
export async function userFromSession(db: Db, token: string | undefined): Promise<User | null> {
  if (!token || token.length > 100) return null;
  return (await db.system((q) => q.one<User>('select u.id, u.email, u.name, u.is_platform_admin from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()', [sha256(token)]))) ?? null;
}
export const logout = (db: Db, token: string) => db.system((q) => q.exec('delete from sessions where token_hash = $1', [sha256(token)]));

/* ---------- recuperação de senha (segue o guia da OWASP) ----------
 * token aleatório de 256 bits, só o hash no banco, vale 1 hora e uma vez; resposta igual exista ou não a conta;
 * nada muda na conta até o token ser usado; ao trocar a senha, todas as sessões abertas caem. */
const RESET_MIN = 60;
export async function requestPasswordReset(db: Db, rawEmail: string, ip: string): Promise<{ email: string; name: string; token: string } | null> {
  const email = String(rawEmail || '').trim().toLowerCase().slice(0, 120);
  rateLimit(`reset-ip:${ip}`, 10, 60 * 60_000);
  if (!z.string().email().safeParse(email).success) throw invalid('Informe um e-mail válido.');
  try { rateLimit(`reset-email:${email}`, 3, 60 * 60_000); } catch { return null; } // excesso por e-mail: silencioso, a resposta é a mesma
  return db.system(async (q) => {
    const u = await q.one('select id, name from users where email = $1', [email]);
    if (!u) return null;
    const token = newToken(32);
    await q.exec('delete from password_resets where user_id = $1 and used_at is null', [u.id]); // só o link mais recente vale
    await q.exec(`insert into password_resets (token_hash, user_id, expires_at) values ($1,$2, now() + make_interval(mins => $3))`, [sha256(token), u.id, RESET_MIN]);
    await q.exec(`insert into audit_log (user_id, action, entity, entity_id) values ($1,'auth.reset_requested','user',$2)`, [u.id, u.id]);
    return { email, name: u.name as string, token };
  });
}
export async function resetTokenValid(db: Db, token: string) {
  if (!token || token.length > 100) return false;
  return !!(await db.system((q) => q.one('select 1 from password_resets where token_hash = $1 and used_at is null and expires_at > now()', [sha256(token)])));
}
export async function resetPassword(db: Db, token: string, password: string, confirm: string) {
  if (!token || token.length > 100) throw invalid('Link inválido ou vencido. Peça outro.');
  const pw = signupSchema.shape.password.safeParse(password);
  if (!pw.success) throw invalid(pw.error.issues[0].message);
  if (password !== confirm) throw invalid('As duas senhas não são iguais.');
  const hash = await hashPassword(password);
  return db.system(async (q) => {
    // marca como usado na mesma operação que lê: dois envios simultâneos não usam o mesmo link
    const r = await q.one(`update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha256(token)]);
    if (!r) throw invalid('Link inválido ou vencido. Peça outro.');
    const u = await q.one('update users set password_hash = $2 where id = $1 returning email, name', [r.user_id, hash]);
    await q.exec('delete from sessions where user_id = $1', [r.user_id]);
    await q.exec('delete from password_resets where user_id = $1 and used_at is null', [r.user_id]);
    await q.exec(`insert into audit_log (user_id, action, entity, entity_id) values ($1,'auth.password_reset','user',$2)`, [r.user_id, r.user_id]);
    return { email: u!.email as string, name: u!.name as string };
  });
}
/** Limpeza periódica: sessões vencidas e links de senha antigos. */
export const cleanupAuth = (db: Db) => db.system(async (q) => {
  await q.exec('delete from sessions where expires_at < now()');
  await q.exec(`delete from password_resets where expires_at < now() - interval '7 days'`);
});

/** Resolve o tenant a partir da sessão + vínculo. O slug da URL só escolhe entre estabelecimentos aos quais o usuário pertence. */
export async function contextFor(db: Db, user: User, slug: string): Promise<Ctx> {
  const row = await db.system((q) => q.one(`select ${SHOP_COLS.split(', ').map((c) => 's.' + c).join(', ')}, m.role, m.professional_id from shops s join memberships m on m.shop_id = s.id and m.user_id = $1 where s.slug = $2`, [user.id, slug]));
  if (!row) throw notFound('Barbearia não encontrada.');
  const { role, professional_id, ...shop } = row;
  return { user, shop: shop as Shop, role, professionalId: professional_id };
}
export const shopsOf = (db: Db, userId: string) => db.system((q) => q.all<{ slug: string; name: string; role: Role }>('select s.slug, s.name, m.role from memberships m join shops s on s.id = m.shop_id where m.user_id = $1 order by s.created_at', [userId]));
export const publicShop = (db: Db, slug: string) => db.system((q) => q.one<Shop>(`select ${SHOP_COLS} from shops where slug = $1`, [slug]));

/* ---------- acesso da equipe (somente o proprietário) ---------- */
export const staffAccessSchema = z.object({
  professionalId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(8, 'A senha provisória precisa de 8 caracteres ou mais.'),
  role: z.enum(['manager', 'reception', 'barber']),
});
export async function grantStaffAccess(db: Db, ctx: Ctx, raw: unknown) {
  must(ctx, 'access.manage');
  const p = staffAccessSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  const i = p.data;
  const pro = await db.tenant(ctx.shop.id, (q) => q.one('select id from professionals where id = $1', [i.professionalId]));
  if (!pro) throw notFound('Profissional não encontrado.');
  const hash = await hashPassword(i.password);
  return db.system(async (q) => {
    // Não vincula silenciosamente uma conta que já existe (ela é de outra pessoa/outra barbearia e a senha digitada seria ignorada).
    // Convite com aceite pelo próprio dono da conta fica para a fase 2.
    if (await q.one('select 1 from users where email = $1', [i.email])) throw invalid('Esse e-mail já tem uma conta. Use outro e-mail para este acesso.');
    const u = await q.one('insert into users (email, name, password_hash) values ($1,$2,$3) returning id', [i.email, i.name, hash]);
    await q.exec('insert into memberships (shop_id, user_id, role, professional_id) values ($1,$2,$3,$4)', [ctx.shop.id, u!.id, i.role, i.professionalId]);
    await q.exec(`insert into audit_log (shop_id, user_id, action, entity, entity_id, meta) values ($1,$2,'access.granted','user',$3,$4)`, [ctx.shop.id, ctx.user.id, u!.id, JSON.stringify({ role: i.role })]);
    return u!.id as string;
  });
}

export function fieldErrors(e: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of e.issues) { const k = String(i.path[0] ?? ''); if (k && !out[k]) out[k] = i.message; }
  return out;
}
