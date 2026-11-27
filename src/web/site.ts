import { h, doc, LOGO, Safe, flash, ICON, ASSET_V } from './html.ts';
import { PLATFORM, brl } from '../lib/core.ts';

/* Site de vendas. Identidade em DESIGN.md: branco, preto quente, vermelho de cadeira de barbeiro;
   Bricolage Grotesque nos títulos e Geist no texto (as mesmas do painel). As imagens são recortes das telas reais
   (scripts/recortes.ts), em tamanho legível, cada uma explicando uma parte da rotina. */
function shell(title: string, main: Safe, o: { desc?: string; user?: boolean; home?: boolean } = {}) {
  return doc({ title, desc: o.desc, css: ['site.css'], scripts: ['forms.js'], bodyClass: 'site', body: h`
  <header class="top"><div class="wrap">
    <a class="brand" href="/" aria-label="${PLATFORM.name}, início">${LOGO}<span>${PLATFORM.name}</span></a>
    <nav aria-label="Principal">
      <a class="hide-sm" href="${o.home ? '' : '/'}#rotina">Como funciona</a><a class="hide-sm" href="/planos">Preços</a><a class="hide-md" href="/exemplo">Barbearia de exemplo</a>
      ${o.user ? h`<a class="btn red sm" href="/app">Meu painel</a>` : h`<a href="/entrar">Entrar</a><a class="btn red sm" href="/criar-conta">Testar grátis</a>`}
    </nav>
  </div></header>
  <div id="conteudo">${main}</div>
  <footer class="foot"><div class="wrap">
    <div class="foot-brand"><a class="brand" href="/">${LOGO}<span>${PLATFORM.name}</span></a><p>Agenda, lembretes, caixa e comissão para barbearias. Feito no Brasil.</p></div>
    <nav aria-label="Rodapé"><a href="/planos">Preços</a><a href="/exemplo">Barbearia de exemplo</a><a href="/contato">Contato e suporte</a><a href="/termos">Termos de uso</a><a href="/privacidade">Privacidade</a><a href="/entrar">Entrar</a></nav>
  </div></footer>` });
}

/* Quem vê o quê: tirado das permissões reais (PERMS em accounts.ts). */
const ROLES_TABLE: [string, string, string, string, string][] = [
  ['Agenda', 'De todos', 'De todos', 'De todos', 'Só a dele'],
  ['Fechar comanda', 'Sim', 'Sim', 'Sim', 'Dos clientes dele'],
  ['Caixa do dia e fechamento', 'Sim', 'Sim', 'Sim', 'Não'],
  ['Clientes e histórico', 'Sim', 'Sim', 'Sim', 'Não'],
  ['Financeiro e comissões', 'De todos', 'De todos', 'Não', 'Só a dele'],
  ['Serviços, preços, horários e equipe', 'Sim', 'Sim', 'Não', 'Não'],
  ['Assinatura e acessos ao painel', 'Sim', 'Não', 'Não', 'Não'],
];

