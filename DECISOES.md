# Cadeira: registro de decisões e progresso

Marca provisória **Cadeira** (configurável por `PLATFORM_NAME`). A Navalha & Co. é só o estabelecimento de demonstração (`is_demo`).

## Como rodar
```
npm install
npm test          # 18 testes (node:test)
npm run typecheck
npm start         # http://localhost:3000 — na 1ª vez imprime o login da demo
```
Variáveis: `PORT`, `DATA_DIR` (padrão `data/pg`), `PUBLIC_HOST`, `TRUST_PROXY=1` (atrás de proxy), `NODE_ENV=production` (cookie Secure), `DEMO_PASSWORD`.

## Arquitetura (fase 1)
- **Node 23.6+ com TypeScript nativo** (sem build), **Hono** (HTTP), **Zod** (validação), HTML renderizado no servidor com escape automático (`src/web/html.ts`). Sem framework de front: o fluxo de agendamento funciona sem JavaScript e guarda as escolhas na URL.
- **Postgres via PGlite** (Postgres real embarcado, em arquivo). Mesmo SQL roda num Postgres gerenciado; trocar o adaptador em `src/db/db.ts` por `pg` com pool é a única mudança. Migrações versionadas em `src/db/migrations`.
- **Isolamento multiempresa em três camadas**:
  1. Tenant resolvido no servidor pela sessão + vínculo (`memberships`). O slug da URL só escolhe entre barbearias às quais o usuário pertence.
  2. Transações de tenant rodam com `SET LOCAL ROLE app_tenant` + `app.shop_id`: **RLS** em todas as tabelas de barbearia.
  3. Chaves estrangeiras compostas `(shop_id, id)`: uma reserva não aponta para profissional/cliente de outra barbearia nem por erro de código.
- **Conflito de horário**: restrição de exclusão `bookings_no_overlap` (btree_gist + tstzrange) no banco. A disponibilidade é recalculada dentro da transação da reserva; em "quem estiver livre" tenta cada profissional com savepoint.
- **Permissões** centralizadas em `PERMS` (`src/domain/accounts.ts`), checadas em toda rota e no domínio. Papéis: proprietário, gerente, recepção, barbeiro (só a própria agenda).
- **Assinatura SaaS** (`saas_subscriptions`, barbearia → plataforma) separada de qualquer cobrança de cliente final. Planos em tabela (`plans`), com valores ainda **zerados de propósito** até a definição comercial.
- **Temas das páginas públicas**: 4 presets × 4 cores, todos com contraste testado. O dono escolhe da lista; não há cor livre.
- **Cliente final** consulta/cancela a reserva por **link com token secreto** (hash no banco), não por telefone.
- Segurança: scrypt para senhas, sessão em cookie httpOnly/SameSite=Lax com token em hash, checagem de Origin em POST, CSP sem scripts de terceiros, rate limit (login, cadastro, reserva, cancelamento), honeypot no agendamento, auditoria das ações de gestão.

## Fase 1 — entregue
Cadastro com provisionamento automático · login/sessão · painel (Hoje, Agenda por profissional, detalhe com histórico, novo horário, serviços, equipe/escalas/comissão/acessos, horários e bloqueios, página pública/tema/regras/publicação) · página pública com agendamento em 4 etapas · gestão da reserva pelo cliente · demo.

## Revisão da fase 1 (corrigido, com teste)
- **P1 privacidade**: a confirmação pública mostrava o nome cadastrado do telefone digitado (dava para descobrir nomes de clientes pelo número). Agora a reserva guarda `contact_name` (migração 002) e a página pública só mostra o nome digitado; o painel mostra os dois.
- **P1 agenda**: profissional com escala própria herdava o horário da casa nos dias de folga e podia ser agendado. Escala própria agora vale para a semana inteira.
- **P2**: acesso de equipe vinculava silenciosamente contas já existentes; agora recusa. Cadastros simultâneos davam 500; agora 409. Bloqueio com profissional de outra barbearia dava 500; agora 404. Corpo de requisição limitado a 64 KB. Limite de login por e-mail (ataque distribuído). Limite de acessos na página pública.
- **P2 desempenho**: a página pública fazia ~70 consultas para montar 14 dias; agora 5 (`availabilityRange`).
- **P2 cache**: CSS com versão na URL; depois de uma atualização o navegador não usa estilo antigo.
- **P3/UX**: “Em pausa · volta às 13:00” no almoço; Hoje sem botões desabilitados (mostra “em 1h40”); agenda começa no expediente do dia; Serviços e Equipe viraram listas com resumo (escala resumida como “Qua–Sáb 13:00–20:00”) e edição recolhida; `DEMO=0` desliga a demo.

