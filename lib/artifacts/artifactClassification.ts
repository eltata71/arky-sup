import type { Artifact, ArtifactType } from '../../types';
import { isPresentationArtifactType } from './artifactKind';

export type ArtifactContentKind =
  | 'diagram'
  | 'document'
  | 'markdown'
  | 'table'
  | 'matrix'
  | 'data-dictionary'
  | 'hybrid'
  | 'presentation';

export interface ArtifactClassification {
  primaryKind: ArtifactContentKind;
  artifactType: ArtifactType;
  representation: Artifact['representation'];
  hasDiagram: boolean;
  hasDocument: boolean;
  hasMarkdown: boolean;
  hasTables: boolean;
  isDataDictionary: boolean;
  confidence: number;
  rationale: string[];
}

const DATA_DICTIONARY_TERMS = [
  'diccionario de datos',
  'data dictionary',
  'campo',
  'tipo de dato',
  'longitud',
  'formato',
  'reglas de validación',
  'phi',
  'pii',
  'sensibilidad',
  'sistema destino',
];

const MATRIX_TERMS = ['matriz', 'matrix', 'traceability', 'trazabilidad'];

export const hasMarkdownTable = (content: string): boolean => {
  const lines = content.split(/\r?\n/);
  return lines.some((line, index) => {
    const next = lines[index + 1] ?? '';
    return line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
  });
};

export const hasCsvLikeTable = (content: string): boolean => {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines.filter((line) => line.split(',').length >= 3 || line.split('\t').length >= 3);
  return candidates.length >= 2;
};

export const classifyArtifact = (artifact: Artifact): ArtifactClassification => {
  const haystack = [artifact.name, artifact.type, artifact.objective, artifact.content.slice(0, 4000)]
    .join('\n')
    .toLowerCase();
  const rationale: string[] = [];
  const typeStartsAsDiagram = artifact.type.startsWith('mermaid') || artifact.type === 'react-flow-graph';
  const hasMermaidFence = /```mermaid[\s\S]*?```/i.test(artifact.content);
  const hasMermaidHeader = /^\s*(graph|flowchart|sequenceDiagram|classDiagram|C4Context|C4Container|C4Component|C4Deployment|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|timeline|pie)\b/im.test(artifact.content);
  const hasRenderableIR = Boolean(artifact.ir?.nodes?.length);
  const hasDiagram = hasRenderableIR || hasMermaidFence || hasMermaidHeader || (typeStartsAsDiagram && artifact.content.trim().length > 0 && !/^(#|\w+\s+.+)/.test(artifact.content.trim()));
  const hasTables = hasMarkdownTable(artifact.content) || hasCsvLikeTable(artifact.content);
  const isDataDictionary = DATA_DICTIONARY_TERMS.filter((term) => haystack.includes(term)).length >= 2
    || /\b(diccionario|dictionary)\b/i.test(artifact.name) && /\b(data|datos)\b/i.test(artifact.name);
  const isMatrix = MATRIX_TERMS.some((term) => haystack.includes(term));
  const hasMarkdown = artifact.type === 'markdown' || /(^|\n)#{1,6}\s+/.test(artifact.content) || hasTables;
  const hasDocument = artifact.representation === 'document' || artifact.representation === 'hybrid' || artifact.type === 'markdown' || hasMarkdown || artifact.content.trim().length > 0;

  if (isDataDictionary) rationale.push('Se detectaron señales de diccionario de datos en nombre, objetivo o columnas.');
  if (hasTables) rationale.push('Se detectó estructura tabular exportable.');
  if (typeStartsAsDiagram || hasRenderableIR) rationale.push('El tipo o IR indica capacidad de diagrama.');
  if (artifact.representation === 'document') rationale.push('La representación declarada es documental.');

  const isPresentation = isPresentationArtifactType(artifact.type);
  if (isPresentation) rationale.push('El tipo del artefacto indica un deck de presentación.');

  let primaryKind: ArtifactContentKind = 'document';
  if (isPresentation) primaryKind = 'presentation';
  else if (isDataDictionary) primaryKind = 'data-dictionary';
  else if (isMatrix) primaryKind = 'matrix';
  else if (hasTables) primaryKind = 'table';
  else if (artifact.representation === 'hybrid') primaryKind = 'hybrid';
  else if (typeStartsAsDiagram && artifact.representation === 'diagram') primaryKind = 'diagram';
  else if (hasMarkdown) primaryKind = 'markdown';

  const confidence = Math.min(0.98, 0.55 + (rationale.length * 0.12));

  return {
    primaryKind,
    artifactType: artifact.type,
    representation: artifact.representation,
    hasDiagram,
    hasDocument,
    hasMarkdown,
    hasTables,
    isDataDictionary,
    confidence,
    rationale,
  };
};
