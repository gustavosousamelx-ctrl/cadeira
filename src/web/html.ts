import { PLATFORM } from '../lib/core.ts';

/** Template HTML com escape automático. Só `raw()` e outros `h``...`` entram sem escape. */
export class Safe { s: string; constructor(s: string) { this.s = s; } toString() { return this.s; } }
export const raw = (s: string) => new Safe(s);
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function render(v: unknown): string {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
export function h(strings: TemplateStringsArray, ...vals: unknown[]) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}

export const ICON: Record<string, Safe> = Object.fromEntries(Object.entries({
  today: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>',
  agenda: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  chat: '<path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 9 19z"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.3-2.6-1.6-4.3-3.6-5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5h4"/>',
  page: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  users: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
}).map(([k, d]) => [k, raw(`<svg class="i" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`)]));

/** Marca: uma cadeira montada com blocos de agenda; o assento vermelho é o horário marcado. Encosto e pé seguem a cor do texto. */
export const MARK = `<rect x="3" y="2" width="6" height="15" rx="2" fill="currentColor"/><rect x="10" y="17" width="4" height="5" rx="1" fill="currentColor"/><rect x="3" y="12" width="18" height="6" rx="2" fill="#D6281F"/>`;
export const LOGO = raw(`<svg class="mk" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">${MARK}</svg>`);
/** Ícone (favicon, app): fundo preto quente, encosto e pé brancos, assento vermelho. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.5" fill="#17130F"/><g transform="translate(2.4 2.4) scale(.8)" color="#fff">${MARK}</g></svg>`;

/** Versão dos arquivos estáticos: muda a cada publicação, então o navegador nunca usa CSS antigo. */
const ASSET_V = process.env.ASSET_VERSION || Date.now().toString(36);
const FONT = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400;500;600;700&display=swap';
export function doc(o: { title: string; body: Safe; css: string[]; fonts?: string[]; bodyClass?: string; style?: string; desc?: string; scripts?: string[]; head?: Safe; noindex?: boolean }) {
  return '<!doctype html>' + h`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${o.title}</title>${o.desc ? h`<meta name="description" content="${o.desc}">
    <meta property="og:locale" content="pt_BR">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${o.title}">
    <meta property="og:description" content="${o.desc}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${o.title}">
    <meta name="twitter:description" content="${o.desc}">` : ''}
${o.noindex ? raw('<meta name="robots" content="noindex,nofollow">') : ''}
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#17130F"><link rel="apple-touch-icon" href="/static/img/apple-touch-icon.png">
${o.head ?? ''}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${(o.fonts ?? [FONT]).map((f) => h`<link rel="stylesheet" href="${f}">`)}
${o.css.map((c) => h`<link rel="stylesheet" href="/static/${c}?v=${ASSET_V}">`)}
${(o.scripts ?? []).map((s) => h`<script src="/static/${s}?v=${ASSET_V}" defer></script>`)}
<link rel="icon" href="/favicon.ico" type="image/svg+xml">
</head><body class="${o.bodyClass ?? ''}" ${o.style ? h`style="${o.style}"` : ''}>
  <a class="skip" href="#conteudo">Pular para o conteúdo</a><div id="conteudo">${o.body}</div></body></html>`.s;
}

export const MESSAGES: Record<string, string> = {
  saved: 'Alterações salvas.', created: 'Cadastrado.', archived: 'Arquivado. O histórico continua.', restored: 'Reativado.',
  booked: 'Horário marcado.', moved: 'Horário mudado. Se quiser, mande o lembrete: ele já vai com o horário novo.', status: 'Agendamento atualizado.', published: 'Página publicada. Já dá para receber agendamentos.', unpublished: 'Página fora do ar.',
  access: 'Acesso criado. Envie o e-mail e a senha provisória para a pessoa.', blocked: 'Bloqueio criado.', unblocked: 'Bloqueio removido.',
  sale: 'Pagamento registrado no caixa.', sale_void: 'Venda estornada.', cash_closed: 'Caixa do dia fechado.', customer_saved: 'Dados do cliente salvos.', customer_deleted: 'Dados pessoais apagados.', contact: 'Mensagem enviada. Respondemos pelo e-mail informado.',
  plan_changed: 'Plano alterado.', plan_scheduled: 'Troca de plano agendada para a próxima renovação.', sub_canceled: 'Cancelamento registrado.', sub_resumed: 'Assinatura mantida. Nada muda na cobrança.',
  welcome: 'Barbearia criada. Siga os passos abaixo para começar a receber agendamentos.',
};
export const flash = (key?: string, err?: string) => err ? h`<div class="flash err" role="alert">${err}</div>` : key && MESSAGES[key] ? h`<div class="flash ok" role="status">${MESSAGES[key]}</div>` : '';
export const platformName = () => PLATFORM.name;
