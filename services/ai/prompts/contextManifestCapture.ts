/** Records the selected context at composition time, including unknown revisions. */
import type { ArtifactContextPorts, ContextManifestRecord } from '../../../lib/artifacts';
import type { ArtifactContextBundle, ArtifactContextSources } from './artifactContext';

/** Extra context already rendered by a path: keep the exact text, not its inputs. */
export function captureContextBlocks(
  project: ArtifactContextSources['project'],
  capture: ArtifactContextPorts['onContextCaptured'],
  blocks: Record<string, string>,
): void {
  const sections = Object.entries(blocks).filter(([, text]) => text.trim()).map(([scope, text]) => ({ scope, items: [{ text }] }));
  if (sections.length) capture?.({
    label: 'Contexto complementario',
    sources: [{ id: project.id, label: project.name, revision: project.revision }],
    sections,
    omitted: [],
  });
}

export function captureArtifactContext(
  sources: ArtifactContextSources,
  bundle: ArtifactContextBundle,
  capture: ArtifactContextPorts['onContextCaptured'],
  extra: ContextManifestRecord['sections'] = [],
): void {
  if (!capture) return;
  const { project, settings, artifact } = sources;
  const siblingIds = new Set(bundle.sections.flatMap((section) => section.items.flatMap((item) => item.sourceId ? [item.sourceId] : [])));
  capture({
    label: 'Contexto de artefacto',
    profile: bundle.profile,
    sources: [
      { id: project.id, label: project.name, revision: project.revision },
      { id: 'settings', label: 'Estándares y preferencias', revision: settings.revision },
      ...(artifact ? [{ id: artifact.id, label: artifact.name, revision: artifact.revision }] : []),
      ...project.artifacts.filter((item) => siblingIds.has(item.id)).map((item) => ({ id: item.id, label: item.name, revision: item.revision })),
    ],
    sections: [
      ...extra,
      ...bundle.sections.map(({ scope, items }) => ({
        scope,
        items: items.map(({ text, sourceId, truncated }) => ({ text, sourceId, truncated })),
      })),
    ],
    omitted: bundle.omitted,
  });
}

type ManifestRef = { id: string; name: string; revision?: number };
const sourceOf = ({ id, name, revision }: ManifestRef) => ({ id, label: name, revision });

/** Diagram paths: the request fragments sent next to the ranked bundle, per attempt. */
export function captureDiagramRequest(
  capture: ArtifactContextPorts['onContextCaptured'],
  attempt: { corrective: boolean; project: ManifestRef; artifact: ManifestRef & { type: string; objective?: string }; audience: string },
  blocks: { signals: string; brief?: string; previous: string },
): void {
  const { corrective, project, artifact, audience } = attempt;
  capture?.({
    label: corrective ? 'Solicitud de diagrama correctivo' : 'Solicitud de diagrama inicial',
    profile: corrective ? 'diagram-corrective' : 'diagram',
    sources: [sourceOf(project), sourceOf(artifact)],
    sections: [
      { scope: 'solicitud', items: [{ text: `${artifact.name} — ${artifact.type}\n${artifact.objective ?? ''}\n${audience}` }] },
      ...([['señales', blocks.signals], ['brief', blocks.brief], ['respuestaAnterior', blocks.previous]] as const)
        .flatMap(([scope, text]) => text ? [{ scope, items: [{ text }] }] : []),
    ],
    omitted: [],
  });
}

/** Diagram paths: the project block exactly as rendered, and what its caps left out. */
export function captureDiagramProjectBlock(
  capture: ArtifactContextPorts['onContextCaptured'],
  block: { corrective: boolean; project: ManifestRef & { description?: string; projectContext?: readonly string[] }; artifact?: ManifestRef & { keyConcepts?: readonly unknown[] }; text: string },
  caps: { maxContextItems: number; maxKeyConcepts: number; maxDescriptionChars: number },
): void {
  const { corrective, project, artifact, text } = block;
  const extraNotes = (project.projectContext?.length ?? 0) - caps.maxContextItems;
  const extraConcepts = (artifact?.keyConcepts?.length ?? 0) - caps.maxKeyConcepts;
  capture?.({
    label: corrective ? 'Proyecto del diagrama correctivo' : 'Proyecto del diagrama inicial',
    profile: corrective ? 'diagram-corrective' : 'diagram',
    sources: [sourceOf(project), ...(artifact ? [sourceOf(artifact)] : [])],
    sections: [{ scope: 'proyecto', items: [{ text, sourceId: project.id, truncated: (project.description?.trim().length ?? 0) > caps.maxDescriptionChars }] }],
    omitted: [
      ...(corrective && extraNotes > 0 ? [{ scope: 'proyecto', count: extraNotes, reason: 'Límite de notas del intento correctivo' }] : []),
      ...(extraConcepts > 0 ? [{ scope: 'glosario', count: extraConcepts, reason: 'Límite de conceptos del intento' }] : []),
    ],
  });
}
