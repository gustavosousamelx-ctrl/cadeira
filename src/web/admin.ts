import { h, doc, ICON, LOGO, Safe, flash } from './html.ts';
import type { User } from '../domain/accounts.ts';
import { PLATFORM, brl } from '../lib/core.ts';
import { SUB_LABEL, PAY_LABEL } from '../billing/billing.ts';

const dt = (d: any) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
const day = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '—';
export const subChip = (s?: string) => s ? h`<span class="st sub-${s}">${SUB_LABEL[s as keyof typeof SUB_LABEL] ?? s}</span>` : h`<span class="muted">—</span>`;
export const payChip = (s: string) => h`<span class="st pay-${s}">${PAY_LABEL[s] ?? s}</span>`;
const FEATURE: Record<string, string> = { caixa: 'Caixa e comandas', clientes: 'Clientes e histórico', agenda: 'Agenda por profissional', pagina_publica: 'Página de agendamento', servicos: 'Serviços e preços', equipe: 'Equipe com acessos', comissoes: 'Comissões', fidelidade: 'Fidelidade', lembretes: 'Lembretes', relatorios_avancados: 'Relatórios avançados', multiusuario_avancado: 'Permissões avançadas' };
export const featureLabel = (f: string) => FEATURE[f] ?? f;

function layout(u: User, active: string, title: string, content: Safe, f: { ok?: string; err?: string } = {}) {
  const nav: [string, string, string][] = [['', 'Visão geral', 'today'], ['barbearias', 'Barbearias', 'team'], ['planos', 'Planos e preços', 'scissors'], ['cobrancas', 'Cobranças', 'agenda'], ['suporte', 'Mensagens', 'users'], ['auditoria', 'Auditoria', 'page']];
  return doc({ title: `${title} · Admin ${PLATFORM.name}`, css: ['app.css'], body: h`<div class="shell admin">
    <aside class="side"><a class="brand" href="/admin">${LOGO}<span>${PLATFORM.name}</span></a>
      <div class="shopbox"><b>Administração</b><small>${u.email}</small></div>
      <nav class="nav">${nav.map(([k, l, i]) => h`<a href="/admin${k ? '/' + k : ''}" class="${active === k ? 'on' : ''}">${ICON[i]}<span>${l}</span></a>`)}</nav>
      <div class="side-foot"><a href="/app">${ICON.left}<span>Meu painel</span></a><form method="post" action="/sair"><button>${ICON.out}<span>Sair</span></button></form></div></aside>
    <div class="mtop"><a class="brand" href="/admin" aria-label="Administração: visão geral">${LOGO}</a><b>Administração</b></div>
    <main class="main"><header class="pagehead"><h1>${title}</h1></header>${flash(f.ok, f.err)}${content}</main></div>` });
}

export function overview(u: User, m: any, f: any) {
  const conv = m.convEnded ? Math.round((m.convConverted / m.convEnded) * 100) : null;
  return layout(u, '', 'Visão geral', h`
    <p class="lead">Barbearias de demonstração ficam fora destes números.</p>
    <div class="kpi-grid">
      <div class="kpi hero"><span class="k">Receita recorrente (MRR) contratada</span><b>${brl(m.mrr)}</b><small>${m.paying} ${m.paying === 1 ? 'assinatura ativa ou em atraso' : 'assinaturas ativas ou em atraso'}</small></div>
      <div class="kpi"><span class="k">ARR estimado</span><b>${brl(m.arr)}</b><small>Projeção: MRR × 12</small></div>
      <div class="kpi"><span class="k">Recebido neste mês</span><b>${brl(m.received)}</b><small>${m.receivedN} cobranças pagas</small></div>
      <div class="kpi"><span class="k">Cobranças em aberto</span><b>${brl(m.open)}</b><small>${m.openN} aguardando, vencidas ou recusadas</small></div>
      <div class="kpi"><span class="k">Testes em andamento</span><b>${m.trialsActive}</b><small>${m.shops} barbearias no total · ${m.shopsMonth} novas no mês</small></div>
      <div class="kpi"><span class="k">Conversão de testes (30 dias)</span><b>${conv == null ? '—' : conv + '%'}</b><small>${m.convEnded ? `${m.convConverted} de ${m.convEnded} testes encerrados` : 'Nenhum teste terminou ainda'}</small></div>
      <div class="kpi"><span class="k">Novas assinaturas no mês</span><b>${m.newSubs}</b><small>Primeiro pagamento confirmado</small></div>
      <div class="kpi"><span class="k">Cancelamentos no mês</span><b>${m.cancels}</b><small>Assinaturas encerradas</small></div>
    </div>
    <section class="block"><h2>Assinaturas por situação</h2><div class="status-bar">${['trialing', 'active', 'past_due', 'expired', 'canceled'].map((s) => h`<a href="/admin/barbearias?status=${s}">${subChip(s)}<b>${m.byStatus[s] ?? 0}</b></a>`)}</div></section>`, f);
}