## Ajustes visuais (pós-revisão)
- Horários da casa e escala de cada profissional: editor com chave liga/desliga por dia, abre/fecha e pausa opcional em campos de hora (antes era texto “09:00-12:00, 13:00-19:00”). O servidor continua aceitando o formato de texto (`d0..d6`).
- Novo horário: horários livres agrupados em manhã/tarde/noite; botões no tamanho certo.
- Detalhe do agendamento: horário em destaque com dia, profissional e situação no topo.
- Página pública no computador: agendamento à esquerda e horários/contato fixos à direita; no celular, abaixo.

## Fase 2 (parte 1) — assinatura SaaS e administração
- **Modelo**: `saas_subscriptions` (estado da assinatura) separado de `saas_payments` (estado de cada cobrança) e de `billing_events` (caixa de entrada dos avisos, chave única = idempotência). Nenhuma dessas tabelas é acessível ao papel do tenant. Clube de cortes (cliente → barbearia) continua fora e terá modelo próprio.
- **Estados**: assinatura `trialing → active ⇄ past_due → expired`, `active → canceled` no fim do período; cobrança `pending → confirmed | overdue | failed | canceled`, `confirmed → refunded`. Transições fora de ordem são ignoradas e registradas.
- **Regras**: upgrade vale na hora (próxima mensalidade já com o novo valor, sem cobrança proporcional); downgrade na renovação e só se o limite de equipe permitir; cancelamento mantém acesso até o fim do período; tolerância e antecedência da renovação configuráveis no admin. Quem assina mantém o preço contratado quando o admin muda o preço do plano.
- **Liberação só por aviso autenticado do provedor** (ou conciliação). Voltar da página de pagamento não libera nada. Bloqueio verificado no servidor: painel fica só com “Assinatura”; página pública e reserva respondem 503.
- **Provedores**: `sandbox` (simulador com HMAC, página de pagamento de teste, padrão fora de produção) e `asaas` (adaptador pronto pela documentação pública; **não testado contra a API real** por falta de conta). Em produção sem provedor configurado a contratação fica desligada com aviso.
- **Rotina** a cada 10 min: fim de teste, renovação (N dias antes), atraso, suspensão, cancelamento no fim do período, downgrade agendado. Conciliação com o provedor a cada hora e por botão no admin.
- **Admin da plataforma** (`/admin`, só `is_platform_admin`; outros recebem 404): MRR contratado, ARR estimado (projeção), recebido no mês, em aberto, testes, conversão, novas assinaturas, cancelamentos — demos excluídas. Barbearias com busca/filtro, detalhe sem dados pessoais de clientes, estender teste (auditado), planos e regras editáveis (auditados), avisos de pagamento, auditoria. Conceder admin: `npm run make-admin email` com o servidor parado.
- Configuração: `BILLING_PROVIDER=sandbox|asaas`, `BILLING_WEBHOOK_SECRET` (sandbox), `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENV=production` (padrão sandbox). Webhook: `POST /webhooks/billing/asaas`.

