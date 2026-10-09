/**
 * ArchiMate 3.2 metamodel, the subset the product draws (plan clase mundial, 11.1).
 *
 * Foundation layer: a declaration with no behaviour. Element types and
 * relationship types are the standard's own; the layers are its layers. The
 * table of allowed relationships is **rule-based and conservative**: it
 * refuses what the standard clearly forbids (a business actor served by
 * nothing, technology realised by the business…) and does not try to
 * reproduce the full derivation table. A relation it cannot place is
 * *reported*, never silently accepted.
 */

export const ARCHIMATE_LAYERS = ['strategy', 'business', 'application', 'technology', 'motivation', 'implementation'] as const;
export type ArchimateLayer = (typeof ARCHIMATE_LAYERS)[number];

export type ArchimateAspect = 'active' | 'behavior' | 'passive' | 'motivation' | 'strategy' | 'implementation';

interface ElementDef {
  layer: ArchimateLayer;
  aspect: ArchimateAspect;
  label: string;
}

const defs = {
  resource: { layer: 'strategy', aspect: 'strategy', label: 'Recurso' },
  capability: { layer: 'strategy', aspect: 'strategy', label: 'Capacidad' },
  'value-stream': { layer: 'strategy', aspect: 'strategy', label: 'Flujo de valor' },
  'course-of-action': { layer: 'strategy', aspect: 'strategy', label: 'Curso de acción' },

  'business-actor': { layer: 'business', aspect: 'active', label: 'Actor de negocio' },
  'business-role': { layer: 'business', aspect: 'active', label: 'Rol de negocio' },
  'business-collaboration': { layer: 'business', aspect: 'active', label: 'Colaboración de negocio' },
  'business-interface': { layer: 'business', aspect: 'active', label: 'Interfaz de negocio' },
  'business-process': { layer: 'business', aspect: 'behavior', label: 'Proceso de negocio' },
  'business-function': { layer: 'business', aspect: 'behavior', label: 'Función de negocio' },
  'business-interaction': { layer: 'business', aspect: 'behavior', label: 'Interacción de negocio' },
  'business-event': { layer: 'business', aspect: 'behavior', label: 'Evento de negocio' },
  'business-service': { layer: 'business', aspect: 'behavior', label: 'Servicio de negocio' },
  'business-object': { layer: 'business', aspect: 'passive', label: 'Objeto de negocio' },
  contract: { layer: 'business', aspect: 'passive', label: 'Contrato' },
  representation: { layer: 'business', aspect: 'passive', label: 'Representación' },
  product: { layer: 'business', aspect: 'passive', label: 'Producto' },

  'application-component': { layer: 'application', aspect: 'active', label: 'Componente de aplicación' },
  'application-collaboration': { layer: 'application', aspect: 'active', label: 'Colaboración de aplicación' },
  'application-interface': { layer: 'application', aspect: 'active', label: 'Interfaz de aplicación' },
  'application-function': { layer: 'application', aspect: 'behavior', label: 'Función de aplicación' },
  'application-process': { layer: 'application', aspect: 'behavior', label: 'Proceso de aplicación' },
  'application-interaction': { layer: 'application', aspect: 'behavior', label: 'Interacción de aplicación' },
  'application-event': { layer: 'application', aspect: 'behavior', label: 'Evento de aplicación' },
  'application-service': { layer: 'application', aspect: 'behavior', label: 'Servicio de aplicación' },
  'data-object': { layer: 'application', aspect: 'passive', label: 'Objeto de datos' },

  node: { layer: 'technology', aspect: 'active', label: 'Nodo' },
  device: { layer: 'technology', aspect: 'active', label: 'Dispositivo' },
  'system-software': { layer: 'technology', aspect: 'active', label: 'Software de sistema' },
  'technology-collaboration': { layer: 'technology', aspect: 'active', label: 'Colaboración de tecnología' },
  'technology-interface': { layer: 'technology', aspect: 'active', label: 'Interfaz de tecnología' },
  path: { layer: 'technology', aspect: 'active', label: 'Ruta' },
  'communication-network': { layer: 'technology', aspect: 'active', label: 'Red de comunicación' },
  'technology-function': { layer: 'technology', aspect: 'behavior', label: 'Función de tecnología' },
  'technology-process': { layer: 'technology', aspect: 'behavior', label: 'Proceso de tecnología' },
  'technology-interaction': { layer: 'technology', aspect: 'behavior', label: 'Interacción de tecnología' },
  'technology-event': { layer: 'technology', aspect: 'behavior', label: 'Evento de tecnología' },
  'technology-service': { layer: 'technology', aspect: 'behavior', label: 'Servicio de tecnología' },
  artifact: { layer: 'technology', aspect: 'passive', label: 'Artefacto' },

  stakeholder: { layer: 'motivation', aspect: 'motivation', label: 'Interesado' },
  driver: { layer: 'motivation', aspect: 'motivation', label: 'Motivador' },
  assessment: { layer: 'motivation', aspect: 'motivation', label: 'Evaluación' },
  goal: { layer: 'motivation', aspect: 'motivation', label: 'Objetivo' },
  outcome: { layer: 'motivation', aspect: 'motivation', label: 'Resultado' },
  principle: { layer: 'motivation', aspect: 'motivation', label: 'Principio' },
  requirement: { layer: 'motivation', aspect: 'motivation', label: 'Requisito' },
  constraint: { layer: 'motivation', aspect: 'motivation', label: 'Restricción' },
  meaning: { layer: 'motivation', aspect: 'motivation', label: 'Significado' },
  value: { layer: 'motivation', aspect: 'motivation', label: 'Valor' },

  'work-package': { layer: 'implementation', aspect: 'implementation', label: 'Paquete de trabajo' },
  deliverable: { layer: 'implementation', aspect: 'implementation', label: 'Entregable de proyecto' },
  'implementation-event': { layer: 'implementation', aspect: 'implementation', label: 'Evento de implementación' },
  plateau: { layer: 'implementation', aspect: 'implementation', label: 'Meseta' },
  gap: { layer: 'implementation', aspect: 'implementation', label: 'Brecha' },
} as const satisfies Record<string, ElementDef>;

