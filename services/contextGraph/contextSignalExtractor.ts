/**
 * ContextSignalExtractor — deterministic, regex/keyword extractor that turns
 * free-text project signals into typed `ContextSignal` candidates.
 *
 * It is intentionally synchronous and side-effect free: no AI calls. It is the
 * first stage of the context pipeline and feeds the deduplicator and builder.
 *
 * Extraction rules implemented here:
 *  - Only explicit signals are emitted (verbatim mentions). Inference happens
 *    later, in the builder, and is never allowed to invent entities.
 *  - Every signal keeps its source and an extraction timestamp.
 *  - Confidence is pessimistic: strong canonical cues score high, weak keyword
 *    cues score low; the ranker can adjust later.
 */

import type {
  ContextEntityType,
  ContextGraphInput,
  ContextSignal,
  ContextSource,
  ContextSourceType,
} from './contextGraphTypes';
import type { Artifact } from '../../lib/artifacts';

/* --------------------------------------------------------------------- */
/* Shared text helpers (re-exported for the rest of the pipeline)         */
/* --------------------------------------------------------------------- */

const ACCENTS = /[̀-ͯ]/g;

export const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(ACCENTS, '');

export const normalizeLabel = (value: string): string =>
  stripAccents(value).toLowerCase().replace(/\s+/g, ' ').trim();

export const slugify = (value: string): string =>
  stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'item';

export const truncate = (value: string, max = 140): string => {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
};

/** Returns the sentence (clause) around the first match of `index`. */
const sentenceAround = (text: string, index: number): string => {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const start = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf('\n'),
    before.lastIndexOf(';'),
    before.lastIndexOf('•'),
  );
  const endRel = after.search(/[.\n;•]/);
  const end = endRel === -1 ? text.length : index + endRel;
  return text.slice(start + 1, end).trim();
};

/* --------------------------------------------------------------------- */
/* Canonical pattern catalogues                                          */
/* --------------------------------------------------------------------- */

interface CanonicalPattern {
  pattern: RegExp;
  label: string;
  type: ContextEntityType;
  tag: string;
}

const TECHNOLOGY_PATTERNS: CanonicalPattern[] = [
  { pattern: /\bpostgres(?:ql)?\b/i, label: 'PostgreSQL', type: 'technology', tag: 'database' },
  { pattern: /\bmysql\b/i, label: 'MySQL', type: 'technology', tag: 'database' },
  { pattern: /\bmongo(?:db)?\b/i, label: 'MongoDB', type: 'technology', tag: 'database' },
  { pattern: /\bredis\b/i, label: 'Redis', type: 'technology', tag: 'cache' },
  { pattern: /\bkafka\b/i, label: 'Apache Kafka', type: 'technology', tag: 'messaging' },
  { pattern: /\brabbitmq\b/i, label: 'RabbitMQ', type: 'technology', tag: 'messaging' },
  { pattern: /\belastic(?:search)?\b/i, label: 'Elasticsearch', type: 'technology', tag: 'search' },
  { pattern: /\bnode(?:\.?js)?\b/i, label: 'Node.js', type: 'technology', tag: 'runtime' },
  { pattern: /\breact\b/i, label: 'React', type: 'technology', tag: 'frontend' },
  { pattern: /\bnext\.?js\b/i, label: 'Next.js', type: 'technology', tag: 'frontend' },
  { pattern: /\bspring\s?boot\b/i, label: 'Spring Boot', type: 'technology', tag: 'backend' },
  { pattern: /\bdjango\b/i, label: 'Django', type: 'technology', tag: 'backend' },
  { pattern: /\b\.net\b|\bdotnet\b/i, label: '.NET', type: 'technology', tag: 'backend' },
  { pattern: /\bgraphql\b/i, label: 'GraphQL', type: 'technology', tag: 'api' },
  { pattern: /\bgrpc\b/i, label: 'gRPC', type: 'technology', tag: 'api' },
  { pattern: /\bdocker\b/i, label: 'Docker', type: 'technology', tag: 'infrastructure' },
  { pattern: /\bkubernetes\b|\bk8s\b/i, label: 'Kubernetes', type: 'technology', tag: 'infrastructure' },
  { pattern: /\bterraform\b/i, label: 'Terraform', type: 'technology', tag: 'infrastructure' },
];

