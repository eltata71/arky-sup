import type { Artifact } from '../../lib/artifacts';
import type {
  ArtifactPresentationCallout,
  ArtifactPresentationSection,
  ArtifactPresentationTable,
} from '../../lib/artifacts/artifactPresentationModel';

export interface MarkdownPresentationParts {
  title?: string;
  subtitle?: string;
  executiveSummary?: string;
  purpose?: string;
  scope?: string;
  sections: ArtifactPresentationSection[];
  tables: ArtifactPresentationTable[];
  decisions: ArtifactPresentationCallout[];
  risks: ArtifactPresentationCallout[];
  assumptions: ArtifactPresentationCallout[];
  nextSteps: string[];
  traceability: string[];
  warnings: string[];
}

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
const slug = (value: string): string => normalize(value).toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-').replace(/^-|-$/g, '') || 'section';

const classifySection = (title: string): ArtifactPresentationSection['type'] => {
  const lower = title.toLowerCase();
  if (/resumen|summary|overview|síntesis/.test(lower)) return 'summary';
  if (/decisi|adr|acuerdo/.test(lower)) return 'decision';
  if (/riesgo|risk|amenaza/.test(lower)) return 'risk';
  if (/supuesto|assumption|hipótesis/.test(lower)) return 'assumption';
  if (/próximo|siguiente|next step|acción|plan/.test(lower)) return 'next-steps';
  if (/trazabilidad|traceability|matriz/.test(lower)) return 'traceability';
  if (/anexo|appendix|referencia/.test(lower)) return 'appendix';
  return 'body';
};

const extractFirstParagraph = (content: string): string | undefined => {
  const paragraph = content
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((item) => normalize(item.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '')))
    .find((item) => item.length > 40);
  return paragraph?.slice(0, 700);
};

const splitSections = (content: string): ArtifactPresentationSection[] => {
  const lines = content.split(/\r?\n/);
  const sections: ArtifactPresentationSection[] = [];
  let currentTitle = 'Contenido';
  let currentLevel: 1 | 2 | 3 = 1;
  let buffer: string[] = [];
  let order = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (!body && currentTitle === 'Contenido') return;
    sections.push({
      id: `${slug(currentTitle)}-${order + 1}`,
      title: currentTitle,
      level: currentLevel,
      content: body,
      type: classifySection(currentTitle),
      order,
    });
    order += 1;
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (match) {
      flush();
      currentTitle = normalize(match[2]);
      currentLevel = Math.min(match[1].length, 3) as 1 | 2 | 3;
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (sections.length === 0 && content.trim()) {
    sections.push({ id: 'contenido-1', title: 'Contenido', level: 1, content: content.trim(), type: 'body', order: 0 });
  }
  return sections;
};

const parseMarkdownTables = (content: string): ArtifactPresentationTable[] => {
  const lines = content.split(/\r?\n/);
  const tables: ArtifactPresentationTable[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i].trim();
    const separatorLine = lines[i + 1].trim();
    if (!headerLine.includes('|') || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separatorLine)) continue;
    const headers = headerLine.split('|').map((cell) => normalize(cell)).filter(Boolean);
    const rows: string[][] = [];
    let cursor = i + 2;
    while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim() !== '') {
      const cells = lines[cursor].split('|').map((cell) => normalize(cell));
      const normalizedCells = cells.length > headers.length ? cells.filter((_, idx) => !(idx === 0 || idx === cells.length - 1 && cells[idx] === '')) : cells;
      rows.push(headers.map((_, idx) => normalizedCells[idx] ?? ''));
      cursor += 1;
    }
    const totalCells = Math.max(headers.length * rows.length, 1);
    const filledCells = rows.flat().filter((cell) => cell.length > 0 && !/^n\/?a$/i.test(cell)).length;
    const weakHeaders = headers.some((header) => header.length < 3 || /^col(umna)?\s*\d*$/i.test(header));
    tables.push({
      id: `table-${tables.length + 1}`,
      title: `Tabla ${tables.length + 1}`,
      headers,
      rows,
      completeness: Math.round((filledCells / totalCells) * 100) / 100,
      exportSafe: headers.length > 0 && rows.length > 0 && !weakHeaders,
      readingNotes: [
        weakHeaders ? 'Revisar encabezados antes de publicar.' : 'Encabezados detectados para lectura tabular.',
        rows.some((row) => row.some((cell) => cell.length === 0)) ? 'Existen celdas incompletas.' : 'Filas completas para exportación tabular.',
      ],
    });
    i = cursor;
  }
  return tables;
};