## Revisão do painel (varredura + acabamento)
- `test/varredura.test.ts`: abre todas as telas (dono, barbeiro, admin, site, página pública), segue todo link interno e envia todo formulário como o navegador enviaria. Achou e corrigiu: “Novo horário” dava erro 500 com serviço inválido no endereço; link “Ver exemplo” dava 404 sem a barbearia demo (agora `/exemplo`).
- Hoje: “Expediente encerrado” depois do fechamento, horários atrasados com “Atendido” e “Não veio” direto na lista, texto do aviso corrigido.
- Agenda: faixa da semana com número de horários por dia, navegação por semana, data muda ao escolher.
- Detalhe: duas colunas (serviços + histórico em linha do tempo | ações + cliente com nº de visitas e última visita); atendido/falta só aparecem quando valem; cancelamento com confirmação e motivo.
- Novo horário: etapas numeradas, busca de cliente já cadastrado (preenche nome e WhatsApp), resumo antes de marcar.
- `panel.js` (opcional, tudo funciona sem ele): data sem botão “Ir”, preenchimento do cliente, bloqueio de clique duplo em envios, tela Hoje se atualiza a cada 2 min.

## Fase 3 — caixa, clientes, onboarding, site e operação
- **Caixa** (`sales`, `sale_items`, `sale_payments`, `cash_closings`, migração 004; dinheiro do cliente → barbearia, separado da assinatura SaaS). Comanda por atendimento ou venda avulsa; serviço extra, produtos, desconto rateado entre itens, pagamento em até duas formas (soma tem de bater com o total). Comissão = % do profissional sobre o serviço já descontado, **congelada na venda**; produtos não comissionam. Uma comanda paga por atendimento (índice único). Estorno só por dono/gerente e só antes do fechamento do dia. Fechamento registra dinheiro esperado × contado.
- “Atendido” leva direto à comanda (dá para voltar sem receber; o atendimento fica na lista “sem pagamento registrado” do caixa).
- **Financeiro** do mês só com comandas pagas: faturamento, ticket médio, faltas, gráfico por dia, formas de pagamento, mais vendidos e comissões por profissional. Comissões dependem do recurso `comissoes` do plano (checado no servidor). Barbeiro vê só “Minhas comissões”.
- **Clientes**: visitas, última visita, próximo horário, quanto pagou, faltas, filtros (com horário, sumidos há 45+ dias, sem visita), ficha com histórico, frequência média, anotações. **LGPD**: exportar dados (JSON) e anonimizar (só proprietário; bloqueado se houver horário futuro; histórico financeiro mantido sem dados pessoais).
- **Primeiros passos** (`/comecar`): horários → serviços → equipe → aparência → publicar, salvando a cada etapa (`_next` validado: só caminhos do próprio painel). Cadastro novo cai aqui.
- **Site**: telas reais (geradas com `npm run telas` + Edge headless), página de contato com mensagens no admin (`/admin/suporte`), termos e privacidade (texto-modelo com aviso até `LEGAL_REVIEWED=1`).
- **Operação**: `Dockerfile`, `/saude`, backup diário em `BACKUP_DIR` (14 cópias), `scripts/restore.ts`. Guia em `COLOCAR-NO-AR.md`.

## Rodada de pesquisa e melhorias (migrações 005 e 006)
- **Asaas** corrigido pela documentação atual: sandbox em `api-sandbox.asaas.com/v3`; cliente procurado por `externalReference` antes de criar (sem duplicar); CPF/CNPJ obrigatório; valor em reais; token do webhook com 32–255 caracteres e sem espaços; eventos `PAYMENT_*` mapeados; campos desconhecidos tolerados. Testado contra uma imitação da API (`test/asaas.test.ts`), não contra o Asaas real.
- **Postgres de verdade**: `DATABASE_URL` liga o adaptador `openPgDb` (driver `pg`, pool de conexões, mesmas transações e RLS). Migrações com trava (`pg_advisory_lock`), para duas instâncias não aplicarem a mesma ao mesmo tempo. Migração 005 dá ao usuário da conexão o papel `app_tenant` (no gerenciado ele não é superusuário). O teste `test/postgres.test.ts` roda cadastro, isolamento, conflito de horário e aviso de pagamento pelo protocolo do Postgres (PGlite servindo por socket). O banco embutido continua para desenvolvimento e testes: o próprio PGlite ainda se declara em fase inicial.
- **Menos faltas** (lembrete antes do horário e facilidade para remarcar aparecem com frequência nos estudos sobre faltas em atendimento com hora marcada):
  - tela **Lembretes** (padrão: amanhã) com botão que abre o WhatsApp da barbearia já com a mensagem e o link do cliente, e registra o envio (`reminded_at`). Sem API paga do WhatsApp: quem envia é a barbearia, pelo próprio número.
  - o link de cada reserva é `HMAC(segredo, id)`: a barbearia pode reenviar o link sem o banco guardar o link em texto, e horários marcados no balcão também ganham link. Segredo em `APP_SECRET` ou, sem ela, gerado na migração 006. Horários futuros sem link ganham o derivado na subida do servidor; links aleatórios já entregues continuam valendo.
  - o cliente **confirma presença** (`client_confirmed_at`, aparece no painel com ✓) e **remarca sozinho**: mesmo profissional, mesma duração e preço combinados, só horários livres, dentro do prazo de cancelamento da casa. A troca é revalidada na transação e o banco barra sobreposição. Remarcar zera confirmação e lembrete. Tudo fica no histórico do horário.
  - CSP: `form-action` passou a aceitar `wa.me` e `api.whatsapp.com` (o botão de lembrete é um formulário que registra o envio e redireciona).
