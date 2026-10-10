/** ADM phases in reading order, with their labels. */
import type { AdmPhase } from '../../types';

export type { AdmPhase };
export const ADM_PHASES: readonly AdmPhase[] = ['preliminary', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'requirements'];

export const ADM_PHASE_LABELS: Readonly<Record<AdmPhase, string>> = {
  preliminary: 'Preliminar · Marco de trabajo',
  A: 'Fase A · Visión de la arquitectura',
  B: 'Fase B · Arquitectura de negocio',
  C: 'Fase C · Sistemas de información',
  D: 'Fase D · Arquitectura tecnológica',
  E: 'Fase E · Oportunidades y soluciones',
  F: 'Fase F · Planificación de la migración',
  G: 'Fase G · Gobierno de la implementación',
  H: 'Fase H · Gestión del cambio',
  requirements: 'Gestión de requisitos',
};

/** Label for templates that declare no ADM phase. */
export const NO_ADM_PHASE_LABEL = 'Sin fase ADM';

export const admPhaseLabel = (phase: AdmPhase | undefined): string =>
  phase ? ADM_PHASE_LABELS[phase] : NO_ADM_PHASE_LABEL;

/** Groups templates by ADM phase, in ADM order; templates outside the ADM close the list. */
export function groupTemplatesByAdm<T extends { admPhase?: AdmPhase }>(templates: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const key of [...ADM_PHASES, undefined]) {
    const label = admPhaseLabel(key);
    const members = templates.filter(template => template.admPhase === key);
    if (members.length > 0) groups.set(label, members);
  }
  return [...groups.entries()];
}
