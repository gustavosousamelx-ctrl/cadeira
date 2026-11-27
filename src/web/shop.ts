import { h, raw, doc, ICON, Safe } from './html.ts';
import type { Shop } from '../domain/accounts.ts';
import { resolveTheme, themeVars } from '../domain/themes.ts';
import { PLATFORM, brl, fmtPhone, hhmm, toLocal, clock, addDays, newToken } from '../lib/core.ts';
import { dayLabel } from './panel.ts';

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DOWL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const initials = (n: string) => n.replace(/&/g, ' ').split(/\s+/).filter((w) => w.length > 1 || /[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export interface ShopData { shop: Shop; services: any[]; pros: any[]; hours: any[] }

/** Prévia ao compartilhar o link (WhatsApp, Instagram) e dados estruturados para o Google (schema.org HairSalon). */
function meta(d: ShopData, url: string) {
  const s = d.shop, desc = s.description || `Agende seu horário na ${s.name}.`;
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ld = {
    '@context': 'https://schema.org', '@type': 'HairSalon', name: s.name, url, description: desc,
    ...(s.address ? { address: s.address } : {}),
    ...(s.phone ? { telephone: '+' + (s.phone.length <= 11 ? '55' + s.phone : s.phone) } : {}),
    openingHoursSpecification: d.hours.filter((x) => !x.professional_id).map((x) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: wd[x.weekday], opens: hhmm(x.start_min), closes: hhmm(x.end_min) })),
  };
  // "<" escapado: um nome com "</script>" não fecha o bloco
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return h`<meta property="og:type" content="website"><meta property="og:title" content="${s.name}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:locale" content="pt_BR">
<link rel="canonical" href="${url}"><script type="application/ld+json">${raw(json)}</script>`;
}

