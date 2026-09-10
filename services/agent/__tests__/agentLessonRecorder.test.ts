import { describe, it, expect } from 'vitest';
import {
  AGENT_LESSON_AUTHOR,
  AGENT_LESSON_PREFIX,
  MAX_AGENT_LESSONS,
  buildAgentLesson,
  mergeAgentLesson,
} from '../agentLessonRecorder';
import type { AgentActionPlan, AgentActionResult, AgentIntent } from '../agentTypes';
import { createMemoryEntry } from '../../memory/memoryEntries';

const intent = (type: AgentIntent['type'], instruction = 'mejora la sección de riesgos'): AgentIntent => ({
  type,
  confidence: 0.9,
  userInstruction: instruction,
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: null,
  extractedRequirements: [],
  requiresConfirmation: false,
  impact: 'medium',
  suggestedTarget: 'new_version',
});

const plan = (type: AgentIntent['type']): AgentActionPlan => ({
  traceId: 'trace-1',
  actionType: type,
  intent: intent(type),
  artifactId: 'art-1',
  currentVersionId: 'art-1',
  title: 't',
  summary: 's',
  rationale: 'r',
  affectedAreas: [],
  risks: [],
  target: 'new_version',
  requiresConfirmation: false,
} as unknown as AgentActionPlan);

const result = (status: AgentActionResult['status'], score?: number): AgentActionResult => ({
  status,
  newArtifactVersionId: null,
  previousArtifactVersionId: 'art-1',
  appliedChanges: [],
  validationResult: typeof score === 'number' ? { passed: true, summary: 'ok', score } : null,
  messages: status === 'failed' ? ['La IA no devolvió contenido.'] : ['ok'],
  errors: [],
  traceId: 'trace-1',
});

describe('agentLessonRecorder', () => {
  describe('buildAgentLesson', () => {
    it('builds a success lesson with score and instruction', () => {
      const lesson = buildAgentLesson(plan('artifact.improve'), result('success', 85), 'BRD Reclamos');
      expect(lesson).toContain(AGENT_LESSON_PREFIX);
      expect(lesson).toContain('mejora');
      expect(lesson).toContain('BRD Reclamos');
      expect(lesson).toContain('85/100');
      expect(lesson).toContain('mejora la sección de riesgos');
    });

    it('builds a failure lesson with the reason', () => {
      const lesson = buildAgentLesson(plan('artifact.regenerate'), result('failed'), 'C4 Contexto');
      expect(lesson).toContain('falló');
      expect(lesson).toContain('La IA no devolvió contenido.');
    });

    it('skips cancelled results and non-recordable intents', () => {
      expect(buildAgentLesson(plan('artifact.improve'), result('cancelled'), 'X')).toBeNull();
      expect(buildAgentLesson(plan('memory.save.project'), result('success'), 'X')).toBeNull();
      expect(buildAgentLesson(plan('artifact.explainOnly'), result('success'), 'X')).toBeNull();
    });
  });

  describe('mergeAgentLesson', () => {
    it('appends the lesson signed by the agent with low priority', () => {
      const merged = mergeAgentLesson({
        existingTexts: ['Nota del usuario'],
        existingEntries: undefined,
        lesson: `${AGENT_LESSON_PREFIX} la mejora sobre "X" funcionó.`,
      });
      expect(merged).not.toBeNull();
      expect(merged!.texts).toHaveLength(2);
      const lessonEntry = merged!.entries[1];
      expect(lessonEntry.authorName).toBe(AGENT_LESSON_AUTHOR);
      expect(lessonEntry.priority).toBe('low');
      expect(lessonEntry.createdAt).toBeTruthy();
    });

    it('returns null for duplicate lessons', () => {
      const lesson = `${AGENT_LESSON_PREFIX} la mejora sobre "X" funcionó.`;
      const merged = mergeAgentLesson({ existingTexts: [lesson], existingEntries: undefined, lesson });
      expect(merged).toBeNull();
    });

    it('caps auto-lessons at MAX_AGENT_LESSONS without touching user notes', () => {
      const userNote = createMemoryEntry('Preferencia del usuario: usar Kafka', { priority: 'high' });
      const oldLessons = Array.from({ length: MAX_AGENT_LESSONS }, (_, i) =>
        createMemoryEntry(`${AGENT_LESSON_PREFIX} lección antigua ${i}.`),
      );
      const entries = [userNote, ...oldLessons];
      const merged = mergeAgentLesson({
        existingTexts: entries.map((e) => e.text),
        existingEntries: entries,
        lesson: `${AGENT_LESSON_PREFIX} lección nueva.`,
      });
      expect(merged).not.toBeNull();
      const lessonTexts = merged!.texts.filter((t) => t.startsWith(AGENT_LESSON_PREFIX));
      expect(lessonTexts).toHaveLength(MAX_AGENT_LESSONS);
      // Oldest lesson pruned, newest appended, user note intact.
      expect(merged!.texts).toContain('Preferencia del usuario: usar Kafka');
      expect(lessonTexts).not.toContain(`${AGENT_LESSON_PREFIX} lección antigua 0.`);
      expect(lessonTexts).toContain(`${AGENT_LESSON_PREFIX} lección nueva.`);
    });
  });
});
