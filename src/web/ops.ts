import { h, raw, ICON, Safe } from './html.ts';
import type { Ctx } from '../domain/accounts.ts';
import { can } from '../domain/accounts.ts';
import { layout, dayLabel, chip, hoursEditor, initials } from './panel.ts';
import { METHODS } from '../domain/sales.ts';
import { PRESETS, resolveTheme } from '../domain/themes.ts';
import { brl, fmtPhone, hhmm, toLocal, addDays, clock } from '../lib/core.ts';

type F = { ok?: string; err?: string };
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${MES[mm - 1][0].toUpperCase() + MES[mm - 1].slice(1)} de ${y}`; };
const shiftMonth = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const real = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const t = (ctx: Ctx, iso: any) => { const l = toLocal(new Date(iso), ctx.shop.timezone); return { date: l.date, time: hhmm(l.minutes) }; };

/* ---------------- comanda ---------------- */
export function checkoutPage(ctx: Ctx, d: { booking: any; services: any[]; pros: any[] }, f: F) {
  const base = `/app/s/${ctx.shop.slug}`;
  const b = d.booking;
  const fixed = b ? b.items.reduce((s: number, i: any) => s + i.price_cents, 0) : 0;
  const when = b ? t(ctx, b.starts_at) : null;
  return layout(ctx, 'caixa', b ? 'Fechar comanda' : 'Venda avulsa', h`
    ${b?.paid ? h`<div class="flash ok">A comanda deste atendimento já foi fechada. <a href="${base}/caixa?date=${when!.date}">Ver no caixa</a></div>` : ''}
    <form method="post" action="${base}/caixa/comanda" class="co" data-fixed="${fixed}">
      <input type="hidden" name="bookingId" value="${b?.id ?? ''}">
      <div class="co-main">
        ${b ? h`<section class="block co-who"><span class="ava">${initials(b.customer)}</span><span class="who"><b>${b.customer}</b><small>${dayLabel(when!.date)}, ${when!.time} · com ${b.pro_name}</small></span>${chip(b.status)}</section>`
          : h`<section class="block"><h2>Quem atendeu</h2><div class="grid3">
              <div class="field"><label for="pr">Profissional</label><select class="input" id="pr" name="professionalId" required>${d.pros.map((p) => h`<option value="${p.id}">${p.name}</option>`)}</select></div>
              <div class="field"><label for="cn">Cliente (opcional)</label><input class="input" id="cn" name="customerName" maxlength="80"></div>
              <div class="field"><label for="cp">WhatsApp (opcional)</label><input class="input" id="cp" name="customerPhone" inputmode="tel"></div></div></section>`}
        <section class="block"><h2>Itens</h2>
          ${b ? h`<ul class="co-items">${b.items.map((i: any) => h`<li><span>${i.name}</span><b>${brl(i.price_cents)}</b></li>`)}</ul>` : ''}
          <fieldset class="field"><legend>${b ? 'Adicionar serviço' : 'Serviços'}</legend>
            <div class="pick">${d.services.map((s) => h`<label><input type="checkbox" name="svc" value="${s.id}" data-price="${s.price_cents}"><span>${s.name}<small>${brl(s.price_cents)}</small></span></label>`)}</div></fieldset>
          <fieldset class="field"><legend>Produtos e outros</legend>
            ${[0, 1].map((i) => h`<div class="prod"><label class="sr" for="pn${i}">Produto</label><input class="input" id="pn${i}" name="productName" placeholder="Ex.: pomada modeladora" maxlength="80"><div class="affix pre"><span>R$</span><label class="sr" for="pp${i}">Preço</label><input class="input" id="pp${i}" name="productPrice" inputmode="decimal" placeholder="0,00" data-money></div></div>`)}
            <p class="hint">Produtos não geram comissão.</p></fieldset>
          <div class="field co-disc"><label for="ds">Desconto</label><div class="affix pre"><span>R$</span><input class="input" id="ds" name="discount" inputmode="decimal" placeholder="0,00" data-money></div></div>
        </section>
      </div>
      <aside class="co-side block">
        <span class="k">Total a receber</span>
        <b class="co-total" data-total>${brl(fixed)}</b>
        <fieldset class="field"><legend>Como pagou</legend>
          <div class="methods">${Object.entries(METHODS).map(([k, l], i) => h`<label><input type="radio" name="method1" value="${k}" ${i === 0 ? 'checked' : ''} required><span>${l}</span></label>`)}</div></fieldset>
        <div class="field cash-only"><label for="rc">Valor recebido em dinheiro</label><div class="affix pre"><span>R$</span><input class="input" id="rc" inputmode="decimal" placeholder="0,00" data-received></div><small class="hint" data-change></small></div>
        <details class="split"><summary>Dividir em duas formas</summary>
          <div class="grid2"><div class="field"><label for="m2">Segunda forma</label><select class="input" id="m2" name="method2"><option value="">—</option>${Object.entries(METHODS).map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select></div>
          <div class="field"><label for="a2">Valor</label><div class="affix pre"><span>R$</span><input class="input" id="a2" name="amount2" inputmode="decimal" placeholder="0,00" data-money></div></div></div>
          <p class="hint">O restante fica na primeira forma.</p></details>
        <button class="btn primary wide co-go" ${b?.paid ? 'disabled' : ''}>${ICON.check} Receber <span data-total>${brl(fixed)}</span></button>
        ${b ? h`<a class="btn ghost wide" href="${base}/reserva/${b.id}">Voltar sem receber</a>` : ''}
      </aside>
    </form>`, f);
}

/* ---------------- caixa do dia ---------------- */
export function cashPage(ctx: Ctx, day: string, d: any, f: F) {
  const base = `/app/s/${ctx.shop.slug}`;
  const today = toLocal(clock.now(), ctx.shop.timezone).date;
  const cards = (d.byMethod.debito ?? 0) + (d.byMethod.credito ?? 0);
  const diff = d.closing ? d.closing.counted_cash_cents - d.closing.expected_cash_cents : 0;
  return layout(ctx, 'caixa', day === today ? 'Caixa de hoje' : `Caixa · ${ddmm(day)}`, h`
    <div class="agbar">
      <div class="segnav"><a href="?date=${addDays(day, -1)}" aria-label="Dia anterior">${ICON.left}</a><a href="?date=${today}" class="${day === today ? 'on' : ''}">Hoje</a><a href="?date=${addDays(day, 1)}" aria-label="Próximo dia">${ICON.right}</a></div>
      <span class="muted">${dayLabel(day)}</span>
      <form method="get" class="datepick"><label class="sr" for="dt">Ir para data</label><input id="dt" type="date" name="date" value="${day}" class="input sm"><button class="btn sm">Ir</button></form>
    </div>
    <div class="summary-line">
      <div><span class="k">Recebido no dia</span><b>${brl(d.total)}</b></div>
      <div><span class="k">Pix</span><b>${brl(d.byMethod.pix ?? 0)}</b></div>
      <div><span class="k">Dinheiro</span><b>${brl(d.byMethod.dinheiro ?? 0)}</b></div>
      <div><span class="k">Cartão</span><b>${brl(cards)}</b></div>
      <div><span class="k">Comandas</span><b>${d.count}</b></div>
    </div>
    ${d.pending.length ? h`<section class="block pend"><div class="block-head"><h2>Atendimentos sem pagamento registrado</h2><span class="muted">${d.pending.length}</span></div>
      <ul class="rows">${d.pending.map((b: any) => h`<li class="row"><span class="t">${t(ctx, b.starts_at).time}</span><span class="who"><b>${b.customer}</b><small>${b.pro_name} · ${brl(b.price_cents)}</small></span><a class="btn sm primary" href="${base}/caixa/comanda?booking=${b.id}">Fechar comanda</a></li>`)}</ul></section>` : ''}
    <section class="block"><div class="block-head"><h2>Vendas</h2>${can(ctx, 'sales.create') ? h`<a class="btn sm" href="${base}/caixa/comanda">${ICON.plus} Venda avulsa</a>` : ''}</div>
      ${d.sales.length ? h`<div class="table-wrap flat"><table class="tbl"><thead><tr><th>Hora</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th class="r">Valor</th><th></th></tr></thead><tbody>
        ${d.sales.map((s: any) => h`<tr class="${s.status === 'void' ? 'void' : ''}"><td>${t(ctx, s.paid_at).time}</td><td><b>${s.customer ?? 'Sem cadastro'}</b><small class="muted">${s.pros ?? ''}</small></td><td>${s.items}${s.discount_cents ? h`<small class="muted">desconto ${brl(s.discount_cents)}</small>` : ''}</td>
          <td>${(s.pays ?? []).map((p: any) => `${METHODS[p.method]} ${brl(p.amount)}`).join(' + ')}</td><td class="r"><b>${brl(s.total_cents)}</b>${s.status === 'void' ? h`<small class="muted">estornada${s.void_reason ? `: ${s.void_reason}` : ''}</small>` : ''}</td>
          <td class="r">${s.status === 'paid' && can(ctx, 'sales.void') && !d.closing ? h`<details class="mini-void"><summary>Estornar</summary><form method="post" action="${base}/caixa/venda/${s.id}/estornar"><input class="input sm" name="reason" placeholder="Motivo" maxlength="140" aria-label="Motivo do estorno"><button class="btn sm danger">Confirmar</button></form></details>` : ''}</td></tr>`)}
      </tbody></table></div>` : h`<p class="empty">Nenhuma venda neste dia.</p>`}</section>
    <section class="block close-box"><h2>Fechamento do caixa</h2>
      ${d.closing ? h`<div class="closed-ok"><p><b>Caixa fechado</b> às ${t(ctx, d.closing.closed_at).time}.</p>
          <dl class="kv flat"><dt>Dinheiro esperado</dt><dd>${brl(d.closing.expected_cash_cents)}</dd><dt>Dinheiro contado</dt><dd>${brl(d.closing.counted_cash_cents)}</dd>
          <dt>Diferença</dt><dd class="${diff === 0 ? 'ok-t' : 'warn-t'}"><b>${diff === 0 ? 'Bateu certinho' : (diff > 0 ? 'Sobrou ' : 'Faltou ') + brl(Math.abs(diff))}</b></dd>${d.closing.note ? h`<dt>Observação</dt><dd>${d.closing.note}</dd>` : ''}</dl></div>`
        : can(ctx, 'cash.manage') && day <= today ? h`<form method="post" action="${base}/caixa/fechar" class="grid3">
          <input type="hidden" name="day" value="${day}">
          <div class="field"><span class="label">Dinheiro esperado na gaveta</span><b class="big-num">${brl(d.byMethod.dinheiro ?? 0)}</b></div>
          <div class="field"><label for="cc">Dinheiro contado</label><div class="affix pre"><span>R$</span><input class="input" id="cc" name="counted" inputmode="decimal" required placeholder="0,00"></div></div>
          <div class="field"><label for="no">Observação</label><input class="input" id="no" name="note" maxlength="200" placeholder="Opcional"></div>
          <div class="row-btns"><button class="btn primary">Fechar caixa do dia</button></div>
          <p class="hint span3">Depois de fechado, as vendas do dia não podem mais ser estornadas.</p></form>`
        : h`<p class="empty">Ainda não fechado.</p>`}
    </section>`, f, can(ctx, 'sales.create') ? h`<a class="btn primary" href="${base}/caixa/comanda">${ICON.plus} Venda avulsa</a>` : '');
}

/* ---------------- financeiro do mês ---------------- */
function bars(days: { day: string; v: number }[]) {
  const max = Math.max(1, ...days.map((d) => d.v));
  const W = 720, H = 160, bw = W / days.length;
  return h`<svg class="chart" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Faturamento por dia">
    ${days.map((d, i) => { const hh = Math.round((d.v / max) * H); return h`<g><rect x="${(i * bw + 2).toFixed(1)}" y="${H - hh}" width="${(bw - 4).toFixed(1)}" height="${Math.max(hh, d.v ? 2 : 0)}" rx="3"><title>${ddmm(d.day)}: ${brl(d.v)}</title></rect>${i % 5 === 0 ? h`<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 16}" text-anchor="middle">${d.day.slice(8)}</text>` : ''}</g>`; })}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}"></line></svg>`;
}
/** Porcentagem efetiva do mês (a comissão é congelada em cada comanda; se a % mudou no meio do mês, mostra a média real). */
const effPct = (p: any) => (p.services ? Math.round((p.commission / p.services) * 1000) / 10 : p.pct);
/** Explicação com os números do próprio mês: o dono entende a regra olhando o caso dele. */
function commissionExplainer(p: any, base: string) {
  return h`<div class="explain"><b>Como funciona:</b> cada barbeiro fica com uma porcentagem do valor dos serviços que ele atendeu (com desconto já tirado). Produtos não entram.
    ${p.services ? h`Exemplo deste mês: ${p.name.split(' ')[0]} atendeu ${brl(p.services)} em serviços com ${effPct(p)}%, então ${brl(p.commission)} são dele e ${brl(p.services - p.commission)} ficam na barbearia.` : ''}
    <a href="${base}/equipe">Mudar a porcentagem de cada um</a></div>`;
}
export function reportPage(ctx: Ctx, r: any, commissionsOn: boolean, f: F) {
  const base = `/app/s/${ctx.shop.slug}`;
  const rate = r.done + r.noshow ? Math.round((r.noshow / (r.done + r.noshow)) * 100) : 0;
  return layout(ctx, 'financeiro', 'Financeiro', h`
    <div class="agbar"><div class="segnav"><a href="?mes=${shiftMonth(r.month, -1)}" aria-label="Mês anterior">${ICON.left}</a><a href="?mes=${toLocal(clock.now(), ctx.shop.timezone).date.slice(0, 7)}">Este mês</a><a href="?mes=${shiftMonth(r.month, 1)}" aria-label="Próximo mês">${ICON.right}</a></div><b class="month">${monthLabel(r.month)}</b></div>
    <div class="kpi-grid">
      <div class="kpi hero"><span class="k">Faturamento (comandas pagas)</span><b>${brl(r.revenue)}</b><small>${r.salesN} ${r.salesN === 1 ? 'comanda' : 'comandas'} · ticket médio ${brl(r.ticket)}</small></div>
      <div class="kpi"><span class="k">Atendimentos</span><b>${r.done}</b><small>marcados como atendidos</small></div>
      <div class="kpi"><span class="k">Faltas</span><b>${r.noshow}</b><small>${rate}% dos horários do mês</small></div>
      ${commissionsOn ? h`<div class="kpi"><span class="k">Comissões do mês</span><b>${brl(r.commissionTotal)}</b><small>parte dos barbeiros nos serviços</small></div>` : ''}
    </div>
    <section class="block"><div class="block-head"><h2>Faturamento por dia</h2></div>${r.revenue ? bars(r.days) : h`<p class="empty">Sem vendas registradas neste mês. As vendas entram aqui quando a comanda é fechada no caixa.</p>`}</section>
    <div class="cols">
      <section class="block"><h2>Comissões por profissional</h2>
        ${commissionsOn ? (r.byPro.length ? h`${commissionExplainer(r.byPro[0], base)}<table class="mini comm"><thead><tr><th>Profissional</th><th class="r">Atendeu em serviços</th><th class="r">Para ele</th><th class="r">Para a barbearia</th></tr></thead><tbody>${r.byPro.map((p: any) => h`<tr><td><b>${p.name}</b><small class="muted"> · ${effPct(p)}% · ${p.count} ${p.count === 1 ? 'comanda' : 'comandas'}</small></td><td class="r">${brl(p.services)}</td><td class="r"><b>${brl(p.commission)}</b></td><td class="r muted">${brl(p.services - p.commission)}</td></tr>`)}</tbody></table>` : h`<p class="empty">Sem comandas no mês. A comissão aparece aqui quando um atendimento é cobrado no caixa.</p>`)
          : h`<div class="upsell"><p>O cálculo automático de comissões faz parte do plano Profissional.</p>${can(ctx, 'billing.manage') ? h`<a class="btn sm" href="${base}/assinatura">Ver planos</a>` : ''}</div>`}
      </section>
      <section class="block"><h2>Formas de pagamento</h2>${r.pays.length ? h`<ul class="barlist">${r.pays.map((p: any) => h`<li><span>${METHODS[p.method]}</span><i style="--w:${Math.round((p.v / Math.max(1, r.revenue)) * 100)}%"></i><b>${brl(p.v)}</b></li>`)}</ul>` : h`<p class="empty">—</p>`}
        <h2 class="mt">Mais vendidos</h2>${r.bySvc.length ? h`<ul class="barlist">${r.bySvc.slice(0, 8).map((s: any) => h`<li><span>${s.name} <small class="muted">×${s.n}</small></span><i style="--w:${Math.round((s.v / Math.max(1, r.bySvc[0].v)) * 100)}%"></i><b>${brl(s.v)}</b></li>`)}</ul>` : h`<p class="empty">—</p>`}
      </section>
    </div>`, f);
}

export function myCommissionsPage(ctx: Ctx, r: any, commissionsOn: boolean, f: F) {
  const me = r.byPro[0] ?? { services: 0, products: 0, commission: 0, count: 0, pct: 0 };
  return layout(ctx, 'comissoes', 'Minhas comissões', h`
    <div class="agbar"><div class="segnav"><a href="?mes=${shiftMonth(r.month, -1)}" aria-label="Mês anterior">${ICON.left}</a><a href="?mes=${toLocal(clock.now(), ctx.shop.timezone).date.slice(0, 7)}">Este mês</a><a href="?mes=${shiftMonth(r.month, 1)}" aria-label="Próximo mês">${ICON.right}</a></div><b class="month">${monthLabel(r.month)}</b></div>
    ${commissionsOn ? h`<div class="kpi-grid">
      <div class="kpi hero"><span class="k">Sua comissão no mês</span><b>${brl(me.commission)}</b><small>${effPct(me)}% de ${brl(me.services)} em serviços que você atendeu</small></div>
      <div class="kpi"><span class="k">Comandas</span><b>${me.count}</b><small>com você</small></div>
      <div class="kpi"><span class="k">Atendimentos</span><b>${r.done}</b><small>marcados como atendidos</small></div>
      <div class="kpi"><span class="k">Faltas</span><b>${r.noshow}</b><small>clientes que não vieram</small></div></div>
      <div class="explain"><b>Como é calculado:</b> você fica com ${me.pct}% do valor de cada serviço que atende, depois de qualquer desconto. Um corte de R$ 45,00 dá ${brl(Math.round(4500 * me.pct / 100))} para você. Produtos vendidos não entram. A conta é feita quando a comanda é fechada no caixa.</div>
      <section class="block"><h2>Por dia</h2>${me.services ? bars(r.days) : h`<p class="empty">Nenhuma comanda sua neste mês ainda.</p>`}</section>`
    : h`<div class="upsell block"><p>O cálculo de comissões não está incluído no plano atual da barbearia.</p></div>`}`, f);
}

/* ---------------- clientes ---------------- */
export function customersPage(ctx: Ctx, d: any, f: F) {
  const base = `/app/s/${ctx.shop.slug}/clientes`;
  const tabs: [string, string, number][] = [['', 'Todos', d.counts.todos], ['agendado', 'Com horário', d.counts.agendado], ['sumido', 'Sumidos', d.counts.sumido], ['novo', 'Sem visita', d.counts.novo]];
  const day = (x: any) => x ? ddmm(toLocal(new Date(x), ctx.shop.timezone).date) : '—';
  const since = (x: any) => x ? Math.floor((clock.now().getTime() - new Date(x).getTime()) / 86_400_000) : null;
  return layout(ctx, 'clientes', 'Clientes', h`
    <form method="get" class="filters"><input class="input" name="q" value="${d.q}" placeholder="Buscar por nome ou WhatsApp" aria-label="Buscar cliente">${d.filtro ? h`<input type="hidden" name="filtro" value="${d.filtro}">` : ''}<button class="btn">Buscar</button></form>
    <nav class="tabs" aria-label="Filtro">${tabs.map(([k, l, n]) => h`<a href="${base}?filtro=${k}${d.q ? '&q=' + encodeURIComponent(d.q) : ''}" class="${d.filtro === k ? 'on' : ''}">${l} <span>${n}</span></a>`)}</nav>
    ${d.filtro === 'sumido' ? h`<p class="hint" style="margin-bottom:10px">Clientes que não aparecem há mais de 45 dias e não têm horário marcado. Um recado no WhatsApp costuma trazer de volta.</p>` : ''}
    ${d.list.length ? h`<div class="table-wrap" tabindex="0" role="region" aria-label="Lista de clientes"><table class="tbl clients"><thead><tr><th>Cliente</th><th class="r">Visitas</th><th>Última visita</th><th class="r">Já pagou</th><th></th></tr></thead><tbody>
      ${d.list.map((c: any) => { const s = since(c.last_visit); return h`<tr><td><a href="${base}/${c.id}" class="cli"><span class="ava">${initials(c.name)}</span><span><b>${c.name}</b><small class="muted">${fmtPhone(c.phone)}</small></span></a></td>
        <td class="r">${c.visits}${c.noshows ? h`<small class="warn-t">${c.noshows} ${c.noshows === 1 ? 'falta' : 'faltas'}</small>` : ''}</td><td>${c.next_visit ? h`<span class="tag ok">volta ${day(c.next_visit)}</span>` : c.last_visit ? h`${day(c.last_visit)} <small class="muted">há ${s} dias</small>` : h`<span class="muted">—</span>`}</td>
        <td class="r">${c.spent ? brl(c.spent) : h`<span class="muted">—</span>`}</td>
        <td class="r">${c.tag === 'sumido' ? h`<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/55${c.phone}?text=${encodeURIComponent(`Olá, ${c.name.split(' ')[0]}! Faz tempo que você não passa na ${ctx.shop.name}. Quer marcar um horário? Agende por aqui:`)}">Chamar de volta</a>` : ''}</td></tr>`; })}
    </tbody></table></div>` : h`<p class="empty">${d.q ? 'Nenhum cliente encontrado.' : 'Os clientes aparecem aqui quando marcam horário ou passam no caixa.'}</p>`}`, f);
}

export function customerPage(ctx: Ctx, c: any, f: F) {
  const base = `/app/s/${ctx.shop.slug}`;
  return layout(ctx, 'clientes', c.name, h`
    <div class="detail2">
      <div class="d-main">
        <div class="kpi-grid k3">
          <div class="kpi"><span class="k">Visitas atendidas</span><b>${c.visits}</b><small>${c.every ? `volta a cada ~${c.every} dias` : 'frequência ainda sem histórico'}</small></div>
          <div class="kpi"><span class="k">Já pagou</span><b>${brl(c.spent)}</b><small>${c.salesN} ${c.salesN === 1 ? 'comanda' : 'comandas'}</small></div>
          <div class="kpi"><span class="k">Faltas</span><b class="${c.noshows ? 'warn-t' : ''}">${c.noshows}</b><small>horários sem aparecer</small></div>
        </div>
        <section class="block"><h2>Histórico</h2>
          ${c.bookings.length ? h`<ul class="rows">${c.bookings.map((b: any) => { const w = t(ctx, b.starts_at); return h`<li class="row"><a class="row-main" href="${base}/reserva/${b.id}"><span class="t">${ddmm(w.date)}</span><span class="who"><b>${b.services ?? '—'}</b><small>${w.time} · ${b.pro_name} · ${brl(b.price_cents)}</small></span></a>${chip(b.status)}</li>`; })}</ul>` : h`<p class="empty">Sem horários ainda.</p>`}
        </section>
      </div>
      <aside class="d-side">
        <form method="post" action="${base}/clientes/${c.id}" class="block"><h2>Dados</h2>
          <div class="field"><label for="cn">Nome</label><input class="input" id="cn" name="name" value="${c.name}" required maxlength="80"></div>
          <div class="field"><label for="cp">WhatsApp</label><input class="input" id="cp" name="phone" value="${fmtPhone(c.phone)}" inputmode="tel" required></div>
          <div class="field"><label for="cnt">Anotações</label><textarea class="input" id="cnt" name="notes" rows="4" maxlength="1000" placeholder="Ex.: prefere máquina 2 nas laterais">${c.notes}</textarea></div>
          <div class="row-btns"><button class="btn primary sm">Salvar</button><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/55${c.phone}">WhatsApp</a></div>
        </form>
        ${can(ctx, 'customers.privacy') ? h`<section class="block"><h2>Privacidade (LGPD)</h2>
          <p class="hint">Se o cliente pedir, você pode entregar uma cópia dos dados ou apagá-los. O histórico de valores continua, sem nome nem telefone.</p>
          <a class="btn sm wide" href="${base}/clientes/${c.id}/exportar">Baixar dados do cliente</a>
          <details class="danger-zone"><summary>Apagar dados pessoais</summary><form method="post" action="${base}/clientes/${c.id}/apagar"><p class="hint">Nome, WhatsApp e anotações são removidos para sempre. Não dá para desfazer.</p><button class="btn danger wide">Apagar dados de ${c.name.split(' ')[0]}</button></form></details>
        </section>` : ''}
      </aside>
    </div>`, f, h`<a class="btn" href="${base}/clientes">${ICON.left} Clientes</a>`);
}

/* ---------------- primeiros passos ---------------- */
export const STEPS = ['Horários', 'Serviços', 'Equipe', 'Aparência', 'Publicar'];
export function onboardingPage(ctx: Ctx, step: number, d: { done: boolean[]; hours: any[]; services: any[]; pros: any[]; url: string }, f: F) {
  const base = `/app/s/${ctx.shop.slug}`, me = `${base}/comecar`;
  const nextHidden = (n: number) => h`<input type="hidden" name="_next" value="${me}?passo=${n}">`;
  const stepper = h`<ol class="ob-steps">${STEPS.map((s, i) => h`<li class="${i + 1 === step ? 'on' : d.done[i] ? 'done' : ''}"><a href="${me}?passo=${i + 1}" ${i + 1 === step ? raw('aria-current="step"') : ''}><span class="n" aria-hidden="true">${d.done[i] && i + 1 !== step ? ICON.check : i + 1}</span><span class="lbl">${s}</span>${d.done[i] ? h`<span class="sr"> (feito)</span>` : ''}</a></li>`)}</ol>`;
  const nav = (back: number | null, next: Safe) => h`<div class="ob-nav">${back ? h`<a class="btn ghost" href="${me}?passo=${back}">${ICON.left} Voltar</a>` : h`<span></span>`}${next}</div>`;
  let body: Safe;
  if (step === 1) body = h`<h2>Quando a barbearia abre?</h2><p class="lead">Os clientes só conseguem marcar dentro desse horário. Barbeiros com horário diferente você ajusta depois, em Equipe.</p>
    <form method="post" action="${base}/horarios" class="hours">${nextHidden(2)}${hoursEditor((wd) => d.hours.filter((x) => !x.professional_id && x.weekday === wd), 'Fechado')}
      ${nav(null, h`<button class="btn primary">Salvar e continuar ${ICON.right}</button>`)}</form>`;
  else if (step === 2) body = h`<h2>O que você oferece e quanto custa?</h2><p class="lead">Já deixamos três serviços comuns. Ajuste nome, tempo e preço, ou adicione outros. Tudo é salvo ao continuar.</p>
    <details class="add"><summary class="btn">${ICON.plus} Adicionar outro serviço</summary><form method="post" action="${base}/servicos" class="block ob-svc">${nextHidden(2)}
      <input class="input" name="name" placeholder="Ex.: Pigmentação" required aria-label="Nome do serviço novo"><input type="hidden" name="description" value="">
      <div class="affix"><input class="input" name="duration" type="number" min="5" max="480" step="5" value="30" aria-label="Duração do serviço novo"><span>min</span></div>
      <div class="affix pre"><span>R$</span><input class="input" name="price" inputmode="decimal" placeholder="0,00" required aria-label="Preço do serviço novo"></div>
      <button class="btn primary sm">Adicionar</button></form></details>
    <form method="post" action="${me}/servicos">
      <div class="ob-head" aria-hidden="true"><span>Serviço</span><span>Tempo</span><span>Preço</span></div>
      <ul class="items">${d.services.filter((s) => s.active).map((s) => h`<li class="item"><div class="ob-svc">
        <input type="hidden" name="id" value="${s.id}">
        <input class="input" name="name" value="${s.name}" aria-label="Nome: ${s.name}" required>
        <div class="affix"><input class="input" name="duration" type="number" min="5" max="480" step="5" value="${s.duration_min}" aria-label="Duração de ${s.name}"><span>min</span></div>
        <div class="affix pre"><span>R$</span><input class="input" name="price" inputmode="decimal" value="${real(s.price_cents)}" aria-label="Preço de ${s.name}"></div>
      </div></li>`)}</ul>
      ${nav(1, h`<button class="btn primary">Salvar e continuar ${ICON.right}</button>`)}</form>`;
  else if (step === 3) body = h`<h2>Quem atende?</h2><p class="lead">Cada profissional ganha uma coluna na agenda e uma cor. Você já está na lista. Acesso ao painel para a equipe fica em Equipe.</p>
    <ul class="items">${d.pros.filter((p) => p.active).map((p) => h`<li class="item"><div class="static"><span class="ava">${initials(p.name)}</span><span class="who"><b>${p.name}</b><small>${p.title || 'Sem especialidade'} · ${p.commission_pct}% de comissão</small></span></div></li>`)}</ul>
    <form method="post" action="${base}/equipe" class="block grid3">${nextHidden(3)}
      <div class="field"><label for="on">Nome</label><input class="input" id="on" name="name" required maxlength="60"></div>
      <div class="field"><label for="ot">Especialidade</label><input class="input" id="ot" name="title" maxlength="60" placeholder="Opcional"></div>
      <div class="field"><label for="oc">Comissão</label><div class="affix"><input class="input" id="oc" name="commission" type="number" min="0" max="100" step="0.5" value="40" aria-describedby="och"><span>%</span></div></div>
      <p class="hint span3" id="och">Comissão é a parte de cada serviço que fica com o barbeiro. Com 40%, um corte de R$ 45,00 dá R$ 18,00 para ele e R$ 27,00 para a barbearia. O sistema calcula sozinho no caixa.</p>
      <div class="row-btns"><button class="btn sm">${ICON.plus} Adicionar profissional</button></div></form>
    ${nav(2, h`<a class="btn primary" href="${me}?passo=4">Continuar ${ICON.right}</a>`)}`;
  else if (step === 4) {
    const s = ctx.shop, tt = resolveTheme(s.theme), pol = s.policy;
    body = h`<h2>Como sua página vai aparecer</h2><p class="lead">Escolha um estilo e uma cor. Todos ficam legíveis no celular do cliente.</p>
    <form method="post" action="${base}/pagina" class="form">${nextHidden(5)}
      ${['min_notice_min', 'max_days_ahead', 'cancel_until_min', 'slot_step_min'].map((k) => h`<input type="hidden" name="${k}" value="${(pol as any)[k]}">`)}<input type="hidden" name="instagram" value="${s.instagram}">
      <div class="grid2"><div class="field"><label for="pn">Nome da barbearia</label><input class="input" id="pn" name="name" value="${s.name}" required></div>
        <div class="field"><label for="pp">WhatsApp da barbearia</label><input class="input" id="pp" name="phone" value="${s.phone}" inputmode="tel" placeholder="(11) 98765-4321" autocomplete="tel"></div>
        <div class="field span2"><label for="pa">Endereço</label><input class="input" id="pa" name="address" value="${s.address}" maxlength="160"></div>
        <div class="field span2"><label for="pd">Uma frase sobre a casa</label><input class="input" id="pd" name="description" value="${s.description}" maxlength="400" placeholder="Ex.: Corte clássico e barba com toalha quente desde 2015."></div></div>
      <div class="presets">${Object.entries(PRESETS).map(([id, p]) => h`<fieldset class="preset ${tt.id === id ? 'on' : ''}"><legend><b>${p.label}</b><small>${p.note}</small></legend>
        <div class="swatches">${Object.entries(p.accents).map(([aid, a]) => h`<label class="sw" title="${a.label}"><input type="radio" name="theme" value="${id}:${aid}" ${tt.id === id && tt.accent === a.color ? 'checked' : ''} required><span style="background:${p.bg};border-color:${p.line}"><i style="background:${a.color}"></i><em style="color:${p.ink}">Aa</em></span><small>${a.label}</small></label>`)}</div></fieldset>`)}</div>
      ${nav(3, h`<button class="btn primary">Salvar e continuar ${ICON.right}</button>`)}</form>`;
  } else body = h`<h2>Tudo pronto para receber agendamentos</h2>
    <p class="lead">Confira a página como o cliente vai ver. Quando publicar, mande o endereço para os clientes e coloque na bio do Instagram.</p>
    <div class="ob-url"><span class="sel">${d.url}</span><a class="btn sm" href="/b/${ctx.shop.slug}" target="_blank" rel="noopener">Ver página ${ICON.ext}</a></div>
    ${ctx.shop.published ? h`<div class="flash ok">Sua página já está no ar.</div>${nav(4, h`<a class="btn primary" href="${base}">Ir para o painel ${ICON.right}</a>`)}`
      : h`<form method="post" action="${base}/pagina/publicar">${nextHidden(5)}${nav(4, h`<button class="btn primary">Publicar minha página</button>`)}</form>`}`;
  return layout(ctx, 'comecar', 'Primeiros passos', h`<div class="ob">${stepper}<section class="block ob-body">${body}</section>
    <p class="hint ob-skip">Tudo que você salva fica guardado. <a href="${base}">Terminar depois</a></p></div>`, f);
}
export { raw };
