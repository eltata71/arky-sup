/**
 * Contract validation.
 *
 * Evaluates an artifact against its resolved {@link ArtifactContract} and
 * returns structured findings. Document/SDD contracts get strict section and
 * structure checks; diagram contracts delegate quality scoring to the existing
 * diagram quality gate and only verify that a renderable diagram exists.
 */

import type { Artifact } from '../../../types';
import type { ArtifactContract } from '../ArtifactContract';
import type { CompilerIssue, CompilerIssueSeverity } from '../ArtifactCompilerTypes';
import { analyzeDocumentStructure, isSectionPresent, type DocumentStructure } from './sectionValidator';

export interface ContractValidationResult {
  issues: CompilerIssue[];
  /** Document structure snapshot; `null` for diagram-only contracts. */
  structure: DocumentStructure | null;
  /** Whether a renderable diagram payload (IR or content) is present. */
  hasDiagram: boolean;
}

const issue = (
  id: string,
  code: string,
  severity: CompilerIssueSeverity,
  source: CompilerIssue['source'],
  message: string,
  recommendation: string,
  extra: Partial<Pick<CompilerIssue, 'dimension' | 'autoFixable'>> = {},
): CompilerIssue => ({ id, code, severity, source, message, recommendation, ...extra });

const hasRenderableDiagram = (artifact: Artifact): boolean => {
  if ((artifact.ir?.nodes?.length ?? 0) > 0) return true;
  const content = (artifact.content ?? '').trim();
  if (!content) return false;
  // A mermaid/diagram artifact keeps its diagram syntax in `content` until the
  // deterministic pipeline materialises the IR at render time.
  return /\b(graph|flowchart|sequenceDiagram|erDiagram|stateDiagram|gantt|classDiagram|C4Context|C4Container)\b/.test(
    content,
  ) || content.length > 0;
};

const validateDiagramContract = (artifact: Artifact): ContractValidationResult => {
  const issues: CompilerIssue[] = [];
  const hasDiagram = hasRenderableDiagram(artifact);
  if (!hasDiagram) {
    issues.push(
      issue(
        'contract.diagram.empty',
        'CONTRACT_DIAGRAM_EMPTY',
        'critical',
        'diagram',
        'El artefacto de diagrama no tiene contenido renderizable.',
        'Genera el diagrama o revisa el pipeline determinístico antes de persistir.',
      ),
    );
  }
  return { issues, structure: null, hasDiagram };
};

