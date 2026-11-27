# Como colocar o Cadeira no ar

O sistema é um único servidor Node. Para ir ao ar você precisa de: uma hospedagem que rode Docker, um **domínio**,
um **banco Postgres gerenciado** (recomendado), um serviço de **e-mail** e, para cobrar, uma conta no **Asaas**.

> Recomendação para começar: **Railway** ou **Render** (pagos por uso, HTTPS automático, sem precisar administrar servidor)
> com o banco no **Neon** ou no **Supabase** (Postgres gerenciado, com cópias de segurança automáticas).
> Os passos abaixo usam o Railway; no Render o caminho é o mesmo (Web Service com Docker).

## Jeito mais rápido e grátis (para testar com um endereço de verdade)
Resultado: o site no ar em `https://cadeira-xxxx.onrender.com`, com HTTPS, sem pagar nada.
O plano grátis do Render "dorme" depois de 15 minutos sem visita: o primeiro acesso depois disso demora uns 50 segundos.

1. **GitHub** (guarda o código): crie uma conta em github.com e um repositório **privado** vazio chamado `cadeira`.
   Envie o código para ele (o assistente pode fazer isso por você depois de instalar o Git neste computador).
2. **Neon** (banco de dados): crie uma conta em neon.tech → *New project* → região *São Paulo* se houver.
   Em *Connection string*, desligue a opção **Connection pooling** e copie o endereço (começa com `postgresql://`).
3. **Render** (roda o site): crie uma conta em render.com entrando com o GitHub → *New* → **Blueprint** → escolha o
   repositório `cadeira`. O arquivo `render.yaml` já configura tudo. O Render vai pedir quatro valores:
   - `DATABASE_URL`: cole o endereço do Neon;
   - `DEMO_PASSWORD`: uma senha forte para a barbearia de demonstração (login `demo@navalha.exemplo`);
   - `SUPPORT_EMAIL`: o e-mail que aparece como contato;
   - `ADMIN_EMAIL`: o seu e-mail.
4. Espere o *deploy* terminar (alguns minutos). Abra o endereço `…onrender.com` que aparece no topo.
5. Crie sua conta pelo site com o mesmo e-mail de `ADMIN_EMAIL`. Depois, no Render, clique em *Manual Deploy → Restart*:
   você passa a ver a administração da plataforma em `/admin`.

**Para pedir a outra IA (ChatGPT, por exemplo) testar:** dê o endereço e só a conta de demonstração, nunca a sua senha.
Exemplo de pedido:
> Teste o sistema de agendamento para barbearias em https://SEU-ENDERECO.onrender.com como um dono de barbearia exigente e como
> um cliente. Entre no painel com demo@navalha.exemplo / SENHA-DA-DEMO. Marque um horário pela página /b/navalha, confirme,
> remarque e cancele pelo link da reserva; use Agenda, Lembretes, Caixa, Financeiro e Primeiros passos; crie também uma conta
> nova em /criar-conta. Para cada problema, diga a página, o que fez, o que esperava e o que aconteceu. Teste no celular também.

**Domínio próprio (depois):** compre o domínio no registro.br (cerca de R$ 40 por ano) e, no Render,
*Settings → Custom Domains* → adicione o domínio e crie no registro.br o registro DNS que o Render mostrar.

## 0. Começar sem CNPJ (fase de lançamento)
Não precisa abrir empresa para pôr no ar e chamar as primeiras barbearias:
1. Suba o sistema (passos 1 a 4) **sem** `BILLING_PROVIDER`. A cobrança online fica desligada.
2. As barbearias se cadastram e usam o teste grátis. Quando o teste acaba, o painel mostra “fale com a gente”
   (WhatsApp de `SUPPORT_WHATSAPP` e o formulário de contato), e não um botão de pagar que não funciona.
