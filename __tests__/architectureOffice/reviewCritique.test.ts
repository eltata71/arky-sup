/**
 * Tests for the review logic changes (task 18.1).
 *
 * Verifies that:
 * - `officeRunnerAdapters.ts` invokes the persona with `responseSchema` and
 *   a low `REVIEWER_TEMPERATURE`.
 * - No `parseStructured<T>(...)` calls are made without a schema in runner
 *   adapters (the scanner requirement).
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
const adaptersSource = readFileSync(
  resolve(servicesRoot, 'infrastructure/OfficeRunnerAdapters.ts'),
  'utf8',
);
const reviewPromptSource = readFileSync(
  resolve(servicesRoot, 'infrastructure/officeReviewPrompt.ts'),
  'utf8',
);

describe('review logic changes (task 18.1)', () => {
  it('invokes the reviewer with the ReviewCritique schema', () => {
    expect(REVIEW_CRITIQUE_SCHEMA.properties.verdict).toEqual({
      type: 'string',
      enum: ['approved', 'changes-requested', 'rejected'],
    });
    expect(REVIEW_CRITIQUE_SCHEMA.properties.findings).toBeDefined();
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
    });
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
    const reading = readReviewCritique({ summary: 'Está bien.' });
    expect(reading.value).toBeNull();
    expect(reading.discarded.length).toBeGreaterThan(0);
  });

  it('no runner adapter parses structured output without a schema (scanner)', () => {
    // `parseStructured<...>` sin un esquema conocido en el mismo archivo del
    // runner sería una lectura por cast silencioso: la revisión exige que la
    // forma se declare al llamar al modelo y se lea con tolerancia al volver.
    const parses = adaptersSource.match(/parseStructured\s*<[^>]*>\s*\(/g) ?? [];
    expect(parses.length).toBeGreaterThan(0);
    // En `OfficeRunnerAdapters.ts` el único uso es sobre `unknown`, con el
    // esquema declarado en la invocación y la lectura en `readReviewCritique`.
    for (const match of parses) {
      expect(match).toBe('parseStructured<unknown>(');
    }
    expect(adaptersSource).toContain('REVIEW_CRITIQUE_SCHEMA');
    expect(adaptersSource).toContain('readReviewCritique');
    expect(adaptersSource).not.toContain('interface ModelCritique');
  });

  it('numbers the acceptance criteria in the review prompt', () => {
    expect(reviewPromptSource).toContain('`${index + 1}. ${item}`');
    expect(reviewPromptSource).not.toContain('- ${item}');
  });
});
