import { marked } from 'marked';
import type {
  ArtifactPresentationModel,
  ArtifactPresentationDiagram,
  ArtifactPresentationTable,
  PublicationExportMode,
} from '../../lib/artifacts/artifactPresentationModel';
import { escapeHtml, stripMarkdown } from './utils/text';

export type { PublicationExportMode } from '../../lib/artifacts/artifactPresentationModel';

/** Structured table consumed by CSV/XLSX adapters and the publication renderer. */
export interface NormalizedPresentationTable {
  title: string;
  headers: string[];
  rows: string[][];
  completeness?: number;
  readingNotes?: string[];
}

const clean = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
const list = (items: string[]): string =>
  items.filter((item) => clean(item).length > 0).map((item) => `- ${clean(item)}`).join('\n');

const mdTable = (table: NormalizedPresentationTable): string => {
  if (table.headers.length === 0) return '';
  const rows = table.rows.length > 0 ? table.rows : [table.headers.map(() => '')];
  return [
    `| ${table.headers.join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${table.headers.map((_, index) => clean(row[index]).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
};

const tableSafe = (table: ArtifactPresentationTable): NormalizedPresentationTable => ({
  title: table.title || 'Tabla de publicación',
  headers: table.headers.map((header, index) => clean(header) || `Columna ${index + 1}`),
  rows: table.rows.map((row) => table.headers.map((_, index) => clean(row[index]))),
  completeness: table.completeness,
  readingNotes: table.readingNotes,
});

/**
 * Normalises a publication mode. `undefined` and the legacy `original` value
 * collapse to `publication` so callers stay backward compatible.
 */
export const resolvePublicationExportMode = (mode?: PublicationExportMode): PublicationExportMode =>
  mode && mode !== 'original' ? mode : 'publication';

/**
 * Extracts normalised tables for a given publication mode. Diagram-oriented
 * slices never surface standalone tables, so the same model can feed CSV/XLSX
 * (`table-only`) and document exports without duplicating content.
 */
export function extractPresentationTables(
  model: ArtifactPresentationModel,
  mode?: PublicationExportMode,
): NormalizedPresentationTable[] {
  const resolved = resolvePublicationExportMode(mode);
  if (resolved === 'diagram-only' || resolved === 'document-diagram') return [];
  return model.tables
    .filter((table) => table.headers.length > 0 && table.rows.length > 0)
    .map(tableSafe);
}

const completenessNote = (table: NormalizedPresentationTable): string | null =>
  typeof table.completeness === 'number'
    ? `\n_Completitud de la tabla: ${Math.round(table.completeness * 100)}%._`
    : null;

// ── Block builders (leading "\n" reserved for section spacing) ──────────────

const pushCover = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  lines.push('\n## Portada lógica');
  lines.push(`- **Artefacto:** ${model.artifactName}`);
  lines.push(`- **Tipo:** ${model.artifactType}`);
  lines.push(`- **Audiencia:** ${model.audience}`);
  lines.push(`- **Modo:** ${model.mode}`);
  lines.push(`- **Estado:** ${model.quality.readyForPublication ? 'Listo para publicación' : 'Requiere revisión'}`);
  lines.push(`- **Score de presentación:** ${model.quality.score}/100`);
  lines.push(`- **Compilador:** ${model.compilerVersion}`);
  lines.push(`- **Compilado:** ${model.updatedAt}`);
};

const pushMinimalMeta = (lines: Array<string | null>, model: ArtifactPresentationModel, label: string): void => {
  lines.push(`\n## ${label}`);
  lines.push(`- **Artefacto:** ${model.artifactName}`);
  lines.push(`- **Tipo:** ${model.artifactType}`);
  lines.push(`- **Audiencia:** ${model.audience}`);
  lines.push(`- **Compilador:** ${model.compilerVersion}`);
  lines.push(`- **Compilado:** ${model.updatedAt}`);
};

const pushPublicationStatus = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  const { quality } = model;
  if (quality.blockers.length === 0 && quality.warnings.length === 0 && quality.recommendations.length === 0) return;
  lines.push('\n## Estado de publicación');
  lines.push(`- **Score:** ${quality.score}/100`);
  lines.push(`- **Listo para publicación:** ${quality.readyForPublication ? 'sí' : 'no'}`);
  if (quality.blockers.length > 0) lines.push('\n### Bloqueadores', list(quality.blockers));
  if (quality.warnings.length > 0) lines.push('\n### Advertencias', list(quality.warnings));
  if (quality.recommendations.length > 0) lines.push('\n### Recomendaciones', list(quality.recommendations));
};

