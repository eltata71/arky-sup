/**
 * Deterministic entity extraction for the Architecture Knowledge Graph.
 *
 * The extractor is intentionally rule-based (no AI hop): it reads the project
 * surfaces and every artifact (name, objective, key concepts, Markdown
 * content and `DiagramIR`) and emits {@link RawEntitySignal}s — each one
 * carrying its evidence ({@link ArchitectureSourceRef}). Consolidation and
 * deduplication happen later in `ArchitectureGraphDeduplication`.
 *
 * Precision over recall: a phrase only becomes an entity when it matches a
 * known technology, a structured id (RF-001, US-12, …) or a classifying head
 * keyword ("Servicio de Pagos", "API Gateway"). This keeps the graph honest.
 */

import type {
  ArchitectureCriticality,
  ArchitectureEntityType,
  ArchitectureGraphArtifactInput,
  ArchitectureGraphBuildInput,
  ArchitectureSourceRef,
  ArchitectureSourceType,
  RawEntitySignal,
} from './ArchitectureKnowledgeGraphTypes';
import { cleanText, normalizeName, truncate } from './ArchitectureGraphNormalization';

interface ArtifactIRNode {
  id?: unknown;
  label?: unknown;
  kind?: unknown;
  shape?: unknown;
  description?: unknown;
  technology?: unknown;
  group?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Named technologies recognised regardless of casing. */
const NAMED_TECH: Array<{ pattern: RegExp; type: ArchitectureEntityType; subtype?: string }> = [
  { pattern: /\bpostgre?s(?:ql)?\b/i, type: 'database', subtype: 'postgresql' },
  { pattern: /\bmysql\b/i, type: 'database', subtype: 'mysql' },
  { pattern: /\bmongo\s?db\b/i, type: 'database', subtype: 'mongodb' },
  { pattern: /\bredis\b/i, type: 'dataStore', subtype: 'redis' },
  { pattern: /\b(?:apache\s+)?kafka\b/i, type: 'topic', subtype: 'kafka' },
  { pattern: /\brabbit\s?mq\b/i, type: 'queue', subtype: 'rabbitmq' },
  { pattern: /\b(?:amazon\s+)?sqs\b/i, type: 'queue', subtype: 'sqs' },
  { pattern: /\bdynamo\s?db\b/i, type: 'database', subtype: 'dynamodb' },
  { pattern: /\belasticsearch\b/i, type: 'dataStore', subtype: 'elasticsearch' },
  { pattern: /\bkubernetes\b|\bk8s\b/i, type: 'deploymentNode', subtype: 'kubernetes' },
  { pattern: /\bdocker\b/i, type: 'deploymentNode', subtype: 'docker' },
  { pattern: /\baws\b|\bamazon web services\b/i, type: 'environment', subtype: 'aws' },
  { pattern: /\bazure\b/i, type: 'environment', subtype: 'azure' },
  { pattern: /\bgcp\b|\bgoogle cloud\b/i, type: 'environment', subtype: 'gcp' },
];

/**
 * Head keywords that classify a captured noun phrase. Order matters — more
 * specific phrases are listed first.
 */
const HEAD_KEYWORDS: Array<{ pattern: RegExp; type: ArchitectureEntityType }> = [
  { pattern: /\bbases?\s+de\s+datos\b|\bdatabase\b/i, type: 'database' },
  { pattern: /\bmicroservicios?\b|\bmicroservices?\b/i, type: 'application' },
  { pattern: /\bapi\s+gateway\b|\bgateway\b/i, type: 'api' },
  { pattern: /\bbff\b/i, type: 'application' },
  { pattern: /\bapis?\b|\bendpoints?\b/i, type: 'api' },
  { pattern: /\bcolas?\b|\bqueues?\b/i, type: 'queue' },
  { pattern: /\bt[óo]picos?\b|\btopics?\b/i, type: 'topic' },
  { pattern: /\beventos?\b|\bevents?\b/i, type: 'event' },
  { pattern: /\bcomandos?\b|\bcommands?\b/i, type: 'command' },
  { pattern: /\bagregados?\b|\baggregates?\b/i, type: 'aggregate' },
  { pattern: /\bcontextos?\s+delimitados?\b|\bbounded\s+contexts?\b/i, type: 'boundedContext' },
  { pattern: /\bmicro\s?frontends?\b|\baplicaci[óo]n(?:es)?\b|\bapplication\b/i, type: 'application' },
  { pattern: /\bcontenedor(?:es)?\b|\bcontainer\b/i, type: 'container' },
  { pattern: /\bcomponentes?\b|\bcomponent\b/i, type: 'component' },
  { pattern: /\bm[óo]dulos?\b|\bmodules?\b/i, type: 'module' },
  { pattern: /\bservicios?\b|\bservices?\b|\bsistemas?\b|\bsystems?\b|\bplataformas?\b/i, type: 'system' },
  { pattern: /\bcapacidad(?:es)?\s+de\s+negocio\b|\bbusiness\s+capabilit/i, type: 'businessCapability' },
  { pattern: /\bprocesos?\s+de\s+negocio\b|\bprocesos?\b|\bworkflows?\b/i, type: 'businessProcess' },
  { pattern: /\bintegraci[óo]n(?:es)?\b|\bintegrations?\b/i, type: 'integration' },
  { pattern: /\bnodos?\s+de\s+despliegue\b|\bdeployment\s+nodes?\b/i, type: 'deploymentNode' },
  { pattern: /\bambient(?:e|es)\b|\bentornos?\b|\benvironments?\b/i, type: 'environment' },
];

/** Free-text cue words that classify whole sentences. */
const SENTENCE_CUES: Array<{ pattern: RegExp; type: ArchitectureEntityType; criticality?: ArchitectureCriticality }> = [
  { pattern: /\briesgos?\b|\brisks?\b/i, type: 'risk', criticality: 'high' },
  { pattern: /\bmitigaci[óo]n(?:es)?\b|\bmitigation\b/i, type: 'mitigation' },
  { pattern: /\bdecidimos\b|\bdecisi[óo]n(?:es)?\b|\bdecision\b|\bADR\b/i, type: 'decision' },
  { pattern: /\brestricci[óo]n(?:es)?\b|\bconstraints?\b/i, type: 'constraint' },
  { pattern: /\bsupuestos?\b|\basunci[óo]n(?:es)?\b|\bassumptions?\b/i, type: 'assumption' },
];

/** Structured-id patterns surfaced in document content. */
const ID_PATTERNS: Array<{ pattern: RegExp; type: ArchitectureEntityType }> = [
  { pattern: /\bRNF[-\s]?\d{1,4}\b/gi, type: 'nonFunctionalRequirement' },
  { pattern: /\bNFR[-\s]?\d{1,4}\b/gi, type: 'nonFunctionalRequirement' },
  { pattern: /\bRF[-\s]?\d{1,4}\b/gi, type: 'functionalRequirement' },
  { pattern: /\b(?:REQ|FR)[-\s]?\d{1,4}\b/gi, type: 'requirement' },
  { pattern: /\bUS[-\s]?\d{1,4}\b/gi, type: 'userStory' },
  { pattern: /\bUC[-\s]?\d{1,4}\b/gi, type: 'useCase' },
  { pattern: /\b(?:TC|CP)[-\s]?\d{1,4}\b/gi, type: 'testCase' },
  { pattern: /\b(?:RISK|RG|RIESGO)[-\s]?\d{1,4}\b/gi, type: 'risk' },
  { pattern: /\b(?:ADR|DEC)[-\s]?\d{1,4}\b/gi, type: 'decision' },
];

/** Maps DiagramIR node kinds / shapes to entity types. */
const mapIRNodeToType = (kind: string, shape: string): ArchitectureEntityType => {
  const k = kind.toLowerCase();
  const s = shape.toLowerCase();
  if (k.includes('person') || s === 'person') return 'actor';
  if (k.includes('system_ext') || k.includes('external')) return 'externalSystem';
  if (k.includes('containerdb') || k.includes('systemdb') || k.includes('database') || s === 'cylinder') return 'dataStore';
  if (k.includes('container')) return 'container';
  if (k.includes('component')) return 'component';
  if (k.includes('softwaresystem') || k === 'system') return 'system';
  if (k.includes('entity')) return 'dataEntity';
  if (k.includes('queue')) return 'queue';
  if (k.includes('topic')) return 'topic';
  if (k.includes('event')) return 'event';
  if (k.includes('integration')) return 'integration';
  if (k.includes('api')) return 'api';
  if (s === 'cloud') return 'externalSystem';
  return 'component';
};

const CAP_PHRASE = /\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]*(?:[\s/-](?:de\s+|del\s+|la\s+|el\s+)?[A-Za-zÁÉÍÓÚÑáéíóúñ][\wáéíóúñ]*){0,4})/g;

