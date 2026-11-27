// Envio de e-mail transacional (recuperação de senha, aviso de senha alterada).
// Com RESEND_API_KEY configurada, envia pela API do Resend; sem ela, só registra no console.
export interface Mail { to: string; subject: string; text: string }
export interface Mailer { id: string; send(m: Mail): Promise<void> }

export function resendMailer(cfg: { apiKey: string; from: string; fetchImpl?: typeof fetch }): Mailer {
  const f = cfg.fetchImpl ?? fetch;
  return {
    id: 'resend',
    async send(m) {
      const r = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
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
