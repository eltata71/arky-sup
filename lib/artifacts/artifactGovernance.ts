import { Artifact, ArtifactTemplate, Project } from '../../types';

const PHASE_ORDER: Record<string, number> = {
  'Fase 1: Estratégica y de Visión de Negocio': 1,
  'Fase 2: Diseño Conceptual y Lógico': 2,
  'Fase 3: Diseño Físico y Tecnológico': 3,
  'Fase 4: Implementación y Operaciones': 4,
  'SDD: Especificación': 5,
  'General': 6,
};

const ARTIFACT_PRIORITY: Record<string, number> = {
  'Visión de la Arquitectura': 10,
  'Principios de Arquitectura': 20,
  'Mapa de Capacidades de Negocio': 30,
  'Análisis de Stakeholders': 40,
  'Diagrama de Contexto (C4-N1)': 50,
  'Modelo de Proceso de Negocio (BPMN)': 60,
  'Mapa de Flujo de Valor': 70,
  'Diagrama de Contenedores (C4-N2)': 80,
  'Modelo de Dominio (ERD)': 90,
  'Diccionario de Datos': 100,
  'Diagrama de Integración': 110,
  'Diagrama de Componentes (C4-N3)': 120,
  'Diagrama de Flujo de Datos Lógico': 130,
  'Modelo Físico de Datos': 140,
  'Estrategia de Migración de Datos': 150,
  'Diagrama de Despliegue (C4-N4)': 160,
  'Contrato de API (OpenAPI)': 170,
  'Catálogo de Patrones de Diseño': 180,
};

const PREREQUISITES: Record<string, string[]> = {
  'Diagrama de Contenedores (C4-N2)': ['Diagrama de Contexto (C4-N1)', 'Visión de la Arquitectura'],
  'Diagrama de Componentes (C4-N3)': ['Diagrama de Contenedores (C4-N2)'],
  'Modelo Físico de Datos': ['Modelo de Dominio (ERD)', 'Diccionario de Datos'],
  'Contrato de API (OpenAPI)': ['Diagrama de Integración', 'Diagrama de Componentes (C4-N3)'],
  'Diagrama de Despliegue (C4-N4)': ['Diagrama de Contenedores (C4-N2)'],
  'Catálogo de Patrones de Diseño': ['Diagrama de Componentes (C4-N3)', 'Principios de Arquitectura'],
};

export type ReadinessResult = {
  score: number;
  missingArtifacts: string[];
  missingInputs: string[];
  blockers: string[];
  canGenerate: boolean;
};

const hasAnyContent = (artifact?: Artifact): boolean => !!artifact?.content?.trim();

export function sortTemplatesByRoadmap(templates: ArtifactTemplate[]): ArtifactTemplate[] {
  return [...templates].sort((a, b) => {
    const phaseDelta = (PHASE_ORDER[a.phase] ?? 999) - (PHASE_ORDER[b.phase] ?? 999);
    if (phaseDelta !== 0) return phaseDelta;
    const priDelta = (ARTIFACT_PRIORITY[a.name] ?? 999) - (ARTIFACT_PRIORITY[b.name] ?? 999);
    if (priDelta !== 0) return priDelta;
    return a.name.localeCompare(b.name, 'es');
  });
}

export function validateArtifactReadiness(project: Project, template: ArtifactTemplate): ReadinessResult {
  const projectArtifacts = project.artifacts;
  const latestByName = new Map<string, Artifact>();
  projectArtifacts.forEach(artifact => {
    const current = latestByName.get(artifact.name);
    if (!current || artifact.version > current.version) latestByName.set(artifact.name, artifact);
  });

  const required = PREREQUISITES[template.name] ?? [];
  const missingArtifacts = required.filter(name => !hasAnyContent(latestByName.get(name)));

  const missingInputs: string[] = [];
  if (!project.description?.trim()) missingInputs.push('Descripción de proyecto');
  if (!project.projectContext?.length) missingInputs.push('Contexto estratégico del proyecto');

  const blockers: string[] = [];
  if (missingArtifacts.length > 0) {
    blockers.push('Faltan artefactos prerrequisito para mantener consistencia arquitectónica.');
  }

  const score = Math.max(0, Math.min(100,
    100
      - missingArtifacts.length * 20
      - missingInputs.length * 8
  ));

  return {
    score,
    missingArtifacts,
    missingInputs,
    blockers,
    canGenerate: missingArtifacts.length === 0 && score >= 80,
  };
}
