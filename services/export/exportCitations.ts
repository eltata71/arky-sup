/**
 * No export carries an opaque `[ctx:*]` tag (plan de calidad de artefactos,
 * 7.5b). Applied once, in `exportArtifact`, before any adapter runs — so a
 * format added tomorrow inherits it instead of having to remember it.
 *
 * The original content gets numbered notes under «Fuentes de contexto»,
 * resolved against the generation's recorded manifest. A diagram's text and a
 * publication slice have no place for notes, so their tags are removed. What
 * could not be resolved is removed too, and named in the export trace.
 */
import { renderCitationsForExport, stripContextCitations } from '../../lib/artifacts';
import type { ExportTrace } from '../../lib/artifacts/exportContracts';
import type { ExportContext } from './exportTypes';

const CITATION = /\[ctx:/i;

const containsCitation = (value: unknown): boolean => {
  if (typeof value === 'string') return CITATION.test(value);
  if (Array.isArray(value)) return value.some(containsCitation);
  if (value && typeof value === 'object') return Object.values(value).some(containsCitation);
  return false;
};

const stripDeep = <T>(value: T): T => {
  if (typeof value === 'string') return stripContextCitations(value) as T;
  if (Array.isArray(value)) return value.map(stripDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripDeep(item)])) as T;
  }
  return value;
};

export function prepareCitationsForExport(context: ExportContext): { context: ExportContext; citations?: ExportTrace['citations'] } {
  const { artifact, presentationModel } = context;
  const inContent = CITATION.test(artifact.content ?? '');
  const inPublication = containsCitation(presentationModel);
  if (!inContent && !inPublication) return { context };
  let content = artifact.content;
  let citations: ExportTrace['citations'] = { notes: 0, removed: [] };
  if (inContent && artifact.representation === 'diagram') {
    content = stripContextCitations(content);
  } else if (inContent) {
    const rendered = renderCitationsForExport(content, artifact.generationTrace?.contextManifest);
    content = rendered.content;
    citations = { notes: rendered.notes.length, removed: rendered.removed };
  }
  return {
    context: {
      ...context,
      artifact: { ...artifact, content },
      ...(inPublication ? { presentationModel: stripDeep(presentationModel) } : {}),
    },
    citations,
  };
}