const pushSections = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  model.sections.forEach((section) => {
    const level = '#'.repeat(Math.min(section.level + 1, 4));
    lines.push(`\n${level} ${section.title}`, section.content || '_Sin contenido detallado._');
  });
};

const pushDiagrams = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  model.diagrams.forEach((diagram, index) => {
    lines.push(`\n## Diagrama ${index + 1}: ${diagram.title}`);
    lines.push(`\n**Propósito:** ${diagram.purpose}`);
    if (diagram.executiveSummary) lines.push(`\n**Resumen ejecutivo:** ${diagram.executiveSummary}`);
    if (diagram.technicalSummary) lines.push(`\n**Resumen técnico:** ${diagram.technicalSummary}`);
    lines.push(`\n**Métricas:** ${diagram.nodeCount} nodos · ${diagram.edgeCount} relaciones · densidad ${diagram.density} · orientación ${diagram.orientation} · exportSafe ${diagram.exportSafe ? 'sí' : 'no'}.`);
    if (diagram.legend.length > 0) lines.push('\n### Leyenda', list(diagram.legend.map((item) => `${item.label}: ${item.meaning}`)));
    if (diagram.readingNotes.length > 0) lines.push('\n### Notas de lectura', list(diagram.readingNotes));
    if (diagram.mermaid) lines.push('\n```mermaid', diagram.mermaid.trim(), '```');
    else lines.push('\n> No existe código Mermaid renderizable; se conserva descripción textual para evitar una exportación engañosa.');
  });
};

const pushTables = (lines: Array<string | null>, model: ArtifactPresentationModel, mode: PublicationExportMode): void => {
  extractPresentationTables(model, mode).forEach((table) => {
    lines.push(`\n## ${table.title}`, mdTable(table));
    const note = completenessNote(table);
    if (note) lines.push(note);
    if (table.readingNotes && table.readingNotes.length > 0) lines.push('\n### Notas de lectura', list(table.readingNotes));
  });
};

const pushCallouts = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  if (model.decisions.length > 0) lines.push('\n## Decisiones', list(model.decisions.map((item) => `${item.title}: ${item.content}`)));
  if (model.risks.length > 0) lines.push('\n## Riesgos', list(model.risks.map((item) => `${item.title}: ${item.content}`)));
  if (model.assumptions.length > 0) lines.push('\n## Supuestos', list(model.assumptions.map((item) => `${item.title}: ${item.content}`)));
};

const pushCompilerMeta = (lines: Array<string | null>, model: ArtifactPresentationModel, mode: PublicationExportMode): void => {
  lines.push(
    '\n## Metadatos de compilación',
    `- **Modo de publicación:** ${mode}`,
    `- **Modelo presentación:** ${model.id}`,
    `- **Creado:** ${model.createdAt}`,
    `- **Actualizado:** ${model.updatedAt}`,
    `- **Formatos recomendados:** ${model.exportProfile.recommendedFormats.join(', ') || 'N/A'}`,
  );
};

const visualWarnings = (model: ArtifactPresentationModel): string[] =>
  model.quality.warnings.filter((warning) => /diagrama|visual|leyenda|nodo|arista/i.test(warning));

const tableWarnings = (model: ArtifactPresentationModel): string[] =>
  model.quality.warnings.filter((warning) => /tabla|matriz|completitud|columna/i.test(warning));

// ── Per-mode assembly ───────────────────────────────────────────────────────

