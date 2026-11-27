import { h, ICON } from './html.ts';
import type { Ctx } from '../domain/accounts.ts';
import { can } from '../domain/accounts.ts';
import { layout } from './panel.ts';
import { paymentsTable, subChip, featureLabel, payChip } from './admin.ts';
import { brl, PLATFORM } from '../lib/core.ts';

/** Recursos que constam no plano mas ainda não existem: aparecem marcados, nunca como se já funcionassem. */
const SOON = new Set(['fidelidade', 'relatorios_avancados', 'multiusuario_avancado']);
const day = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }) : '—';

/** Tela "Assinatura" do dono: plano, situação, cobrança em aberto, troca de plano, cancelamento e histórico. */
export function billingPage(ctx: Ctx, d: { sub: any; plans: any[]; payments: any[]; provider: string | null; returning: boolean }, f: { ok?: string; err?: string }) {
  const base = `/app/s/${ctx.shop.slug}/assinatura`;
  const s = d.sub, st = s.status as string;
  const live = ['active', 'past_due'].includes(st);
  const open = d.payments.find((p) => ['pending', 'overdue', 'failed'].includes(p.status));
  const current = s.price_cents ?? s.plan_price;
  const next = st === 'trialing' ? `Teste grátis até ${day(s.trial_ends_at)}` : live ? (s.cancel_at_period_end ? `Acesso até ${day(s.current_period_end)}` : `Próxima mensalidade em ${day(s.current_period_end)}`) : '';
  const planCard = (p: any) => {
    const mine = p.id === s.plan_id, pending = p.id === s.pending_plan_id, priced = p.price_cents > 0;
    let action;
    if (!priced && !mine) action = '';
    else if (live) {
      if (mine && !s.pending_plan_id) action = h`<span class="plan-tag">Seu plano</span>`;
      else if (mine) action = h`<form method="post" action="${base}/trocar"><input type="hidden" name="plan" value="${p.id}"><button class="btn sm">Manter este plano</button></form>`;
      else if (pending) action = h`<span class="plan-tag">Começa em ${day(s.current_period_end)}</span>`;
      else action = h`<form method="post" action="${base}/trocar"><input type="hidden" name="plan" value="${p.id}"><button class="btn sm">${p.price_cents >= current ? 'Mudar agora' : 'Mudar na renovação'}</button></form>`;
    } else if (!priced || !d.provider) action = ''; // sem cobrança online ligada, não mostra um "Assinar" que não funcionaria
    else action = h`<form method="post" action="${base}/contratar" class="buy">
        <input type="hidden" name="plan" value="${p.id}">
        ${d.provider === 'asaas' ? h`<label class="sr" for="doc-${p.id}">CPF ou CNPJ de quem paga</label><input class="input sm" id="doc-${p.id}" name="document" inputmode="numeric" placeholder="CPF ou CNPJ" required>` : ''}
        <button class="btn ${mine ? 'primary' : ''} sm">${st === 'trialing' ? 'Assinar' : 'Reativar'}${mine && st === 'trialing' ? ' este plano' : ''}</button></form>`;
    return h`<article class="plan ${mine ? 'mine' : ''}">
      <header><h3>${p.name}</h3>${mine && st === 'trialing' ? h`<span class="plan-tag soft">Plano do seu teste</span>` : ''}</header>
      <p class="price">${priced ? h`${brl(p.price_cents)}<small>/mês</small>` : h`<span class="muted">Preço em definição</span>`}</p>
      <ul>${p.max_professionals ? h`<li>Até ${p.max_professionals} profissionais</li>` : h`<li>Profissionais ilimitados</li>`}${(p.features as string[]).map((x) => h`<li>${featureLabel(x)}${SOON.has(x) ? h` <span class="soon">em breve</span>` : ''}</li>`)}</ul>
      <div class="plan-act">${action}</div></article>`;
  };
  return layout(ctx, 'assinatura', 'Assinatura', h`
    ${d.returning && st === 'active' ? h`<div class="flash ok">Pagamento confirmado. Sua assinatura está ativa.</div>` : ''}
    ${d.returning && st !== 'active' ? h`<div class="flash info">Recebemos seu retorno do pagamento. A assinatura é liberada assim que o meio de pagamento confirmar, normalmente em poucos minutos. Atualize esta página para ver.</div>` : ''}
    <section class="sub-card ${ctx.ent?.level ?? 'ok'}">
      <div><span class="k">Plano atual</span><b>${s.plan_name}</b><small>${next}</small></div>
      <div>${subChip(st)}${live && current ? h`<span class="amt">${brl(current)}/mês</span>` : ''}</div>
      ${ctx.ent?.message ? h`<p class="sub-msg">${ctx.ent.message}</p>` : ''}
      ${s.pending_plan_id ? h`<p class="sub-msg">Troca para ${s.pending_plan_name} agendada para ${day(s.current_period_end)}.</p>` : ''}
    </section>
    ${open?.checkout_url ? h`<section class="block pay-open"><div><b>${open.kind === 'first' ? 'Contratação' : 'Mensalidade'} em aberto: ${brl(open.amount_cents)}</b><small>${payChip(open.status)} · vencimento ${day(open.due_at)}</small></div><a class="btn primary" href="${open.checkout_url}">Pagar agora</a></section>` : ''}
    ${!d.provider && !live ? h`<section class="block launch"><b>Estamos em fase de lançamento.</b> A assinatura online ainda não está aberta: por enquanto você usa no período de teste${st === 'trialing' ? ` (até ${day(s.trial_ends_at)})` : ''}. Se precisar de mais tempo, fale com a gente que liberamos.${contactButtons()}</section>` : ''}
    <h2 class="sub">Planos</h2>
    <div class="plans">${d.plans.map(planCard)}</div>
    <p class="hint">Mudar para um plano maior vale na hora e a próxima mensalidade já vem com o novo valor. Mudar para um menor vale a partir da renovação. Sem multa e sem fidelidade.</p>
    <h2 class="sub">Pagamentos</h2>
    ${paymentsTable(d.payments)}
    ${live ? (s.cancel_at_period_end
      ? h`<form method="post" action="${base}/retomar" class="cancel-box"><p>O cancelamento está agendado para ${day(s.current_period_end)}.</p><button class="btn sm">Continuar assinando</button></form>`
      : h`<details class="cancel-box"><summary>Cancelar assinatura</summary><form method="post" action="${base}/cancelar"><p>O acesso continua até ${day(s.current_period_end)}. Depois disso a página de agendamento sai do ar e o painel fica só com a tela de assinatura. Seus dados continuam guardados se quiser voltar.</p><button class="btn danger sm">Confirmar cancelamento</button></form></details>`)
      : st === 'trialing' ? h`<details class="cancel-box"><summary>Encerrar teste</summary><form method="post" action="${base}/cancelar"><p>O acesso termina agora. Você pode voltar assinando um plano.</p><button class="btn danger sm">Encerrar teste</button></form></details>` : ''}`, f);
}

