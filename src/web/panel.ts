import { h, raw, doc, ICON, LOGO, Safe, flash } from './html.ts';
import type { Ctx } from '../domain/accounts.ts';
import { can, ROLE_LABEL } from '../domain/accounts.ts';
import { STATUS_LABEL, TRANSITIONS } from '../domain/booking.ts';
import { PRESETS, resolveTheme } from '../domain/themes.ts';
import { PLATFORM, brl, fmtPhone, hhmm, addDays, toLocal, clock } from '../lib/core.ts';

const DOW = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dayLabel = (d: string) => { const x = new Date(d + 'T12:00:00Z'); return `${DOW[x.getUTCDay()]}, ${x.getUTCDate()} de ${MES[x.getUTCMonth()]}`; };
const shortDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); return `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
export const chip = (s: string) => h`<span class="st st-${s}">${STATUS_LABEL[s]}</span>`;
const eta = (m: number) => m < 60 ? `em ${m} min` : `em ${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
const real = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

type Flash = { ok?: string; err?: string };
export function layout(ctx: Ctx, active: string, title: string, content: Safe, f: Flash = {}, actions: Safe | string = '') {
  const base = `/app/s/${ctx.shop.slug}`;
  const nav: [string, string, string, boolean][] = [
    ['hoje', 'Hoje', 'today', true], ['agenda', 'Agenda', 'agenda', true], ['novo', 'Novo horário', 'plus', true],
    ['lembretes', 'Lembretes', 'bell', true], ['caixa', 'Caixa', 'money', can(ctx, 'cash.view')], ['clientes', 'Clientes', 'users', can(ctx, 'customers.view')],
    ['financeiro', 'Financeiro', 'chart', can(ctx, 'reports.view')], ['comissoes', 'Minhas comissões', 'chart', !can(ctx, 'reports.view')],
    ['servicos', 'Serviços', 'scissors', can(ctx, 'catalog.manage')], ['equipe', 'Equipe', 'team', can(ctx, 'team.manage')],
    ['horarios', 'Horários e bloqueios', 'clock', can(ctx, 'catalog.manage')], ['pagina', 'Página pública', 'page', can(ctx, 'page.manage')],
    ['assinatura', 'Assinatura', 'card', can(ctx, 'billing.manage')],
  ];
  const href = (k: string) => k === 'hoje' ? base : `${base}/${k}`;
  const ent = ctx.ent;
  const banner = ent && ent.level !== 'ok' && active !== 'assinatura' && active !== ''
    ? h`<div class="sub-banner ${ent.level}">${ent.message} ${can(ctx, 'billing.manage') ? h`<a href="${base}/assinatura">${ent.ok ? 'Ver assinatura' : 'Escolher plano'}</a>` : ''}</div>` : '';
  const links = nav.filter((n) => n[3]).map(([k, l, i]) => h`<a href="${href(k)}" class="${active === k ? 'on' : ''}" ${active === k ? raw('aria-current="page"') : ''}>${ICON[i]}<span>${l}</span></a>`);
  const MOB = ['hoje', 'agenda', 'novo', can(ctx, 'cash.view') ? 'caixa' : 'comissoes'];
  const mob = nav.filter((n) => n[3] && MOB.includes(n[0]));
  const body = h`
  <div class="shell">
    <aside class="side">
      <a class="brand" href="/app">${LOGO}<span>${PLATFORM.name}</span></a>
      <div class="shopbox"><b>${ctx.shop.name}</b><small>${ROLE_LABEL[ctx.role]} · ${ctx.user.name.split(' ')[0]}</small></div>
      <nav class="nav" aria-label="Painel">${links}</nav>
      <div class="side-foot">
        <a href="/b/${ctx.shop.slug}" target="_blank" rel="noopener">${ICON.ext}<span>Ver página pública</span></a>
        <form method="post" action="/sair"><button>${ICON.out}<span>Sair</span></button></form>
      </div>
    </aside>
    <div class="mtop"><a class="brand" href="${base}" aria-label="Hoje">${LOGO}</a><b>${ctx.shop.name}</b></div>
    <main class="main" id="conteudo">
      ${banner}
      <header class="pagehead"><h1>${title}</h1><div class="acts">${actions}</div></header>
      ${flash(f.ok, f.err)}
      ${content}
    </main>
    <nav class="mnav" aria-label="Atalhos">
      ${mob.map(([k, l, i]) => h`<a href="${href(k)}" class="${active === k ? 'on' : ''}">${ICON[i]}<span>${k === 'novo' ? 'Novo' : k === 'comissoes' ? 'Comissões' : l}</span></a>`)}
      <a href="${base}/menu" class="${!MOB.includes(active) ? 'on' : ''}">${ICON.menu}<span>Mais</span></a>
    </nav>
  </div>`;
  return doc({ title: `${title} · ${ctx.shop.name}`, body, css: ['app.css'], scripts: ['panel.js'], bodyClass: `page-${active || 'bloqueio'}` });
}

export function menuPage(ctx: Ctx) {
  const base = `/app/s/${ctx.shop.slug}`;
  const items: [string, string, string, boolean][] = [['lembretes', 'Lembretes de amanhã', 'bell', true], ['clientes', 'Clientes', 'users', can(ctx, 'customers.view')], ['financeiro', 'Financeiro e comissões', 'chart', can(ctx, 'reports.view')], ['comissoes', 'Minhas comissões', 'chart', !can(ctx, 'reports.view')], ['caixa', 'Caixa', 'money', can(ctx, 'cash.view')], ['comecar', 'Primeiros passos', 'check', can(ctx, 'page.manage')], ['servicos', 'Serviços e preços', 'scissors', can(ctx, 'catalog.manage')], ['equipe', 'Equipe e escalas', 'team', can(ctx, 'team.manage')], ['horarios', 'Horários e bloqueios', 'clock', can(ctx, 'catalog.manage')], ['pagina', 'Página pública', 'page', can(ctx, 'page.manage')], ['assinatura', 'Assinatura', 'card', can(ctx, 'billing.manage')]];
  return layout(ctx, 'menu', 'Mais', h`<div class="menu-list">
    ${items.filter((i) => i[3]).map(([k, l, i]) => h`<a href="${base}/${k}">${ICON[i]}<span>${l}</span>${ICON.right}</a>`)}
    <a href="/b/${ctx.shop.slug}" target="_blank" rel="noopener">${ICON.ext}<span>Ver página pública</span>${ICON.right}</a>
    <form method="post" action="/sair"><button>${ICON.out}<span>Sair</span></button></form></div>`);
}

/* ---------- cor de cada profissional (identifica a pessoa em todo o painel) ---------- */
export const PRO_COLORS = ['#2A44C8', '#0B7559', '#A9480B', '#8A3FD1', '#B4235A', '#0A6E92', '#86600A', '#4B5563'];
export const proColor = (pros: any[], id: string) => PRO_COLORS[Math.max(0, pros.findIndex((p: any) => p.id === id)) % PRO_COLORS.length];

/** Linha do dia: uma faixa por profissional, do início ao fim do expediente, com o "agora" marcado. */
function timeline(ctx: Ctx, day: any, now: number) {
  if (!day.pros.length) return '';
  const shopH = day.hours.filter((x: any) => !x.professional_id);
  const hoursOf = (pid: string) => day.ownPros.includes(pid) ? day.hours.filter((x: any) => x.professional_id === pid) : shopH;
  const all = day.hours.length ? day.hours : [{ start_min: 540, end_min: 1140 }];
  const start = Math.floor(Math.min(...all.map((x: any) => x.start_min)) / 60) * 60, end = Math.ceil(Math.max(...all.map((x: any) => x.end_min)) / 60) * 60;
  const pct = (m: number) => `${(((Math.max(start, Math.min(end, m)) - start) / (end - start)) * 100).toFixed(2)}%`;
  const ticks = []; for (let m = start; m <= end; m += 60) ticks.push(m);
  const base = `/app/s/${ctx.shop.slug}`;
  const showNow = now > start && now < end;
  return h`<section class="block tl"><div class="block-head"><h2>Linha do dia</h2><span class="muted">${hhmm(start)} às ${hhmm(end)}</span></div>
    <div class="tl-grid">
      <div class="tl-ticks"><span></span><div>${ticks.map((m, i) => h`<i class="${i % 2 ? 'odd' : ''}" style="left:${pct(m)}">${String(m / 60).padStart(2, '0')}h</i>`)}</div></div>
      ${day.pros.map((p: any) => { const iv = hoursOf(p.id); const color = proColor(day.pros, p.id); return h`<div class="tl-row" style="--pc:${color}">
        <span class="tl-name"><span class="ava pc">${initials(p.name)}</span><span>${p.name.split(' ')[0]}</span></span>
        <div class="tl-track">
          ${iv.map((x: any) => h`<i class="tl-open" style="left:${pct(x.start_min)};width:calc(${pct(x.end_min)} - ${pct(x.start_min)})"></i>`)}
          ${day.bookings.filter((b: any) => b.professional_id === p.id && b.status !== 'cancelled').map((b: any) => h`<a class="tl-b st-${b.status}" href="${base}/reserva/${b.id}" title="${hhmm(b.startMin)} · ${b.customer} · ${b.services}" style="left:${pct(b.startMin)};width:calc(${pct(b.startMin + b.duration_min)} - ${pct(b.startMin)} - 2px)"><span>${b.customer.split(' ')[0]}</span></a>`)}
          ${showNow ? h`<i class="tl-now" style="left:${pct(now)}"></i>` : ''}
        </div></div>`; })}
    </div></section>`;
}

/* ---------- Hoje ---------- */
export function todayPage(ctx: Ctx, d: { date: string; day: any; nextFree: { name: string; time: string | null }[]; checklist: { label: string; done: boolean; href: string }[] | null }, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}`;
  const now = toLocal(clock.now(), ctx.shop.timezone).minutes;
  const live = d.day.bookings.filter((b: any) => b.status !== 'cancelled');
  const pending = live.filter((b: any) => b.status === 'confirmed' || b.status === 'pending');
  const done = live.filter((b: any) => b.status === 'completed');
  const proName = (id: string) => d.day.pros.find((p: any) => p.id === id)?.name.split(' ')[0] ?? '';
  const pc = (id: string) => proColor(d.day.pros, id);
  const onDay = live.filter((b: any) => b.status !== 'no_show').reduce((s: number, b: any) => s + b.price_cents, 0);
  const noShow = live.filter((b: any) => b.status === 'no_show').length;
  const inChair = pending.find((b: any) => b.startMin <= now && now < b.startMin + b.duration_min);
  const next = pending.find((b: any) => b.startMin > now);
  const focus = inChair ?? next;
  const late = pending.filter((b: any) => b.startMin + b.duration_min <= now);
  const hello = now < 720 ? 'Bom dia' : now < 1080 ? 'Boa tarde' : 'Boa noite';
  const closeAt = Math.max(0, ...d.day.hours.map((x: any) => x.end_min));
  const closed = !d.day.hours.length || now >= closeAt;
  const statusForm = (b: any, to: string, label: Safe | string, cls = '') => h`<form method="post" action="${base}/reserva/${b.id}/status" class="row-act"><input type="hidden" name="to" value="${to}"><input type="hidden" name="back" value="hoje"><button class="btn sm ${cls}">${label}</button></form>`;
  const nowCard = focus ? h`<section class="now-card" style="--pc:${pc(focus.professional_id)}">
      <div class="now-main">
        <span class="tag">${inChair ? 'Na cadeira agora' : 'Próximo cliente'}</span>
        <a class="now-name" href="${base}/reserva/${focus.id}">${focus.customer}</a>
        <span class="now-svc">${focus.services} <span class="dot"></span> com ${proName(focus.professional_id)}</span>
      </div>
      <div class="now-side">
        <span class="now-time">${hhmm(focus.startMin)}</span>
        <span class="now-eta">${inChair ? `termina às ${hhmm(focus.startMin + focus.duration_min)}` : eta(focus.startMin - now)}</span>
        ${focus.startMin - 30 <= now ? h`<form method="post" action="${base}/reserva/${focus.id}/status"><input type="hidden" name="to" value="completed"><input type="hidden" name="back" value="hoje"><button class="btn primary">${ICON.check} Atendido</button></form>` : h`<a class="btn" href="${base}/reserva/${focus.id}">Ver horário</a>`}
      </div>
    </section>`
    : closed
      ? h`<section class="now-card idle"><div class="now-main"><span class="tag">Agora</span><span class="now-name">Expediente encerrado</span><span class="now-svc">${done.length ? `${done.length} ${done.length === 1 ? 'atendimento' : 'atendimentos'} hoje. ` : ''}Confira como está a agenda de amanhã.</span></div><div class="now-side"><a class="btn primary" href="${base}/agenda?date=${addDays(d.date, 1)}">${ICON.agenda} Agenda de amanhã</a></div></section>`
      : h`<section class="now-card idle"><div class="now-main"><span class="tag">Agora</span><span class="now-name">Agenda livre pelo resto do dia</span><span class="now-svc">Encaixe alguém ou aproveite para organizar a casa.</span></div><div class="now-side"><a class="btn primary" href="${base}/novo">${ICON.plus} Novo horário</a></div></section>`;
  return layout(ctx, 'hoje', `${hello}, ${ctx.user.name.split(' ')[0]}`, h`
    ${d.checklist ? h`<section class="block onboarding"><div class="block-head"><h2>Para começar a receber agendamentos</h2><span class="muted">${d.checklist.filter((c) => c.done).length} de ${d.checklist.length}</span></div>
      <ol class="steps">${d.checklist.map((c) => h`<li class="${c.done ? 'done' : ''}"><span class="tick">${c.done ? ICON.check : ''}</span><a href="${c.href}">${c.label}</a></li>`)}</ol></section>` : ''}
    <p class="date-line">${dayLabel(d.date)}</p>
    ${nowCard}
    ${late.length ? h`<div class="flash warn">${late.length === 1 ? '1 horário já passou e ainda não foi marcado' : `${late.length} horários já passaram e ainda não foram marcados`} como atendido ou falta. Resolva na lista abaixo.</div>` : ''}
    <div class="summary-line">
      <div><span class="k">Na fila</span><b>${pending.length}</b></div>
      <div><span class="k">Atendidos</span><b>${done.length}</b></div>
      <div><span class="k">Faltas</span><b class="${noShow ? 'warn-t' : ''}">${noShow}</b></div>
      <div><span class="k">Previsto no dia</span><b>${brl(onDay)}</b></div>
    </div>
    ${timeline(ctx, d.day, now)}
    <div class="cols">
      <section class="block"><div class="block-head"><h2>${late.length ? 'Para resolver e próximos' : 'Próximos'}</h2><a class="btn sm" href="${base}/agenda">Agenda completa</a></div>
        ${pending.length ? h`<ul class="rows">${pending.slice(0, 10).map((b: any) => { const isLate = b.startMin + b.duration_min <= now; return h`<li class="row ${b.startMin <= now && now < b.startMin + b.duration_min ? 'now' : ''} ${isLate ? 'late' : ''}" style="--pc:${pc(b.professional_id)}">
          <a class="row-main" href="${base}/reserva/${b.id}"><span class="t">${hhmm(b.startMin)}</span><span class="pdot" aria-hidden="true"></span><span class="who"><b>${b.customer}${b.client_confirmed_at ? h` <span class="cc" title="Confirmou presença" aria-label="Confirmou presença">${ICON.check}</span>` : ''}</b><small>${b.services} · ${proName(b.professional_id)}</small></span></a>
          ${b.startMin - 30 > now ? h`<span class="eta">${eta(b.startMin - now)}</span>`
            : isLate ? h`<div class="row-btns">${statusForm(b, 'completed', h`${ICON.check} Atendido`, 'primary')}${statusForm(b, 'no_show', 'Não veio')}</div>`
            : statusForm(b, 'completed', h`${ICON.check} Atendido`, b.startMin <= now ? 'primary' : '')}</li>`; })}</ul>`
          : h`<p class="empty">${closed ? 'Nada pendente. Bom descanso.' : 'Ninguém na fila agora.'}</p>`}
      </section>
      <section class="block"><div class="block-head"><h2>Próximo horário livre</h2></div>
        <ul class="rows">${d.nextFree.map((n, i) => h`<li class="row" style="--pc:${PRO_COLORS[i % PRO_COLORS.length]}"><span class="ava pc">${initials(n.name)}</span><span class="who"><b>${n.name}</b></span><span class="free ${n.time ? '' : 'muted'}">${n.time ? n.time : 'sem vaga hoje'}</span></li>`)}</ul>
        <div class="quick"><a class="btn primary" href="${base}/novo">${ICON.plus} Novo horário</a>${can(ctx, 'catalog.manage') ? h`<a class="btn" href="${base}/horarios#bloqueio">Bloquear horário</a>` : ''}</div>
      </section>
    </div>`, f);
}

/* ---------- Agenda (dia) ---------- */
export function agendaPage(ctx: Ctx, date: string, day: any, f: Flash, week: { date: string; n: number }[] = []) {
  const base = `/app/s/${ctx.shop.slug}`;
  const shopH = day.hours.filter((x: any) => !x.professional_id);
  const allH = day.hours.length ? day.hours : [{ start_min: 480, end_min: 1200 }];
  // a grade começa e termina no expediente do dia (e se estende se houver horário marcado fora dele)
  const bMin = day.bookings.filter((b: any) => b.status !== 'cancelled').map((b: any) => b.startMin), bMax = day.bookings.filter((b: any) => b.status !== 'cancelled').map((b: any) => b.startMin + b.duration_min);
  const start = Math.floor(Math.min(...allH.map((x: any) => x.start_min), ...bMin) / 60) * 60, end = Math.ceil(Math.max(...allH.map((x: any) => x.end_min), ...bMax) / 60) * 60;
  const PX = 1.4, Y = (m: number) => (m - start) * PX;
  const vis = day.bookings.filter((b: any) => b.status !== 'cancelled');
  const nowL = toLocal(clock.now(), ctx.shop.timezone);
  const hoursOf = (pid: string) => day.ownPros.includes(pid) ? day.hours.filter((x: any) => x.professional_id === pid) : shopH;
  const gaps = (pid: string) => { const iv = hoursOf(pid).sort((a: any, b: any) => a.start_min - b.start_min); const out: [number, number][] = []; let cur = start; for (const i of iv) { if (i.start_min > cur) out.push([cur, i.start_min]); cur = Math.max(cur, i.end_min); } if (cur < end) out.push([cur, end]); return out; };
  const lines: Safe[] = []; for (let m = start; m <= end; m += 30) lines.push(h`<i class="gl ${m % 60 ? 'half' : ''}" style="top:${Y(m)}px"></i>`);
  const DOW3 = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const nav = h`<div class="agbar">
    <div class="segnav"><a href="?date=${addDays(date, -7)}" aria-label="Semana anterior">${ICON.left}</a><a href="?date=${nowL.date}" class="${date === nowL.date ? 'on' : ''}">Hoje</a><a href="?date=${addDays(date, 7)}" aria-label="Próxima semana">${ICON.right}</a></div>
    <nav class="week" aria-label="Dias da semana">${week.map((w) => { const x = new Date(w.date + 'T12:00:00Z'); return h`<a href="?date=${w.date}" class="${w.date === date ? 'on' : ''} ${w.date === nowL.date ? 'today' : ''}" ${w.date === date ? raw('aria-current="date"') : ''}><small>${DOW3[x.getUTCDay()]}</small><b>${x.getUTCDate()}</b><em>${w.n ? `${w.n} ${w.n === 1 ? 'horário' : 'horários'}` : '—'}</em></a>`; })}</nav>
    <form method="get" class="datepick"><label class="sr" for="dt">Ir para data</label><input id="dt" type="date" name="date" value="${date}" class="input sm"><button class="btn sm">Ir</button></form></div>`;
  const grid = h`<div class="ag" style="--cols:${day.pros.length}">
    <div class="ag-head"><div></div>${day.pros.map((p: any) => h`<div style="--pc:${proColor(day.pros, p.id)}"><span class="ava pc">${initials(p.name)}</span><span class="hn"><b>${p.name}</b><small>${vis.filter((b: any) => b.professional_id === p.id && b.status !== 'no_show').length} horários</small></span></div>`)}</div>
    <div class="ag-body" style="height:${(end - start) * PX}px">
      <div class="ag-times">${Array.from({ length: (end - start) / 60 + 1 }, (_, i) => h`<span style="top:${Y(start + i * 60)}px">${hhmm(start + i * 60)}</span>`)}</div>
      ${day.pros.map((p: any) => h`<div class="ag-col">${lines}
        ${gaps(p.id).map(([a, b]) => h`<div class="ag-off" style="top:${Y(a)}px;height:${(b - a) * PX}px"></div>`)}
        ${day.off.filter((o: any) => !o.professional_id || o.professional_id === p.id).map((o: any) => { const a = Math.max(start, toLocal(new Date(o.starts_at), ctx.shop.timezone).minutes), e = new Date(o.ends_at) >= new Date(new Date(o.starts_at).getTime() + 86_000_000) ? end : Math.min(end, toLocal(new Date(o.ends_at), ctx.shop.timezone).minutes || end); return h`<div class="ag-block" style="top:${Y(a)}px;height:${Math.max(18, (e - a) * PX)}px"><span>${o.reason || 'Bloqueado'}</span></div>`; })}
        ${vis.filter((b: any) => b.professional_id === p.id).map((b: any) => h`<a class="ag-b st-${b.status}" href="${base}/reserva/${b.id}" style="--pc:${proColor(day.pros, p.id)};top:${Y(b.startMin) + 1}px;height:${b.duration_min * PX - 2}px"><b>${hhmm(b.startMin)} ${b.customer}</b>${b.duration_min >= 30 ? h`<small>${b.services}</small>` : ''}</a>`)}
        ${date === nowL.date && nowL.minutes > start && nowL.minutes < end ? h`<i class="ag-now" style="top:${Y(nowL.minutes)}px"></i>` : ''}
      </div>`)}
    </div></div>`;
  const list = h`<ul class="rows ag-list">${vis.length ? vis.map((b: any) => h`<li class="row"><a class="row-main" href="${base}/reserva/${b.id}"><span class="t">${hhmm(b.startMin)}</span><span class="who"><b>${b.customer}</b><small>${b.services} · ${day.pros.find((p: any) => p.id === b.professional_id)?.name.split(' ')[0] ?? ''}</small></span></a>${chip(b.status)}</li>`) : h`<li class="empty">Nenhum horário marcado neste dia.</li>`}</ul>`;
  return layout(ctx, 'agenda', dayLabel(date), h`${nav}${day.pros.length ? h`<div class="ag-wrap">${grid}</div>${list}` : h`<p class="empty">Nenhum profissional ativo.</p>`}`, f, h`<a class="btn primary" href="${base}/novo?date=${date}">${ICON.plus} Novo horário</a>`);
}

/* ---------- Detalhe do agendamento ---------- */
export function bookingPage(ctx: Ctx, b: any, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}`;
  const L = toLocal(new Date(b.starts_at), ctx.shop.timezone);
  const next = TRANSITIONS[b.status] || [];
  const label: Record<string, string> = { confirmed: b.status === 'no_show' ? 'Desfazer falta' : 'Confirmar', completed: 'Marcar como atendido', no_show: 'Cliente não veio', cancelled: 'Cancelar horário' };
  const nowL = toLocal(clock.now(), ctx.shop.timezone);
  const upcoming = ['pending', 'confirmed'].includes(b.status) && new Date(b.starts_at).getTime() > clock.now().getTime();
  const at = (v: any) => { const l = toLocal(new Date(v), ctx.shop.timezone); return `${shortDay(l.date)} às ${hhmm(l.minutes)}`; };
  const presence = b.client_confirmed_at ? h`<p class="presence ok">${ICON.check} Cliente confirmou presença (${at(b.client_confirmed_at)})</p>`
    : upcoming && b.reminded_at ? h`<p class="presence wait">${ICON.bell} Lembrete aberto no WhatsApp ${at(b.reminded_at)} · aguardando o cliente confirmar</p>` : '';
  // atendido/falta só fazem sentido a partir de 30 min antes do horário (mesma regra do servidor)
  const opensAt = new Date(new Date(b.starts_at).getTime() - 30 * 60_000);
  const early = opensAt.getTime() > clock.now().getTime();
  const shown = next.filter((to) => !(early && (to === 'completed' || to === 'no_show')));
  const form = (to: string, cls: string, text: string) => h`<form method="post" action="${base}/reserva/${b.id}/status"><input type="hidden" name="to" value="${to}"><button class="btn ${cls}">${text}</button></form>`;
  const visits = Number(b.visits ?? 0);
  return layout(ctx, 'agenda', b.customer, h`
    <div class="detail2">
      <div class="when-card" style="--pc:${b.pro_color}"><span class="big">${hhmm(L.minutes)}<small>–${hhmm(L.minutes + b.duration_min)}</small></span><span class="dlabel">${dayLabel(L.date)}<br><span class="muted">com ${b.pro_name}</span></span>${chip(b.status)}</div>
      ${presence}
      <div class="d-main">
        <section class="block"><h2>Serviços</h2>
          <table class="mini"><tbody>${b.items.map((i: any) => h`<tr><td>${i.name}</td><td class="muted">${i.duration_min} min</td><td class="r">${brl(i.price_cents)}</td></tr>`)}
            <tr class="tot"><td>Total</td><td class="muted">${b.duration_min} min</td><td class="r">${brl(b.price_cents)}</td></tr></tbody></table>
          <p class="hint">${b.source === 'online' ? 'Marcado pelo cliente na página de agendamento.' : 'Marcado pela equipe.'}${b.cancel_reason ? ` Motivo do cancelamento: ${b.cancel_reason}.` : ''}</p>
        </section>
        <section class="block"><h2>Histórico</h2><ol class="hist">${b.events.map((e: any) => { const l = toLocal(new Date(e.at), ctx.shop.timezone); return h`<li><span class="hd"></span><span><b>${e.from_status && e.from_status === e.to_status && e.note ? e.note : e.from_status ? `${STATUS_LABEL[e.from_status]} → ${STATUS_LABEL[e.to_status]}` : `Marcado (${STATUS_LABEL[e.to_status].toLowerCase()})`}</b><small>${shortDay(l.date)} às ${hhmm(l.minutes)} · ${e.actor === 'customer' ? 'pelo cliente' : e.actor === 'system' ? 'sistema' : e.actor_name || 'equipe'}</small></span></li>`; })}</ol></section>
      </div>
      <aside class="d-side">
        ${next.length ? h`<section class="block act-card"><h2>${early ? 'Ações' : 'O cliente veio?'}</h2>
          ${shown.filter((to) => to !== 'cancelled').map((to) => form(to, to === 'completed' ? 'primary wide' : 'wide', label[to]))}
          ${['pending', 'confirmed'].includes(b.status) ? h`<a class="btn wide" href="${base}/reserva/${b.id}/mudar">${ICON.clock} Mudar horário</a>` : ''}
          ${early && next.includes('completed') ? h`<p class="hint">Atendido e falta ficam disponíveis a partir de ${L.date === nowL.date ? '' : shortDay(toLocal(opensAt, ctx.shop.timezone).date) + ' '}${hhmm(toLocal(opensAt, ctx.shop.timezone).minutes)}.</p>` : ''}
          ${next.includes('cancelled') ? h`<details class="danger-zone"><summary>Cancelar horário</summary><form method="post" action="${base}/reserva/${b.id}/status"><input type="hidden" name="to" value="cancelled"><label class="sr" for="cn">Motivo</label><input class="input sm" id="cn" name="note" maxlength="140" placeholder="Motivo (opcional)"><button class="btn danger wide">Confirmar cancelamento</button><p class="hint">O horário fica livre na agenda na hora.</p></form></details>` : ''}
        </section>` : ''}
        <section class="block"><h2>Cliente</h2>
          <div class="client"><span class="ava">${initials(b.customer)}</span><span class="who"><b>${b.customer}</b><small class="sel">${fmtPhone(b.phone)}</small></span></div>
          ${b.contact_name && b.contact_name !== b.customer ? h`<p class="hint">Nesta reserva informou o nome <b>${b.contact_name}</b>.</p>` : ''}
          <p class="visits">${visits ? h`<b>${visits} ${visits === 1 ? 'visita' : 'visitas'}</b> atendidas${b.last_visit ? h` · última em ${shortDay(toLocal(new Date(b.last_visit), ctx.shop.timezone).date)}` : ''}` : 'Primeira visita'}</p>
          ${upcoming ? h`<form method="post" action="${base}/lembretes/${b.id}" target="_blank" class="remind"><button class="btn wide">${ICON.chat} ${b.reminded_at ? 'Reenviar lembrete no WhatsApp' : 'Enviar lembrete no WhatsApp'}</button></form>
            <p class="hint">A mensagem leva o link para o cliente confirmar, remarcar ou cancelar.</p>`
            : h`<a class="btn wide" href="https://wa.me/${b.phone.length <= 11 ? '55' + b.phone : b.phone}" target="_blank" rel="noopener">${ICON.chat} Conversar no WhatsApp</a>`}
        </section>
      </aside>
    </div>`, f, h`<a class="btn" href="${base}/agenda?date=${L.date}">${ICON.left} Agenda do dia</a>`);
}

