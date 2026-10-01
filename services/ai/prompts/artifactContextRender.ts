/**
 * How an artifact context bundle reads in a prompt (plan de calidad de
 * artefactos, 7.2–7.3): the scopes' titles, the hierarchy rule, and the fence.
 * Apart from the assembly because the assembly decides what is kept and this
 * decides only how it is said — and together they were over the size a module
 * may reach here.
 */
import type { Settings } from '../../../types';
import type { Artifact, ArtifactContextPorts } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { captureArtifactContext } from './contextManifestCapture';
import { assembleArtifactContext, type ArtifactContextBundle, type ArtifactContextScope } from './artifactContext';

/** How each scope is titled in a prompt. The chat's composer uses the same words. */
export const ARTIFACT_CONTEXT_TITLES: Readonly<Record<ArtifactContextScope, string>> = Object.freeze({
  artefacto: 'Memoria del Artefacto',
  entregable: 'Entregables en curso del proyecto (la solicitud del comité, su alcance y sus restricciones obligan al artefacto)',
  proyecto: 'Contexto del Proyecto (selección relevante)',
  capturaInicial: 'Captura Inicial del Proyecto (objetivos, alcance, stakeholders)',
  memoriaProyecto: 'Memoria del Agente (Proyecto)',
  conversacion: 'Decisiones recientes de la conversación con el agente (acordadas en el chat, aún no registradas como memoria)',
  global: 'Memoria Global (estándares y preferencias)',
  agente: 'Preferencias del Arquitecto (memoria del agente)',
  hermanos: 'Extractos de artefactos relacionados del proyecto (fuente de verdad para nombres, IDs y decisiones; no los contradigas)',
});

/** The rule that tells the model how to weigh the scopes it just read. */
export const ARTIFACT_CONTEXT_HIERARCHY_RULE = [
  'Jerarquía del contexto (obligatoria):',
  '- Usa todos los ámbitos disponibles; ante información en conflicto, manda el artefacto > el entregable en curso > el proyecto (contexto, captura inicial, memoria del proyecto, decisiones de la conversación) > lo global > las preferencias del arquitecto.',
  '- Dentro de un ámbito, manda la prioridad de la nota (alta > media > baja) y, a igual prioridad, la más reciente. Las anotaciones [prioridad · fecha · autor] lo indican.',
  '- Mantén los nombres, IDs y decisiones de los artefactos relacionados; si detectas una contradicción, señálala en vez de elegir en silencio.',
].join('\n');

/**
 * The bundle as one fenced block, with the hierarchy rule outside the fence:
 * everything inside is what people wrote, the rule is what the application says.
 */
export function renderArtifactContextBundle(bundle: ArtifactContextBundle): string {
  if (bundle.sections.length === 0) return '';
  const body = bundle.sections
    .map((section) => {
      const lines = section.scope === 'hermanos'
        ? section.items.map((item) => item.text)
        : section.items.map((item) => `- ${item.text}`);
      return [`${ARTIFACT_CONTEXT_TITLES[section.scope]}:`, ...lines].join('\n');
    })
    .join('\n\n');
  return [wrapUntrustedContent('contexto del proyecto', body), ARTIFACT_CONTEXT_HIERARCHY_RULE].join('\n');
}

/** A diagram's context, ranked against the artifact it will draw (the IR path, 7.2b). */
export const renderDiagramContextBundle = (project: Project, settings: Settings, artifact?: Artifact, capture?: ArtifactContextPorts['onContextCaptured']): string => {
  const sources = { project, settings, artifact, query: artifact ? `${artifact.name}. ${artifact.objective ?? ''}` : undefined };
  const bundle = assembleArtifactContext(sources, 'diagram');
  captureArtifactContext(sources, bundle, capture);
  return renderArtifactContextBundle(bundle);
};
