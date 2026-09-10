/**
 * Deterministic relation extraction for the Architecture Knowledge Graph.
 *
 * Relations are read from three high-precision surfaces:
 *  1. `DiagramIR` edges — the strongest signal (source/target are explicit).
 *  2. Requirements traceability matrices — `tracesTo` links between ids.
 *  3. A conservative free-text verb scan ("A depende de B", "A usa B", …).
 *
 * Each signal carries its evidence; endpoint names are resolved to entity ids
 * later by `ArchitectureKnowledgeGraphService`.
 */

import type {
  ArchitectureGraphArtifactInput,
  ArchitectureGraphBuildInput,
  ArchitectureRelationType,
  ArchitectureSourceRef,
  RawRelationSignal,
} from './ArchitectureKnowledgeGraphTypes';
import { cleanText, truncate } from './ArchitectureGraphNormalization';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Maps a `DiagramIREdge.relation` to a canonical relation type. */
const mapEdgeRelation = (relation: string): ArchitectureRelationType => {
  switch (relation) {
    case 'dependency':
      return 'dependsOn';
    case 'inheritance':
      return 'implements';
    case 'async':
      return 'publishes';
    case 'data-flow':
      return 'uses';
    case 'sync':
      return 'calls';
    default:
      return 'uses';
  }
};

/** Free-text verb cues, ordered most-specific-first. */
const VERB_RULES: Array<{ pattern: RegExp; type: ArchitectureRelationType }> = [
  { pattern: /\bse\s+integra\s+con\b|\bintegrates?\s+with\b/i, type: 'uses' },
  { pattern: /\bdepende\s+de\b|\bdepends?\s+on\b/i, type: 'dependsOn' },
  { pattern: /\bconsume\b|\bconsumes?\b/i, type: 'consumes' },
  { pattern: /\bpublica\b|\bpublishes?\b/i, type: 'publishes' },
  { pattern: /\binvoca\b|\bllama\s+a\b|\bcalls?\b/i, type: 'calls' },
  { pattern: /\blee\s+de\b|\breads?\s+from\b/i, type: 'reads' },
  { pattern: /\bescribe\s+en\b|\bwrites?\s+to\b/i, type: 'writes' },
  { pattern: /\bexpone\b|\bexposes?\b/i, type: 'exposes' },
  { pattern: /\bcontiene\b|\bcontains?\b/i, type: 'contains' },
  { pattern: /\busa\b|\butiliza\b|\buses?\b/i, type: 'uses' },
];

const VERB_SCAN = new RegExp(
  '([A-ZÁÉÍÓÚÑ][\\wáéíóúñ ]{2,48}?)\\s+' +
    '(se integra con|depende de|consume|publica|invoca|llama a|lee de|escribe en|expone|contiene|utiliza|usa)\\s+' +
    '([A-ZÁÉÍÓÚÑ][\\wáéíóúñ ]{2,48}?)(?=[.,;\\n]|$)',
  'gi',
);

/** Captures structured ids used inside traceability matrices. */
const ID_TOKEN = /\b(?:RNF|NFR|RF|REQ|FR|US|UC|TC|CP|RISK|RG|RIESGO|ADR|DEC)[-\s]?\d{1,4}\b/gi;

export class ArchitectureRelationExtractor {
  private ref(
    base: Partial<ArchitectureSourceRef>,
    confidence: number,
    now: string,
  ): ArchitectureSourceRef {
    return {
      sourceType: base.sourceType ?? 'artifact-content',
      sourceId: base.sourceId ?? 'unknown',
      confidence,
      createdAt: now,
      ...base,
    } as ArchitectureSourceRef;
  }

