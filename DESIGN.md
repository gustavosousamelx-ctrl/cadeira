# DESIGN.md · identidade do Cadeira

Direção escolhida: **"vermelho de cadeira"**. A cadeira de barbeiro clássica (couro vermelho, estrutura escura)
e o poste de barbearia dão a cor; a agenda dá a forma. Empresa brasileira de software, não marca de cosmético:
branco de verdade, preto quente, um vermelho só, letra pesada e telas reais do sistema em tamanho legível.

Como foi escolhida (nov/2026): três direções montadas com as mesmas telas reais e comparadas em computador e celular.
- *Anil com coral, centralizada*: limpa, mas com cara de modelo de SaaS.
- *Verde com limão*: cara de fintech e parecida com o verde-limão do Booksy.
- *Vermelho de cadeira*: a única ligada ao ofício e difícil de confundir. Escolhida.
Referências de mercado vistas: BarberOS (escuro com dourado, números e depoimentos que não dá para conferir,
taxa por agendamento), Luka's/BarberOS+ (página do cliente que demora a carregar), Trinks, AppBarber e Booksy.

## Marca
- Símbolo: uma cadeira feita de **blocos de agenda**. Encosto e pé na cor do texto, **assento vermelho** (o horário marcado).
  `MARK` em `src/web/html.ts`; ícone do app com fundo `#17130F`.
- Nome em minúsculas, Bricolage Grotesque 800, espaçamento apertado (-0,045em).

## Cor
| Token | Valor | Papel |
|---|---|---|
| `--ink` | `#1A1714` | texto e títulos |
| `--ink2` | `#3F3A35` | texto de apoio |
| `--muted` | `#625C56` | legendas (6,0:1 no fundo claro) |
| `--brand` | `#17130F` | botão principal **do painel** (preto quente, como no painel da Shopify; vermelho não compete com "cancelar") |
| `--red` | `#D6281F` | marca e botão principal **do site** (branco sobre ele: 5,0:1) |
| `--red-on-dark` | `#FF6A5E` | vermelho sobre fundo escuro (6,6:1) |
| `--night` | `#17130F` | faixas escuras, lateral do painel, rodapé |
| `--canvas` / `--bg2` | `#F5F5F3` | fundo do painel e faixas claras alternadas (cinza neutro, não bege) |
| `--paper` / `--bg` | `#FFFFFF` | cartões e fundo do site |
| `--line` / `--line2` | `#E4E2DE` / `#CDC9C3` | bordas |
| `--info` | `#2453B8` | estado "confirmado" e avisos informativos |
| `--ok` `--warn` `--danger` | `#137148` `#985A06` `#B42318` | sucesso, atenção, erro |

Cores de cada barbeiro (painel): 8 tons com 4,5:1 ou mais sobre o fundo claro e com texto branco.
Sem gradiente, sem vidro, sem dourado. Sombra só nos celulares e no balão do WhatsApp.

## Tipografia
- **Bricolage Grotesque** (títulos, números grandes, nome da marca): 800, espaçamento -0,035 a -0,045em, entrelinha 0,95–1,05.
- **Geist** (texto e interface): 400/500/600. Site 17px, painel 15px.
- Site: título principal 46–88px; títulos de seção 34–54px. Painel: título da página 30px.

## Espaço e forma
- Base 4px. Seções do site com 104px (64px no celular). Conteúdo até 1200px.
- Raio: 8px (botões, campos), 12–14px (molduras e cartões), 30–40px (celulares).
- Profundidade por contraste de faixas (branco → cinza claro → preto quente → vermelho no fechamento).

## Componentes
- Site: botão vermelho (ação principal), contorno preto (secundária), branco (sobre o vermelho). Altura 54px nos principais.
- Painel: botão principal preto, secundário branco com borda; marcador vermelho no item ativo do menu.
- Listas numeradas com círculo vermelho para explicar uma rotina em passos.
- "Sobretítulo" com uma barra vermelha curta antes do texto.

## Imagens
- Só **recortes de telas reais** (`scripts/recortes.ts`), cada um explicando uma parte da rotina, em tamanho legível.
  No celular, cada tela do computador é trocada pela versão de celular da mesma tela (`<picture>`).
- Sem foto de banco de imagem, sem ilustração genérica, sem depoimento, número ou logo inventado.
- Recortes em JPEG 80%, no máximo 1440px (computador) e 660px (celular).