export function shopsPage(u: User, list: any[], q: { q?: string; status?: string }, f: any) {
  return layout(u, 'barbearias', 'Barbearias', h`
    <form class="filters" method="get"><input class="input" name="q" value="${q.q ?? ''}" placeholder="Nome, endereço ou e-mail do dono" aria-label="Buscar">
      <select class="input" name="status" aria-label="Situação"><option value="">Todas as situações</option>${Object.entries(SUB_LABEL).map(([k, l]) => h`<option value="${k}" ${q.status === k ? 'selected' : ''}>${l}</option>`)}</select><button class="btn">Filtrar</button></form>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Tabela"><table class="tbl"><thead><tr><th>Barbearia</th><th>Dono</th><th>Plano</th><th>Situação</th><th>Vence / teste até</th><th class="r">Mensalidade</th></tr></thead><tbody>
    ${list.length ? list.map((s) => h`<tr><td><a href="/admin/barbearias/${s.id}"><b>${s.name}</b></a><small class="muted">/b/${s.slug}${s.is_demo ? ' · demonstração' : ''}</small></td><td>${s.owner_email ?? '—'}</td><td>${s.plan_name ?? '—'}</td><td>${subChip(s.status)}</td>
      <td>${s.status === 'trialing' || s.status === 'expired' && !s.current_period_end ? day(s.trial_ends_at) : day(s.current_period_end)}</td><td class="r">${s.price_cents ? brl(s.price_cents) : '—'}</td></tr>`) : h`<tr><td colspan="6" class="muted">Nenhuma barbearia encontrada.</td></tr>`}
    </tbody></table></div>`, f);
}

