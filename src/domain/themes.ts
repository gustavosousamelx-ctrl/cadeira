/**
 * Temas das páginas públicas. O dono escolhe um preset e uma cor de destaque de uma lista curada:
 * todas as combinações já têm contraste AA garantido (ver test/themes.test.ts), então a personalização
 * não consegue destruir a legibilidade.
 */
export interface Preset {
  label: string; note: string;
  bg: string; surface: string; ink: string; muted: string; line: string;
  display: string; displayWeight: number; displayCase: 'uppercase' | 'none'; body: string; fonts: string;
  accents: Record<string, { label: string; color: string }>;
}
const GF = 'https://fonts.googleapis.com/css2?display=swap&family=';
export const PRESETS = {
  oficio: {
    label: 'Ofício', note: 'Claro, letreiro condensado. Lembra fachada de barbearia de bairro.',
    bg: '#F3F3F0', surface: '#FFFFFF', ink: '#15171B', muted: '#5F646C', line: '#E1E1DB',
    display: '"Big Shoulders Display", "Arial Narrow", sans-serif', displayWeight: 800, displayCase: 'uppercase',
    body: '"Instrument Sans", system-ui, sans-serif', fonts: GF + 'Big+Shoulders+Display:wght@800;900&family=Instrument+Sans:wght@400;500;600;700',
    accents: { vermelho: { label: 'Vermelho poste', color: '#C41E30' }, azul: { label: 'Azul marinho', color: '#1E3257' }, verde: { label: 'Verde', color: '#1B6B47' }, grafite: { label: 'Grafite', color: '#2B2E34' } },
  },
  salao: {
    label: 'Salão', note: 'Serifado e sóbrio, para casas mais clássicas.',
    bg: '#F2F1EE', surface: '#FFFFFF', ink: '#1C1F1E', muted: '#5D625F', line: '#DFDDD7',
    display: '"DM Serif Display", Georgia, serif', displayWeight: 400, displayCase: 'none',
    body: '"Inter", system-ui, sans-serif', fonts: GF + 'DM+Serif+Display&family=Inter:wght@400;500;600;700',
    accents: { garrafa: { label: 'Verde-garrafa', color: '#1F4D3A' }, bordo: { label: 'Bordô', color: '#7A2232' }, azul: { label: 'Azul', color: '#22406B' }, tabaco: { label: 'Tabaco', color: '#6B4423' } },
  },
  noturno: {
    label: 'Noturno', note: 'Escuro, para casas com clima de bar.',
    bg: '#131416', surface: '#1C1E21', ink: '#F1EFEA', muted: '#A4A7AD', line: '#2F3236',
    display: '"Archivo", system-ui, sans-serif', displayWeight: 800, displayCase: 'uppercase',
    body: '"Archivo", system-ui, sans-serif', fonts: GF + 'Archivo:wdth,wght@62..125,400..800',
    accents: { areia: { label: 'Areia', color: '#D9B77E' }, ciano: { label: 'Ciano', color: '#6CC4CB' }, laranja: { label: 'Laranja', color: '#EC8C4F' }, gelo: { label: 'Gelo', color: '#E6E8EA' } },
  },
  limpo: {
    label: 'Limpo', note: 'Branco e direto, sem ornamento.',
    bg: '#FFFFFF', surface: '#F5F6F7', ink: '#111214', muted: '#5E6369', line: '#E4E6E9',
    display: '"Inter Tight", system-ui, sans-serif', displayWeight: 700, displayCase: 'none',
    body: '"Inter", system-ui, sans-serif', fonts: GF + 'Inter+Tight:wght@700&family=Inter:wght@400;500;600;700',
    accents: { preto: { label: 'Preto', color: '#111214' }, azul: { label: 'Azul', color: '#2050C8' }, verde: { label: 'Verde', color: '#137A48' }, vinho: { label: 'Vinho', color: '#8E1F3F' } },
  },
} satisfies Record<string, Preset>;
export type PresetId = keyof typeof PRESETS;

function lum(hex: string) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

export function resolveTheme(theme: any) {
  const id = (theme?.preset in PRESETS ? theme.preset : 'oficio') as PresetId;
  const p: Preset = PRESETS[id];
  const acc = p.accents[theme?.accent] ?? Object.values(p.accents)[0];
  const onAccent = contrast(acc.color, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#111214';
  return { id, preset: p, accent: acc.color, onAccent };
}
/** Variáveis CSS do tema (valores vêm só da lista curada acima, nunca de texto livre). */
export function themeVars(theme: any) {
  const t = resolveTheme(theme), p = t.preset;
  return `--bg:${p.bg};--surface:${p.surface};--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${t.accent};--on-accent:${t.onAccent};--f-display:${p.display};--f-body:${p.body};--display-weight:${p.displayWeight};--display-case:${p.displayCase};color-scheme:${lum(p.bg) < 0.2 ? 'dark' : 'light'}`;
}
