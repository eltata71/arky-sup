/**
 * Tests for the review logic changes (task 18.1).
 *
 * Verifies that:
 * - `officeRunnerAdapters.ts` invokes the persona with `responseSchema` and
 *   a low `REVIEWER_TEMPERATURE`.
 * - The anti-cast scanner lives in `runnerAdapterReads.test.ts` (AST, #264 M3).
 * - `officeReviewPrompt.ts` passes acceptance criteria as a numbered list.
 * - The `ReviewCritique` contract is correctly read and validated.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REVIEW_CRITIQUE_SCHEMA } from '../../services/architectureOffice/application/orchestrationSchemas';
import { REVIEWER_TEMPERATURE } from '../../services/architectureOffice/domain/agentDefinition';
import { readReviewCritique } from '../../services/architectureOffice/domain/reviewCritique';

const servicesRoot = resolve(__dirname, '../../services/architectureOffice');
const reviewPromptSource = readFileSync(
  resolve(servicesRoot, 'infrastructure/officeReviewPrompt.ts'),
  'utf8',
);

describe('review logic changes (task 18.1)', () => {
  it('invokes the reviewer with the ReviewCritique schema', () => {
    expect(REVIEW_CRITIQUE_SCHEMA.properties?.verdict).toEqual({
      type: 'string',
      enum: ['approved', 'changes-requested', 'rejected'],
    });
    expect(REVIEW_CRITIQUE_SCHEMA.properties?.findings).toBeDefined();
  });

  it('uses the declared reviewer temperature in the contract', () => {
    expect(REVIEWER_TEMPERATURE).toBeLessThanOrEqual(0.3);
    expect(REVIEWER_TEMPERATURE).toBeGreaterThan(0);
  });

  it('reads the review critique through the tolerant contract reader, not a cast', () => {
    const reading = readReviewCritique({
      verdict: 'CHANGES-REQUESTED',
      summary: '  Necesita ajustes en la sección de riesgos.  ',
      findings: [
        {
          severity: 'high',
          message: 'El diagrama no cubre el flujo de error.',
          criterion: 2,
          evidence: 'linea 14 del diagrama',
        },
        {
          severity: 'catastrophe', // fuera del vocabulario: se descarta
          message: 'El diagrama está incompleto.',
        },
      ],
    }, { acceptanceCriteria: ['Incluye decisiones.', 'Cubre el flujo de error.'] });
    expect(reading.value).not.toBeNull();
    expect(reading.value!.verdict).toBe('changes-requested');
    expect(reading.value!.summary).toBe('Necesita ajustes en la sección de riesgos.');
    expect(reading.value!.findings).toHaveLength(1);
    expect(reading.value!.findings[0].criterion).toBe(2);
    expect(reading.discarded).toEqual([
      '«findings»: severidad fuera del vocabulario en «El diagrama está incompleto.»; el hallazgo se descarta.',
    ]);
  });

  it('drops a critique without a readable verdict (evidence-only path)', () => {
    const reading = readReviewCritique({ summary: 'Está bien.' }, { acceptanceCriteria: [] });
    expect(reading.value).toBeNull();
    expect(reading.discarded.length).toBeGreaterThan(0);
  });

  // El escáner anti-cast (antes una regex sobre un único archivo, evadible con
  // `as`, aserciones de ángulo, alias o `JSON.parse`) vive ahora en
  // `runnerAdapterReads.test.ts`: AST sobre todos los adaptadores del runner,
  // cada lectura atada a su validador y un mutante por regla (#264 M3).

  it('numbers the acceptance criteria in the review prompt', () => {
    expect(reviewPromptSource).toContain('`${index + 1}. ${item}`');
    expect(reviewPromptSource).not.toContain('- ${item}');
  });
});