/** Recorte de tela real; no celular pode trocar por outro recorte (mesma tela, versão de celular). */
const shot = (o: { src: string; w: number; h: number; alt: string; mob?: { src: string; w: number; h: number }; eager?: boolean; cls?: string }) => h`<picture class="${o.cls ?? ''}">
  ${o.mob ? h`<source media="(max-width: 700px)" srcset="/static/img/${o.mob.src}?v=${ASSET_V}" width="${o.mob.w}" height="${o.mob.h}">` : ''}
  <img src="/static/img/${o.src}?v=${ASSET_V}" alt="${o.alt}" width="${o.w}" height="${o.h}" ${o.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;

const launchNotice = h`<p class="launch-note">Você já pode testar o Cadeira. A contratação paga abre após a fase de lançamento.</p>`;
export function home(o: { trialDays: number; user: boolean; plans: any[]; billingOpen?: boolean }) {
  const priced = o.plans.some((p) => p.price_cents > 0);
  return shell(`${PLATFORM.name} · agenda, lembretes, caixa e comissão para barbearias`, h`
  <main>
    <section class="hero"><div class="wrap hero-grid">
      <div class="hero-copy">
        <p class="kicker">Sistema para barbearia</p>
        <h1>Pare de marcar horário pelo WhatsApp.</h1>
        <p class="lede">Seu cliente marca e remarca pelo link. Sua equipe envia o lembrete pelo WhatsApp. No balcão, você vê o dia de cada barbeiro, fecha o caixa e já sabe a comissão de cada um.</p>
        ${o.billingOpen === false ? launchNotice : ''}
        <div class="cta"><a class="btn red lg" href="/criar-conta">Criar minha barbearia</a><a class="btn line lg" href="/exemplo">Ver uma barbearia de exemplo</a></div>
        <ul class="promises"><li>${o.trialDays} dias grátis</li><li>Sem cartão para testar</li><li>Sem taxa por agendamento</li></ul>
      </div>
      <div class="hero-demo" aria-label="Exemplo: o cliente escolhe o horário e recebe o lembrete">
        <figure class="phone">${shot({ src: 'demo-cliente-horario.jpg', w: 780, h: 1688, alt: 'Página de agendamento no celular do cliente, com os horários livres de amanhã', eager: true })}</figure>
        <div class="bubble" aria-hidden="true">
          <small>Mensagem pronta no WhatsApp da barbearia</small>
          <p>Olá, Caio! Passando para lembrar do seu horário amanhã às 15:00 na Navalha &amp; Co. com Diego.</p>
          <p>Confirme, remarque ou cancele por aqui: <u>link da reserva</u></p>
        </div>
      </div>
    </div></section>

    <section class="counter" id="rotina"><div class="wrap counter-grid">
      <div class="counter-copy">
        <p class="kicker on-dark">No balcão</p>
        <h2>O dia inteiro da barbearia numa tela só.</h2>
        <ol class="points">
          <li><b>Quem é o próximo</b> e quanto falta. Quando der a hora, um toque marca como atendido e já abre a comanda.</li>
          <li><b>A linha do dia de cada barbeiro</b>, com pausas, folgas e o “agora” marcado. Dá para ver o buraco na agenda antes de ele acontecer.</li>
          <li><b>O próximo horário livre</b> de cada um, para encaixar quem chega sem marcar.</li>
        </ol>
      </div>
      <figure class="screen">${shot({ src: 'demo-hoje.jpg', w: 2096, h: 1252, alt: 'Tela Hoje do painel: próximo cliente às 15:00, resumo do dia e a linha do dia de cada barbeiro', mob: { src: 'demo-hoje-celular.jpg', w: 780, h: 1688 } })}</figure>
    </div></section>

    <section class="loop"><div class="wrap">
      <p class="kicker">Menos falta</p>
      <h2>O lembrete sai do seu WhatsApp e volta respondido.</h2>
      <div class="loop-grid">
        <ol class="steps">
          <li><b>Na véspera</b>, a tela Lembretes lista os horários de amanhã. Um toque abre o WhatsApp da barbearia com a mensagem e o link do cliente.</li>
          <li><b>O cliente abre o link</b> e confirma presença, remarca para um horário livre ou cancela.</li>
          <li><b>No painel</b> aparece quem confirmou. Se ele cancelou, o horário já voltou para a agenda.</li>
        </ol>
        <figure class="screen">${shot({ src: 'demo-lembretes.jpg', w: 1416, h: 768, alt: 'Lista de lembretes de amanhã: horário, cliente, serviço, barbeiro e o botão WhatsApp de cada um', mob: { src: 'demo-lembretes-celular.jpg', w: 780, h: 1688 } })}</figure>
        <figure class="phone sm">${shot({ src: 'demo-cliente-link.jpg', w: 780, h: 1688, alt: 'Tela do cliente com os botões confirmar presença, remarcar e cancelar' })}</figure>
      </div>
      <p class="note">O envio é por um toque, do número da própria barbearia. Não há mensagem automática nem custo por mensagem.</p>
    </div></section>

    <section class="money"><div class="wrap money-grid">
      <div>
        <p class="kicker">Caixa</p>
        <h2>Atendeu, fechou a comanda.</h2>
        <p class="body">Serviço extra, pomada, desconto e pagamento em Pix, dinheiro com troco, débito, crédito ou dividido em dois. No fim do dia, o caixa mostra quanto entrou em cada forma e quanto devia ter na gaveta.</p>
        <figure class="screen pay">${shot({ src: 'demo-comanda.jpg', w: 682, h: 864, alt: 'Comanda de um corte de 45 reais com as formas de pagamento Pix, dinheiro, débito, crédito ou outro' })}</figure>
      </div>
      <div>
        <p class="kicker">Comissão</p>
        <h2>Comissão que o barbeiro entende.</h2>
        <p class="body">Você define a porcentagem de cada um. A cada comanda, o sistema separa o que é dele e o que fica na barbearia, já com o desconto tirado. Produto vendido não entra. Ele vê a dele no celular; você vê a de todos.</p>
        <figure class="screen">${shot({ src: 'demo-comissao.jpg', w: 1148, h: 750, alt: 'Comissões do mês por barbeiro: quanto atendeu, quanto é dele e quanto fica na barbearia, com explicação do cálculo' })}</figure>
      </div>
    </div></section>

    <section class="plain"><div class="wrap">
      <h2>Sem letra miúda.</h2>
      <div class="plain-grid">
        <div><h3>Sem taxa por agendamento</h3><p>Mensalidade fixa. Marcou cem horários no mês? Paga o mesmo.</p></div>
        <div><h3>Cancela no painel</h3><p>Sem fidelidade e sem ligar para ninguém. O acesso vai até o fim do mês pago.</p></div>
        <div><h3>Os clientes são seus</h3><p>Nome, WhatsApp e histórico ficam com a sua barbearia. Exporte ou apague os dados de um cliente quando ele pedir.</p></div>
        <div><h3>O cliente não baixa nada</h3><p>Ele marca pelo link no navegador do celular. Você usa o painel no computador do balcão ou no celular.</p></div>
      </div>
    </div></section>

    <section class="roles"><div class="wrap roles-grid">
      <div>
        <h2>Cada um entra com o próprio acesso.</h2>
        <p class="body">O barbeiro vê a agenda e a comissão dele. A recepção cuida da agenda e do caixa. O dono vê tudo. O sistema confere a permissão em cada tela, não só no menu.</p>
      </div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="O que cada função vê"><table class="rtable">
        <thead><tr><th scope="col"><span class="sr">Recurso</span></th><th scope="col">Dono</th><th scope="col">Gerente</th><th scope="col">Recepção</th><th scope="col">Barbeiro</th></tr></thead>
        <tbody>${ROLES_TABLE.map(([what, ...cells]) => h`<tr><th scope="row">${what}</th>${cells.map((c) => h`<td class="${c === 'Não' ? 'no' : ''}">${c}</td>`)}</tr>`)}</tbody>
      </table></div>
    </div></section>

    <section class="prices" id="precos"><div class="wrap">
      <h2>Preços</h2>
      <p class="body">Mensalidade fixa, sem taxa por agendamento. Todos os planos começam com ${o.trialDays} dias grátis e incluem agenda, página de agendamento, lembretes, caixa e clientes.</p>
      ${!priced ? h`<p class="price-note"><b>Os preços ainda estão sendo definidos.</b><span>Enquanto isso, você testa por ${o.trialDays} dias sem cartão. Nada é cobrado sem você escolher um plano, e o preço aparece aqui antes.</span></p>` : h`<div class="price-grid home-prices">${priceCards(o.plans)}</div>`}
    </div></section>

    <section class="faq-home"><div class="wrap">
      <h2>Perguntas de quem está pensando em testar</h2>
      <div class="faq-list">
        <details><summary>Preciso de cartão para testar?</summary><p>Não. São ${o.trialDays} dias usando com a sua agenda de verdade. Se não servir, é só não assinar.</p></details>
        <details><summary>O cliente precisa baixar aplicativo?</summary><p>Não. Ele marca pelo link da barbearia, no navegador do celular. Coloque o link na bio do Instagram e mande no WhatsApp.</p></details>
        <details><summary>O lembrete sai sozinho?</summary><p>É um toque por cliente: o sistema monta a mensagem com o horário e o link e abre o WhatsApp da barbearia, você só envia. Não tem custo por mensagem.</p></details>
        <details><summary>Funciona com mais de um barbeiro?</summary><p>Sim. Cada um tem a própria coluna na agenda, a própria escala e, se você quiser, o próprio acesso, vendo só a agenda e a comissão dele.</p></details>
        <details><summary>Tem fidelidade ou multa?</summary><p>Não. Se cancelar, o acesso continua até o fim do mês pago e seus dados ficam guardados se quiser voltar.</p></details>
        <details><summary>Os dados dos meus clientes são de quem?</summary><p>Da sua barbearia. Quando um cliente pedir, você exporta ou apaga os dados dele pelo painel, como prevê a LGPD.</p></details>
      </div>
    </div></section>

    <section class="closing"><div class="wrap closing-grid">
      <h2>Monte hoje a agenda de amanhã.</h2>
      <div><p>Crie a conta, confira os serviços e horários que já vêm sugeridos e publique a página quando estiver do seu jeito.</p>
      <a class="btn white lg" href="/criar-conta">Criar minha barbearia</a></div>
    </div></section>
  </main>`, { desc: 'Agenda online, lembretes por WhatsApp, caixa e comissão para barbearias. Sem taxa por agendamento. Teste grátis.', user: o.user, home: true });
}

const FEATURE: Record<string, string> = { agenda: 'Agenda por profissional', pagina_publica: 'Página de agendamento com sua marca', servicos: 'Serviços e preços', equipe: 'Equipe com acessos separados', caixa: 'Caixa, comandas e fechamento do dia', clientes: 'Clientes e histórico', comissoes: 'Comissões calculadas', fidelidade: 'Fidelidade', lembretes: 'Lembretes por WhatsApp, com confirmação e remarcação pelo cliente', relatorios_avancados: 'Relatórios avançados', multiusuario_avancado: 'Permissões avançadas' };
const SOON = new Set(['fidelidade', 'relatorios_avancados', 'multiusuario_avancado']);

/* ---------- contato, termos e privacidade ---------- */
export function contactPage(o: { sent?: boolean; error?: string; v?: Record<string, string>; user: boolean }) {
  const v = o.v ?? {};
  return shell(`Contato · ${PLATFORM.name}`, h`<main class="auth"><div class="contact-grid">
    <section class="contact-copy"><h1>Fale com a gente</h1><p>Dúvidas sobre o sistema, planos ou ajuda para configurar a sua barbearia. Respondemos por e-mail em dias úteis.</p>
      <dl>${PLATFORM.supportEmail ? h`<dt>E-mail</dt><dd class="sel">${PLATFORM.supportEmail}</dd>` : ''}${PLATFORM.supportPhone ? h`<dt>WhatsApp</dt><dd class="sel">${PLATFORM.supportPhone}</dd>` : ''}</dl></section>
    ${o.sent ? h`<div class="auth-card"><h2>Mensagem recebida</h2><p>Obrigado. Vamos responder no e-mail que você informou.</p><a class="btn" href="/">Voltar ao início</a></div>`
      : h`<form method="post" action="/contato" class="auth-card">${flash(undefined, o.error)}
      <div class="field"><label for="cn">Seu nome</label><input class="input" id="cn" name="name" required maxlength="80" value="${v.name ?? ''}"></div>
      <div class="field"><label for="ce">E-mail</label><input class="input" id="ce" name="email" type="email" required maxlength="120" value="${v.email ?? ''}"></div>
      <div class="field"><label for="cw">WhatsApp (opcional)</label><input class="input" id="cw" name="phone" inputmode="tel" value="${v.phone ?? ''}"></div>
      <div class="field"><label for="cb">Barbearia (opcional)</label><input class="input" id="cb" name="shop" maxlength="80" value="${v.shop ?? ''}"></div>
      <div class="field"><label for="cm">Mensagem</label><textarea class="input" id="cm" name="message" rows="5" required maxlength="2000">${v.message ?? ''}</textarea></div>
      <div class="hp" aria-hidden="true"><label for="cs">Não preencha</label><input id="cs" name="site" tabindex="-1" autocomplete="off"></div>
      <button class="btn primary wide">Enviar mensagem</button>
      <p class="hint">Usamos estes dados só para responder você. Veja a <a href="/privacidade">política de privacidade</a>.</p></form>`}
  </div></main>`, { user: o.user, desc: 'Contato e suporte.' });
}

const legalDraft = () => process.env.LEGAL_REVIEWED === '1' ? '' : h`<div class="legal-draft">Versão preliminar para o período de testes.</div>`;
/** Quem oferece o serviço: pode ser pessoa física (nome + CPF) antes de abrir empresa, ou empresa (razão social + CNPJ).
 *  COMPANY_DOC aceita CPF (11 dígitos) ou CNPJ (14); o rótulo certo sai do tamanho. Sem ele, o documento não aparece. */
const CO = () => {
  const d = (process.env.COMPANY_DOC || '').replace(/\D/g, '');
  const doc = d.length === 14 ? `CNPJ ${d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : d.length === 11 ? `CPF ${d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}` : '';
  return { name: process.env.COMPANY_NAME || 'Cadeira (em fase de lançamento)', doc, who: `${process.env.COMPANY_NAME || 'Cadeira (em fase de lançamento)'}${doc ? `, ${doc}` : ''}`, city: process.env.COMPANY_CITY || '' };
};
export function termsPage(user: boolean) {
  const c = CO();
  return shell(`Termos de uso · ${PLATFORM.name}`, h`<main class="wrap legal">${legalDraft()}<h1>Termos de uso</h1><p class="muted">Última atualização: ${new Date().getFullYear()}</p>
    <h2>1. Quem somos e o que oferecemos</h2><p>O ${PLATFORM.name} é um software de agenda, página de agendamento, caixa e gestão para barbearias, oferecido por ${c.who} (“nós”). Estes termos valem para a pessoa ou empresa que cria uma conta para usar o sistema na sua barbearia (“você”).</p>
    <h2>2. Conta e acesso</h2><p>Você é responsável pelas informações do cadastro, pela guarda da sua senha e pelos acessos que der à sua equipe. Avise-nos se suspeitar de uso indevido da sua conta.</p>
    <h2>3. Teste, planos e pagamento</h2><p>Os planos, preços, limites e o período de teste são os mostrados na página de planos no momento da contratação. A mensalidade é cobrada por um intermediador de pagamentos; não guardamos dados de cartão. Mudar para um plano maior vale na hora; para um menor, na renovação. Sem fidelidade.</p>
    <h2>4. Atraso e cancelamento</h2><p>Se a mensalidade não for paga, há um período de tolerância informado no painel. Depois dele, o agendamento online e o painel ficam suspensos até o pagamento; os dados não são apagados. Você pode cancelar quando quiser; o acesso continua até o fim do período pago.</p>
    <h2>5. Dados dos seus clientes</h2><p>Os dados que a sua barbearia registra sobre os clientes dela (nome, WhatsApp, horários, pagamentos) pertencem à sua barbearia, que decide como usá-los (controladora, nos termos da LGPD). Nós tratamos esses dados apenas para prestar o serviço (operadora), conforme a política de privacidade. O sistema oferece exportação e exclusão dos dados de um cliente quando ele pedir.</p>
    <h2>6. Uso adequado</h2><p>Não é permitido usar o sistema para enviar mensagens não solicitadas em massa, cadastrar dados sem base legal, tentar acessar dados de outras barbearias ou prejudicar o funcionamento do serviço.</p>
    <h2>7. Disponibilidade</h2><p>Trabalhamos para manter o sistema no ar e com cópias de segurança diárias, mas podem ocorrer interrupções para manutenção ou por falhas de terceiros. Avisaremos com antecedência sempre que possível.</p>
    <h2>8. Responsabilidade</h2><p>O sistema organiza a agenda e o caixa, mas a prestação do serviço ao cliente final, preços e cobranças da barbearia são responsabilidade da barbearia.</p>
    <h2>9. Alterações</h2><p>Podemos atualizar estes termos. Mudanças relevantes serão avisadas no painel com antecedência.</p>
    <h2>10. Foro</h2><p>${c.city ? 'Fica eleito o foro de ' + c.city + ', salvo regra legal em contrário.' : 'Aplica-se o foro competente conforme a legislação.'}</p>
    <p>Dúvidas: <a href="/contato">Fale com o suporte</a></p></main>`, { user, desc: 'Termos de uso.' });
}
export function privacyPage(user: boolean) {
  const c = CO();
  return shell(`Privacidade · ${PLATFORM.name}`, h`<main class="wrap legal">${legalDraft()}<h1>Política de privacidade</h1><p class="muted">Última atualização: ${new Date().getFullYear()}</p>
    <h2>1. Quem trata os dados</h2><p>${c.who}, responsável pelo ${PLATFORM.name}. Contato do encarregado de dados: ${process.env.DPO_EMAIL || PLATFORM.supportEmail || h`<a href="/contato">Formulário de contato</a>`}.</p>
    <h2>2. Dados dos donos e da equipe das barbearias</h2><p>Coletamos nome, e-mail, senha (guardada de forma irreversível, nunca em texto), dados da barbearia e registros de uso necessários para segurança (como data e ação). Usamos para prestar o serviço, cobrar a assinatura, dar suporte e cumprir obrigações legais. Aqui somos controladores.</p>
    <h2>3. Dados dos clientes das barbearias</h2><p>Quando alguém agenda numa barbearia, registramos nome, WhatsApp, horários e pagamentos em nome daquela barbearia. Ela é a controladora e nós somos operadores: usamos esses dados apenas para o funcionamento do sistema dela. Cada barbearia só acessa os próprios dados.</p>
    <h2>4. Pagamentos</h2><p>A mensalidade é processada por um intermediador de pagamentos, que recebe os dados necessários para a cobrança. Não armazenamos números de cartão.</p>
    <h2>5. Cookies</h2><p>Usamos apenas cookies essenciais: o que mantém você conectado e um aviso temporário de confirmação de ações. Não usamos cookies de publicidade.</p>
    <h2>6. Compartilhamento</h2><p>Compartilhamos dados apenas com quem é necessário para o serviço funcionar (hospedagem e intermediador de pagamentos) ou quando a lei exigir. Não vendemos dados.</p>
    <h2>7. Por quanto tempo guardamos</h2><p>Enquanto a conta estiver ativa e pelo prazo exigido em lei para registros fiscais e de acesso. Depois disso, os dados são apagados ou anonimizados.</p>
    <h2>8. Seus direitos</h2><p>Você pode pedir confirmação, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados. Clientes de uma barbearia devem fazer o pedido à própria barbearia, que tem ferramentas no painel para exportar ou apagar os dados; também podem nos escrever.</p>
    <h2>9. Segurança</h2><p>Senhas protegidas por hash, conexões cifradas, separação dos dados de cada barbearia no banco, registro de ações sensíveis e cópias de segurança.</p>
    <p>Se acontecer um incidente de segurança que possa causar risco ou dano relevante às pessoas, avisamos a Autoridade Nacional de Proteção de Dados (ANPD) e os titulares afetados em até 3 dias úteis, como pede a Resolução CD/ANPD nº 15/2024, e as barbearias afetadas no mesmo prazo.</p>
    <h2>10. Alterações</h2><p>Esta política pode ser atualizada; mudanças relevantes serão avisadas no painel.</p></main>`, { user, desc: 'Política de privacidade.' });
}
/** Cards de plano: os mesmos na página inicial e em /planos. */
function priceCards(plans: any[]) {
  return plans.map((p, i) => h`<article class="price-card ${i === 1 ? 'pick' : ''}">
      <h2>${p.name}</h2>
      <p class="pc-price">${p.price_cents > 0 ? h`${brl(p.price_cents)}<small>/mês</small>` : h`<span class="muted">Preço em definição</span>`}</p>
      <p class="pc-trial">${p.trial_days} dias de teste</p>
      <ul><li>${p.max_professionals ? `Até ${p.max_professionals} profissionais` : 'Profissionais ilimitados'}</li>${(p.features as string[]).map((f) => h`<li>${FEATURE[f] ?? f}${SOON.has(f) ? h` <span class="soon">em breve</span>` : ''}</li>`)}</ul>
      <a class="btn ${i === 1 ? 'primary' : ''} wide" href="/criar-conta?plano=${p.id}">Testar grátis</a></article>`);
}
export function plansPage(plans: any[], user: boolean, billingOpen = true) {
  const priced = plans.some((p) => p.price_cents > 0);
  return shell(`Planos · ${PLATFORM.name}`, h`<main>
    <section class="wrap plans-head"><h1>Planos</h1><p>Mensalidade fixa, sem taxa por agendamento, sem fidelidade. Todos começam com teste grátis.</p>${billingOpen ? '' : launchNotice}</section>
    <section class="wrap price-grid">${priceCards(plans)}</section>
    <section class="wrap faq"><h2>Perguntas frequentes</h2>
      <details><summary>Preciso de cartão para testar?</summary><p>Não. Você cria a conta, configura e testa. A cobrança só começa quando você escolhe assinar.</p></details>
      <details><summary>Como pago?</summary><p>Pela tela Assinatura do painel. O pagamento é processado por um intermediador de pagamentos; nós não guardamos dados de cartão.</p></details>
      <details><summary>Posso trocar de plano?</summary><p>Sim. Para um plano maior vale na hora; para um menor, a partir da próxima mensalidade.</p></details>
      <details><summary>E se eu cancelar?</summary><p>O acesso continua até o fim do período pago. Seus dados ficam guardados caso queira voltar.</p></details>
      <details><summary>O que acontece se a mensalidade atrasar?</summary><p>Você recebe aviso no painel e tem alguns dias de tolerância. Depois disso a página de agendamento sai do ar até o pagamento.</p></details>
    </section>
    ${!priced ? h`<p class="wrap fine">Os valores ainda estão sendo definidos.</p>` : ''}
  </main>`, { user, desc: 'Planos e preços.' });
}