const buildPublication = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  pushCover(lines, model);
  if (model.purpose) lines.push('\n## Propósito', model.purpose);
  if (model.scope) lines.push('\n## Alcance', model.scope);
  if (model.executiveSummary) lines.push('\n## Resumen ejecutivo', model.executiveSummary);
  pushPublicationStatus(lines, model);
  pushSections(lines, model);
  pushDiagrams(lines, model);
  pushTables(lines, model, 'publication');
  pushCallouts(lines, model);
  if (model.nextSteps.length > 0) lines.push('\n## Próximos pasos', list(model.nextSteps));
  if (model.traceability.length > 0) lines.push('\n## Trazabilidad', list(model.traceability));
  pushCompilerMeta(lines, model, 'publication');
};

const buildDocumentDiagram = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  pushCover(lines, model);
  if (model.purpose) lines.push('\n## Propósito', model.purpose);
  if (model.scope) lines.push('\n## Alcance', model.scope);
  if (model.executiveSummary) lines.push('\n## Resumen ejecutivo', model.executiveSummary);
  pushSections(lines, model);
  pushDiagrams(lines, model);
  pushCallouts(lines, model);
  if (model.nextSteps.length > 0) lines.push('\n## Próximos pasos', list(model.nextSteps));
  if (model.traceability.length > 0) lines.push('\n## Trazabilidad', list(model.traceability.slice(0, 8)));
};

const buildDiagramOnly = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  pushMinimalMeta(lines, model, 'Metadatos del diagrama');
  if (model.diagrams.length === 0) {
    lines.push('\n> **Borrador:** el modelo de presentación no contiene diagramas exportables. Regenera el artefacto o usa otro modo de publicación.');
    return;
  }
  if (model.purpose) lines.push('\n## Propósito', model.purpose);
  pushDiagrams(lines, model);
  const warnings = visualWarnings(model);
  if (warnings.length > 0) lines.push('\n## Advertencias visuales', list(warnings));
};

const buildTableOnly = (lines: Array<string | null>, model: ArtifactPresentationModel): void => {
  pushMinimalMeta(lines, model, 'Metadatos de la tabla');
  const tables = extractPresentationTables(model, 'table-only');
  if (tables.length === 0) {
    lines.push('\n> **Borrador:** el modelo de presentación no contiene tablas o matrices exportables. Usa otro modo de publicación.');
    return;
  }
  tables.forEach((table) => {
    lines.push(`\n## ${table.title}`, mdTable(table));
    const note = completenessNote(table);
    if (note) lines.push(note);
    if (table.readingNotes && table.readingNotes.length > 0) lines.push('\n### Notas de lectura', list(table.readingNotes));
  });
  const warnings = tableWarnings(model);
  if (warnings.length > 0) lines.push('\n## Advertencias de tabla', list(warnings));
};

/**
 * Renders the publication model to Markdown for a given export mode.
 * Defaults to `publication` for backward compatibility. Never returns an
 * empty string: an under-populated mode yields a clearly labelled draft.
 */
export function renderPresentationModelToMarkdown(
  model: ArtifactPresentationModel,
  mode?: PublicationExportMode,
): string {
  const resolved = resolvePublicationExportMode(mode);
  const lines: Array<string | null> = [`# ${clean(model.title) || model.artifactName}`];
  if (model.subtitle) lines.push(`\n_${clean(model.subtitle)}_`);
  lines.push('\n---');

  if (resolved === 'diagram-only') buildDiagramOnly(lines, model);
  else if (resolved === 'table-only') buildTableOnly(lines, model);
  else if (resolved === 'document-diagram') buildDocumentDiagram(lines, model);
  else buildPublication(lines, model);

  const output = lines.filter((line): line is string => line !== null && line !== '').join('\n').trim();
  if (stripMarkdown(output).trim().length === 0) {
    return `# ${clean(model.title) || model.artifactName || 'Borrador de publicación'}\n\n> **Borrador:** el modo \`${resolved}\` no produjo contenido suficiente. Revisa el artefacto antes de publicar.\n`;
  }
  return `${output}\n`;
}

