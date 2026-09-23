/**
 * The LMS is out of the monolith, and stays out.
 *
 * The first vertical of the strangler migration. It was chosen because it was
 * measurably self-contained rather than because it looked tidy: ten public
 * methods with **zero** callers inside `geminiService`, and three engine
 * dependencies that each already had a neutral equivalent. That made the
 * extraction exact instead of negotiated.
 *
 * The value of a strangler is only realised if the monolith actually shrinks
 * and stays shrunk — a migration where the old code lingers "just in case" has
 * moved nothing. So the shape is asserted mechanically.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The file with comments stripped.
 *
 * The rule is about code. `courseAuthoring.ts` documents where it was
 * extracted from, and a guard that reads that as a dependency would punish the
 * comment that explains the migration.
 */
const readCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MOVED_METHODS = [
  'generateCourseSyllabus',
  'generateDynamicTopics',
  'generateRoleCatalog',
  'generateRoleDiagnostic',
  'generateLessonTabContent',
  'generateMasterclassContent',
  'generateCategoryMasterclass',
  'chatWithLesson',
  'generateDiagramChallenge',
  'evaluateDiagramChallenge',
  // F5-01, corte 2: the last LMS method the façade still took from the engine.
  'evaluateChallenge',
];

const monolith = () => readFileSync('services/geminiService.ts', 'utf8');
const facade = () => readFileSync('services/ai/generation/learningService.ts', 'utf8');

describe('the capability left the monolith', () => {
  it('defines none of the LMS methods any more', () => {
    const source = monolith();
    const remaining = MOVED_METHODS.filter((name) => source.includes(`public async ${name}`));
    expect(remaining, 'These belong in services/ai/generation/learning/').toEqual([]);
  });

  it('does not import the LMS types it no longer uses', () => {
    // A leftover import is the usual sign that a piece of the capability was
    // kept behind — cheap to check, and it fails loudly if one creeps back.
    expect(monolith()).not.toContain("from '../types/lms'");
  });

  it('is meaningfully smaller for it', () => {
    // Not a line-count fetish: the point is that the file cannot quietly
    // reabsorb the capability while this number holds.
    expect(monolith().split('\n').length).toBeLessThan(6400);
  });
});

describe('the façade did not change shape', () => {
  it('still exposes every method callers used', () => {
    const source = facade();
    for (const name of MOVED_METHODS) {
      expect(source, `${name} disappeared from the façade`).toContain(`get ${name}()`);
    }
  });

  it('serves them from the extracted modules, not the engine', () => {
    const source = facade();
    expect(readCode('services/ai/generation/learningService.ts')).not.toContain('geminiService');
    for (const name of MOVED_METHODS) {
      expect(source).toContain(`return learning.${name};`);
    }
  });
});

describe('the extracted modules stay independent of the engine', () => {
  const modules = [
    'services/ai/generation/learning/courseAuthoring.ts',
    'services/ai/generation/learning/lessonDelivery.ts',
    'services/ai/generation/learning/diagramChallenge.ts',
    'services/ai/generation/learning/challengeEvaluation.ts',
  ];

  it('never import the legacy monolith', () => {
    // The whole point: they reach the model through `aiGateway`, which is the
    // supported surface for a layer that composes its own prompts.
    for (const file of modules) {
      expect(readCode(file), file).not.toContain('geminiService');
    }
  });

  it('never import a provider SDK directly', () => {
    for (const file of modules) {
      expect(readCode(file), file).not.toContain('@google/genai');
    }
  });

  it('stay under the size the plan set for a domain module', () => {
    for (const file of modules) {
      expect(readFileSync(file, 'utf8').split('\n').length, file).toBeLessThan(500);
    }
  });
});