function frame(d: ShopData, title: string, main: Safe, opts: { noindex?: boolean; url?: string } = {}) {
  const s = d.shop, t = resolveTheme(s.theme);
  const nowL = toLocal(clock.now(), s.timezone);
  const shopH = d.hours.filter((x) => !x.professional_id);
  const today = shopH.filter((x) => x.weekday === nowL.weekday);
  const openNow = today.find((x) => nowL.minutes >= x.start_min && nowL.minutes < x.end_min);
  let status: Safe;
  if (openNow) status = h`<span class="open">Aberto agora</span> · até ${hhmm(openNow.end_min)}`;
  else {
    const later = today.find((x) => x.start_min > nowL.minutes);
    if (later && today.some((x) => x.end_min <= nowL.minutes)) status = h`<span class="closed">Em pausa</span> · volta às ${hhmm(later.start_min)}`;
    else {
      let nx: Safe = h``;
      for (let i = 0; i < 8; i++) { const wd = (nowL.weekday + i) % 7; const iv = shopH.filter((x) => x.weekday === wd && (i > 0 || x.start_min > nowL.minutes)); if (iv.length) { nx = h` · abre ${i === 0 ? 'hoje' : i === 1 ? 'amanhã' : DOWL[wd].toLowerCase()} às ${hhmm(iv[0].start_min)}`; break; } }
      status = h`<span class="closed">Fechado</span>${nx}`;
    }
  }
  const body = h`
  ${s.is_demo ? h`<div class="demo-note">Barbearia de demonstração do ${PLATFORM.name}. Os agendamentos feitos aqui são de teste.</div>` : ''}
  <header class="sh-head"><div class="wrap">
    <a class="mono" href="/b/${s.slug}"><span aria-hidden="true">${initials(s.name)}</span><span class="sr">Início da página da ${s.name}</span></a>
    <div class="sh-id"><h1>${s.name}</h1><p>${status}${s.address ? h` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}" target="_blank" rel="noopener">${s.address}</a>` : ''}</p></div>
  </div></header>
  <div class="wrap sh-grid">
  <main class="sh-main">${main}</main>
  <aside class="sh-info">
    <section><h2>Horários</h2><dl class="hours">${[1, 2, 3, 4, 5, 6, 0].map((wd) => { const iv = shopH.filter((x) => x.weekday === wd); return h`<dt class="${wd === nowL.weekday ? 'today' : ''}">${DOWL[wd]}</dt><dd class="${wd === nowL.weekday ? 'today' : ''}">${iv.length ? iv.map((x) => `${hhmm(x.start_min)}–${hhmm(x.end_min)}`).join(', ') : 'Fechado'}</dd>`; })}</dl></section>
    <section><h2>Contato</h2>
      ${s.description ? h`<p>${s.description}</p>` : ''}
      ${s.phone ? h`<p>WhatsApp <span class="sel">${fmtPhone(s.phone.replace(/^55(?=\d{10,11}$)/, ''))}</span></p>` : ''}
      ${s.instagram ? h`<p><a href="https://instagram.com/${s.instagram}" target="_blank" rel="noopener">@${s.instagram}</a></p>` : ''}
    </section>
  </aside>
  </div>
  <footer class="sh-foot"><div class="wrap"><p class="powered">Agendamento por <a href="/">${PLATFORM.name}</a></p></div></footer>`;
  return doc({ title, body, css: ['shop.css'], scripts: ['forms.js'], fonts: [t.preset.fonts], style: themeVars(s.theme), bodyClass: `t-${t.id}`, desc: s.description || `Agende seu horário na ${s.name}.`,
    noindex: opts.noindex || s.is_demo, head: opts.url && !opts.noindex ? meta(d, opts.url) : undefined });
}

export function unavailable(name: string) {
  return doc({ title: name, css: ['site.css'], body: h`<main class="center-msg"><h1>${name}</h1><p>O agendamento online está temporariamente indisponível. Fale direto com a barbearia para marcar seu horário.</p></main>` });
}
export function notPublished(name: string) {
  return doc({ title: name, css: ['site.css'], body: h`<main class="center-msg"><h1>${name}</h1><p>Esta página de agendamento ainda não foi publicada.</p></main>` });
}

/** Parâmetros do fluxo ficam na URL: voltar no navegador preserva as escolhas. */
export interface Sel { s: string[]; p?: string; d?: string; t?: string }
const qs = (sel: Partial<Sel>) => { const u = new URLSearchParams(); (sel.s || []).forEach((x) => u.append('s', x)); if (sel.p) u.set('p', sel.p); if (sel.d) u.set('d', sel.d); if (sel.t) u.set('t', sel.t); const v = u.toString(); return v ? '?' + v : ''; };

function stepsNav(d: ShopData, sel: Sel, step: number) {
  const base = `/b/${d.shop.slug}`;
  const items: [string, string | null][] = [['Serviço', base + qs({ s: sel.s })], ['Profissional', sel.s.length ? base + qs({ s: sel.s }) + (sel.s.length ? '&pro=1' : '') : null], ['Horário', sel.p ? base + qs({ s: sel.s, p: sel.p, d: sel.d }) : null], ['Seus dados', null]];
  return h`<ol class="steps" aria-label="Etapas">${items.map(([l, href], i) => h`<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}" ${i + 1 === step ? raw('aria-current="step"') : ''}>${href && i + 1 < step ? h`<a href="${href}">${l}</a>` : l}</li>`)}</ol>`;
}
function summary(d: ShopData, sel: Sel, q: { durationMin: number; priceCents: number } | null) {
  if (!q) return '';
  const pro = sel.p === 'any' ? 'Quem estiver livre' : d.pros.find((p) => p.id === sel.p)?.name;
  const names = d.services.filter((x) => sel.s.includes(x.id)).map((x) => x.name).join(' + ');
  const when = sel.t && !Number.isNaN(Date.parse(sel.t)) ? (() => { const l = toLocal(new Date(sel.t!), d.shop.timezone); return `${dayLabel(l.date)}, ${hhmm(l.minutes)}`; })() : '';
  return h`<div class="tally"><div><b>${names}</b><small>${[pro, when].filter(Boolean).join(' · ')}</small></div><div class="tot"><b>${brl(q.priceCents)}</b><small>${q.durationMin} min</small></div></div>`;
}

export function bookingFlow(d: ShopData, sel: Sel & { pro?: boolean }, extra: { quote?: any; days?: { date: string; n: number; open: boolean }[]; slots?: any[]; error?: string; alternatives?: any[]; form?: { name: string; phone: string }; url?: string }) {
  const base = `/b/${d.shop.slug}`;
  let step = 1, body: Safe;
  const err = extra.error ? h`<div class="alert" role="alert">${extra.error}</div>` : '';
  if (!sel.s.length || (!sel.p && !sel.pro && !extra.quote)) {
    step = 1;
    body = h`<h2>Escolha o serviço</h2><p class="hint">Pode marcar mais de um. Tempo e valor somam.</p>
      <form method="get" action="${base}" class="menu-form">
        <ul class="menu">${d.services.map((x) => h`<li><label class="item"><input type="checkbox" name="s" value="${x.id}" ${sel.s.includes(x.id) ? 'checked' : ''}>
          <span class="box">${ICON.check}</span><span class="nm">${x.name}</span><span class="dots"></span><span class="pr">${brl(x.price_cents)}</span>
          <span class="ds">${x.description}</span><span class="du">${x.duration_min} min</span></label></li>`)}</ul>
        <input type="hidden" name="pro" value="1">
        <div class="bar"><span class="hint">Escolha ao menos um serviço</span><button class="btn primary">Continuar</button></div>
      </form>`;
  } else if (!sel.p) {
    step = 2;
    body = h`<h2>Com quem?</h2>
      <ul class="pros">
        <li><a class="pro" href="${base + qs({ s: sel.s, p: 'any' })}"><span class="av any">${ICON.team}</span><span><b>Quem estiver livre</b><small>Mostra mais horários</small></span>${ICON.right}</a></li>
        ${d.pros.map((p) => h`<li><a class="pro" href="${base + qs({ s: sel.s, p: p.id })}"><span class="av">${initials(p.name)}</span><span><b>${p.name}</b>${p.title ? h`<small>${p.title}</small>` : ''}</span>${ICON.right}</a></li>`)}
      </ul>`;
  } else if (!sel.t || extra.slots) {
    step = 3;
    const slots = extra.slots || [];
    const groups = [['Manhã', 0, 720], ['Tarde', 720, 1080], ['Noite', 1080, 1440]].map(([l, a, b]) => [l, slots.filter((x) => x.min >= (a as number) && x.min < (b as number))] as const).filter((g) => g[1].length);
    body = h`<h2>Escolha o horário</h2>${err}
      <nav class="days" aria-label="Dias">${(extra.days || []).map((x) => { const dt = new Date(x.date + 'T12:00:00Z'); const i = Math.round((Date.parse(x.date) - Date.parse(toLocal(clock.now(), d.shop.timezone).date)) / 864e5); const lab = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : DOW[dt.getUTCDay()];
        return x.n ? h`<a class="day ${sel.d === x.date ? 'on' : ''}" href="${base + qs({ s: sel.s, p: sel.p, d: x.date })}" ${sel.d === x.date ? raw('aria-current="date"') : ''}><small>${lab}</small><b>${dt.getUTCDate()}</b><em>${x.n} ${x.n === 1 ? 'vaga' : 'vagas'}</em></a>`
          : h`<span class="day off"><small>${lab}</small><b>${dt.getUTCDate()}</b><em>${x.open ? 'lotado' : 'fechado'}</em></span>`; })}</nav>
      ${groups.length ? groups.map(([l, ts]) => h`<div class="period"><h3>${l}</h3><div class="slots">${ts.map((x) => h`<a class="slot" href="${base + qs({ s: sel.s, p: sel.p, d: sel.d, t: x.startsAt })}">${x.time}</a>`)}</div></div>`) : h`<p class="empty">Sem horário livre neste dia. Escolha outro dia acima.</p>`}`;
  } else {
    step = 4;
    body = h`<h2>Seus dados</h2>${err}
      <form method="post" action="${base}/reservar" class="details" autocomplete="on">
        ${sel.s.map((x) => h`<input type="hidden" name="s" value="${x}">`)}<input type="hidden" name="p" value="${sel.p}"><input type="hidden" name="t" value="${sel.t}"><input type="hidden" name="k" value="${newToken(18)}">
        <div class="field"><label for="nm">Nome</label><input class="input" id="nm" name="name" autocomplete="name" required minlength="2" maxlength="80" value="${extra.form?.name ?? ''}"></div>
        <div class="field"><label for="ph">WhatsApp</label><input class="input" id="ph" name="phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="(11) 98765-4321" value="${extra.form?.phone ?? ''}"></div>
        <div class="hp" aria-hidden="true"><label for="ws">Não preencha</label><input id="ws" name="website" tabindex="-1" autocomplete="off"></div>
        <p class="hint">Pagamento na barbearia. Você recebe um link para ver, remarcar ou cancelar o horário${d.shop.policy.cancel_until_min ? ` até ${d.shop.policy.cancel_until_min >= 1440 ? '1 dia' : d.shop.policy.cancel_until_min / 60 + 'h'} antes` : ''}.</p>
        <p class="hint privacy">Seu nome e WhatsApp ficam só com a ${d.shop.name}, para o agendamento e o lembrete. Nada de propaganda de outras empresas.</p>
        <div class="bar"><a class="btn ghost" href="${base + qs({ s: sel.s, p: sel.p, d: sel.d })}">Trocar horário</a><button class="btn primary">Confirmar horário</button></div>
      </form>`;
  }
  return frame(d, `Agendar · ${d.shop.name}`, h`<section class="book">${stepsNav(d, sel, step)}${summary(d, sel, extra.quote ?? null)}<div class="pane">${body}</div></section>`, { url: extra.url });
}

type Move = { blocked: boolean; days: { date: string; open: boolean; n: number }[]; d: string; slots: any[] };
function moveSection(d: ShopData, link: string, m: Move) {
  if (m.blocked) return h`<div class="alert">A remarcação online está indisponível agora. Fale com a barbearia.</div>`;
  const t0 = toLocal(clock.now(), d.shop.timezone).date;
  const groups = [['Manhã', 0, 720], ['Tarde', 720, 1080], ['Noite', 1080, 1440]].map(([l, a, b]) => [l, m.slots.filter((x) => x.min >= (a as number) && x.min < (b as number))] as const).filter((g) => g[1].length);
  return h`<section class="move" id="remarcar"><h3>Escolha o novo horário</h3>
    <nav class="days" aria-label="Dias">${m.days.map((x) => { const dt = new Date(x.date + 'T12:00:00Z'); const i = Math.round((Date.parse(x.date) - Date.parse(t0)) / 864e5); const lab = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : DOW[dt.getUTCDay()];
      return x.n ? h`<a class="day ${m.d === x.date ? 'on' : ''}" href="${link}?remarcar=1&d=${x.date}#remarcar" ${m.d === x.date ? raw('aria-current="date"') : ''}><small>${lab}</small><b>${dt.getUTCDate()}</b><em>${x.n} ${x.n === 1 ? 'vaga' : 'vagas'}</em></a>`
        : h`<span class="day off"><small>${lab}</small><b>${dt.getUTCDate()}</b><em>${x.open ? 'lotado' : 'fechado'}</em></span>`; })}</nav>
    ${groups.length ? h`<form method="post" action="${link}/remarcar">${groups.map(([l, ts]) => h`<div class="period"><h3>${l}</h3><div class="slots">${ts.map((x) => h`<button class="slot" name="t" value="${x.startsAt}">${x.time}</button>`)}</div></div>`)}</form>`
      : h`<p class="empty">Sem horário livre neste dia com o mesmo profissional. Escolha outro dia acima.</p>`}
    <p><a href="${link}">Manter o horário atual</a></p>
  </section>`;
}

export function managePage(d: ShopData, b: any, token: string, o: { fresh?: boolean; error?: string; cancelled?: boolean; confirmed?: boolean; moved?: boolean; move?: Move }) {
  const s = d.shop, L = toLocal(new Date(b.starts_at), s.timezone);
  const ymd = L.date.replace(/-/g, ''), st = `${ymd}T${hhmm(L.minutes).replace(':', '')}00`, en = `${ymd}T${hhmm(L.minutes + b.duration_min).replace(':', '')}00`;
  const services = b.items.map((i: any) => i.name).join(' + ');
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(services + ' · ' + s.name)}&dates=${st}/${en}&ctz=${encodeURIComponent(s.timezone)}&location=${encodeURIComponent(s.address)}`;
  const link = `/b/${s.slug}/reserva/${token}`;
  return frame(d, `Sua reserva · ${s.name}`, h`<section class="book ticket">
    ${o.fresh ? h`<p class="ok">${ICON.check} Horário reservado</p><h2>Até ${L.date === toLocal(clock.now(), s.timezone).date ? 'hoje' : dayLabel(L.date).toLowerCase()}, ${b.customer_name.split(' ')[0]}.</h2>` : h`<h2>Sua reserva</h2>`}
    ${o.error ? h`<div class="alert" role="alert">${o.error}</div>` : ''}
    ${o.moved ? h`<p class="ok" role="status">${ICON.check} Horário remarcado</p>` : ''}
    ${b.status === 'cancelled' ? h`<div class="alert">${o.cancelled ? 'Reserva cancelada. O horário foi liberado.' : 'Esta reserva foi cancelada.'}</div>` : ''}
    ${b.client_confirmed_at && b.status !== 'cancelled' ? h`<p class="ok presence" role="status">${ICON.check} Presença confirmada${o.confirmed ? '. Até lá!' : ''}</p>` : ''}
    ${b.canConfirm && !o.fresh && !o.move ? h`<form method="post" action="${link}/confirmar" class="confirm"><button class="btn primary wide">${ICON.check} Confirmar presença</button><p class="hint">Assim a barbearia sabe que pode contar com você.</p></form>` : ''}
    <dl class="comanda">
      <dt>Quando</dt><dd>${dayLabel(L.date)}, ${hhmm(L.minutes)}</dd>
      <dt>Serviço</dt><dd>${services}</dd>
      <dt>Com</dt><dd>${b.pro_name}</dd>
      <dt>Duração</dt><dd>${b.duration_min} min</dd>
      <dt class="tot">Total</dt><dd class="tot">${brl(b.price_cents)}</dd>
    </dl>
    ${o.move ? moveSection(d, link, o.move) : b.status !== 'cancelled' ? h`<div class="actions">
      <a class="btn" href="${gcal}" target="_blank" rel="noopener">${ICON.agenda} Salvar na agenda</a>
      ${b.canChange ? h`<a class="btn" href="${link}?remarcar=1#remarcar">${ICON.clock} Remarcar</a>` : ''}
      ${s.phone ? h`<a class="btn" href="https://wa.me/${s.phone.length <= 11 ? '55' + s.phone : s.phone}?text=${encodeURIComponent(`Olá! Tenho horário ${dayLabel(L.date)} às ${hhmm(L.minutes)} (${services}).`)}" target="_blank" rel="noopener">Falar com a barbearia</a>` : ''}
    </div>` : ''}
    ${o.fresh ? h`<p class="hint keep">Guarde este link: é por ele que você vê, remarca ou cancela o horário. Ninguém mais tem acesso.</p>` : ''}
    ${o.move ? '' : b.canCancel ? h`<form method="post" action="${link}/cancelar" class="cancel"><button class="btn ghost danger">Cancelar reserva</button></form>` : b.status !== 'cancelled' && b.status !== 'completed' ? h`<p class="hint">Para cancelar ou remarcar agora, fale com a barbearia.</p>` : ''}
    <p><a href="/b/${s.slug}">Fazer outro agendamento</a></p>
  </section>`, { noindex: true });
}

export function daysStrip(today: string, n: number) { return Array.from({ length: n }, (_, i) => addDays(today, i)); }