- **Esqueci minha senha** (guia de recuperação de senha da OWASP): token aleatório de 256 bits, só o hash no banco, vale 1 hora e uma vez; resposta e tempo iguais exista ou não a conta (e-mail enviado sem bloquear a resposta); limite por IP e por e-mail (o excesso por e-mail fica silencioso); senha repetida duas vezes; ao trocar, todas as sessões caem e chega um e-mail avisando. O link sai de `PUBLIC_HOST`; em produção sem ele, nada é enviado (nunca do cabeçalho Host, que o atacante controla). E-mail pelo Resend (`RESEND_API_KEY`, `MAIL_FROM`); sem chave, mostra no console só em desenvolvimento. Sessões vencidas e links antigos são apagados na rotina de 10 minutos.
- **Página pública**: Open Graph (prévia ao colar o link no WhatsApp/Instagram), endereço canônico e dados estruturados schema.org `HairSalon` com horários e telefone (o `<` é escapado no JSON). Link de reserva e página de demonstração com `noindex`; `robots.txt` tira painel, admin e links secretos da busca.
- **Painel instalável** no celular: `manifest.webmanifest` com ícones 192/512 e versão “maskable”, `theme-color`, ícone para iPhone. Sem service worker: agenda precisa estar em tempo real, então não há modo offline.
- **Cabeçalhos**: `Permissions-Policy` (câmera, microfone, localização, pagamento desligados), `Cross-Origin-Opener-Policy: same-origin`, HSTS de 1 ano em produção. Respostas comprimidas (`hono/compress`).
- **Privacidade**: compromisso de avisar ANPD e titulares em até 3 dias úteis em incidente relevante (Resolução CD/ANPD nº 15/2024). Isso é um compromisso de processo, não declaração de conformidade.

## Revisão como cliente exigente + site novo (migração 007)
- **Erros achados usando no celular**: o editor de horários (primeiros passos, Horários, Equipe) ficava espremido em 7 colunas porque a faixa da semana da agenda usava o mesmo nome de estilo (`.week`); agora a faixa é `nav.week`. Na etapa de serviços dos primeiros passos, quem mudava preço e clicava em "Continuar" sem "Salvar" em cada linha perdia a mudança; agora é um formulário só, salvo ao continuar, tudo ou nada. Em páginas curtas a barra do topo do celular esticava.
- **Faltava**: a equipe mudar o horário de um cliente (antes só cancelando e marcando de novo). Agora "Mudar horário" no detalhe: mesmo preço e duração, só horários livres, troca de barbeiro para quem vê a agenda de todos, registrado no histórico. O cadastro não dizia que a pessoa aceita os termos; o campo de endereço dizia "pode deixar em branco" mas era obrigatório; o WhatsApp pedia o número com 55.
- **Comissão** explicada nas telas com exemplo em reais (Financeiro, Equipe, Minhas comissões, primeiros passos). "Comissões a pagar" virou "Comissões do mês" (o sistema não controla o pagamento ao barbeiro). A % mostrada no financeiro é a efetiva do mês (a comissão fica congelada em cada comanda).
- **Sem CNPJ**: termos e privacidade aceitam pessoa física (CPF) ou empresa (CNPJ). Sem cobrança ligada, fim do teste leva a "fale com a gente" e o admin estende o teste.
- **Lembretes em todos os planos** (migração 007): a tela já não era restrita por plano; a lista de recursos agora diz a verdade.
- **Site novo** seguindo `DESIGN.md`: fundo de papel, títulos em Archivo condensada (letreiro), o azul do painel nos botões e um vermelho de poste como acento. Estrutura: abertura com telas reais, "um dia na barbearia" (09:00 → 20:10), comissão com exemplo de comanda, tabela de quem vê o quê (tirada das permissões reais), planos do banco, perguntas e fechamento. Sem depoimento, número ou logo inventados.

