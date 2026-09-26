import type { Artifact } from '../../../lib/artifacts';
import { buildAccessibleSummary } from '../../diagram/accessibleSummary';
import { extractMermaid } from '../../../utils/diagram/extractMermaid';
import {
  getYamlScalar,
  hasYamlEntries,
  readYamlStructure,
  type YamlNode,
} from './yamlStructure';

/**
 * ADR sections, with the spellings a real document uses. English and Spanish
 * are both accepted: the app's UI language is Spanish, so demanding English
 * headings failed valid artifacts.
 */
/** User-facing reason for each way Mermaid extraction can fail. */
const UNRENDERABLE_REASONS: Record<'empty' | 'no-fence' | 'fence-without-mermaid' | 'fence-empty' | 'no-header', string> = {
  empty: 'El diagrama está vacío.',
  'no-fence': 'No se encontró un bloque de diagrama en el contenido.',
  'fence-without-mermaid': 'El bloque de código no declara mermaid.',
  'fence-empty': 'El bloque mermaid está vacío.',
  'no-header': 'El contenido no declara un tipo de diagrama Mermaid válido.',
};

const ADR_SECTIONS = {
  status: {
    code: 'ADR_MISSING_STATUS',
    message: 'Falta la sección Status / Estado.',
    accepted: ['status', 'estado'],
  },
  context: {
    code: 'ADR_MISSING_CONTEXT',
    message: 'Falta la sección Context / Contexto.',
    accepted: ['context', 'contexto'],
  },
  decision: {
    code: 'ADR_MISSING_DECISION',
    message: 'Falta la sección Decision / Decisión.',
    accepted: ['decision', 'decision tomada', 'decisions'],
  },
  consequences: {
    code: 'ADR_MISSING_CONSEQUENCES',
    message: 'Falta la sección Consequences / Consecuencias.',
    accepted: ['consequences', 'consecuencias'],
  },
} as const;

export type OfficeValidatorId =
  | 'adr'
  | 'openapi'
  | 'asyncapi'
  | 'c4'
  | 'threat-model'
  | 'erd'
  | 'cost-model'
  | 'software-design'
  | 'manifest'
  | 'renderable-diagram'
  | 'diagram-accessibility';

export interface OfficeValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface OfficeValidatorResult {
  validatorId: OfficeValidatorId;
  passed: boolean;
  issues: OfficeValidationIssue[];
}

export interface OfficeArtifactValidationReport {
  artifactId: string;
  blocking: boolean;
  results: OfficeValidatorResult[];
  evaluatedAt: string;
}

interface OfficeValidator {
  id: OfficeValidatorId;
  applies: (artifact: Artifact) => boolean;
  validate: (artifact: Artifact) => OfficeValidationIssue[];
}

const lower = (artifact: Artifact): string => `${artifact.name}\n${artifact.objective}\n${artifact.content}`.toLowerCase();
const issue = (code: string, message: string, severity: 'error' | 'warning' = 'error'): OfficeValidationIssue => ({ code, message, severity });
const diagramArtifact = (artifact: Artifact): boolean => artifact.representation !== 'document' || artifact.type.startsWith('mermaid') || artifact.type === 'react-flow-graph';

/**
 * Markdown headings declared in the document, normalized (accent-folded,
 * lowercased, `#` markers stripped).
 *
 * `content.includes('## status')` matched the phrase anywhere — inside a
 * paragraph, a table cell, or a fenced code block — and missed a perfectly
 * valid `### Status` or a Spanish `## Estado`. Reading the headings answers the
 * question the validator is actually asking.
 */