const validateDocumentContract = (
  artifact: Artifact,
  contract: ArtifactContract,
): ContractValidationResult => {
  const content = artifact.content ?? '';
  const structure = analyzeDocumentStructure(content);
  const issues: CompilerIssue[] = [];
  const hasDiagram = hasRenderableDiagram(artifact);

  // ── Empty / thin content ───────────────────────────────────────────────
  if (structure.wordCount === 0) {
    issues.push(
      issue(
        'contract.content.empty',
        'CONTRACT_EMPTY',
        'critical',
        'contract',
        'El artefacto no tiene contenido textual.',
        'Genera o pega contenido antes de compilar y persistir.',
        { dimension: 'completitud' },
      ),
    );
    return { issues, structure, hasDiagram };
  }
  if (structure.wordCount < Math.ceil(contract.minWordCount / 3)) {
    issues.push(
      issue(
        'contract.content.too-thin',
        'CONTRACT_THIN_CONTENT',
        'high',
        'contract',
        `El contenido es insuficiente (${structure.wordCount} palabras; mínimo recomendado ${contract.minWordCount}).`,
        'Desarrolla las secciones clave hasta alcanzar contenido profesional.',
        { dimension: 'completitud' },
      ),
    );
  } else if (structure.wordCount < contract.minWordCount) {
    issues.push(
      issue(
        'contract.content.thin',
        'CONTRACT_THIN_CONTENT',
        'medium',
        'contract',
        `El contenido está por debajo del mínimo recomendado (${structure.wordCount}/${contract.minWordCount} palabras).`,
        'Amplía las secciones con detalle accionable.',
        { dimension: 'completitud' },
      ),
    );
  }

  // ── Title / headings ───────────────────────────────────────────────────
  if (contract.rules.requireTitle && structure.h1Count === 0) {
    issues.push(
      issue(
        'contract.title.missing',
        'CONTRACT_NO_TITLE',
        'medium',
        'structure',
        'Falta un título principal (encabezado H1).',
        'Agrega un encabezado # con el nombre del artefacto al inicio.',
        { dimension: 'estructura', autoFixable: true },
      ),
    );
  }
  if (contract.rules.requireHeadings && structure.headingCount === 0) {
    issues.push(
      issue(
        'contract.headings.missing',
        'CONTRACT_NO_HEADINGS',
        'high',
        'structure',
        'El documento no tiene encabezados.',
        'Estructura el contenido con encabezados ## por sección.',
        { dimension: 'estructura', autoFixable: true },
      ),
    );
  }
  if (structure.duplicateHeadings.length > 0) {
    issues.push(
      issue(
        'contract.headings.duplicate',
        'CONTRACT_DUPLICATE_HEADINGS',
        'low',
        'structure',
        `Hay encabezados duplicados: ${structure.duplicateHeadings.join(', ')}.`,
        'Unifica o renombra los encabezados repetidos para evitar ambigüedad.',
        { dimension: 'estructura', autoFixable: true },
      ),
    );
  }

  // ── Contract sections ──────────────────────────────────────────────────
  for (const sectionSpec of contract.sections) {
    const present = isSectionPresent(content, structure, sectionSpec.keywords);
    if (present) continue;
    const isRequired = sectionSpec.requirement === 'required';
    const severity: CompilerIssueSeverity = isRequired
      ? sectionSpec.severity ?? 'high'
      : 'low';
    issues.push(
      issue(
        `contract.section.${sectionSpec.id}.missing`,
        isRequired ? 'CONTRACT_MISSING_SECTION' : 'CONTRACT_MISSING_OPTIONAL_SECTION',
        severity,
        'contract',
        `${isRequired ? 'Falta' : 'Se recomienda'} la sección "${sectionSpec.label}".`,
        `Agrega un encabezado dedicado a ${sectionSpec.label.toLowerCase()} con contenido accionable.`,
        { dimension: 'cumplimiento-contrato', autoFixable: Boolean(sectionSpec.repairTemplate) },
      ),
    );
  }

  // ── Empty sections ─────────────────────────────────────────────────────
  if (structure.emptySectionCount > 0) {
    issues.push(
      issue(
        'contract.section.empty',
        'CONTRACT_EMPTY_SECTION',
        'medium',
        'structure',
        `${structure.emptySectionCount} sección(es) tienen encabezado pero no contenido real.`,
        'Completa el contenido de las secciones vacías o elimínalas.',
        { dimension: 'completitud' },
      ),
    );
  }

  // ── Placeholders ───────────────────────────────────────────────────────
  if (contract.rules.forbidPlaceholders && structure.hardPlaceholderCount > 0) {
    issues.push(
      issue(
        'contract.placeholder.hard',
        'CONTRACT_HARD_PLACEHOLDER',
        'medium',
        'structure',
        `Se encontraron ${structure.hardPlaceholderCount} marcador(es) TBD/TODO/FIXME sin resolver.`,
        'Resuelve o elimina los marcadores antes de presentar o exportar.',
        { dimension: 'consistencia', autoFixable: true },
      ),
    );
  }
  if (structure.controlledPlaceholderCount > 0) {
    issues.push(
      issue(
        'contract.placeholder.pending',
        'CONTRACT_PENDING_SECTIONS',
        'low',
        'structure',
        `Hay ${structure.controlledPlaceholderCount} marcador(es) "_Pendiente_" que requieren completarse.`,
        'Reemplaza los marcadores pendientes con contenido definitivo y solicita revisión humana.',
        { dimension: 'completitud' },
      ),
    );
  }

  // ── Malformed lists ────────────────────────────────────────────────────
  if (structure.malformedListLineCount > 0) {
    issues.push(
      issue(
        'contract.lists.malformed',
        'CONTRACT_MALFORMED_LIST',
        'low',
        'structure',
        `${structure.malformedListLineCount} línea(s) parecen listas mal formadas.`,
        'Usa "- " o "1. " al inicio de cada elemento de lista.',
        { dimension: 'estructura', autoFixable: true },
      ),
    );
  }

  // ── Tables ─────────────────────────────────────────────────────────────
  if (contract.rules.expectsTables && structure.tableCount === 0) {
    issues.push(
      issue(
        'contract.tables.missing',
        'CONTRACT_MISSING_TABLE',
        'high',
        'structure',
        'El artefacto se esperaba con al menos una tabla y no se detectó ninguna.',
        'Agrega una tabla Markdown con encabezados y filas de datos.',
        { dimension: 'completitud', autoFixable: true },
      ),
    );
  }

  // ── Gherkin (BDD) ──────────────────────────────────────────────────────
  if (contract.rules.expectsGherkin) {
    if (!structure.hasGherkin) {
      issues.push(
        issue(
          'contract.gherkin.missing',
          'CONTRACT_MISSING_GHERKIN',
          'high',
          'contract',
          'No se detectaron escenarios Gherkin (Given / When / Then).',
          'Escribe los escenarios con la estructura Given/When/Then.',
          { dimension: 'cumplimiento-contrato', autoFixable: true },
        ),
      );
    } else if (!structure.hasMultipleScenarios) {
      issues.push(
        issue(
          'contract.gherkin.single',
          'CONTRACT_BDD_SINGLE_SCENARIO',
          'medium',
          'contract',
          'Sólo se detectó un escenario; faltan casos positivos y negativos.',
          'Agrega escenarios de éxito y de error/excepción.',
          { dimension: 'completitud' },
        ),
      );
    }
  }

  // ── Traceability matrix ────────────────────────────────────────────────
  if (contract.rules.expectsTraceabilityTable && structure.tableCount === 0) {
    issues.push(
      issue(
        'contract.traceability.missing',
        'CONTRACT_MISSING_TRACEABILITY',
        'high',
        'contract',
        'La matriz de trazabilidad no contiene una tabla de cobertura.',
        'Agrega una tabla con requisito, fuente, artefacto, caso de prueba, estado y cobertura.',
        { dimension: 'trazabilidad', autoFixable: true },
      ),
    );
  }

  // ── Hybrid: diagram expected ───────────────────────────────────────────
  if (contract.representation === 'hybrid' && !hasDiagram) {
    issues.push(
      issue(
        'contract.hybrid.no-diagram',
        'CONTRACT_HYBRID_NO_DIAGRAM',
        'medium',
        'diagram',
        'El artefacto híbrido no incluye un diagrama renderizable.',
        'Agrega el diagrama Mermaid/ReactFlow que acompaña a la narrativa.',
        { dimension: 'completitud' },
      ),
    );
  }

  return { issues, structure, hasDiagram };
};

/** Validate an artifact against its contract. Never throws. */
export const validateAgainstContract = (
  artifact: Artifact,
  contract: ArtifactContract,
): ContractValidationResult => {
  if (contract.representation === 'diagram') {
    return validateDiagramContract(artifact);
  }
  return validateDocumentContract(artifact, contract);
};