export function shopPage(u: User, d: any, f: any) {
  const s = d.sub;
  return layout(u, 'barbearias', d.shop.name, h`
    <div class="cols">
      <section class="block"><h2>Assinatura</h2>
        <dl class="kv flat"><dt>Situação</dt><dd>${subChip(s?.status)}</dd><dt>Plano</dt><dd>${s?.plan_name ?? '—'}</dd><dt>Teste até</dt><dd>${day(s?.trial_ends_at)}</dd><dt>Período pago até</dt><dd>${day(s?.current_period_end)}</dd>
          ${s?.grace_until ? h`<dt>Tolerância até</dt><dd>${day(s.grace_until)}</dd>` : ''}${s?.cancel_at_period_end ? h`<dt>Cancelamento</dt><dd>No fim do período</dd>` : ''}<dt>Provedor</dt><dd>${s?.provider ?? '—'}</dd></dl>
        ${s && ['trialing', 'expired'].includes(s.status) && !s.current_period_end ? h`<form method="post" action="/admin/barbearias/${d.shop.id}/estender" class="inline-form"><label for="ed">Estender teste em</label><input class="input sm" id="ed" name="days" type="number" min="1" max="60" value="7"><span>dias</span><button class="btn sm">Estender</button></form>` : ''}
      </section>
      <section class="block"><h2>Uso</h2><dl class="kv flat"><dt>Dono</dt><dd>${d.owner?.name} · ${d.owner?.email}</dd><dt>Endereço</dt><dd><a href="/b/${d.shop.slug}" target="_blank" rel="noopener">/b/${d.shop.slug}</a> ${d.shop.published ? '' : '(não publicada)'}</dd>
        <dt>Profissionais ativos</dt><dd>${d.counts.pros}</dd><dt>Serviços ativos</dt><dd>${d.counts.services}</dd><dt>Agendamentos (30 dias)</dt><dd>${d.counts.bookings30}</dd><dt>Clientes cadastrados</dt><dd>${d.counts.customers}</dd><dt>Criada em</dt><dd>${day(d.shop.created_at)}</dd></dl>
        <p class="hint">Dados pessoais dos clientes da barbearia não aparecem aqui.</p></section>
    </div>
    <section class="block"><h2>Cobranças</h2>${paymentsTable(d.payments)}</section>`, f);
}

export function paymentsTable(list: any[]) {
  return list.length ? h`<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela"><table class="tbl"><thead><tr><th>Criada</th><th>Tipo</th><th>Período</th><th>Situação</th><th class="r">Valor</th></tr></thead><tbody>
    ${list.map((p) => h`<tr><td>${dt(p.created_at)}</td><td>${p.kind === 'first' ? 'Contratação' : 'Renovação'}${p.plan_name ? ` · ${p.plan_name}` : ''}</td><td>${day(p.period_start)} a ${day(p.period_end)}</td><td>${payChip(p.status)}${p.paid_at ? h`<small class="muted"> em ${day(p.paid_at)}</small>` : ''}</td><td class="r">${brl(p.amount_cents)}</td></tr>`)}
    </tbody></table></div>` : h`<p class="empty">Nenhuma cobrança ainda.</p>`;
}

export function plansPage(u: User, plans: any[], settings: any, f: any) {
  return layout(u, 'planos', 'Planos e preços', h`
    <p class="lead">Valores, testes e limites valem para novas contratações e renovações sem mudar o código. Quem já assina mantém o preço contratado até trocar de plano. Plano com preço zero não pode ser contratado.</p>
    ${plans.map((p) => h`<form method="post" action="/admin/planos/${p.id}" class="block plan-edit">
      <div class="block-head"><h2>${p.name} <small class="muted">· ${p.id}</small></h2><label class="inline"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''}> Disponível para contratar</label></div>
      <div class="grid4">
        <div class="field"><label for="n-${p.id}">Nome</label><input class="input" id="n-${p.id}" name="name" value="${p.name}" required></div>
        <div class="field"><label for="p-${p.id}">Mensalidade</label><div class="affix pre"><span>R$</span><input class="input" id="p-${p.id}" name="price" inputmode="decimal" value="${(p.price_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"></div></div>
        <div class="field"><label for="t-${p.id}">Dias de teste</label><input class="input" id="t-${p.id}" name="trial_days" type="number" min="0" max="90" value="${p.trial_days}"></div>
        <div class="field"><label for="m-${p.id}">Máx. profissionais</label><input class="input" id="m-${p.id}" name="max_professionals" type="number" min="1" value="${p.max_professionals ?? ''}" placeholder="Sem limite"></div>
      </div>
      <p class="hint">Recursos: ${(p.features as string[]).map(featureLabel).join(', ')}</p>
      <div class="row-btns"><button class="btn primary sm">Salvar ${p.name}</button></div>
    </form>`)}
    <form method="post" action="/admin/configuracoes" class="block"><h2>Regras de cobrança</h2>
      <div class="grid4">
        <div class="field"><label for="gd">Tolerância após vencer (dias)</label><input class="input" id="gd" name="grace_days" type="number" min="0" max="30" value="${settings.grace_days}"></div>
        <div class="field"><label for="rd">Gerar renovação com antecedência (dias)</label><input class="input" id="rd" name="renew_days_before" type="number" min="0" max="15" value="${settings.renew_days_before}"></div>
      </div>
      <div class="row-btns"><button class="btn sm">Salvar regras</button></div></form>`, f);
}