/** Página de pagamento do SIMULADOR: só existe em desenvolvimento, claramente marcada como teste. */
export function sandboxCheckout(ch: any) {
  return doc({ title: 'Pagamento de teste', css: ['site.css'], body: h`<main class="auth"><div class="auth-card sandbox">
    <p class="sandbox-tag">Ambiente de teste · nenhum valor é cobrado</p>
    <h1>${brl(ch.amount_cents)}</h1><p>Assinatura de <b>${ch.name}</b></p>
    ${ch.status !== 'pending' ? h`<p class="muted">Esta cobrança já foi processada (${ch.status}).</p>` : ''}
    <form method="post" action="/sandbox/pagar/${ch.id}/confirmed"><button class="btn primary wide">Simular pagamento aprovado</button></form>
    <form method="post" action="/sandbox/pagar/${ch.id}/failed"><button class="btn wide">Simular pagamento recusado</button></form>
    <p class="hint">Em produção, aqui fica a página do intermediador (Pix, boleto ou cartão). A assinatura só é liberada quando o aviso autenticado do pagamento chega ao servidor.</p>
  </div></main>` });
}

export function loginPage(o: { email?: string; error?: string; ok?: string }) {
  return shell(`Entrar · ${PLATFORM.name}`, h`<main class="auth"><form method="post" action="/entrar" class="auth-card">
    <h1>Entrar</h1>${o.ok ? h`<div class="flash ok" role="status">${o.ok}</div>` : ''}${flash(undefined, o.error)}
    <div class="field"><label for="em">E-mail</label><input class="input" id="em" name="email" type="email" autocomplete="email" required value="${o.email ?? ''}"></div>
    <div class="field"><label for="pw">Senha</label><input class="input" id="pw" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary wide">Entrar</button>
    <p class="alt"><a href="/esqueci">Esqueci minha senha</a></p>
    <p class="alt">Ainda não tem conta? <a href="/criar-conta">Criar minha barbearia</a></p>
  </form></main>`);
}

