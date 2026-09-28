/**
 * Los colores de nodos y conexiones vienen de tokens (plan de diagramas, 3.1).
 *
 * Dos garantías: ningún color escrito en línea vuelve a `CustomNode` ni a
 * `CustomEdge` —un cambio de estilo toca `lib/diagramTokens.ts` y no dos
 * componentes—, y los tokens tienen exactamente los valores que había en línea,
 * así que la auditoría no cambió el aspecto de nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDGE_CHROME_TOKENS, NODE_CHROME_TOKENS } from '../../lib/diagramTokens';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
/** Un color escrito a mano: `#abc`, `#aabbcc`, o `rgb(`/`rgba(` con números. Un `rgba(${…})` construido no cuenta. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g;

describe('colores de nodos y conexiones', () => {
  it.each(['components/CustomNode.tsx', 'components/CustomEdge.tsx'])('%s no escribe colores en línea', (file) => {
    const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code.match(COLOR_LITERAL) ?? []).toEqual([]);
  });

  it('los tokens conservan los valores que había en línea: la auditoría no cambió el aspecto', () => {
    expect(NODE_CHROME_TOKENS).toEqual({
      light: {
        stroke: '#64748b', bg: '#f1f5f9', headerBg: '#f8fafc', text: '#0f172a',
        chipBg: 'rgba(15,23,42,0.06)', chipBorder: 'rgba(15,23,42,0.12)',
        highlight: 'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 70%)',
        sheen: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 45%, transparent 65%, rgba(255,255,255,0.06) 100%)',
      },
      dark: {
        stroke: '#94a3b8', bg: '#1e293b', headerBg: '#0f172a', text: '#f1f5f9',
        chipBg: 'rgba(148,163,184,0.18)', chipBorder: 'rgba(148,163,184,0.35)',
        highlight: null,
        sheen: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 45%, transparent 65%, rgba(255,255,255,0.06) 100%)',
      },
    });
    expect(EDGE_CHROME_TOKENS).toEqual({
      light: { labelBg: 'rgba(255,255,255,0.96)', labelText: null, badgeFill: '#ffffff' },
      dark: { labelBg: 'rgba(15,23,42,0.92)', labelText: '#f1f5f9', badgeFill: '#0b0b0f' },
    });
  });
});
