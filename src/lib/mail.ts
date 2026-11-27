// Envio de e-mail transacional (recuperação de senha, aviso de senha alterada).
// Com RESEND_API_KEY configurada, envia pela API do Resend; sem ela, só registra no console.
import type { Db } from '../db/db.ts';

export interface Mail { idempotencyKey?: string; to: string; subject: string; text: string }
export interface Mailer { id: string; send(m: Mail): Promise<void> }

export function resendMailer(cfg: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const f = cfg.fetchImpl ?? fetch;
  return {
    id: 'resend',
    async send(m) {
      const r = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json', ...(m.idempotencyKey ? { 'Idempotency-Key': m.idempotencyKey } : {}) },
        body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`Resend respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}

/** Sem provedor: em desenvolvimento mostra o e-mail no console (para testar o fluxo); em produção não mostra o conteúdo, que pode ter link de acesso. */
export function consoleMailer(production: boolean): Mailer {
  return {
    id: 'console',
    async send(m) {
      if (production) console.warn(`E-mail NÃO enviado (configure RESEND_API_KEY e MAIL_FROM): "${m.subject}" para ${m.to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
      else console.log(`\n--- e-mail (não enviado: sem RESEND_API_KEY) ---\nPara: ${m.to}\nAssunto: ${m.subject}\n\n${m.text}\n---\n`);
    },
  };
}

export function mailerFromEnv(): Mailer {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (key && from) return resendMailer({ apiKey: key, from });
  return consoleMailer(process.env.NODE_ENV === 'production');
}

/** Caixa de saída em memória, para testes. */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { id: 'memory', sent, async send(m) { sent.push(m); } };
}

export async function deliverSupportNotices(db: Db, mailer: Mailer) {
  if (mailer.id === 'console') return;
  for (let i = 0; i < 10; i++) {
    const found = await db.system(async q => {
      const m = await q.one(`select * from contact_messages where notify_to is not null and notified_at is null
        and handled_at is null and notify_attempts < 8 and notify_after <= now()
        order by notify_after, id limit 1 for update skip locked`);
      if (!m) return false;
      try {
        await mailer.send({ to: m.notify_to, idempotencyKey: 'support-' + m.id + '-' + new Date(m.created_at).getTime(),
          subject: 'Contato pelo site: ' + m.name,
          text: [m.name, m.email, m.phone, m.shop_name, '', m.message, '', 'Consulte /admin/suporte.'].join('\n') });
      } catch {
        await q.exec(`update contact_messages set notify_attempts = notify_attempts + 1,
          notify_after = now() + interval '1 minute' * power(2, notify_attempts) where id = $1`, [m.id]);
        return true;
      }
      await q.exec('update contact_messages set notified_at = now() where id = $1', [m.id]);
      return true;
    });
    if (!found) break;
  }
}