## Revisão crítica completa + identidade nova (migração 008)
- **Medição antes de mexer**: `scripts/auditoria.ts` (Playwright com o Edge instalado + axe) abre 38 telas em celular, tablet e computador e mede acessibilidade, erros, rolagem lateral, tempo e peso. Começo: cerca de 70 ocorrências sérias (contraste das cores dos barbeiros verde e laranja em 3,6:1, link do topo sem nome no celular, monograma da página pública, tabela sem foco). Fim: nenhuma.
- **Toque duplo em "Confirmar horário"** mostrava "horário ocupado" ao cliente que acabara de marcar. Agora o servidor reconhece o mesmo WhatsApp no mesmo horário (15 min) e leva à reserva feita, e `forms.js` ignora o segundo envio no site e na página da barbearia.
- **Aviso por e-mail ao dono e gerentes** quando o cliente marca, remarca ou cancela pela página (pode desligar em Página pública). Antes o dono só sabia olhando o painel.
- **Formulário do cliente** diz o que é feito com o nome e o WhatsApp.
- **Lembretes no celular**: os nomes dos clientes eram cortados; a situação passou para baixo do nome.
- **Identidade** (ver DESIGN.md): três direções testadas com telas reais; escolhida a "vermelho de cadeira". Marca nova (cadeira de blocos de agenda), painel com preto quente e marcador vermelho, títulos em Bricolage. Site recomposto em torno da rotina do dono, com recortes legíveis das telas reais e troca por versões de celular em telas pequenas. Seção de preços honesta enquanto não há preço (em vez de três "Preço a definir").
- **Peso**: recortes em JPEG 80% no tamanho exibido; CSS e JS com versão ficam em cache por um ano.

## Pendências reais (próximas fases)
- **Preços dos planos**: decisão comercial do dono. Referência pública vista em nov/2026: BarberOS cobra R$ 47,90 / 97,90 / 197,90 por mês **mais** R$ 4 / 3 / 2 por agendamento.
- **Quem está por trás**: uma seção "quem faz" (nome, cidade, foto real, contato) aumentaria a confiança; depende de informação e foto reais do dono.
- **Logo e fotos dos barbeiros** na página pública (envio de imagem): melhora a identidade de cada barbearia; exige guardar arquivos.
- **Clube de assinatura da barbearia** (o cliente paga mensal e corta sem pagar na hora): pedido comum no mercado e diferente da mensalidade do Cadeira; precisa de um desenho próprio de cobrança antes de existir.
- **Fase 4**: fidelidade, clube de cortes (fluxo financeiro próprio, separado da assinatura SaaS), estoque/loja. Lembrete **automático** por WhatsApp exige a API oficial (custo por mensagem); hoje o envio é de um toque pela barbearia.
- Infra: limite de tentativas em memória serve para uma instância; com várias, mover para o banco ou Redis. Upload de logo/fotos exige armazenamento de arquivos (ainda não há). Verificação do cliente por código (OTP) para ver o histórico de reservas.
- Asaas: rodar a contratação no sandbox real antes de vender.
- LGPD: política de retenção (por quanto tempo guardar clientes sem visita) e textos legais revisados por advogado.
