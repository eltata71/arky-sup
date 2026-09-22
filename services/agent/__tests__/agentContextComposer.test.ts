import { describe, it, expect } from 'vitest';
import {
  buildAgentSystemInstruction,
  buildProjectArtifactsInventory,
  compactBullet,
  DEFAULT_AGENT_MEMORY,
  DEFAULT_CONTEXT_BUDGET,
  getAgentBaseMemory,
  prepareChatHistoryForModel,
  selectRelevantMemory,
  selectRelevantMemoryEntries,
  stemMatchToken,
} from '../agentContextComposer';
import type { MemoryEntry, Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';

const SETTINGS: Settings = {
  language: 'es',
  theme: 'dark',
  globalContext: [
    'Siempre usamos AWS para infraestructura.',
    'Preferimos tecnologías serverless cuando sea posible.',
    'Nuestro estándar de integración es API-led con MuleSoft.',
  ],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.5,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'global',
    includeChatHistoryByDefault: false,
  },
  agentMemory: [
    'Soy el Arquitecto Agente, soporte para una compañía multinacional de seguros.',
    'Diferencio entre asesoría y acción ejecutable dentro de la app.',
  ],
};

const PROJECT: Project = {
  id: 'proj-1',
  name: 'Reclamos médicos LATAM',
  description: 'Modernización del core de reclamos médicos para 8 países.',
  projectContext: [
    'Decidimos usar Kafka como bus de eventos.',
    'El proveedor médico se autentica vía OAuth con la red regional.',
    'Reclamos rechazados deben permitir apelación en 30 días.',
  ],
  agentMemory: ['Cuando el usuario pide un C4-N1, anclar al actor "Asegurado" y al sistema "Core de Reclamos".'],
  artifacts: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ARTIFACT: Artifact = {
  id: 'art-1',
  versionGroupId: 'grp-1',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Diagrama C4 Contexto',
  type: 'mermaid-c4-context',
  phase: 'Análisis',
  architecturalView: 'Vista de Contexto y Negocio',
  content: 'C4Context\n  title Reclamos Médicos\n  Person(asegurado, "Asegurado")',
  objective: 'Mostrar el alcance del sistema de reclamos médicos.',
  keyConcepts: [],
  representation: 'diagram',
  artifactMemory: ['El nivel N1 debe omitir bases de datos internas; van en N2/N3.'],
};

describe('agentContextComposer', () => {
  describe('getAgentBaseMemory', () => {
    it('returns the user-configured bullets when set', () => {
      const bullets = getAgentBaseMemory(SETTINGS);
      expect(bullets).toEqual(SETTINGS.agentMemory);
    });

    it('falls back to DEFAULT_AGENT_MEMORY when missing/empty', () => {
      const bullets = getAgentBaseMemory({ ...SETTINGS, agentMemory: [] });
      expect(bullets).toEqual([...DEFAULT_AGENT_MEMORY]);
    });

    it('tolerates undefined settings', () => {
      const bullets = getAgentBaseMemory(undefined);
      expect(bullets.length).toBeGreaterThan(0);
    });

    it('strips empty/whitespace-only bullets', () => {
      const bullets = getAgentBaseMemory({ ...SETTINGS, agentMemory: ['', '   ', 'Real bullet'] });
      expect(bullets).toEqual(['Real bullet']);
    });
  });

  describe('compactBullet', () => {
    it('returns the original when within the cap', () => {
      expect(compactBullet('short text', 100)).toBe('short text');
    });

    it('truncates at a word boundary when possible', () => {
      const long = 'palabra '.repeat(40).trim();
      const compacted = compactBullet(long, 80);
      expect(compacted.length).toBeLessThanOrEqual(80);
      expect(compacted.endsWith('…')).toBe(true);
      // Should end at a word boundary, not mid-word
      expect(compacted.replace('…', '').trim()).not.toMatch(/palab$/);
    });

    it('handles non-string input gracefully', () => {
      expect(compactBullet(null as unknown as string, 100)).toBe('');
    });
  });

  describe('selectRelevantMemory', () => {
    it('returns natural order when no query is provided', () => {
      const result = selectRelevantMemory({
        items: ['A', 'B', 'C'],
        query: '',
        limit: 10,
        bulletCharCap: 100,
      });
      expect(result).toEqual(['A', 'B', 'C']);
    });

    it('ranks bullets by token overlap with the query', () => {
      const result = selectRelevantMemory({
        items: [
          'Generalidades irrelevantes sobre marketing digital.',
          'El bus de eventos en Kafka recibe reclamos médicos.',
          'Apelación de reclamos: 30 días hábiles.',
        ],
        query: 'cómo se aprueba una apelación de reclamos',
        limit: 2,
        bulletCharCap: 200,
      });
      // The apelación bullet must rank first; Kafka may or may not appear.
      expect(result[0]).toMatch(/apelación/i);
      expect(result).not.toContain('Generalidades irrelevantes sobre marketing digital.');
    });

    it('falls back to natural order if no bullet matches the query', () => {
      const result = selectRelevantMemory({
        items: ['First', 'Second', 'Third'],
        query: 'completely unrelated query about tax law',
        limit: 2,
        bulletCharCap: 100,
      });
      expect(result).toEqual(['First', 'Second']);
    });

    it('respects the limit and the per-bullet character cap', () => {
      const longBullet = 'palabra '.repeat(60).trim();
      const result = selectRelevantMemory({
        items: [longBullet, longBullet, longBullet, longBullet],
        query: '',
        limit: 2,
        bulletCharCap: 40,
      });
      expect(result).toHaveLength(2);
      expect(result.every((b) => b.length <= 40)).toBe(true);
    });

    it('returns [] when items list is empty', () => {
      const result = selectRelevantMemory({
        items: [],
        query: 'anything',
        limit: 5,
        bulletCharCap: 100,
      });
      expect(result).toEqual([]);
    });
  });

  describe('buildAgentSystemInstruction', () => {
    it('places the Memoria del Agente (Base) before global/project sections', () => {
      const instruction = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: null,
        settings: SETTINGS,
        userQuery: 'pregunta cualquier cosa',
      });

      const baseIdx = instruction.indexOf('Memoria del Agente (Base):');
      const globalIdx = instruction.indexOf('Memoria Global');
      const projectIdx = instruction.indexOf('Contexto del Proyecto');

      expect(baseIdx).toBeGreaterThan(-1);
      expect(globalIdx).toBeGreaterThan(baseIdx);
      expect(projectIdx).toBeGreaterThan(globalIdx);
    });

    it('includes the artifact section only when an artifact is active', () => {
      const without = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: null,
        settings: SETTINGS,
      });
      const withArtifact = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: ARTIFACT,
        settings: SETTINGS,
      });
      expect(without).not.toContain('Artefacto activo:');
      expect(withArtifact).toContain('Artefacto activo:');
      expect(withArtifact).toContain(ARTIFACT.name);
    });

    it('uses DEFAULT_AGENT_MEMORY when settings.agentMemory is empty', () => {
      const instruction = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: null,
        settings: { ...SETTINGS, agentMemory: [] },
      });
      // The instruction must still contain the base section + at least one
      // default bullet (the role definition).
      expect(instruction).toContain('Memoria del Agente (Base):');
      expect(instruction).toContain('Arquitecto Agente');
    });

    it('truncates the artifact content excerpt when it exceeds the cap', () => {
      const longContent = 'lorem '.repeat(2000); // > 1800 chars
      const instruction = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: { ...ARTIFACT, content: longContent },
        settings: SETTINGS,
      });
      expect(instruction).toContain('[…contenido truncado para el contexto…]');
    });

    it('applies the user query to project context selection', () => {
      const instruction = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: null,
        settings: SETTINGS,
        userQuery: 'apelación de reclamos médicos',
      });
      // The "apelación" bullet must appear; the unrelated Kafka bullet may not.
      expect(instruction).toContain('apelación');
    });

    it('respects a custom per-scope budget override', () => {
      const instruction = buildAgentSystemInstruction({
        project: PROJECT,
        activeArtifact: null,
        settings: SETTINGS,
        budget: { agentBaseMax: 1, globalMax: 1, projectMax: 1, projectAgentMax: 0 },
      });
      // With agentBaseMax: 1 we surface only the first agent base bullet.
      expect(instruction).toContain('Soy el Arquitecto Agente');
      // With projectAgentMax: 0 the per-project agent section must be absent.
      expect(instruction).not.toContain('Memoria del Agente (Proyecto):');
    });
  });

  describe('prepareChatHistoryForModel', () => {
    const history = [
      { role: 'user' as const, content: 'hola' },
      { role: 'model' as const, content: 'hola, ¿en qué te ayudo?' },
      { role: 'user' as const, content: 'crea un C4-N1' },
      { role: 'model' as const, content: 'listo, aquí está…' },
    ];

    it('returns [] when history is disabled', () => {
      const result = prepareChatHistoryForModel({ history, includeChatHistory: false });
      expect(result).toEqual([]);
    });

    it('returns the tail in Gemini format when history is enabled', () => {
      const result = prepareChatHistoryForModel({ history, includeChatHistory: true });
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: 'user', parts: [{ text: 'hola' }] });
      expect(result[3]).toEqual({ role: 'model', parts: [{ text: 'listo, aquí está…' }] });
    });

    it('caps the history to budget.historyMax', () => {
      const longHistory = Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'model') as 'user' | 'model',
        content: `msg ${i}`,
      }));
      const result = prepareChatHistoryForModel({
        history: longHistory,
        includeChatHistory: true,
        budget: { historyMax: 5 },
      });
      expect(result).toHaveLength(5);
      expect(result[result.length - 1].parts[0].text).toBe('msg 29');
    });

    it('drops compaction marker messages', () => {
      const withMarker = [
        { role: 'user' as const, content: 'antigua' },
        { role: 'model' as const, content: '[COMPACTION MARKER]', meta: { kind: 'compaction' as const } },
        { role: 'user' as const, content: 'nueva' },
      ];
      const result = prepareChatHistoryForModel({ history: withMarker, includeChatHistory: true });
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.parts[0].text)).toEqual(['antigua', 'nueva']);
    });
  });

  describe('DEFAULT_CONTEXT_BUDGET', () => {
    it('keeps conservative per-scope caps', () => {
      expect(DEFAULT_CONTEXT_BUDGET.agentBaseMax).toBeGreaterThan(0);
      expect(DEFAULT_CONTEXT_BUDGET.globalMax).toBeGreaterThanOrEqual(DEFAULT_CONTEXT_BUDGET.agentBaseMax);
      expect(DEFAULT_CONTEXT_BUDGET.historyMax).toBeGreaterThan(0);
      expect(DEFAULT_CONTEXT_BUDGET.bulletCharCap).toBeGreaterThanOrEqual(100);
      expect(DEFAULT_CONTEXT_BUDGET.initialCaptureMax).toBeGreaterThan(0);
      expect(DEFAULT_CONTEXT_BUDGET.projectArtifactsMax).toBeGreaterThan(0);
    });
  });

  describe('semantic-lite matching (stemming + accents + plurals)', () => {
    it('stems Spanish word families to a common root', () => {
      expect(stemMatchToken('integración')).toBe(stemMatchToken('integraciones'));
      expect(stemMatchToken('sistemas')).toBe(stemMatchToken('sistema'));
      expect(stemMatchToken('autenticación')).toBe(stemMatchToken('autenticacion'));
      expect(stemMatchToken('payments')).toBe(stemMatchToken('payment'));
    });

    it('matches accented queries against unaccented bullets and vice versa', () => {
      const ranked = selectRelevantMemory({
        items: ['La autenticacion usa OAuth con la red regional.', 'El despliegue corre en Kubernetes.'],
        query: '¿cómo funciona la autenticación?',
        limit: 1,
        bulletCharCap: 220,
      });
      expect(ranked[0]).toContain('OAuth');
    });

    it('matches plurals and derivational forms across query and bullet', () => {
      const ranked = selectRelevantMemory({
        items: ['Las integraciones con hospitales usan API-led.', 'El tema visual es editorial.'],
        query: 'explícame la integración con el hospital',
        limit: 1,
        bulletCharCap: 220,
      });
      expect(ranked[0]).toContain('API-led');
    });
  });

  describe('selectRelevantMemoryEntries', () => {
    const datedEntry = (text: string, priority: 'high' | 'medium' | 'low', createdAt: string | null): MemoryEntry => ({
      id: `id-${text}`,
      text,
      priority,
      createdAt,
      updatedAt: null,
      authorId: null,
      authorName: 'Ana',
    });

    it('orders by prioridad + recencia when no query is given', () => {
      const selected = selectRelevantMemoryEntries({
        texts: ['baja nueva', 'media vieja', 'alta vieja'],
        entries: [
          datedEntry('baja nueva', 'low', '2026-06-01T00:00:00Z'),
          datedEntry('media vieja', 'medium', '2025-01-01T00:00:00Z'),
          datedEntry('alta vieja', 'high', '2024-01-01T00:00:00Z'),
        ],
        limit: 3,
        bulletCharCap: 220,
      });
      expect(selected[0]).toContain('alta vieja');
      expect(selected[1]).toContain('media vieja');
      expect(selected[2]).toContain('baja nueva');
    });

    it('annotates notes with prioridad/fecha/autor metadata', () => {
      const selected = selectRelevantMemoryEntries({
        texts: ['usar kafka'],
        entries: [datedEntry('usar kafka', 'high', '2026-06-01T00:00:00Z')],
        limit: 5,
        bulletCharCap: 220,
      });
      expect(selected[0]).toContain('[prioridad alta · 2026-06-01 · Ana]');
    });

    it('boosts high-priority notes when relevance ties', () => {
      const selected = selectRelevantMemoryEntries({
        texts: ['kafka es el bus de eventos', 'kafka requiere idempotencia'],
        entries: [
          datedEntry('kafka es el bus de eventos', 'low', null),
          datedEntry('kafka requiere idempotencia', 'high', null),
        ],
        query: 'kafka',
        limit: 1,
        bulletCharCap: 220,
      });
      expect(selected[0]).toContain('idempotencia');
    });

    it('still works with legacy data (texts only, no entries)', () => {
      const selected = selectRelevantMemoryEntries({
        texts: ['uno', 'dos'],
        entries: undefined,
        limit: 2,
        bulletCharCap: 220,
      });
      expect(selected).toEqual(['uno', 'dos']);
    });
  });

  describe('buildProjectArtifactsInventory', () => {
    it('lists only the latest version per group with type and version', () => {
      const project: Project = {
        ...PROJECT,
        artifacts: [
          { ...ARTIFACT, id: 'a1', versionGroupId: 'g1', version: 1, name: 'C4 Contexto' },
          { ...ARTIFACT, id: 'a2', versionGroupId: 'g1', version: 2, name: 'C4 Contexto' },
          { ...ARTIFACT, id: 'b1', versionGroupId: 'g2', version: 1, name: 'BRD', type: 'sdd-brd', reviewStatus: 'approved' },
        ],
      };
      const inventory = buildProjectArtifactsInventory(project, 10);
      expect(inventory).toHaveLength(2);
      const c4 = inventory.find((line) => line.includes('C4 Contexto'));
      expect(c4).toContain('v2');
      const brd = inventory.find((line) => line.includes('BRD'));
      expect(brd).toContain('estado: approved');
    });

    it('returns [] for projects without artifacts', () => {
      expect(buildProjectArtifactsInventory({ ...PROJECT, artifacts: [] }, 10)).toEqual([]);
    });
  });

  describe('buildAgentSystemInstruction — memoria estructurada', () => {
    it('includes the hierarchy/consistency rules and the artifact inventory', () => {
      const project: Project = {
        ...PROJECT,
        artifacts: [{ ...ARTIFACT }],
        initialCapture: ['Objetivo: modernizar reclamos en 8 países.'],
      };
      const instruction = buildAgentSystemInstruction({
        project,
        activeArtifact: null,
        settings: SETTINGS,
      });
      expect(instruction).toContain('Jerarquía y uso de la memoria');
      expect(instruction).toContain('contexto del artefacto > contexto del proyecto > contexto global > memoria del agente');
      expect(instruction).toContain('Artefactos existentes del proyecto');
      expect(instruction).toContain('Diagrama C4 Contexto');
      expect(instruction).toContain('Captura Inicial del Proyecto');
      expect(instruction).toContain('Objetivo: modernizar reclamos en 8 países.');
    });

    it('surfaces high-priority recent notes with their annotation', () => {
      const project: Project = {
        ...PROJECT,
        projectContextEntries: [
          {
            id: 'n1',
            text: 'Decidimos usar Kafka como bus de eventos.',
            priority: 'high',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: null,
            authorId: 'u1',
            authorName: 'Carlos',
          },
        ],
      };
      const instruction = buildAgentSystemInstruction({
        project,
        activeArtifact: null,
        settings: SETTINGS,
      });
      expect(instruction).toContain('[prioridad alta · 2026-06-01 · Carlos] Decidimos usar Kafka como bus de eventos.');
    });
  });
});