const documentHeadings = (content: string): Set<string> => {
  const headings = new Set<string>();
  let inFence = false;
  for (const rawLine of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(rawLine)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(rawLine);
    if (!match) continue;
    headings.add(
      match[1]
        .replace(/[*_`]/g, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase(),
    );
  }
  return headings;
};

/** True when any of the accepted spellings appears as a heading. */
const hasHeading = (headings: ReadonlySet<string>, accepted: readonly string[]): boolean =>
  accepted.some((candidate) => headings.has(candidate));

/** Reads the YAML mapping tree once per validation, lazily. */
const yamlOf = (artifact: Artifact): YamlNode => readYamlStructure(artifact.content);

/** A YAML artifact whose *document root* declares the given spec key. */
const declaresSpecKey = (artifact: Artifact, key: string): boolean => {
  if (artifact.type !== 'yaml') return false;
  return getYamlScalar(yamlOf(artifact), key) !== undefined;
};

export const OFFICE_VALIDATORS: readonly OfficeValidator[] = Object.freeze([
  {
    id: 'adr',
    // Detect by name *or* by shape: renaming an ADR must not stop it being
    // validated as one.
    applies: (artifact) => {
      if (/(^|\b)adr[-\s]/i.test(artifact.name)) return true;
      if (artifact.representation === 'diagram') return false;
      const headings = documentHeadings(artifact.content);
      return hasHeading(headings, ADR_SECTIONS.decision.accepted)
        && hasHeading(headings, ADR_SECTIONS.status.accepted);
    },
    validate: (artifact) => {
      const headings = documentHeadings(artifact.content);
      return Object.values(ADR_SECTIONS)
        .filter((section) => !hasHeading(headings, section.accepted))
        .map((section) => issue(section.code, section.message));
    },
  },
  {
    id: 'openapi',
    // The document must *declare* a root `openapi` key. Merely mentioning the
    // word in a title or a description is not an OpenAPI contract.
    applies: (artifact) => declaresSpecKey(artifact, 'openapi'),
    validate: (artifact) => {
      const tree = yamlOf(artifact);
      const issues: OfficeValidationIssue[] = [];
      const version = getYamlScalar(tree, 'openapi') ?? '';
      if (!/^3\.1(?:\.\d+)?$/.test(version)) {
        issues.push(issue('OPENAPI_VERSION', `Debe usar OpenAPI 3.1 (declara "${version || 'nada'}").`));
      }
      const missing = (['info.title', 'info.version'] as const)
        .filter((path) => getYamlScalar(tree, path) === undefined);
      if (!hasYamlEntries(tree, 'paths')) missing.push('paths' as never);
      if (missing.length > 0) {
        issues.push(issue('OPENAPI_STRUCTURE', `Faltan o están vacíos: ${missing.join(', ')}.`));
      }
      if (!hasYamlEntries(tree, 'components.securitySchemes')) {
        issues.push(issue('OPENAPI_SECURITY', 'Falta components.securitySchemes con al menos un esquema.'));
      }
      return issues;
    },
  },
  {
    id: 'asyncapi',
    applies: (artifact) => declaresSpecKey(artifact, 'asyncapi'),
    validate: (artifact) => {
      const tree = yamlOf(artifact);
      const issues: OfficeValidationIssue[] = [];
      const version = getYamlScalar(tree, 'asyncapi') ?? '';
      if (!/^3\.0(?:\.\d+)?$/.test(version)) {
        issues.push(issue('ASYNCAPI_VERSION', `Debe usar AsyncAPI 3.0 (declara "${version || 'nada'}").`));
      }
      const missing = (['info.title', 'info.version'] as const)
        .filter((path) => getYamlScalar(tree, path) === undefined);
      if (!hasYamlEntries(tree, 'channels')) missing.push('channels' as never);
      if (missing.length > 0) {
        issues.push(issue('ASYNCAPI_STRUCTURE', `Faltan o están vacíos: ${missing.join(', ')}.`));
      }
      return issues;
    },
  },
  {
    id: 'c4',
    applies: (artifact) => artifact.type.startsWith('mermaid-c4-'),
    validate: (artifact) => {
      const expected = artifact.type.replace('mermaid-', '').replace(/(^|-)(\w)/g, (_match, _dash: string, letter: string) => letter.toUpperCase());
      // The dialect has to *open a line* — Mermaid reads it as a directive.
      // Matching anywhere let a mention inside a title or a note pass.
      const declaresDialect = new RegExp(`^\\s*${expected}\\b`, 'mi').test(artifact.content);
      return declaresDialect
        ? []
        : [issue('C4_DIALECT', `El artefacto no declara el dialecto ${expected} al inicio de una línea.`)];
    },
  },
  {
    id: 'threat-model',
    applies: (artifact) => /threat model|modelo de amenazas|stride/i.test(lower(artifact)),
    validate: (artifact) => {
      const value = lower(artifact);
      const categories = ['spoofing', 'tampering', 'repudiation', 'information disclosure', 'denial of service', 'elevation of privilege'];
      const missing = categories.filter((category) => !value.includes(category));
      const issues = missing.length > 0 ? [issue('THREAT_STRIDE_COVERAGE', `Faltan categorías STRIDE: ${missing.join(', ')}.`)] : [];
      if (!/mitig|control|contramedida/i.test(value)) issues.push(issue('THREAT_MITIGATIONS', 'Faltan mitigaciones verificables.'));
      return issues;
    },
  },
  {
    id: 'erd',
    applies: (artifact) => artifact.type === 'mermaid-erd' || /modelo de dominio|erd/i.test(artifact.name),
    validate: (artifact) => artifact.content.includes('erDiagram') || artifact.ir?.nodes?.length
      ? []
      : [issue('ERD_STRUCTURE', 'Falta un erDiagram o DiagramIR con entidades.')],
  },
  {
    id: 'cost-model',
    applies: (artifact) => /cost model|modelo de costos/i.test(lower(artifact)),
    validate: (artifact) => /monthly|mensual|annual|anual|usd|\$/i.test(artifact.content)
      ? []
      : [issue('COST_TOTAL', 'Faltan totales y moneda del modelo de costos.')],
  },
  {
    id: 'software-design',
    applies: (artifact) => /software design|diseño de software/i.test(lower(artifact)),
    validate: (artifact) => /component|componente/i.test(artifact.content) && /nfr|requisito no funcional/i.test(artifact.content)
      ? []
      : [issue('SOFTWARE_DESIGN_CONTENT', 'Faltan componentes o NFR medibles.')],
  },
  {
    id: 'manifest',
    applies: (artifact) => /manifest|manifiesto de entrega/i.test(lower(artifact)),
    validate: (artifact) => /version|versión/i.test(artifact.content) && /evidence|evidencia/i.test(artifact.content)
      ? []
      : [issue('MANIFEST_EVIDENCE', 'El manifest debe incluir versión y evidencia.')],
  },
  {
    id: 'renderable-diagram',
    applies: diagramArtifact,
    /**
     * "Renderable" now means the content actually resolves to something a
     * renderer can consume: a populated DiagramIR, extractable Mermaid, or —
     * for ReactFlow graphs — parseable JSON with nodes. Previously any
     * non-empty string passed, so a paragraph of prose counted as a diagram.
     */
    validate: (artifact) => {
      if ((artifact.ir?.nodes?.length ?? 0) > 0) return [];

      if (artifact.type === 'react-flow-graph') {
        try {
          const parsed = JSON.parse(artifact.content) as { nodes?: unknown };
          if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) return [];
        } catch {
          // Falls through to the failure below with a precise reason.
        }
        return [issue('DIAGRAM_EMPTY', 'El grafo ReactFlow no contiene JSON con nodos.')];
      }

      const extracted = extractMermaid(artifact.content, artifact.representation);
      if (extracted.ok === true) return [];
      return [issue('DIAGRAM_EMPTY', UNRENDERABLE_REASONS[extracted.reason])];
    },
  },
  {
    id: 'diagram-accessibility',
    applies: diagramArtifact,
    validate: (artifact) => {
      const value = lower(artifact);
      if (/descripci[oó]n textual|accessible summary|resumen accesible|narrativa/i.test(value)) return [];
      if (artifact.ir && artifact.ir.nodes.length > 0) {
        const summary = buildAccessibleSummary(artifact.ir);
        if (summary.fullText.trim().length > 0) return [];
      }
      return [issue('DIAGRAM_TEXT_ALTERNATIVE', 'Falta una descripción textual accesible o DiagramIR utilizable.')];
    },
  },
]);

export const validateOfficeArtifact = (artifact: Artifact): OfficeArtifactValidationReport => {
  const results = OFFICE_VALIDATORS
    .filter((validator) => validator.applies(artifact))
    .map((validator): OfficeValidatorResult => {
      const issues = validator.validate(artifact);
      return {
        validatorId: validator.id,
        passed: !issues.some((current) => current.severity === 'error'),
        issues,
      };
    });
  return {
    artifactId: artifact.id,
    blocking: results.some((result) => !result.passed),
    results,
    evaluatedAt: new Date().toISOString(),
  };
};
