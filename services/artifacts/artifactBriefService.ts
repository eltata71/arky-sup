import type { Project } from '../../types';
import type {
  ArtifactAudience,
  ArtifactDetailLevel,
  ArtifactFamilyPreference,
  ArtifactGenerationContract,
  ArtifactPurpose,
  ArtifactVisualPreferences,
} from './artifactGenerationContract';
import { normalizeArtifactGenerationContract } from './artifactGenerationContract';

const normalizeText = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const includesAny = (text: string, terms: readonly string[]): boolean => terms.some(term => text.includes(term));

const buildContractId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `agc-${crypto.randomUUID()}`;
  }
  return `agc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export interface BuildArtifactBriefOptions {
  now?: string;
  language?: 'es' | 'en';
}

export const inferAudienceFromRequest = (request: string): ArtifactAudience => {
  const text = normalizeText(request);
  if (includesAny(text, ['comite', 'gerencia', 'directivo', 'ejecutivo', 'board', 'c-level', 'ceo', 'cfo', 'decision'])) return 'executive';
  if (includesAny(text, ['operacion', 'operaciones', 'soporte', 'sre', 'devops', 'mesa de ayuda'])) return 'operations';
  if (includesAny(text, ['negocio', 'comercial', 'producto', 'stakeholder', 'cliente'])) return 'business';
  if (includesAny(text, ['tecnico', 'desarrollador', 'arquitecto', 'ingenier', 'api', 'microservicio', 'infraestructura'])) return 'technical';
  return 'mixed';
};

export const inferArtifactFamilyFromRequest = (request: string): ArtifactFamilyPreference => {
  const text = normalizeText(request);
  if (includesAny(text, ['matriz', 'matrix'])) return 'matrix';
  if (includesAny(text, ['tabla', 'listado', 'inventario'])) return 'table';
  if (includesAny(text, ['presentacion', 'slides', 'deck'])) return 'presentation';
  if (includesAny(text, ['documento', 'informe', 'reporte', 'especificacion', 'brief'])) return 'document';
  if (includesAny(text, ['diagrama', 'visual', 'mapa', 'c4', 'bpmn', 'erd', 'secuencia', 'flow'])) return 'diagram';
  if (includesAny(text, ['explicar', 'comunicar', 'narrativa']) && includesAny(text, ['diagrama', 'visual', 'flujo'])) return 'hybrid';
  return 'auto';
};

export const inferPurposeFromRequest = (request: string): ArtifactPurpose => {
  const text = normalizeText(request);
  if (includesAny(text, ['decidir', 'decision', 'aprobar', 'aprobacion'])) return 'decision';
  if (includesAny(text, ['implementar', 'implementacion', 'desarrollo', 'construccion'])) return 'implementation';
  if (includesAny(text, ['comparar', 'comparacion', 'versus', 'alternativa'])) return 'comparison';
  if (includesAny(text, ['validar', 'validacion', 'verificar', 'cumplimiento'])) return 'validation';
  if (includesAny(text, ['gobierno', 'gobernanza', 'control', 'estandar'])) return 'governance';
  if (includesAny(text, ['analizar', 'analisis', 'riesgo', 'gap', 'brecha'])) return 'analysis';
  if (includesAny(text, ['disenar', 'diseño', 'arquitectura', 'modelo'])) return 'design';
  if (includesAny(text, ['comunicar', 'presentar', 'socializar'])) return 'communication';
  return 'explanation';
};

export const inferDetailLevelFromRequest = (request: string, audience: ArtifactAudience): ArtifactDetailLevel => {
  const text = normalizeText(request);
  if (includesAny(text, ['deep technical', 'profundo', 'detallado a nivel tecnico', 'codigo', 'configuracion'])) return 'deep-technical';
  if (includesAny(text, ['fisico', 'despliegue', 'infraestructura', 'nodos', 'red'])) return 'physical';
  if (includesAny(text, ['tecnico', 'implementacion', 'api', 'contrato', 'componente'])) return 'technical';
  if (includesAny(text, ['logico', 'contenedor', 'dominio', 'componentes'])) return 'logical';
  if (audience === 'executive') return 'executive';
  return 'conceptual';
};

const inferVisualPreferences = (request: string): ArtifactVisualPreferences => {
  const text = normalizeText(request);
  return {
    orientation: includesAny(text, ['vertical', 'arriba abajo', 'top down']) ? 'TD' : includesAny(text, ['horizontal', 'izquierda derecha', 'left to right']) ? 'LR' : 'auto',
    density: includesAny(text, ['simple', 'sencillo', 'alto nivel']) ? 'simple' : includesAny(text, ['detallado', 'completo']) ? 'detailed' : 'balanced',
    includeLegend: true,
    includeBoundaries: !includesAny(text, ['sin limites', 'sin boundaries']),
    includeMetrics: includesAny(text, ['metricas', 'kpi', 'sla', 'slo']),
    preferredDiagramStyle: includesAny(text, ['c4']) ? 'c4' : includesAny(text, ['bpmn']) ? 'bpmn' : includesAny(text, ['secuencia']) ? 'sequence' : includesAny(text, ['erd', 'entidad']) ? 'erd' : includesAny(text, ['dfd', 'flujo de datos']) ? 'dfd' : includesAny(text, ['estado']) ? 'state' : 'auto',
  };
};

const inferAcceptanceCriteria = (request: string): string[] => {
  const family = inferArtifactFamilyFromRequest(request);
  const criteria = [
    'Responder directamente a la intención normalizada sin contenido genérico.',
    'Mantener trazabilidad visible de fuentes, supuestos y decisiones relevantes.',
  ];
  if (family === 'diagram' || family === 'hybrid') {
    criteria.push('Producir una vista visual renderizable, legible y compatible con el canvas/exportación.');
  }
  if (family === 'document' || family === 'table' || family === 'matrix' || family === 'presentation') {
    criteria.push('Estructurar el contenido con secciones claras, accionables y listas para revisión arquitectónica.');
  }
  criteria.push('Respetar audiencia, propósito, nivel de detalle y restricciones de contexto seleccionadas.');
  return criteria;
};

export const buildDeterministicArtifactBrief = (
  project: Project,
  request: string,
  options: BuildArtifactBriefOptions = {},
): ArtifactGenerationContract => {
  const now = options.now ?? new Date().toISOString();
  const audience = inferAudienceFromRequest(request);
  const artifactFamily = inferArtifactFamilyFromRequest(request);
  const purpose = inferPurposeFromRequest(request);
  const detailLevel = inferDetailLevelFromRequest(request, audience);
  const normalizedIntent = request.trim().replace(/\s+/g, ' ');
  const defaultContextItems = (project.projectContext ?? [])
    .filter(item => item.trim().length > 0)
    .slice(0, 3);

  return normalizeArtifactGenerationContract({
    id: buildContractId(),
    originalRequest: request,
    normalizedIntent,
    audience,
    artifactFamily,
    purpose,
    detailLevel,
    requiredSourceArtifactIds: [],
    optionalSourceArtifactIds: [],
    excludedSourceArtifactIds: [],
    requiredContextItems: defaultContextItems,
    excludedContextItems: [],
    acceptanceCriteria: inferAcceptanceCriteria(request),
    exportTargets: artifactFamily === 'diagram' ? ['png', 'svg', 'mermaid'] : artifactFamily === 'presentation' ? ['pdf', 'markdown'] : ['markdown', 'pdf'],
    visualPreferences: inferVisualPreferences(request),
    language: options.language ?? 'es',
    qualityTarget: audience === 'executive' ? 92 : 90,
    createdAt: now,
    updatedAt: now,
  });
};

export const updateArtifactBriefFromForm = (
  contract: ArtifactGenerationContract,
  patch: Partial<ArtifactGenerationContract>,
): ArtifactGenerationContract => normalizeArtifactGenerationContract({
  ...contract,
  ...patch,
  acceptanceCriteria: patch.acceptanceCriteria ?? contract.acceptanceCriteria,
  exportTargets: patch.exportTargets ?? contract.exportTargets,
  updatedAt: new Date().toISOString(),
});