const calloutsFromSections = (
  sections: ArtifactPresentationSection[],
  type: ArtifactPresentationCallout['type'],
  sectionType: ArtifactPresentationSection['type'],
  title: string,
): ArtifactPresentationCallout[] => sections
  .filter((section) => section.type === sectionType || classifySection(section.title) === sectionType)
  .map((section, index) => ({
    id: `${type}-${index + 1}`,
    type,
    title: section.title || title,
    content: normalize(section.content).slice(0, 600) || title,
    severity: type === 'risk' ? 'medium' : undefined,
  }));

const extractListItems = (sections: ArtifactPresentationSection[], sectionType: ArtifactPresentationSection['type']): string[] =>
  sections
    .filter((section) => section.type === sectionType)
    .flatMap((section) => section.content.split(/\r?\n/))
    .map((line) => normalize(line.replace(/^[-*]\s+|^\d+\.\s+/, '')))
    .filter((line) => line.length > 0)
    .slice(0, 8);

export const compileMarkdownPresentation = (artifact: Artifact): MarkdownPresentationParts => {
  const content = artifact.content ?? '';
  const sections = splitSections(content).filter((section) => !/^```mermaid/i.test(section.content.trim()));
  const tables = parseMarkdownTables(content);
  const warnings: string[] = [];
  const headingTitle = sections.find((section) => section.level === 1)?.title;
  const firstParagraph = extractFirstParagraph(content);
  const summarySection = sections.find((section) => section.type === 'summary');
  const executiveSummary = normalize(summarySection?.content ?? '') || firstParagraph;

  if (!summarySection) warnings.push('El documento no declara un resumen ejecutivo explícito. Se derivó uno desde el primer párrafo útil.');
  if (sections.length <= 1 && content.length > 1200) warnings.push('El documento es monolítico; conviene dividirlo en secciones publicables.');
  if (tables.some((table) => !table.exportSafe || table.completeness < 0.85)) warnings.push('Una o más tablas requieren revisión de encabezados o completitud.');

  const nextSteps = extractListItems(sections, 'next-steps');
  if (nextSteps.length === 0) warnings.push('No se detectaron próximos pasos accionables.');

  const traceability = extractListItems(sections, 'traceability');
  if (traceability.length === 0) warnings.push('No se detectó trazabilidad explícita hacia decisiones, requisitos o fuentes.');

  return {
    title: headingTitle ?? artifact.name,
    subtitle: artifact.objective,
    executiveSummary,
    purpose: sections.find((section) => /propósito|purpose|objetivo/i.test(section.title))?.content.trim() || artifact.objective,
    scope: sections.find((section) => /alcance|scope/i.test(section.title))?.content.trim(),
    sections,
    tables,
    decisions: calloutsFromSections(sections, 'decision', 'decision', 'Decisión'),
    risks: calloutsFromSections(sections, 'risk', 'risk', 'Riesgo'),
    assumptions: calloutsFromSections(sections, 'assumption', 'assumption', 'Supuesto'),
    nextSteps,
    traceability,
    warnings,
  };
};

export const compileTablePresentation = (artifact: Artifact): Pick<MarkdownPresentationParts, 'tables' | 'warnings'> => {
  const tables = parseMarkdownTables(artifact.content ?? '');
  return {
    tables,
    warnings: tables.flatMap((table) => [
      ...(table.completeness < 0.85 ? [`La tabla "${table.title}" tiene completitud baja (${Math.round(table.completeness * 100)}%).`] : []),
      ...(!table.exportSafe ? [`La tabla "${table.title}" requiere encabezados y filas válidas antes de publicación.`] : []),
    ]),
  };
};