const VENDOR_PATTERNS: CanonicalPattern[] = [
  { pattern: /\baws\b|amazon web services/i, label: 'AWS', type: 'vendor', tag: 'cloud' },
  { pattern: /\bazure\b/i, label: 'Microsoft Azure', type: 'vendor', tag: 'cloud' },
  { pattern: /\bgcp\b|google cloud/i, label: 'Google Cloud', type: 'vendor', tag: 'cloud' },
  { pattern: /\bvercel\b/i, label: 'Vercel', type: 'vendor', tag: 'cloud' },
  { pattern: /\bcloudflare\b/i, label: 'Cloudflare', type: 'vendor', tag: 'cloud' },
  { pattern: /\bfirebase\b/i, label: 'Firebase', type: 'vendor', tag: 'platform' },
  { pattern: /\bsupabase\b/i, label: 'Supabase', type: 'vendor', tag: 'platform' },
  { pattern: /\bstripe\b/i, label: 'Stripe', type: 'vendor', tag: 'payments' },
  { pattern: /\btwilio\b/i, label: 'Twilio', type: 'vendor', tag: 'communications' },
  { pattern: /\bauth0\b/i, label: 'Auth0', type: 'vendor', tag: 'identity' },
  { pattern: /\bokta\b/i, label: 'Okta', type: 'vendor', tag: 'identity' },
  { pattern: /\bsalesforce\b/i, label: 'Salesforce', type: 'vendor', tag: 'crm' },
  { pattern: /\bsap\b/i, label: 'SAP', type: 'vendor', tag: 'erp' },
  { pattern: /\boracle\b/i, label: 'Oracle', type: 'vendor', tag: 'enterprise' },
  { pattern: /\bsendgrid\b/i, label: 'SendGrid', type: 'vendor', tag: 'communications' },
];

const COMPLIANCE_PATTERNS: CanonicalPattern[] = [
  { pattern: /\bgdpr\b/i, label: 'GDPR', type: 'compliance-regulation', tag: 'privacy' },
  { pattern: /\bhipaa\b/i, label: 'HIPAA', type: 'compliance-regulation', tag: 'health' },
  { pattern: /\bpci[\s-]?dss\b|\bpci\b/i, label: 'PCI DSS', type: 'compliance-regulation', tag: 'payments' },
  { pattern: /\bsoc\s?2\b/i, label: 'SOC 2', type: 'compliance-regulation', tag: 'security' },
  { pattern: /\biso[\s/]?(?:iec[\s/]?)?27001\b/i, label: 'ISO 27001', type: 'compliance-regulation', tag: 'security' },
  { pattern: /\blgpd\b/i, label: 'LGPD', type: 'compliance-regulation', tag: 'privacy' },
  { pattern: /\bccpa\b/i, label: 'CCPA', type: 'compliance-regulation', tag: 'privacy' },
  { pattern: /\bsolvencia?\s?(?:ii|2)\b|solvency\s?ii/i, label: 'Solvency II', type: 'compliance-regulation', tag: 'insurance' },
  { pattern: /\bsox\b|sarbanes/i, label: 'SOX', type: 'compliance-regulation', tag: 'financial' },
];

const COUNTRY_PATTERNS: CanonicalPattern[] = [
  { pattern: /\bm[eé]xico\b|\bmexico\b/i, label: 'México', type: 'country', tag: 'geography' },
  { pattern: /\bcolombia\b/i, label: 'Colombia', type: 'country', tag: 'geography' },
  { pattern: /\bchile\b/i, label: 'Chile', type: 'country', tag: 'geography' },
  { pattern: /\bper[uú]\b/i, label: 'Perú', type: 'country', tag: 'geography' },
  { pattern: /\bargentina\b/i, label: 'Argentina', type: 'country', tag: 'geography' },
  { pattern: /\bbrasil\b|\bbrazil\b/i, label: 'Brasil', type: 'country', tag: 'geography' },
  { pattern: /\bespa[ñn]a\b|\bspain\b/i, label: 'España', type: 'country', tag: 'geography' },
  { pattern: /\bestados unidos\b|\busa\b|\beeuu\b/i, label: 'Estados Unidos', type: 'country', tag: 'geography' },
];