export function forgotPage(o: { email?: string; error?: string; sent?: boolean }) {
  return shell(`Recuperar senha · ${PLATFORM.name}`, h`<main class="auth">${o.sent
    ? h`<div class="auth-card"><h1>Confira seu e-mail</h1>
        <p>Se existir uma conta com esse e-mail, enviamos um link para criar uma senha nova. Ele vale por 1 hora e funciona uma vez só.</p>
        <p class="hint">Não chegou em alguns minutos? Veja a caixa de spam ou <a href="/esqueci">peça de novo</a>.</p>
        <p class="alt"><a href="/entrar">Voltar para o login</a></p></div>`
    : h`<form method="post" action="/esqueci" class="auth-card">
        <h1>Esqueci minha senha</h1>${flash(undefined, o.error)}
        <p>Informe o e-mail da sua conta. Mandamos um link para você criar uma senha nova.</p>
        <div class="field"><label for="em">E-mail</label><input class="input" id="em" name="email" type="email" autocomplete="email" required value="${o.email ?? ''}"></div>
        <button class="btn primary wide">Enviar link</button>
        <p class="alt"><a href="/entrar">Voltar para o login</a></p>
      </form>`}</main>`);
}

export function resetPage(o: { token: string; valid: boolean; error?: string }) {
  return shell(`Nova senha · ${PLATFORM.name}`, h`<main class="auth">${o.valid
    ? h`<form method="post" action="/redefinir/${o.token}" class="auth-card">
        <h1>Crie uma senha nova</h1>${flash(undefined, o.error)}
        <div class="field"><label for="pw">Senha nova</label><input class="input" id="pw" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="pw-h"><small class="hint" id="pw-h">Pelo menos 8 caracteres. Uma frase curta é mais fácil de lembrar e mais difícil de adivinhar.</small></div>
        <div class="field"><label for="pw2">Repita a senha</label><input class="input" id="pw2" name="confirm" type="password" autocomplete="new-password" minlength="8" required></div>
        <button class="btn primary wide">Salvar senha</button>
        <p class="hint">Ao salvar, você sai de todos os aparelhos e entra de novo com a senha nova.</p>
      </form>`
    : h`<div class="auth-card"><h1>Link vencido</h1>${flash(undefined, o.error)}
        <p>Este link de senha já foi usado ou passou de 1 hora. Peça outro, leva um minuto.</p>
        <a class="btn primary wide" href="/esqueci">Pedir outro link</a></div>`}</main>`);
}

