/**
 * ContextConflictDetector — surfaces contradictions among extracted entities
 * so the prompt builder can flag them instead of feeding ambiguous context to
 * the model.
 *
 * Heuristics are intentionally conservative — false positives would block
 * legitimate hybrid architectures, so a conflict is only raised when the
 * evidence is unambiguous.
 */

import type { ContextConflict, ContextEntity, ContextSource } from './contextGraphTypes';
import { normalizeLabel } from './contextSignalExtractor';

const REVERSAL_CUES = [
  'ya no', 'en lugar de', 'reemplaz', 'deprecat', 'se descarto', 'descartad',
  'cambiamos a', 'migrar de', 'migracion de', 'sustituye a', 'en vez de',
];

const hasReversalCue = (entity: ContextEntity): boolean => {
  const haystacks = [entity.label, ...entity.sources.map((s) => s.snippet ?? '')];
  return haystacks.some((text) => {
    const norm = normalizeLabel(text);
    return REVERSAL_CUES.some((cue) => norm.includes(cue));
  });
};

const collectSources = (entities: ContextEntity[]): ContextSource[] => {
  const seen = new Set<string>();
  const out: ContextSource[] = [];
  for (const entity of entities) {
    for (const source of entity.sources) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      out.push(source);
    }
  }
  return out;
};

export class ContextConflictDetector {
  detect(entities: ContextEntity[], now = new Date().toISOString()): ContextConflict[] {
    const conflicts: ContextConflict[] = [];

    // 1) Competing primary databases declared on the same project.
    const databases = entities.filter(
      (e) => e.type === 'technology' && e.tags.includes('database'),
    );
    if (databases.length > 1) {
      conflicts.push({
        id: `conflict-db-${databases.map((d) => d.id).join('+')}`,
        kind: 'competing-choice',
        description: `Múltiples bases de datos primarias detectadas: ${databases
          .map((d) => d.label)
          .join(', ')}. Confirma cuál es la canónica.`,
        entityIds: databases.map((d) => d.id),
        sources: collectSources(databases),
        severity: 'high',
        detectedAt: now,
      });
    }

    // 2) Competing cloud providers presented as the canonical one.
    const clouds = entities.filter((e) => e.type === 'vendor' && e.tags.includes('cloud'));
    if (clouds.length > 1) {
      conflicts.push({
        id: `conflict-cloud-${clouds.map((c) => c.id).join('+')}`,
        kind: 'competing-choice',
        description: `Múltiples proveedores cloud principales detectados: ${clouds
          .map((c) => c.label)
          .join(', ')}. Aclara si la arquitectura es multi-cloud o hay una contradicción.`,
        entityIds: clouds.map((c) => c.id),
        sources: collectSources(clouds),
        severity: 'medium',
        detectedAt: now,
      });
    }

    // 3) Decisions that look reversed ("ya no usamos X", "migramos de X a Y").
    for (const decision of entities.filter((e) => e.type === 'decision')) {
      if (!hasReversalCue(decision)) continue;
      conflicts.push({
        id: `conflict-reversal-${decision.id}`,
        kind: 'reversal',
        description: `La decisión "${decision.label}" describe un cambio de rumbo; verifica que el contexto previo ya no aplique.`,
        entityIds: [decision.id],
        sources: decision.sources,
        severity: 'medium',
        detectedAt: now,
      });
    }

    return conflicts;
  }
}

export const contextConflictDetector = new ContextConflictDetector();
