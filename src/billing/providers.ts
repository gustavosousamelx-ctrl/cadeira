import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';

/** Evento normalizado: cada provedor traduz seus avisos para estes tipos internos. */
export type PayEvent = { eventId: string; type: 'confirmed' | 'overdue' | 'failed' | 'refunded' | 'canceled' | 'ignored'; providerPaymentId: string | null; raw: string };

export interface BillingProvider {
  id: 'sandbox' | 'asaas';
  createCustomer(o: { name: string; email: string; shopId: string; document?: string }): Promise<string>;
  createCharge(o: { customerId: string; amountCents: number; dueAt: Date; description: string; externalRef: string }): Promise<{ id: string; checkoutUrl: string }>;
  /** Autentica o aviso recebido. Sem isso, nada é processado. */
  verify(headers: Record<string, string | undefined>, rawBody: string): boolean;
  parse(rawBody: string): PayEvent;
  /** Para conciliação: consulta o status atual direto no provedor. */
  status?(providerPaymentId: string): Promise<PayEvent['type'] | null>;
}

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/* ---------------- Simulador (desenvolvimento e testes) ----------------
 * Imita um provedor real: guarda cobranças, oferece uma página de pagamento de teste
 * e confirma por aviso assinado com HMAC-SHA256 (nunca pelo retorno do navegador). */
export function sandboxProvider(db: Db, secret: string): BillingProvider & { sign(body: string): string; settle(chargeId: string, result: 'confirmed' | 'failed' | 'overdue' | 'refunded'): Promise<string> } {
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex');
  return {
    id: 'sandbox',
    async createCustomer() { return 'cus_' + randomBytes(6).toString('hex'); },
    async createCharge(o) {
      const id = 'pay_' + randomBytes(8).toString('hex');
      await db.system((q) => q.exec('insert into sandbox_charges (id, customer_id, amount_cents) values ($1,$2,$3)', [id, o.customerId, o.amountCents]));
      return { id, checkoutUrl: `/sandbox/pagar/${id}` };
    },
    verify(headers, raw) { const s = headers['x-sandbox-signature']; return !!s && safeEq(s, sign(raw)); },
    parse(raw) {
      const b = JSON.parse(raw);
      const map: Record<string, PayEvent['type']> = { 'payment.confirmed': 'confirmed', 'payment.failed': 'failed', 'payment.overdue': 'overdue', 'payment.refunded': 'refunded', 'payment.canceled': 'canceled' };
      return { eventId: String(b.id), type: map[b.type] ?? 'ignored', providerPaymentId: b.payment_id ?? null, raw };
    },
    async status(id) { const r = await db.system((q) => q.one('select status from sandbox_charges where id = $1', [id])); return r ? (r.status === 'pending' ? null : r.status) : null; },
    sign,
    /** Simula o provedor mudando a cobrança e devolve o corpo do aviso que ele enviaria. */
    async settle(chargeId, result) {
      await db.system((q) => q.exec('update sandbox_charges set status = $2 where id = $1', [chargeId, result]));
      return JSON.stringify({ id: 'evt_' + randomBytes(8).toString('hex'), type: 'payment.' + result, payment_id: chargeId });
    },
  };
}

/* ---------------- Asaas ----------------
 * Escolhido para o Brasil por ter Pix, boleto e cartão, ambiente sandbox e avisos com token.
 * Conferido com a documentação oficial (docs.asaas.com, nov/2026): URLs, header "access_token", cpfCnpj obrigatório no
 * cliente, invoiceUrl, avisos com "asaas-access-token" (32–255 caracteres), entrega "pelo menos uma vez" (id do evento
 * repete nos reenvios) e sem garantia de ordem no modo não sequencial. Ainda não executado contra a API real (falta a conta). */