export type ArchimateElementType = keyof typeof defs;

export const ARCHIMATE_ELEMENT_TYPES = Object.keys(defs) as ArchimateElementType[];

const ELEMENTS: Record<ArchimateElementType, ElementDef> = defs;

export function isArchimateElementType(value: string): value is ArchimateElementType {
  return Object.prototype.hasOwnProperty.call(ELEMENTS, value);
}

export const archimateLayerOf = (type: ArchimateElementType): ArchimateLayer => ELEMENTS[type].layer;
export const archimateAspectOf = (type: ArchimateElementType): ArchimateAspect => ELEMENTS[type].aspect;
export const archimateElementLabel = (type: ArchimateElementType): string => ELEMENTS[type].label;

export const ARCHIMATE_LAYER_LABELS: Record<ArchimateLayer, string> = {
  strategy: 'Estrategia',
  business: 'Negocio',
  application: 'Aplicación',
  technology: 'Tecnología',
  motivation: 'Motivación',
  implementation: 'Implementación y migración',
};

export const ARCHIMATE_RELATION_TYPES = [
  'composition', 'aggregation', 'assignment', 'realization', 'serving', 'access',
  'influence', 'triggering', 'flow', 'specialization', 'association',
] as const;
export type ArchimateRelationType = (typeof ARCHIMATE_RELATION_TYPES)[number];

export function isArchimateRelationType(value: string): value is ArchimateRelationType {
  return (ARCHIMATE_RELATION_TYPES as readonly string[]).includes(value);
}

export const ARCHIMATE_RELATION_LABELS: Record<ArchimateRelationType, string> = {
  composition: 'Composición',
  aggregation: 'Agregación',
  assignment: 'Asignación',
  realization: 'Realización',
  serving: 'Servicio a',
  access: 'Acceso',
  influence: 'Influencia',
  triggering: 'Disparo',
  flow: 'Flujo',
  specialization: 'Especialización',
  association: 'Asociación',
};

/** The core layers, bottom-up: a lower layer serves and is realised upward. */
const CORE_ORDER: ArchimateLayer[] = ['technology', 'application', 'business'];

const isCore = (layer: ArchimateLayer): boolean => CORE_ORDER.includes(layer);