/** Painel bloqueado. Sem cobrança online ligada (fase de lançamento), o caminho é falar com a gente: o admin estende o teste. */
export function blockedPage(ctx: Ctx, billingOn = true) {
  const owner = can(ctx, 'billing.manage');
  return layout(ctx, '', 'Acesso suspenso', h`<section class="block blocked"><p>${billingOn ? ctx.ent?.message : 'O período de teste terminou.'}</p>
    ${!owner ? h`<p class="muted">Fale com o proprietário da barbearia para regularizar.</p>`
      : billingOn ? h`<a class="btn primary" href="/app/s/${ctx.shop.slug}/assinatura">${ICON.card} Ver planos e pagar</a>`
      : h`<p>Quer continuar usando? Fale com a gente que liberamos mais tempo para a sua barbearia.</p>${contactButtons()}`}
    <p class="hint">Seus dados estão guardados. Nada foi apagado.</p></section>`);
}
/** WhatsApp do suporte (quando configurado) e formulário de contato. */
export function contactButtons() {
  const wa = PLATFORM.supportPhone ? PLATFORM.supportPhone.replace(/\D/g, '') : '';
  return h`<div class="row-btns">${wa ? h`<a class="btn primary" href="https://wa.me/${wa.length <= 11 ? '55' + wa : wa}" target="_blank" rel="noopener">${ICON.chat} Falar no WhatsApp</a>` : ''}<a class="btn ${wa ? '' : 'primary'}" href="/contato">Mandar mensagem</a></div>`;
}