export class ArchitectureEntityExtractor {
  private ref(
    sourceType: ArchitectureSourceType,
    sourceId: string,
    confidence: number,
    now: string,
    extras: Partial<ArchitectureSourceRef> = {},
  ): ArchitectureSourceRef {
    return {
      sourceType,
      sourceId,
      confidence,
      createdAt: now,
      ...extras,
    };
  }

  /** Scans free text for named technologies and classifiable noun phrases. */
  private scanText(text: string, baseRef: ArchitectureSourceRef): RawEntitySignal[] {
    const out: RawEntitySignal[] = [];
    const clean = cleanText(text);
    if (!clean) return out;
    const seen = new Set<string>();

    for (const tech of NAMED_TECH) {
      const match = clean.match(tech.pattern);
      if (match) {
        const name = cleanText(match[0]);
        const key = `${tech.type}:${normalizeName(name)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            name,
            type: tech.type,
            subtype: tech.subtype,
            source: { ...baseRef, excerpt: truncate(clean) },
          });
        }
      }
    }

    let capMatch: RegExpExecArray | null;
    CAP_PHRASE.lastIndex = 0;
    while ((capMatch = CAP_PHRASE.exec(clean)) !== null) {
      const phrase = cleanText(capMatch[1]);
      if (phrase.length < 4 || phrase.length > 64) continue;
      const head = HEAD_KEYWORDS.find((rule) => rule.pattern.test(phrase));
      if (!head) continue;
      const key = `${head.type}:${normalizeName(phrase)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: phrase,
        type: head.type,
        source: { ...baseRef, confidence: Math.min(baseRef.confidence, 0.62), excerpt: truncate(clean) },
      });
    }

    for (const cue of SENTENCE_CUES) {
      if (!cue.pattern.test(clean)) continue;
      const key = `${cue.type}:${normalizeName(clean)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: truncate(clean, 90),
        type: cue.type,
        criticality: cue.criticality,
        source: { ...baseRef, confidence: Math.min(baseRef.confidence, 0.55), excerpt: truncate(clean) },
      });
    }
    return out;
  }

  /** Extracts structured ids (RF-001, US-12, …) from document content. */
  private scanIds(text: string, baseRef: ArchitectureSourceRef): RawEntitySignal[] {
    const out: RawEntitySignal[] = [];
    const seen = new Set<string>();
    for (const rule of ID_PATTERNS) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        const name = cleanText(match[0]).toUpperCase().replace(/\s+/g, '-');
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          type: rule.type,
          tags: ['structured-id'],
          source: { ...baseRef, confidence: 0.85, excerpt: name },
        });
      }
    }
    return out;
  }

  /** Extracts entities from the top-level project surfaces. */
  extractFromProject(input: ArchitectureGraphBuildInput, now: string): RawEntitySignal[] {
    const out: RawEntitySignal[] = [];
    const projectId = `project:${input.projectId}`;

    if (input.projectDescription) {
      out.push(
        ...this.scanText(
          input.projectDescription,
          this.ref('project-description', projectId, 0.7, now),
        ),
      );
    }
    const surfaces: Array<{ list?: string[]; sourceType: ArchitectureSourceType }> = [
      { list: input.projectContext, sourceType: 'project-context' },
      { list: input.agentMemory, sourceType: 'agent-memory' },
      { list: input.initialCapture, sourceType: 'initial-capture' },
      { list: input.globalContext, sourceType: 'global-context' },
    ];
    for (const surface of surfaces) {
      (surface.list ?? []).forEach((entry, index) => {
        const ref = this.ref(surface.sourceType, `${projectId}#${surface.sourceType}-${index}`, 0.66, now);
        out.push(...this.scanText(entry, ref));
      });
    }
    return out;
  }

  /** Extracts entities from a single artifact across all of its surfaces. */
  extractFromArtifact(artifact: ArchitectureGraphArtifactInput, now: string): RawEntitySignal[] {
    const out: RawEntitySignal[] = [];

    if (artifact.objective) {
      out.push(
        ...this.scanText(
          artifact.objective,
          this.ref('artifact-objective', artifact.id, 0.62, now, { artifactId: artifact.id, artifactType: artifact.type }),
        ),
      );
    }

    // Key concepts → glossary terms (always, with high confidence).
    for (const concept of artifact.keyConcepts ?? []) {
      const term = cleanText(concept?.term);
      if (!term) continue;
      out.push({
        name: term,
        type: 'glossaryTerm',
        description: cleanText(concept?.definition) || undefined,
        tags: ['key-concept'],
        source: this.ref('artifact-key-concept', artifact.id, 0.8, now, {
          artifactId: artifact.id,
          artifactType: artifact.type,
          excerpt: truncate(`${term}: ${concept?.definition ?? ''}`),
        }),
      });
    }

    // DiagramIR nodes → structural entities.
    out.push(...this.extractFromIR(artifact, now));

    // Document content → structured ids + classifiable phrases.
    if (artifact.content) {
      const contentRef = this.ref('artifact-content', artifact.id, 0.6, now, {
        artifactId: artifact.id,
        artifactType: artifact.type,
      });
      out.push(...this.scanIds(artifact.content, contentRef));
      out.push(...this.extractGlossaryRows(artifact, now));
      // Keyword scan on a bounded slice keeps document extraction cheap.
      out.push(...this.scanText(artifact.content.slice(0, 6000), contentRef));
    }

    // Per-artifact memory notes.
    (artifact.artifactMemory ?? []).forEach((note, index) => {
      out.push(
        ...this.scanText(
          note,
          this.ref('artifact-content', `${artifact.id}#memory-${index}`, 0.55, now, { artifactId: artifact.id }),
        ),
      );
    });

    return out;
  }

  /** Reads `DiagramIR` nodes and maps them to structural entities. */
  private extractFromIR(artifact: ArchitectureGraphArtifactInput, now: string): RawEntitySignal[] {
    const ir = asRecord(artifact.ir);
    if (!ir) return [];
    const out: RawEntitySignal[] = [];
    for (const rawNode of asArray(ir.nodes)) {
      const node = rawNode as ArtifactIRNode;
      const label = cleanText(readString(node.label) || readString(node.id));
      if (!label) continue;
      const kind = readString(node.kind);
      const shape = readString(node.shape);
      const type = mapIRNodeToType(kind, shape);
      const technology = cleanText(readString(node.technology));
      out.push({
        name: label,
        type,
        subtype: kind || undefined,
        description: cleanText(readString(node.description)) || undefined,
        tags: technology ? ['diagram-node', `tech:${normalizeName(technology)}`] : ['diagram-node'],
        metadata: technology ? { technology } : undefined,
        source: this.ref('artifact-ir', artifact.id, 0.82, now, {
          artifactId: artifact.id,
          artifactType: artifact.type,
          excerpt: truncate(`${label} (${kind || shape || type})`),
        }),
      });
    }
    return out;
  }

  /** Parses simple two-column glossary tables ("| Término | Definición |"). */
  private extractGlossaryRows(artifact: ArchitectureGraphArtifactInput, now: string): RawEntitySignal[] {
    if (artifact.type !== 'sdd-glossary') return [];
    const out: RawEntitySignal[] = [];
    const lines = (artifact.content ?? '').split('\n');
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map((cell) => cleanText(cell)).filter(Boolean);
      if (cells.length < 2) continue;
      const term = cells[0];
      // Keep the separator matcher as alternatives: Tailwind scans this file
      // and used to mistake its compact character class for an arbitrary CSS
      // property, producing an invalid declaration during every build.
      if (!term || /^(?:-|:|\s)+$/.test(term) || /t[ée]rmino|definici[óo]n|term|definition/i.test(term)) continue;
      out.push({
        name: term,
        type: 'glossaryTerm',
        description: cells[1],
        tags: ['glossary-row'],
        source: this.ref('artifact-content', artifact.id, 0.78, now, {
          artifactId: artifact.id,
          artifactType: artifact.type,
          excerpt: truncate(`${term}: ${cells[1]}`),
        }),
      });
    }
    return out;
  }

  /** Convenience: extracts every entity signal for a full build input. */
  extract(input: ArchitectureGraphBuildInput): RawEntitySignal[] {
    const now = input.now ?? new Date().toISOString();
    const out = this.extractFromProject(input, now);
    for (const artifact of input.artifacts ?? []) {
      out.push(...this.extractFromArtifact(artifact, now));
    }
    return out;
  }
}

export const architectureEntityExtractor = new ArchitectureEntityExtractor();
