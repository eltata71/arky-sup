/**
 * Los puertos de lectura que las herramientas del Despacho (`services/ai/tools`)
 * declaran, implementados desde datos que el llamante ya tiene en memoria.
 * Ninguno llega a la red ni a la base de datos: leer a través de un puerto es
 * lo que mantiene a la capa de IA sin importar ningún contexto.
 */

import type {
  ArtifactReadPort,
  KnowledgeGraphReadPort,
  MotivationReadPort,
  StandardsReadPort,
} from '../../ai';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';

interface ArtifactSource {
  id: string;
  name: string;
  type: string;
  version: number;
  objective: string;
  content: string;
}

interface GraphSource {
  entities: readonly { id: string; name: string; type: string; description?: string }[];
  relations: readonly { sourceEntityId: string; targetEntityId: string; type: string; label?: string }[];
}

interface MotivationSource {
  title: string;
  code?: string;
  need: string;
  objectives: readonly string[];
  expectedOutcomes: readonly string[];
  kpis: readonly string[];
}

export const createArtifactReadPort = (artifacts: readonly ArtifactSource[]): ArtifactReadPort => ({
  list: () => artifacts.map((a) => ({
    id: a.id, name: a.name, type: a.type, version: a.version, objective: a.objective, content: a.content,
  })),
});

export const createStandardsReadPort = (): StandardsReadPort => ({
  list: () => getOfficeArchitectureContext().standards.map((s) => ({
    id: s.id, title: s.domain, summary: s.statement,
  })),
});

export const createKnowledgeGraphReadPort = (graph: GraphSource | null | undefined): KnowledgeGraphReadPort => ({
  entities: () => (graph?.entities ?? []).map((e) => ({
    id: e.id, name: e.name, type: e.type, description: e.description,
  })),
  relations: () => (graph?.relations ?? []).map((r) => ({
    sourceId: r.sourceEntityId, targetId: r.targetEntityId, type: r.type, label: r.label,
  })),
});

export const createMotivationReadPort = (motivations: readonly MotivationSource[]): MotivationReadPort => ({
  list: () => motivations.map((m) => ({
    initiativeId: m.code ?? m.title,
    title: m.title,
    need: m.need,
    objectives: m.objectives,
    expectedOutcomes: m.expectedOutcomes,
    kpis: m.kpis,
  })),
});