3. Para dar mais tempo a uma barbearia: `/admin` → a barbearia → **Estender teste**.
4. Em `COMPANY_NAME` coloque o seu nome; `COMPANY_DOC` aceita CPF ou CNPJ (ou fica vazio enquanto você só testa).
5. Quando alguém quiser pagar: abra a conta no Asaas (que também atende pessoa física; confira as condições lá) e ligue o passo 6.
   Converse com um contador sobre MEI ou outra forma de empresa quando a receita começar. Antes de cobrar,
   preencha nome e CPF ou CNPJ no site: a lei de comércio eletrônico pede que quem vende pela internet se identifique.

## 1. Subir o código
1. Crie uma conta no GitHub e um repositório **privado**. Envie a pasta `cadeira` para ele.
2. No Railway: *New Project → Deploy from GitHub repo* → escolha o repositório. Ele encontra o `Dockerfile` sozinho.

## 2. Banco de dados
**Recomendado: Postgres gerenciado.** Crie um banco no Neon (ou Supabase, Railway Postgres, RDS) e copie a
*connection string* (`postgres://usuario:senha@host/banco`). Coloque em `DATABASE_URL` (passo 3).
Na primeira subida o sistema cria as tabelas, as regras de isolamento entre barbearias (RLS) e o papel `app_tenant`.
O usuário da conexão precisa poder criar papéis e a extensão `btree_gist` (o dono do banco pode, nos serviços citados).

**Alternativa para testar: banco embutido (PGlite).** Sem `DATABASE_URL`, o sistema usa um Postgres em arquivo.
Nesse caso crie em *Settings → Volumes* um volume montado em **`/data`**; sem volume, os dados somem a cada atualização.
O próprio projeto PGlite ainda se declara em fase inicial, então não use o banco embutido para vender.

## 3. Variáveis de ambiente (Railway → Variables)
| Variável | Valor |
|---|---|
| `DATABASE_URL` | connection string do Postgres (passo 2). Use `DATABASE_SSL=0` só se o banco não aceitar SSL |
| `PUBLIC_HOST` | seu domínio, ex.: `cadeira.com.br`. **Obrigatório**: os links de e-mail e de lembrete saem dele |
| `APP_SECRET` | um texto aleatório com 32 caracteres ou mais. Assina os links de reserva dos clientes. Não troque depois (os links já enviados param de funcionar) |
| `RESEND_API_KEY` | chave do Resend (resend.com) para enviar e-mail de recuperação de senha |
| `MAIL_FROM` | remetente verificado no Resend, ex.: `Cadeira <nao-responda@cadeira.com.br>` |
| `PLATFORM_NAME` | o nome definitivo da marca (padrão: Cadeira) |
| `SUPPORT_EMAIL` | e-mail de suporte que aparece no site |
| `SUPPORT_WHATSAPP` | opcional, aparece na página de contato |
| `COMPANY_NAME`, `COMPANY_DOC`, `COMPANY_CITY` | seu nome ou a razão social, CPF ou CNPJ, e cidade (usados nos termos e na privacidade) |
| `DPO_EMAIL` | e-mail do encarregado de dados (LGPD) |
| `LEGAL_REVIEWED` | `1` **depois** que um advogado revisar termos e privacidade (tira o aviso de texto-modelo) |
| `BILLING_PROVIDER` | `asaas` (sem isso, em produção a contratação online fica desligada) |
| `ASAAS_API_KEY` | chave da API do Asaas |
| `ASAAS_WEBHOOK_TOKEN` | um texto secreto de 32 a 255 caracteres, sem espaços, inventado por você (o mesmo vai no Asaas, passo 6) |
| `ASAAS_ENV` | `production` para cobrança real; deixe vazio para usar o sandbox do Asaas |

Já vêm definidas no `Dockerfile`: `NODE_ENV=production`, `DATA_DIR=/data/pg`, `BACKUP_DIR=/data/backups`, `TRUST_PROXY=1`, `DEMO=0`.
Se quiser a barbearia de demonstração no ar (para o link “Ver exemplo” do site), defina `DEMO=1` e `DEMO_PASSWORD` com uma senha forte.
Sem `RESEND_API_KEY` o sistema funciona, mas o “Esqueci minha senha” não manda o e-mail (o log avisa).