  /** Extracts relations from a `DiagramIR`'s edges. */
  extractFromIR(artifact: ArchitectureGraphArtifactInput, now: string): RawRelationSignal[] {
    const ir = asRecord(artifact.ir);
    if (!ir) return [];
    const nodeLabelById = new Map<string, string>();
    for (const rawNode of asArray(ir.nodes)) {
      const node = asRecord(rawNode);
      if (!node) continue;
      const id = readString(node.id);
      const label = cleanText(readString(node.label) || id);
      if (id && label) nodeLabelById.set(id, label);
    }

    const out: RawRelationSignal[] = [];
    for (const rawEdge of asArray(ir.edges)) {
      const edge = asRecord(rawEdge);
      if (!edge) continue;
      const sourceLabel = nodeLabelById.get(readString(edge.source));
      const targetLabel = nodeLabelById.get(readString(edge.target));
      if (!sourceLabel || !targetLabel) continue;
      const relation = readString(edge.relation);
      const protocol = cleanText(readString(edge.protocol));
      const direction = edge.direction === 'bidirectional' ? 'bidirectional' : 'unidirectional';
      out.push({
        sourceName: sourceLabel,
        targetName: targetLabel,
        type: mapEdgeRelation(relation),
        label: cleanText(readString(edge.label)) || undefined,
        protocol: protocol || undefined,
        direction,
        source: this.ref(
          {
            sourceType: 'artifact-ir',
            sourceId: artifact.id,
            artifactId: artifact.id,
            artifactType: artifact.type,
            excerpt: truncate(`${sourceLabel} → ${targetLabel}`),
          },
          0.84,
          now,
        ),
      });
    }
    return out;
  }

  /** Builds `tracesTo` links from a requirements traceability matrix. */
  extractFromTraceabilityMatrix(
    artifact: ArchitectureGraphArtifactInput,
    now: string,
  ): RawRelationSignal[] {
    if (artifact.type !== 'sdd-traceability') return [];
    const out: RawRelationSignal[] = [];
    const lines = (artifact.content ?? '').split('\n');
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const ids = (line.match(ID_TOKEN) ?? []).map((token) =>
        token.toUpperCase().replace(/\s+/g, '-'),
      );
      if (ids.length < 2) continue;
      const [anchor, ...rest] = ids;
      for (const target of rest) {
        if (target === anchor) continue;
        out.push({
          sourceName: anchor,
          targetName: target,
          type: 'tracesTo',
          source: this.ref(
            {
              sourceType: 'artifact-content',
              sourceId: artifact.id,
              artifactId: artifact.id,
              artifactType: artifact.type,
              excerpt: truncate(line),
            },
            0.8,
            now,
          ),
        });
      }
    }
    return out;
  }

  /** Conservative free-text verb scan over a bounded slice of content. */
  extractFromText(
    text: string,
    base: Partial<ArchitectureSourceRef>,
    now: string,
  ): RawRelationSignal[] {
    const out: RawRelationSignal[] = [];
    const slice = cleanText(text).slice(0, 6000);
    if (!slice) return out;
    let match: RegExpExecArray | null;
    VERB_SCAN.lastIndex = 0;
    while ((match = VERB_SCAN.exec(slice)) !== null) {
      const sourceName = cleanText(match[1]);
      const verb = match[2];
      const targetName = cleanText(match[3]);
      if (sourceName.length < 3 || targetName.length < 3) continue;
      const rule = VERB_RULES.find((r) => r.pattern.test(verb));
      if (!rule) continue;
      out.push({
        sourceName,
        targetName,
        type: rule.type,
        source: this.ref(base, 0.5, now),
      });
    }
    return out;
  }

  /** Extracts every relation signal contributed by a single artifact. */
  extractFromArtifact(artifact: ArchitectureGraphArtifactInput, now: string): RawRelationSignal[] {
    const out: RawRelationSignal[] = [];
    out.push(...this.extractFromIR(artifact, now));
    out.push(...this.extractFromTraceabilityMatrix(artifact, now));
    if (artifact.content && artifact.type !== 'sdd-traceability') {
      out.push(
        ...this.extractFromText(
          artifact.content,
          {
            sourceType: 'artifact-content',
            sourceId: artifact.id,
            artifactId: artifact.id,
            artifactType: artifact.type,
          },
          now,
        ),
      );
    }
    return out;
  }

  /** Convenience: extracts every relation signal for a full build input. */
  extract(input: ArchitectureGraphBuildInput): RawRelationSignal[] {
    const now = input.now ?? new Date().toISOString();
    const out: RawRelationSignal[] = [];
    if (input.projectDescription) {
      out.push(
        ...this.extractFromText(
          input.projectDescription,
          { sourceType: 'project-description', sourceId: `project:${input.projectId}` },
          now,
        ),
      );
    }
    for (const artifact of input.artifacts ?? []) {
      out.push(...this.extractFromArtifact(artifact, now));
    }
    return out;
  }
}

export const architectureRelationExtractor = new ArchitectureRelationExtractor();