const CANONICAL_PATTERNS: CanonicalPattern[] = [
  ...TECHNOLOGY_PATTERNS,
  ...VENDOR_PATTERNS,
  ...COMPLIANCE_PATTERNS,
  ...COUNTRY_PATTERNS,
];

/* --------------------------------------------------------------------- */
/* Keyword-class detectors                                               */
/* --------------------------------------------------------------------- */

interface KeywordDetector {
  type: ContextEntityType;
  /** Lowercase, accent-free cues. */
  keywords: string[];
  confidence: number;
}

/** Ordered: stronger / more specific classes first so the tag is meaningful. */
const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: 'non-functional-requirement',
    keywords: [
      'nfr', 'rendimiento', 'escalabilidad', 'disponibilidad', 'latencia',
      'throughput', 'sla', 'rto', 'rpo', 'concurren', 'tiempo de respuesta',
      'alta disponibilidad', 'observabilidad',
    ],
    confidence: 0.66,
  },
  {
    type: 'requirement',
    keywords: [
      'requisito', 'requerimiento', 'el sistema debe', 'la plataforma debe',
      'debe permitir', 'debe soportar', 'historia de usuario', 'caso de uso',
    ],
    confidence: 0.62,
  },
  {
    type: 'constraint',
    keywords: [
      'restriccion', 'limitacion', 'no puede', 'no debe', 'on-premise',
      'on premise', 'presupuesto', 'plazo limite', 'fecha limite',
      'solo se permite', 'unicamente', 'obligatorio',
    ],
    confidence: 0.64,
  },
  {
    type: 'assumption',
    keywords: ['supuesto', 'asumimos', 'se asume', 'damos por sentado', 'asumiendo que'],
    confidence: 0.6,
  },
  {
    type: 'decision',
    keywords: [
      'decision', 'decidimos', 'se decidio', 'se eligio', 'se acordo',
      'optamos por', 'adr', 'se descarto', 'elegimos',
    ],
    confidence: 0.68,
  },
  {
    type: 'risk',
    keywords: [
      'riesgo', 'amenaza', 'vulnerabilidad', 'fraude', 'fuga de datos',
      'incidente', 'caida', 'downtime', 'perdida de datos', 'cuello de botella',
    ],
    confidence: 0.65,
  },
  {
    type: 'integration',
    keywords: [
      'integracion', 'integra con', 'se integra', 'conecta con', 'webhook',
      'sso', 'oauth', 'oidc', 'saml', 'interfaz con', 'middleware', 'esb',
    ],
    confidence: 0.62,
  },
  {
    type: 'api',
    keywords: ['api', 'rest api', 'endpoint', 'servicio web', 'openapi', 'swagger'],
    confidence: 0.58,
  },
  {
    type: 'data-store',
    keywords: [
      'base de datos', 'data lake', 'datalake', 'data warehouse', 'datawarehouse',
      'almacen de datos', 'repositorio de datos', 'bucket', 'object storage',
    ],
    confidence: 0.6,
  },
  {
    type: 'data-entity',
    keywords: [
      'entidad de datos', 'modelo de datos', 'tabla', 'coleccion', 'poliza',
      'polizas', 'reclamacion', 'reclamaciones', 'siniestro', 'asegurado',
      'beneficiario', 'cobertura',
    ],
    confidence: 0.58,
  },
  {
    type: 'workflow',
    keywords: ['workflow', 'flujo de trabajo', 'orquestacion', 'bpm', 'proceso de negocio'],
    confidence: 0.6,
  },
  {
    type: 'process',
    keywords: ['proceso de', 'procesamiento', 'flujo de', 'pipeline', 'batch'],
    confidence: 0.56,
  },
  {
    type: 'business-capability',
    keywords: [
      'capacidad de negocio', 'capacidad', 'suscripcion', 'underwriting',
      'facturacion', 'gestion de polizas', 'gestion de reclamaciones',
      'experiencia del cliente',
    ],
    confidence: 0.58,
  },
  {
    type: 'external-platform',
    keywords: [
      'sistema core', 'core de polizas', 'core system', 'plataforma externa',
      'sistema externo', 'tercero', 'third-party', 'red hospitalaria',
      'pasarela de pagos', 'payment gateway', 'sistema legado', 'legacy',
    ],
    confidence: 0.62,
  },
  {
    type: 'application',
    keywords: [
      'aplicacion', 'microservicio', 'micro-servicio', 'frontend', 'backend',
      'app movil', 'aplicacion movil', 'portal', 'servicio de',
    ],
    confidence: 0.56,
  },
  {
    type: 'user-role',
    keywords: ['rol de', 'rol', 'roles', 'perfil de usuario', 'permiso de'],
    confidence: 0.6,
  },
  {
    type: 'actor',
    keywords: [
      'usuario', 'cliente', 'asegurado', 'administrador', 'operador',
      'arquitecto', 'desarrollador', 'analista', 'agente', 'corredor',
      'broker', 'medico', 'actuario', 'proveedor de salud',
    ],
    confidence: 0.6,
  },
];

