// @vitest-environment jsdom
/**
 * El C4 que escribe `irToMermaidC4` lo acepta Mermaid, no sólo nuestro parser
 * (plan de diagramas, 6.1). `mermaidToIR` es tolerante a propósito; la vista
 * de código y la exportación dibujan con Mermaid, que no lo es. Un C4 que
 * sólo entiende el parser propio se vería bien en el lienzo y roto en todo lo
 * demás. Se comprueba con cada C4 del banco de evaluación.
 */
import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import type { DiagramIR } from '../../lib/diagram';
import { c4LevelOfArtifactType, irToMermaidC4 } from '../../services/diagram/irToMermaidC4';
import { loadCorpus } from './evals/diagramEvalHarness';

// Only cases where the model answered an IR: a declined request has none.
const c4Cases = loadCorpus().filter((c) => c.plantilla.tipo.startsWith('mermaid-c4-')
    && typeof c.respuestaModelo === 'object' && 'nodes' in c.respuestaModelo);

describe('Mermaid acepta el C4 serializado', () => {
    it.each(c4Cases.map((c) => [c.id, c] as const))('%s', async (_id, testCase) => {
        const text = irToMermaidC4(testCase.respuestaModelo as DiagramIR, c4LevelOfArtifactType(testCase.plantilla.tipo)!);
        mermaid.initialize({ startOnLoad: false });
        await expect(mermaid.parse(text)).resolves.toBeTruthy();
    });
});