/** Whether `source —relation→ target` is allowed; the reason in Spanish when it is not. */
export function checkArchimateRelation(
  relation: ArchimateRelationType,
  source: ArchimateElementType,
  target: ArchimateElementType,
): { allowed: true } | { allowed: false; reason: string } {
  const s = ELEMENTS[source];
  const t = ELEMENTS[target];
  const no = (reason: string) => ({ allowed: false as const, reason });
  const ok = { allowed: true as const };
  const pair = `${s.label} → ${t.label}`;

  switch (relation) {
    case 'association':
      return ok;
    case 'specialization':
      return source === target ? ok : no(`Especialización exige el mismo tipo en ambos extremos (${pair}).`);
    case 'composition':
    case 'aggregation':
      if (s.aspect === t.aspect && s.layer === t.layer) return ok;
      if (relation === 'aggregation' && s.layer === 'implementation' && t.layer === 'implementation') return ok;
      return no(`${ARCHIMATE_RELATION_LABELS[relation]} agrupa elementos de la misma naturaleza y capa (${pair}).`);
    case 'assignment':
      if (s.aspect === 'active' && t.aspect === 'behavior' && s.layer === t.layer) return ok;
      if (s.aspect === 'active' && t.aspect === 'active' && s.layer === t.layer) return ok;
      if (source === 'business-role' && target === 'business-actor') return ok;
      if (source === 'stakeholder' || target === 'stakeholder') return no(`Un interesado no se asigna; se relaciona por asociación o influencia (${pair}).`);
      if (s.layer === 'implementation' && t.layer === 'implementation') return ok;
      return no(`Asignación enlaza estructura activa con el comportamiento de su misma capa (${pair}).`);
    case 'realization':
      if (s.layer === 'implementation' && t.layer === 'implementation') return ok;
      if (s.layer === 'implementation') return ok;
      if (t.layer === 'motivation') return s.layer === 'motivation' || isCore(s.layer) || s.layer === 'strategy' ? ok : no(`${pair}: no se realiza una motivación desde ahí.`);
      if (s.layer === t.layer && (s.aspect === 'behavior' || s.aspect === 'passive' || s.aspect === 'active')) {
        if (t.aspect === 'behavior' && s.aspect === 'behavior') return ok;
        if (s.aspect === 'active' && t.aspect === 'active') return ok;
        if (s.aspect === 'passive' && t.aspect === 'passive') return ok;
        if (s.aspect === 'active' && t.aspect === 'behavior') return no(`Una estructura activa se asigna al comportamiento, no lo realiza (${pair}).`);
      }
      if (isCore(s.layer) && isCore(t.layer)) {
        // Cross-layer realisation goes upward: technology → application → business.
        const up = CORE_ORDER.indexOf(s.layer) < CORE_ORDER.indexOf(t.layer);
        if (!up) return no(`La realización entre capas va hacia arriba: tecnología → aplicación → negocio (${pair}).`);
        return ok;
      }
      if (s.layer === 'strategy' || t.layer === 'strategy') return ok;
      return no(`Realización no válida (${pair}).`);
    case 'serving':
      if (s.aspect === 'motivation' || s.aspect === 'passive' || t.aspect === 'motivation' || t.aspect === 'passive') {
        return no(`Servicio a conecta servicios o interfaces con quien los usa, no con motivación ni objetos pasivos (${pair}).`);
      }
      if (isCore(s.layer) && isCore(t.layer)) {
        if (CORE_ORDER.indexOf(s.layer) <= CORE_ORDER.indexOf(t.layer)) return ok;
        return no(`Una capa superior no sirve a una inferior (${pair}).`);
      }
      return ok;
    case 'access':
      if (t.aspect === 'passive' && (s.aspect === 'behavior' || s.aspect === 'active')) return ok;
      return no(`Acceso va de comportamiento o estructura activa a un objeto pasivo (${pair}).`);
    case 'influence':
      if (t.layer === 'motivation' || s.layer === 'motivation') return ok;
      return no(`Influencia relaciona elementos de motivación (${pair}).`);
    case 'triggering':
    case 'flow':
      if (s.aspect === 'behavior' && t.aspect === 'behavior') return ok;
      if (s.layer === 'implementation' && t.layer === 'implementation') return ok;
      return no(`${ARCHIMATE_RELATION_LABELS[relation]} ocurre entre elementos de comportamiento (${pair}).`);
  }
}