export function signupPage(o: { v?: Record<string, string>; errors?: Record<string, string>; error?: string; host: string; unavailable?: boolean; plan?: { id: string; name: string } }) {
  const v = o.v ?? {}, e = o.errors ?? {};
  const err = (k: string) => e[k] ? h`<small class="ferr" id="${k}-err">${e[k]}</small>` : '';
  const inv = (k: string) => e[k] ? h`aria-invalid="true" aria-describedby="${k}-err"` : '';
  const planId = o.plan?.id ?? v.plano ?? '';
  return shell(`Criar conta · ${PLATFORM.name}`, h`<main class="auth"><form method="post" action="/criar-conta" class="auth-card wide-card" novalidate>
    <h1>Criar minha barbearia</h1>
    ${o.unavailable ? h`<p class="flash err" role="alert">O cadastro está pausado no momento. Novas barbearias estão indisponíveis.</p>` : h`<p class="lead">Leva dois minutos. Serviços e horários já vêm sugeridos para você ajustar.</p>`}
    ${o.plan ? h`<p class="plan-picked">Plano escolhido: <b>${o.plan.name}</b></p>` : ''}
    ${planId ? h`<input type="hidden" name="plano" value="${planId}">` : ''}
    ${flash(undefined, o.error && !Object.keys(e).length ? o.error : undefined)}
    <fieldset><legend>Você</legend>
      <div class="field"><label for="nm">Seu nome</label><input class="input" id="nm" name="name" autocomplete="name" required value="${v.name ?? ''}" ${inv('name')}>${err('name')}</div>
      <div class="field"><label for="em">E-mail</label><input class="input" id="em" name="email" type="email" autocomplete="email" required value="${v.email ?? ''}" ${inv('email')}>${err('email')}</div>
      <div class="field"><label for="pw">Senha</label><input class="input" id="pw" name="password" type="password" autocomplete="new-password" minlength="8" required ${inv('password')}><small class="hint">Pelo menos 8 caracteres.</small>${err('password')}</div>
    </fieldset>
    <fieldset><legend>A barbearia</legend>
      <div class="field"><label for="sn">Nome da barbearia</label><input class="input" id="sn" name="shopName" required value="${v.shopName ?? ''}" ${inv('shopName')}>${err('shopName')}</div>
      <div class="field"><label for="shop-slug">Endereço da sua página</label><div class="slug"><span>${o.host}/b/</span><input class="input" id="shop-slug" name="slug" value="${v.slug ?? ''}" placeholder="sua-barbearia" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" ${inv('slug')}></div><small class="hint">Pode escrever com maiúscula ou colar o site, a gente ajusta. Se deixar em branco, usamos o nome.</small>${err('slug')}</div>
    </fieldset>
    <button class="btn primary wide">Criar barbearia</button>
    <p class="hint terms">Ao criar a conta você concorda com os <a href="/termos" target="_blank">Termos de uso</a> e a <a href="/privacidade" target="_blank">Política de privacidade</a>. Não pedimos cartão para testar.</p>
    <p class="alt">Já tem conta? <a href="/entrar">Entrar</a></p>
  </form></main>`);
}

export function choosePage(shops: { slug: string; name: string; role: string }[]) {
  return shell(`Suas barbearias · ${PLATFORM.name}`, h`<main class="auth"><div class="auth-card"><h1>Suas barbearias</h1>
    ${shops.length ? h`<ul class="choose">${shops.map((s) => h`<li><a href="/app/s/${s.slug}">${s.name}${ICON.right}</a></li>`)}</ul>` : h`<p>Sua conta ainda não está ligada a nenhuma barbearia.</p><a class="btn primary" href="/criar-conta">Criar barbearia</a>`}
    <form method="post" action="/sair"><button class="btn ghost">Sair</button></form></div></main>`, { user: true });
}

export function errorPage(status: number, message: string) {
  return shell(status === 404 ? 'Página não encontrada' : 'Algo deu errado', h`<main class="center-msg"><h1>${status === 404 ? 'Página não encontrada' : status === 403 ? 'Sem permissão' : 'Algo deu errado'}</h1><p>${message}</p><a class="btn" href="/">Voltar ao início</a></main>`);
}