/** Renders the publication model to a self-contained HTML document. */
export function renderPresentationModelToHtml(
  model: ArtifactPresentationModel,
  mode?: PublicationExportMode,
): string {
  const resolved = resolvePublicationExportMode(mode);
  const body = marked.parse(renderPresentationModelToMarkdown(model, resolved), { async: false }) as string;
  const statusLabel = model.quality.readyForPublication ? 'Listo' : 'Requiere revisión';
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(model.title)}</title>
<style>:root{color-scheme:light;--ink:#101828;--muted:#667085;--brand:#4f46e5;--line:#d0d5dd;--soft:#f8fafc}body{margin:0;font-family:Inter,Aptos,Calibri,Arial,sans-serif;color:var(--ink);line-height:1.62;background:white}.page{max-width:1120px;margin:0 auto;padding:48px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:var(--brand);font-weight:800;font-size:12px}h1{font-size:38px;line-height:1.1;margin:.25rem 0 1rem}h2{margin-top:2rem;border-bottom:1px solid var(--line);padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0;display:block;overflow:auto}th,td{border:1px solid var(--line);padding:8px 10px;vertical-align:top}th{background:#eef2ff}pre,code{border:1px solid var(--line);border-radius:14px;background:var(--soft)}pre{padding:16px;overflow:auto}code{white-space:pre-wrap}.status{display:inline-block;border-radius:999px;background:#eef2ff;color:#3730a3;padding:4px 10px;font-size:12px;font-weight:800}@media print{.page{padding:0}pre{break-inside:avoid}}</style></head>
<body><main class="page"><div class="eyebrow">Arky 10 · Versión publicación · ${escapeHtml(resolved)}</div><span class="status">${escapeHtml(statusLabel)} · ${model.quality.score}/100</span>${body}</main></body></html>`;
}

/** Renders the publication model to plain text for TXT/auditing exports. */
export function renderPresentationModelToPlainText(
  model: ArtifactPresentationModel,
  mode?: PublicationExportMode,
): string {
  return stripMarkdown(renderPresentationModelToMarkdown(model, mode)).trim();
}

const diagramJson = (diagram: ArtifactPresentationDiagram): unknown => ({
  ...diagram,
  ir: diagram.ir ? { nodes: diagram.ir.nodes.length, edges: diagram.ir.edges.length, metadata: diagram.ir.metadata } : undefined,
});

/** Renders the publication model to a JSON payload that respects the export mode. */
export function renderPresentationModelToJson(
  model: ArtifactPresentationModel,
  mode?: PublicationExportMode,
): unknown {
  const resolved = resolvePublicationExportMode(mode);
  const base = {
    schema: 'arky.presentation.publication.v1',
    mode: resolved,
    exportedAt: new Date().toISOString(),
    model: {
      id: model.id,
      artifactId: model.artifactId,
      artifactName: model.artifactName,
      artifactType: model.artifactType,
      title: model.title,
      subtitle: model.subtitle,
      audience: model.audience,
      mode: model.mode,
      compilerVersion: model.compilerVersion,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    },
    quality: model.quality,
    exportProfile: model.exportProfile,
  };

  if (resolved === 'diagram-only') {
    return { ...base, diagrams: model.diagrams.map(diagramJson) };
  }
  if (resolved === 'table-only') {
    return { ...base, tables: extractPresentationTables(model, 'table-only') };
  }
  if (resolved === 'document-diagram') {
    return {
      ...base,
      sections: model.sections,
      diagrams: model.diagrams.map(diagramJson),
      decisions: model.decisions,
      risks: model.risks,
      assumptions: model.assumptions,
      nextSteps: model.nextSteps,
      traceability: model.traceability,
    };
  }
  return {
    ...base,
    sections: model.sections,
    diagrams: model.diagrams.map(diagramJson),
    tables: extractPresentationTables(model, 'publication'),
    decisions: model.decisions,
    risks: model.risks,
    assumptions: model.assumptions,
    nextSteps: model.nextSteps,
    traceability: model.traceability,
    trace: model.trace,
  };
}