## 4. Domínio
1. Railway → *Settings → Networking → Custom Domain* → informe o domínio.
2. No painel onde comprou o domínio (Registro.br, por exemplo), crie o registro **CNAME** que o Railway mostrar.
3. O HTTPS é emitido automaticamente. O sistema manda o cabeçalho HSTS: depois da primeira visita o navegador só usa HTTPS.
Cada barbearia fica em `seudominio.com.br/b/nome-da-barbearia`.

## 5. E-mail (Resend)
1. Crie a conta no Resend e verifique o seu domínio (eles mostram os registros DNS para criar no Registro.br).
2. Gere uma chave de API e preencha `RESEND_API_KEY` e `MAIL_FROM`.
3. Teste: em `/esqueci`, peça o link para o seu e-mail e troque a senha.

## 6. Cobrança (Asaas)
1. Crie a conta no Asaas em nome da sua empresa (o responsável legal precisa fazer isso).
2. Comece no **sandbox** (`ASAAS_ENV` vazio; o sistema usa `api-sandbox.asaas.com`) e faça uma contratação de teste pelo painel de uma barbearia.
3. Em *Integrações → Webhooks*, cadastre a URL `https://seudominio.com.br/webhooks/billing/asaas`, com o token igual a `ASAAS_WEBHOOK_TOKEN`
   e os eventos de cobrança (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`).
4. Confira em `/admin/cobrancas` que os avisos chegam como “applied”. Só depois troque para `ASAAS_ENV=production`.
5. Defina os preços dos planos em `/admin/planos` (planos com preço zero não podem ser contratados).

> O adaptador do Asaas segue a documentação pública e foi testado contra uma imitação da API, mas **ainda não foi executado contra o Asaas de verdade**. Faça o teste do passo 2 antes de vender.

## 7. Virar administrador da plataforma
1. Crie sua conta normalmente pelo site (`/criar-conta`).
2. No Railway, abra o *Shell* do serviço e rode: `node scripts/make-admin.ts seu@email.com`
3. Acesse `/admin`.

## 8. Cópias de segurança
- **Com Postgres gerenciado:** ative os backups do provedor (Neon e Supabase guardam histórico automático; confira por quantos dias no seu plano).
  Faça também um `pg_dump` de tempos em tempos e guarde fora do provedor.
- **Com o banco embutido:** o servidor grava uma cópia completa por dia em `/data/backups` e guarda as 14 mais recentes.
  Copie esses arquivos para fora da hospedagem. Para restaurar (com o servidor parado):
  `node scripts/restore.ts /data/backups/arquivo.tar.gz /data/pg-novo`, depois aponte `DATA_DIR=/data/pg-novo` e suba de novo.

## 9. Antes de anunciar
- [ ] `DATABASE_URL` apontando para Postgres gerenciado, com backups ativos.
- [ ] `PUBLIC_HOST` e `APP_SECRET` definidos.
- [ ] “Esqueci minha senha” testado com e-mail de verdade.
- [ ] Preços definidos em `/admin/planos` (considere taxas do Asaas, hospedagem e suporte).
- [ ] Termos e privacidade revisados por advogado, dados da empresa preenchidos e `LEGAL_REVIEWED=1`.
- [ ] Plano de resposta a incidente combinado: quem avisa a ANPD e os titulares em até 3 dias úteis (Resolução CD/ANPD nº 15/2024).
- [ ] Contratação testada no sandbox do Asaas do começo ao fim.
- [ ] Uma cópia de segurança restaurada com sucesso pelo menos uma vez.
- [ ] `/saude` respondendo `{"ok":true}` (a hospedagem usa isso para saber se o sistema está vivo).
- [ ] Link de uma barbearia colado no WhatsApp mostrando a prévia (nome e descrição).

## Limites desta arquitetura (e quando mudar)
Com Postgres gerenciado dá para rodar mais de uma instância do servidor. Antes disso, um ponto ainda precisa mudar:
o limite de tentativas (login, cadastro, senha) fica na memória de cada instância. Com duas ou mais instâncias,
passe esse controle para o banco ou para um Redis. Com uma instância só, nada muda.