export function eventsPage(u: User, events: any[], f: any) {
  return layout(u, 'cobrancas', 'Avisos de pagamento', h`
    <p class="lead">Todo aviso recebido do provedor fica registrado. Avisos repetidos são ignorados; avisos fora de ordem não desfazem um pagamento confirmado.</p>
    <form method="post" action="/admin/conciliar" class="row-btns" style="margin-bottom:14px"><button class="btn sm">Conciliar agora com o provedor</button></form>
    ${events.length ? h`<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela"><table class="tbl"><thead><tr><th>Recebido</th><th>Provedor</th><th>Evento</th><th>Cobrança</th><th>Resultado</th></tr></thead><tbody>
      ${events.map((e) => h`<tr><td>${dt(e.received_at)}</td><td>${e.provider}</td><td>${e.type}<small class="muted"> ${e.event_id}</small></td><td><small>${e.provider_payment_id ?? '—'}</small></td><td><span class="res ${String(e.result).startsWith('applied') ? 'good' : String(e.result).startsWith('out_of_order') || e.result === 'unknown_payment' ? 'warn' : ''}">${e.result ?? 'pendente'}</span></td></tr>`)}
    </tbody></table></div>` : h`<p class="empty">Nenhum aviso recebido ainda.</p>`}`, f);
}

export function supportPage(u: User, rows: any[], f: any) {
  const open = rows.filter((r) => !r.handled_at), done = rows.filter((r) => r.handled_at);
  const item = (r: any) => h`<li class="msg ${r.handled_at ? 'done' : ''}"><div class="msg-head"><b>${r.name}</b><span class="muted">${dt(r.created_at)}</span></div>
    <p class="msg-meta"><span class="sel">${r.email}</span>${r.phone ? h` · ${r.phone}` : ''}${r.shop_name ? h` · ${r.shop_name}` : ''}</p><p class="msg-body">${r.message}</p>
    ${r.handled_at ? h`<small class="muted">Respondida em ${dt(r.handled_at)}</small>` : h`<form method="post" action="/admin/suporte/${r.id}/respondida"><button class="btn sm">Marcar como respondida</button></form>`}</li>`;
  return layout(u, 'suporte', 'Mensagens do site', h`
    <p class="lead">Mensagens do formulário de contato. Responda pelo e-mail da pessoa e marque aqui para não perder o controle.</p>
    ${open.length ? h`<ul class="msgs">${open.map(item)}</ul>` : h`<p class="empty">Nenhuma mensagem aguardando resposta.</p>`}
    ${done.length ? h`<h2 class="sub">Respondidas</h2><ul class="msgs">${done.map(item)}</ul>` : ''}`, f);
}

export function auditPage(u: User, rows: any[]) {
  return layout(u, 'auditoria', 'Auditoria', h`
    <p class="lead">Ações administrativas, de assinatura e de acesso. Registros não podem ser editados pelo painel.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Tabela"><table class="tbl"><thead><tr><th>Quando</th><th>Ação</th><th>Barbearia</th><th>Quem</th><th>Detalhes</th></tr></thead><tbody>
    ${rows.map((r) => h`<tr><td>${dt(r.at)}</td><td><code>${r.action}</code></td><td>${r.shop ?? '—'}</td><td>${r.email ?? 'sistema'}</td><td><small class="muted">${JSON.stringify(r.meta).slice(0, 140)}</small></td></tr>`)}
    </tbody></table></div>`);
}