/* --------------------------------------------------------------------- */
/* Extractor                                                             */
/* --------------------------------------------------------------------- */

const MAX_ARTIFACT_CONTENT_CHARS = 4000;

const collectAll = (regex: RegExp, text: string): RegExpExecArray[] => {
  const out: RegExpExecArray[] = [];
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    out.push(m);
  }
  return out;
};

/**
 * Word-boundary regex for a keyword cue, cached. The leading `\b` stops short
 * cues (`api`, `rol`, `sla`) matching inside unrelated words (`rápido`,
 * `control`); the optional `(?:e?s)?` tail still accepts Spanish/English
 * plurals (`microservicios`, `aplicaciones`, `roles`).
 */
const keywordRegexCache = new Map<string, RegExp>();
const keywordRegex = (keyword: string): RegExp => {
  const cached = keywordRegexCache.get(keyword);
  if (cached) return cached;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}(?:e?s)?\\b`);
  keywordRegexCache.set(keyword, re);
  return re;
};

export class ContextSignalExtractor {
  extract(input: ContextGraphInput): { signals: ContextSignal[]; sources: ContextSource[] } {
    const now = input.now ?? new Date().toISOString();
    const signals: ContextSignal[] = [];
    const sources: ContextSource[] = [];
    let sourceSeq = 0;
    let signalSeq = 0;

    const makeSource = (
      type: ContextSourceType,
      label: string,
      snippet: string,
      extra: Partial<ContextSource> = {},
    ): ContextSource => {
      const source: ContextSource = {
        id: `src-${++sourceSeq}`,
        type,
        label,
        snippet: truncate(snippet, 220),
        extractedAt: now,
        ...extra,
      };
      sources.push(source);
      return source;
    };

    const scan = (text: string, source: ContextSource): void => {
      if (!text || text.trim().length === 0) return;

      // Accent-stripped, lowercased copy. `stripAccents` preserves length, so
      // indices map 1:1 back onto `text` for `sentenceAround`.
      const searchText = stripAccents(text).toLowerCase();

      // 1) Canonical pattern entities (technology, vendor, compliance, country).
      for (const def of CANONICAL_PATTERNS) {
        for (const match of collectAll(def.pattern, searchText)) {
          signals.push({
            id: `sig-${++signalSeq}`,
            kind: 'entity',
            text: match[0],
            label: def.label,
            entityType: def.type,
            mode: 'explicit',
            confidence: 0.85,
            source,
            extractedAt: now,
            tags: [def.tag],
          });
        }
      }

      // 2) Keyword-class entities. Each class fires at most once per text so a
      //    single bullet does not flood the graph with near-duplicate signals.
      for (const detector of KEYWORD_DETECTORS) {
        let hitKeyword: string | undefined;
        let hitIndex = -1;
        for (const keyword of detector.keywords) {
          const match = keywordRegex(keyword).exec(searchText);
          if (match && (hitIndex === -1 || match.index < hitIndex)) {
            hitIndex = match.index;
            hitKeyword = keyword;
          }
        }
        if (hitKeyword === undefined) continue;
        const sentence = sentenceAround(text, hitIndex) || text;
        signals.push({
          id: `sig-${++signalSeq}`,
          kind: 'entity',
          text: truncate(sentence, 120),
          label: truncate(sentence, 120),
          entityType: detector.type,
          mode: 'explicit',
          confidence: detector.confidence,
          source,
          extractedAt: now,
          tags: [hitKeyword],
        });
      }
    };

    // --- Project anchor: the project itself is the root system. -----------
    if (input.projectName && input.projectName.trim().length > 0) {
      const nameSource = makeSource('artifact-name', 'Nombre del proyecto', input.projectName);
      signals.push({
        id: `sig-${++signalSeq}`,
        kind: 'entity',
        text: input.projectName.trim(),
        label: input.projectName.trim(),
        entityType: 'system',
        mode: 'explicit',
        confidence: 0.95,
        source: nameSource,
        extractedAt: now,
        tags: ['root-system'],
      });
    }

    if (input.projectDescription) {
      scan(input.projectDescription, makeSource('project-description', 'Descripción del proyecto', input.projectDescription));
    }
    (input.projectContext ?? []).forEach((entry, idx) => {
      scan(entry, makeSource('project-context', `Contexto del proyecto #${idx + 1}`, entry, { scope: 'project' }));
    });
    (input.agentMemory ?? []).forEach((entry, idx) => {
      scan(entry, makeSource('agent-memory', `Memoria del agente #${idx + 1}`, entry, { scope: 'agent' }));
    });
    (input.initialCapture ?? []).forEach((entry, idx) => {
      scan(entry, makeSource('initial-capture', `Captura inicial #${idx + 1}`, entry, { scope: 'initial-capture' }));
    });
    (input.globalContext ?? []).forEach((entry, idx) => {
      scan(entry, makeSource('global-context', `Contexto global #${idx + 1}`, entry, { scope: 'global' }));
    });

    (input.artifacts ?? []).forEach((artifact: Artifact) => {
      const baseExtra = { artifactId: artifact.id, scope: 'artifact' as const, updatedAt: artifact.createdAt };
      if (artifact.name) {
        scan(artifact.name, makeSource('artifact-name', `Nombre del artefacto: ${artifact.name}`, artifact.name, baseExtra));
      }
      if (artifact.objective) {
        scan(artifact.objective, makeSource('artifact-objective', `Objetivo de: ${artifact.name}`, artifact.objective, baseExtra));
      }
      if (artifact.content) {
        scan(
          artifact.content.slice(0, MAX_ARTIFACT_CONTENT_CHARS),
          makeSource('artifact-content', `Contenido de: ${artifact.name}`, artifact.content, baseExtra),
        );
      }
      (artifact.keyConcepts ?? []).forEach((kc) => {
        if (!kc.term) return;
        const conceptSource = makeSource(
          'artifact-key-concept',
          `Concepto clave: ${kc.term}`,
          `${kc.term}: ${kc.definition}`,
          baseExtra,
        );
        scan(`${kc.term}. ${kc.definition}`, conceptSource);
        // The named concept is itself a business-capability candidate.
        signals.push({
          id: `sig-${++signalSeq}`,
          kind: 'entity',
          text: kc.term.trim(),
          label: kc.term.trim(),
          entityType: 'business-capability',
          mode: 'explicit',
          confidence: 0.55,
          source: conceptSource,
          extractedAt: now,
          tags: ['key-concept'],
        });
      });
      (artifact.artifactMemory ?? []).forEach((entry, idx) => {
        scan(
          entry,
          makeSource('artifact-memory', `Memoria del artefacto ${artifact.name} #${idx + 1}`, entry, baseExtra),
        );
      });
    });

    if (input.requestContext) {
      const rc = input.requestContext;
      const rcText = [
        rc.userRequest,
        rc.rationale,
        rc.matchedCatalogTemplateName,
        ...(rc.constructionPlan ?? []),
      ]
        .filter((v): v is string => Boolean(v))
        .join('. ');
      if (rcText.trim().length > 0) {
        scan(rcText, makeSource('request-context', 'Contexto de la solicitud (on-demand)', rcText));
      }
    }

    return { signals, sources };
  }
}

export const contextSignalExtractor = new ContextSignalExtractor();