/* ---------- Mudar horário (equipe) ---------- */
export function movePage(ctx: Ctx, d: { booking: any; date: string; pid: string; pros: any[]; slots: any[] }, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}`, b = d.booking, L = toLocal(new Date(b.starts_at), ctx.shop.timezone);
  const todayD = toLocal(clock.now(), ctx.shop.timezone).date;
  const groups = [['Manhã', 0, 720], ['Tarde', 720, 1080], ['Noite', 1080, 1440]].map(([l, a, z]) => [l, d.slots.filter((x) => x.min >= (a as number) && x.min < (z as number))] as const).filter((g) => g[1].length);
  // 7 dias em volta do dia escolhido, sem voltar para antes de hoje
  const from = addDays(d.date, -3) < todayD ? todayD : addDays(d.date, -3);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const q = (date: string) => `?d=${date}${d.pros.length ? `&p=${d.pid}` : ''}`;
  return layout(ctx, 'agenda', `Mudar horário · ${b.customer}`, h`
    <p class="lead-hint">Agora: <b>${dayLabel(L.date)}, ${hhmm(L.minutes)}</b> (${b.duration_min} min). O preço e os serviços continuam os mesmos. O cliente aparece com lembrete zerado, para você avisar do horário novo.</p>
    <form method="get" class="move-filter">
      ${d.pros.length ? h`<div class="field"><label for="mp">Profissional</label><select class="input" id="mp" name="p">${d.pros.map((p: any) => h`<option value="${p.id}" ${p.id === d.pid ? 'selected' : ''}>${p.name}</option>`)}</select></div>` : ''}
      <div class="field"><label for="md">Dia</label><input class="input" id="md" type="date" name="d" value="${d.date}" min="${todayD}"></div>
      <button class="btn">Ver horários</button>
    </form>
    <nav class="week move-days" aria-label="Dias">${days.map((x) => { const t = new Date(x + 'T12:00:00Z'); return h`<a href="${q(x)}" class="${x === d.date ? 'on' : ''} ${x === todayD ? 'today' : ''}" ${x === d.date ? raw('aria-current="date"') : ''}><small>${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][t.getUTCDay()]}</small><b>${t.getUTCDate()}</b></a>`; })}</nav>
    <section class="block"><h2>${dayLabel(d.date)}</h2>
      ${groups.length ? h`<form method="post" action="${base}/reserva/${b.id}/mudar"><input type="hidden" name="p" value="${d.pid}">
        ${groups.map(([l, ts]) => h`<div class="period"><h3>${l}</h3><div class="slots">${ts.map((x) => h`<button class="slot" name="t" value="${x.startsAt}">${x.time}</button>`)}</div></div>`)}</form>`
        : h`<p class="empty">Sem horário livre neste dia. Escolha outro dia${d.pros.length > 1 ? ' ou outro profissional' : ''}.</p>`}
    </section>`, f, h`<a class="btn" href="${base}/reserva/${b.id}">${ICON.left} Voltar</a>`);
}

/* ---------- Lembretes (véspera) ---------- */
export function remindersPage(ctx: Ctx, date: string, todayD: string, rows: any[], f: Flash) {
  const base = `/app/s/${ctx.shop.slug}`, tomorrow = addDays(todayD, 1);
  const sent = rows.filter((r) => r.reminded_at).length, conf = rows.filter((r) => r.client_confirmed_at).length;
  const nowMs = clock.now().getTime();
  const at = (v: any) => hhmm(toLocal(new Date(v), ctx.shop.timezone).minutes);
  const state = (r: any) => r.client_confirmed_at ? h`<span class="rm ok">${ICON.check} Confirmou</span>`
    : r.reminded_at ? h`<span class="rm sent">Abertura solicitada ${at(r.reminded_at)}</span>` : h`<span class="rm none">Sem lembrete</span>`;
  const bar = h`<div class="agbar">
    <div class="segnav"><a href="?date=${todayD}" class="${date === todayD ? 'on' : ''}">Hoje</a><a href="?date=${tomorrow}" class="${date === tomorrow ? 'on' : ''}">Amanhã</a></div>
    <form method="get" class="datepick"><label class="sr" for="dt">Ir para data</label><input id="dt" type="date" name="date" value="${date}" min="${todayD}" class="input sm"><button class="btn sm">Ir</button></form></div>`;
  return layout(ctx, 'lembretes', 'Lembretes', h`${bar}
    <p class="lead-hint">Mande na véspera, pelo WhatsApp da barbearia. A mensagem já leva o link para o cliente <b>confirmar presença</b>, <b>remarcar</b> ou <b>cancelar</b> e liberar o horário para outra pessoa.</p>
    <div class="summary-line">
      <div><span class="k">${date === todayD ? 'Hoje' : date === tomorrow ? 'Amanhã' : shortDay(date)}</span><b>${rows.length} ${rows.length === 1 ? 'horário' : 'horários'}</b></div>
      <div><span class="k">Abertura solicitada</span><b>${sent}</b></div>
      <div><span class="k">Confirmaram</span><b>${conf}</b></div>
      <div><span class="k">Falta lembrar</span><b class="${rows.length - sent ? 'warn-t' : ''}">${rows.filter((r) => !r.reminded_at && !r.client_confirmed_at && new Date(r.starts_at).getTime() > nowMs).length}</b></div>
    </div>
    <section class="block"><div class="block-head"><h2>${dayLabel(date)}</h2></div>
    ${rows.length ? h`<ul class="rows reminders">${rows.map((r) => h`<li class="row">
        <a class="row-main" href="${base}/reserva/${r.id}"><span class="t">${hhmm(r.startMin)}</span><span class="who"><b>${r.customer}</b><small>${r.services ?? ''} · ${r.pro_name.split(' ')[0]}<span class="rm-m ${r.client_confirmed_at ? 'ok' : r.reminded_at ? 'sent' : ''}"> · ${r.client_confirmed_at ? 'Confirmou' : r.reminded_at ? `Abertura solicitada ${at(r.reminded_at)}` : 'Sem lembrete'}</span></small></span></a>
        ${state(r)}
        ${new Date(r.starts_at).getTime() <= nowMs ? h`<span class="muted">Já passou</span>`
          : r.client_confirmed_at ? ''
          : h`<form method="post" action="${base}/lembretes/${r.id}" target="_blank" class="remind"><button class="btn sm ${r.reminded_at ? '' : 'primary'}">${ICON.chat} ${r.reminded_at ? 'Reenviar' : 'WhatsApp'}</button></form>`}
      </li>`)}</ul>` : h`<p class="empty">Nenhum horário marcado para este dia.</p>`}
    </section>`, f);
}

/* ---------- Novo horário (equipe) ---------- */
export function newBookingPage(ctx: Ctx, d: { services: any[]; pros: any[]; customers?: any[]; sel: { s: string[]; p: string; date: string; name: string; phone: string }; slots: any[] | null; quote: any }, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}`;
  const s = d.sel;
  return layout(ctx, 'novo', 'Novo horário', h`
    <form method="post" class="nb" action="${base}/novo/horarios#horarios">
      <section class="block nb-step"><h2><span class="n">1</span>Cliente</h2>
        <div class="grid2">
          <div class="field"><label for="nm">Nome</label><input class="input" id="nm" name="name" value="${s.name}" required maxlength="80" autocomplete="off" list="clientes" placeholder="Digite para buscar quem já veio"></div>
          <div class="field"><label for="ph">WhatsApp</label><input class="input" id="ph" name="phone" value="${s.phone}" inputmode="tel" required placeholder="(11) 98765-4321"></div>
        </div>
        <datalist id="clientes">${(d.customers ?? []).map((c) => h`<option value="${c.name} — ${fmtPhone(c.phone)}"></option>`)}</datalist>
      </section>
      <section class="block nb-step"><h2><span class="n">2</span>Serviços</h2>
        <div class="checks">${d.services.map((x) => h`<label><input type="checkbox" name="s" value="${x.id}" ${s.s.includes(x.id) ? 'checked' : ''}><span>${x.name}</span><small>${x.duration_min} min · ${brl(x.price_cents)}</small></label>`)}</div>
      </section>
      <section class="block nb-step"><h2><span class="n">3</span>Quando e com quem</h2>
        <div class="grid2">
          <div class="field"><label for="pr">Profissional</label><select class="input" id="pr" name="p">${can(ctx, 'agenda.all') ? h`<option value="any" ${s.p === 'any' ? 'selected' : ''}>Quem estiver livre</option>` : ''}${d.pros.map((p) => h`<option value="${p.id}" ${s.p === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
          <div class="field"><label for="dt">Dia</label><input class="input" type="date" id="dt" name="date" value="${s.date}" required></div>
        </div>
        <div class="row-btns"><button class="btn ${d.slots ? '' : 'primary'}">Ver horários livres</button></div>
      </section>
    </form>
    ${d.slots ? h`<form method="post" action="${base}/novo" class="block nb-step nb-slots" id="horarios">
      <input type="hidden" name="name" value="${s.name}"><input type="hidden" name="phone" value="${s.phone}"><input type="hidden" name="p" value="${s.p}">${s.s.map((id) => h`<input type="hidden" name="s" value="${id}">`)}
      <h2><span class="n">4</span>Horário</h2>
      <p class="nb-sum"><b>${s.name}</b> · ${d.services.filter((x) => s.s.includes(x.id)).map((x) => x.name).join(' + ')} · ${d.quote.durationMin} min · <b>${brl(d.quote.priceCents)}</b><br><span class="muted">${dayLabel(s.date)}</span></p>
      <fieldset class="field"><legend class="sr">Horários livres</legend>
        ${d.slots.length ? [['Manhã', 0, 720], ['Tarde', 720, 1080], ['Noite', 1080, 1440]].map(([l, a, b]) => { const ts = d.slots!.filter((x) => x.min >= (a as number) && x.min < (b as number)); return ts.length ? h`<div class="period"><span class="plabel">${l}</span><div class="slots">${ts.map((x) => h`<label class="slot"><input type="radio" name="startsAt" value="${x.startsAt}" required><span>${x.time}</span></label>`)}</div></div>` : ''; }) : h`<p class="empty">Sem horário livre nesse dia para essa combinação.</p>`}
      </fieldset>
      ${d.slots.length ? h`<button class="btn primary">Marcar horário</button>` : ''}
    </form>` : ''}`, f);
}

/* ---------- Serviços ---------- */
const svcFields = (x: any, id: string) => h`
  <div class="field span2"><label for="sn-${id}">Nome</label><input class="input" id="sn-${id}" name="name" value="${x?.name ?? ''}" required maxlength="60" placeholder="Ex.: Pigmentação"></div>
  <div class="field span2"><label for="sd-${id}">Descrição curta</label><input class="input" id="sd-${id}" name="description" value="${x?.description ?? ''}" maxlength="140" placeholder="Aparece embaixo do nome na página"></div>
  <div class="field"><label for="su-${id}">Duração</label><div class="affix"><input class="input" id="su-${id}" name="duration" type="number" min="5" max="480" step="5" value="${x?.duration_min ?? 30}" required><span>min</span></div></div>
  <div class="field"><label for="sp-${id}">Preço</label><div class="affix pre"><span>R$</span><input class="input" id="sp-${id}" name="price" inputmode="decimal" value="${x ? real(x.price_cents) : ''}" placeholder="0,00" required></div></div>`;
export function servicesPage(ctx: Ctx, list: any[], f: Flash) {
  const base = `/app/s/${ctx.shop.slug}/servicos`;
  const active = list.filter((x) => x.active), archived = list.filter((x) => !x.active);
  const item = (x: any) => h`<li class="item ${x.active ? '' : 'off'}">
    <details>
      <summary><span class="who"><b>${x.name}</b><small>${x.description || 'Sem descrição'}</small></span><span class="meta">${x.duration_min} min</span><span class="money">${brl(x.price_cents)}</span><span class="edit">Editar</span></summary>
      <form method="post" action="${base}/${x.id}" class="editor grid2">${svcFields(x, x.id)}
        <div class="row-btns span2"><button class="btn primary sm">Salvar</button><button class="btn sm ghost" formaction="${base}/${x.id}/${x.active ? 'arquivar' : 'reativar'}" formnovalidate>${x.active ? 'Arquivar serviço' : 'Voltar a oferecer'}</button></div>
      </form>
    </details></li>`;
  return layout(ctx, 'servicos', 'Serviços e preços', h`
    <p class="lead">É esta lista que o cliente vê. Quando ele escolhe mais de um serviço, os tempos e valores somam na agenda.</p>
    <ul class="items">${active.map(item)}</ul>
    <details class="add"><summary class="btn">${ICON.plus} Adicionar serviço</summary>
      <form method="post" action="${base}" class="block grid2">${svcFields(null, 'novo')}<div class="row-btns span2"><button class="btn primary sm">Adicionar</button></div></form></details>
    ${archived.length ? h`<h2 class="sub">Arquivados</h2><p class="hint">Não aparecem para o cliente. O histórico das reservas continua.</p><ul class="items">${archived.map(item)}</ul>` : ''}`, f);
}

/* ---------- Equipe ---------- */
const WEEK = [2, 3, 4, 5, 6, 0, 1];
export const fmtDay = (rows: any[]) => rows.map((r) => `${hhmm(r.start_min)}-${hhmm(r.end_min)}`).join(', ');
const DOW3 = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Editor de semana: liga/desliga o dia, abre/fecha e pausa opcional. Sem digitar formato. */
export function hoursEditor(get: (wd: number) => any[], closedLabel: string) {
  return h`<div class="week">${WEEK.map((wd) => {
    const r = [...get(wd)].sort((x, y) => x.start_min - y.start_min), open = r.length > 0;
    const v = { a: open ? hhmm(r[0].start_min) : '09:00', b: open ? hhmm(r.at(-1).end_min) : '19:00', pa: r.length > 1 ? hhmm(r[0].end_min) : '', pb: r.length > 1 ? hhmm(r[1].start_min) : '' };
    return h`<div class="wrow">
      <label class="switch"><input type="checkbox" name="o${wd}" value="1" ${open ? 'checked' : ''}><i aria-hidden="true"></i><span>${DOW[wd]}</span></label>
      <div class="times">
        <input type="time" class="input sm" name="a${wd}" value="${v.a}" aria-label="${DOW[wd]}: abre"><span class="muted">às</span><input type="time" class="input sm" name="b${wd}" value="${v.b}" aria-label="${DOW[wd]}: fecha">
        <span class="pause muted">pausa</span><input type="time" class="input sm" name="pa${wd}" value="${v.pa}" aria-label="${DOW[wd]}: início da pausa"><span class="muted">–</span><input type="time" class="input sm" name="pb${wd}" value="${v.pb}" aria-label="${DOW[wd]}: fim da pausa">
      </div>
      <span class="closed muted">${closedLabel}</span>
    </div>`; })}</div>`;
}
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
/** "Qua–Sáb 13:00–20:00" — agrupa dias seguidos com o mesmo horário. */
export function summarize(rows: any[]) {
  const per = WEEK.map((wd) => [wd, rows.filter((r) => r.weekday === wd).map((r) => `${hhmm(r.start_min)}–${hhmm(r.end_min)}`).join(', ')] as const).filter(([, s]) => s);
  const groups: { from: number; to: number; s: string }[] = [];
  for (const [wd, s] of per) { const g = groups.at(-1); if (g && g.s === s && WEEK.indexOf(wd) === WEEK.indexOf(g.to) + 1) g.to = wd; else groups.push({ from: wd, to: wd, s }); }
  return groups.length ? groups.map((g) => `${DOW3[g.from]}${g.to !== g.from ? '–' + DOW3[g.to] : ''} ${g.s}`).join(' · ') : 'Sem horário (folga)';
}
export function teamPage(ctx: Ctx, d: { pros: any[]; hours: any[]; members: any[]; plan: any }, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}/equipe`;
  const shopDay = (wd: number) => fmtDay(d.hours.filter((x) => !x.professional_id && x.weekday === wd));
  const active = d.pros.filter((p) => p.active), inactive = d.pros.filter((p) => !p.active);
  const proFields = (p: any, id: string) => h`
    <div class="field span2"><label for="n-${id}">Nome</label><input class="input" id="n-${id}" name="name" value="${p?.name ?? ''}" required maxlength="60"></div>
    <div class="field"><label for="t-${id}">Especialidade</label><input class="input" id="t-${id}" name="title" value="${p?.title ?? ''}" maxlength="60" placeholder="Ex.: degradê, barba"></div>
    <div class="field"><label for="c-${id}">Comissão</label><div class="affix"><input class="input" id="c-${id}" name="commission" type="number" min="0" max="100" step="0.5" value="${p?.commission_pct ?? 40}" aria-describedby="ch-${id}"><span>%</span></div></div>
    <p class="hint span2" id="ch-${id}">Parte do valor de cada serviço que ele atende e que fica com ele. Com 40%, um corte de R$ 45,00 dá R$ 18,00 para ele e R$ 27,00 para a barbearia. Produtos vendidos não entram. Mudar a porcentagem vale só para as próximas comandas.</p>`;
  const item = (p: any) => { const own = d.hours.filter((x) => x.professional_id === p.id); return h`
    <li class="item ${p.active ? '' : 'off'}" id="p-${p.id}"><details>
      <summary style="--pc:${proColor(d.pros.filter((x) => x.active), p.id)}"><span class="ava pc">${initials(p.name)}</span><span class="who"><b>${p.name}</b><small>${p.title || 'Sem especialidade'} · ${own.length ? summarize(own) : 'Horário da casa'}</small></span><span class="meta">fica com ${p.commission_pct}% dos serviços</span><span class="edit">Editar</span></summary>
      <div class="editor">
        <form method="post" action="${base}/${p.id}" class="grid2">${proFields(p, p.id)}
          <div class="row-btns span2"><button class="btn primary sm">Salvar</button><button class="btn sm ghost" formaction="${base}/${p.id}/${p.active ? 'desativar' : 'ativar'}" formnovalidate>${p.active ? 'Desativar' : 'Reativar'}</button></div>
        </form>
        <form method="post" action="${base}/${p.id}/escala" class="hours">
          <h3>Escala</h3>
          <label class="inline"><input type="checkbox" name="useShop" value="1" ${own.length ? '' : 'checked'}> Seguir o horário da casa</label>
          ${hoursEditor((wd) => (own.length ? own : d.hours.filter((x) => !x.professional_id)).filter((x) => x.weekday === wd), 'Folga')}
          <div class="row-btns"><button class="btn sm">Salvar escala</button></div>
        </form>
      </div></details></li>`; };
  return layout(ctx, 'equipe', 'Equipe e escalas', h`
    ${d.plan?.max_professionals ? h`<p class="lead">Seu plano permite ${d.plan.max_professionals} profissionais ativos. Hoje: ${active.length}.</p>` : ''}
    <ul class="items">${active.map(item)}</ul>
    <details class="add"><summary class="btn">${ICON.plus} Adicionar profissional</summary>
      <form method="post" action="${base}" class="block grid2">${proFields(null, 'novo')}<div class="row-btns span2"><button class="btn primary sm">Adicionar</button></div></form></details>
    ${inactive.length ? h`<h2 class="sub">Desativados</h2><ul class="items">${inactive.map(item)}</ul>` : ''}
    ${can(ctx, 'access.manage') ? h`<h2 class="sub">Acesso ao painel</h2>
      <p class="hint">Barbeiro vê e atualiza só a própria agenda. Recepção vê a agenda de todos, sem mexer em preços e equipe. Gerente faz tudo, menos dar acessos.</p>
      <ul class="items">${d.members.map((m) => h`<li class="item"><div class="static"><span class="ava">${initials(m.name)}</span><span class="who"><b>${m.name}</b><small>${m.email}</small></span><span class="meta">${ROLE_LABEL[m.role as keyof typeof ROLE_LABEL]}${m.pro_name && m.pro_name !== m.name ? ` · ${m.pro_name}` : ''}</span></div></li>`)}</ul>
      <details class="add"><summary class="btn">${ICON.plus} Dar acesso a alguém da equipe</summary><section class="block">
      <form method="post" action="${base}/acesso" class="grid3">
        <div class="field"><label for="ap">Profissional</label><select class="input" id="ap" name="professionalId">${d.pros.filter((p) => p.active).map((p) => h`<option value="${p.id}">${p.name}</option>`)}</select></div>
        <div class="field"><label for="ar">Papel</label><select class="input" id="ar" name="role"><option value="barber">Barbeiro</option><option value="reception">Recepção</option><option value="manager">Gerente</option></select></div>
        <div class="field"><label for="an">Nome</label><input class="input" id="an" name="name" required></div>
        <div class="field"><label for="ae">E-mail</label><input class="input" id="ae" name="email" type="email" required></div>
        <div class="field"><label for="aw">Senha provisória</label><input class="input" id="aw" name="password" type="text" minlength="8" required autocomplete="off"></div>
        <div class="row-btns"><button class="btn primary sm">Criar acesso</button></div>
      </form></section></details>` : ''}`, f);
}

/* ---------- Horários da casa e bloqueios ---------- */
export function hoursPage(ctx: Ctx, d: { hours: any[]; off: any[]; pros: any[]; today: string }, f: Flash) {
  const base = `/app/s/${ctx.shop.slug}/horarios`;
  const tz = ctx.shop.timezone;
  return layout(ctx, 'horarios', 'Horários e bloqueios', h`
    <section class="block"><h2>Horário de funcionamento</h2>
      <form method="post" action="${base}" class="hours">
        ${hoursEditor((wd) => d.hours.filter((x) => !x.professional_id && x.weekday === wd), 'Fechado')}
        <p class="hint">A pausa é opcional (almoço, por exemplo). Profissionais com escala própria seguem a escala deles.</p>
        <button class="btn primary sm">Salvar horários</button>
      </form></section>
    <section class="block" id="bloqueio"><h2>Bloquear horário</h2>
      <form method="post" action="${base}/bloqueios" class="grid3">
        <div class="field"><label for="bp">Quem</label><select class="input" id="bp" name="professionalId"><option value="">Barbearia inteira</option>${d.pros.map((p) => h`<option value="${p.id}">${p.name}</option>`)}</select></div>
        <div class="field"><label for="bd">Dia</label><input class="input" type="date" id="bd" name="date" value="${d.today}" required></div>
        <div class="field"><label for="bs">Das (vazio = dia todo)</label><input class="input" type="time" id="bs" name="start"></div>
        <div class="field"><label for="be">Até</label><input class="input" type="time" id="be" name="end"></div>
        <div class="field"><label for="br">Motivo</label><input class="input" id="br" name="reason" maxlength="80" placeholder="Folga, médico, feriado…"></div>
        <div class="row-btns"><button class="btn sm">Bloquear</button></div>
      </form>
      <p class="hint">O bloqueio só impede novos agendamentos. Horários já marcados no período continuam na agenda.</p>
      <ul class="rows">${d.off.length ? d.off.map((o) => { const a = toLocal(new Date(o.starts_at), tz), b = toLocal(new Date(o.ends_at), tz); return h`<li class="row"><span class="who"><b>${o.pro || 'Barbearia inteira'}</b><small>${dayLabel(a.date)} · ${a.date === b.date ? `${hhmm(a.minutes)}–${hhmm(b.minutes)}` : 'dia todo'}${o.reason ? ` · ${o.reason}` : ''}</small></span>
        <form method="post" action="${base}/bloqueios/${o.id}/remover"><button class="btn sm ghost">Remover</button></form></li>`; }) : h`<li class="empty">Nenhum bloqueio futuro.</li>`}</ul>
    </section>`, f);
}

/* ---------- Página pública ---------- */
export function pageSettings(ctx: Ctx, f: Flash, publicUrl: string) {
  const s = ctx.shop, t = resolveTheme(s.theme), pol = s.policy;
  return layout(ctx, 'pagina', 'Página pública', h`
    <section class="block publish ${s.published ? 'live' : ''}">
      <div><b>${s.published ? 'No ar' : 'Fora do ar'}</b><p class="hint">${s.published ? 'Clientes já conseguem agendar por este endereço:' : 'Publique quando serviços, equipe e horários estiverem certos. Endereço:'} <a href="/b/${s.slug}" target="_blank" rel="noopener">${publicUrl}</a></p></div>
      <form method="post" action="/app/s/${s.slug}/pagina/${s.published ? 'despublicar' : 'publicar'}"><button class="btn ${s.published ? '' : 'primary'}">${s.published ? 'Tirar do ar' : 'Publicar página'}</button></form>
    </section>
    <form method="post" action="/app/s/${s.slug}/pagina/avisos" class="block notify-form">
      <label class="inline"><input type="checkbox" name="on" value="1" ${s.notify_email !== false ? 'checked' : ''}> <span><b>Avisar por e-mail</b> quando um cliente marcar, remarcar ou cancelar pela página</span></label>
      <button class="btn sm">Salvar aviso</button>
      <p class="hint">Vai para o e-mail do proprietário e dos gerentes. Horários marcados no balcão não geram aviso.</p>
    </form>
    <form method="post" action="/app/s/${s.slug}/pagina" class="form">
      <section class="block"><h2>Informações</h2>
        <div class="grid2">
          <div class="field"><label for="pn">Nome</label><input class="input" id="pn" name="name" value="${s.name}" required maxlength="60"></div>
          <div class="field"><label for="pp">WhatsApp da barbearia</label><input class="input" id="pp" name="phone" value="${s.phone}" inputmode="tel" placeholder="(11) 98765-4321" autocomplete="tel"></div>
          <div class="field span2"><label for="pa">Endereço</label><input class="input" id="pa" name="address" value="${s.address}" maxlength="160"></div>
          <div class="field span2"><label for="pd">Descrição</label><textarea class="input" id="pd" name="description" maxlength="400" rows="3">${s.description}</textarea></div>
          <div class="field"><label for="pi">Instagram</label><input class="input" id="pi" name="instagram" value="${s.instagram}" placeholder="@suabarbearia"></div>
        </div></section>
      <section class="block"><h2>Aparência</h2>
        <p class="hint">As combinações são testadas para manter o texto legível em qualquer celular.</p>
        <div class="presets">${Object.entries(PRESETS).map(([id, p]) => h`<fieldset class="preset ${t.id === id ? 'on' : ''}"><legend><b>${p.label}</b><small>${p.note}</small></legend>
          <div class="swatches">${Object.entries(p.accents).map(([aid, a]) => h`<label class="sw" title="${a.label}"><input type="radio" name="theme" value="${id}:${aid}" ${t.id === id && t.accent === a.color ? 'checked' : ''} required><span style="background:${p.bg};border-color:${p.line}"><i style="background:${a.color}"></i><em style="color:${p.ink}">Aa</em></span><small>${a.label}</small></label>`)}</div></fieldset>`)}</div></section>
      <section class="block"><h2>Regras de agendamento</h2>
        <div class="grid2">
          <div class="field"><label for="mn">Antecedência mínima</label><select class="input" id="mn" name="min_notice_min">${[[0, 'Nenhuma'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [1440, '1 dia']].map(([v, l]) => h`<option value="${v}" ${pol.min_notice_min === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="mx">Agenda aberta até</label><select class="input" id="mx" name="max_days_ahead">${[[7, '1 semana'], [14, '2 semanas'], [30, '30 dias'], [60, '60 dias'], [90, '90 dias']].map(([v, l]) => h`<option value="${v}" ${pol.max_days_ahead === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="cu">Cliente pode cancelar até</label><select class="input" id="cu" name="cancel_until_min">${[[0, 'A qualquer momento'], [60, '1 hora antes'], [120, '2 horas antes'], [360, '6 horas antes'], [1440, '1 dia antes']].map(([v, l]) => h`<option value="${v}" ${pol.cancel_until_min === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="st">Horários de</label><select class="input" id="st" name="slot_step_min">${[10, 15, 20, 30].map((v) => h`<option value="${v}" ${pol.slot_step_min === v ? 'selected' : ''}>${v} em ${v} minutos</option>`)}</select></div>
        </div></section>
      <div class="sticky-save"><button class="btn primary">Salvar página</button><a class="btn" href="/b/${s.slug}" target="_blank" rel="noopener">Pré-visualizar ${ICON.ext}</a></div>
    </form>`, f);
}