export const ASAAS_URLS = { sandbox: 'https://api-sandbox.asaas.com/v3', production: 'https://api.asaas.com/v3' };
/** Status da cobrança no Asaas -> estado interno. CONFIRMED (cartão/boleto, saldo ainda não liberado) e RECEIVED contam como pago. */
export const ASAAS_STATUS: Record<string, PayEvent['type'] | null> = { RECEIVED: 'confirmed', CONFIRMED: 'confirmed', RECEIVED_IN_CASH: 'confirmed', OVERDUE: 'overdue', REFUNDED: 'refunded', PENDING: null, AWAITING_RISK_ANALYSIS: null };
export const ASAAS_EVENTS: Record<string, PayEvent['type']> = {
  PAYMENT_CONFIRMED: 'confirmed', PAYMENT_RECEIVED: 'confirmed', PAYMENT_OVERDUE: 'overdue', PAYMENT_REFUNDED: 'refunded', PAYMENT_DELETED: 'canceled',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'failed', PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'failed',
};
export function asaasProvider(cfg: { apiKey: string; webhookToken: string; sandbox: boolean; fetchImpl?: typeof fetch }): BillingProvider {
  if (cfg.webhookToken.length < 32 || cfg.webhookToken.length > 255 || /\s/.test(cfg.webhookToken)) throw new Error('ASAAS_WEBHOOK_TOKEN precisa ter de 32 a 255 caracteres, sem espaços (regra do Asaas).');
  const base = cfg.sandbox ? ASAAS_URLS.sandbox : ASAAS_URLS.production;
  const f = cfg.fetchImpl ?? fetch;
  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const res = await f(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), access_token: cfg.apiKey, 'user-agent': 'Cadeira/1.0' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Asaas ${method} ${path}: ${res.status} ${JSON.stringify(data?.errors ?? data).slice(0, 300)}`);
    return data;
  }
  return {
    id: 'asaas',
    async createCustomer(o) {
      // a API aceita clientes duplicados: procura antes pelo externalReference (id da barbearia) para não criar dois
      const found = await call('GET', `/customers?externalReference=${encodeURIComponent(o.shopId)}&limit=1`);
      if (found?.data?.[0]?.id) return found.data[0].id;
      if (!o.document) throw new Error('O Asaas exige CPF ou CNPJ para cadastrar o pagador.');
      return (await call('POST', '/customers', { name: o.name, email: o.email, cpfCnpj: o.document, externalReference: o.shopId, notificationDisabled: false })).id;
    },
    async createCharge(o) {
      // billingType UNDEFINED: o cliente escolhe Pix, boleto ou cartão na página de pagamento (invoiceUrl)
      const r = await call('POST', '/payments', { customer: o.customerId, billingType: 'UNDEFINED', value: Math.round(o.amountCents) / 100, dueDate: o.dueAt.toISOString().slice(0, 10), description: o.description.slice(0, 500), externalReference: o.externalRef });
      if (!r.id || !r.invoiceUrl) throw new Error('Asaas não devolveu id/invoiceUrl da cobrança.');
      return { id: r.id, checkoutUrl: r.invoiceUrl };
    },
    verify(headers) { const t = headers['asaas-access-token']; return !!t && safeEq(t, cfg.webhookToken); },
    parse(raw) {
      // campos novos podem aparecer a qualquer momento: lê só o que precisa e nunca falha por campo desconhecido
      const b = JSON.parse(raw);
      return { eventId: String(b.id ?? `${b.event}:${b.payment?.id}:${b.dateCreated}`), type: ASAAS_EVENTS[b.event] ?? 'ignored', providerPaymentId: b.payment?.id ?? null, raw };
    },
    async status(id) { const r = await call('GET', `/payments/${encodeURIComponent(id)}/status`); return ASAAS_STATUS[r?.status] ?? null; },
  };
}

export function providerFromEnv(db: Db): BillingProvider | null {
  const which = process.env.BILLING_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'sandbox');
  if (which === 'asaas') {
    if (!process.env.ASAAS_API_KEY || !process.env.ASAAS_WEBHOOK_TOKEN) return null;
    return asaasProvider({ apiKey: process.env.ASAAS_API_KEY, webhookToken: process.env.ASAAS_WEBHOOK_TOKEN, sandbox: process.env.ASAAS_ENV !== 'production' });
  }
  if (which === 'sandbox') return sandboxProvider(db, process.env.BILLING_WEBHOOK_SECRET || randomBytes(24).toString('hex'));
  return null; // produção sem provedor configurado: contratação fica indisponível, com aviso
}
