/**
 * Concrete artifact contracts (Task 3).
 *
 * One contract per artifact family. Diagram families share a single
 * pattern-matched contract that delegates scoring/repair to the existing
 * deterministic diagram quality gate — no logic is duplicated here.
 */

import type { ArtifactContract, ContractSection } from '../ArtifactContract';

// ── Reusable section builders ────────────────────────────────────────────────

const section = (
  id: string,
  label: string,
  keywords: string[],
  requirement: ContractSection['requirement'],
  extra: Partial<Pick<ContractSection, 'severity' | 'repairTemplate'>> = {},
): ContractSection => ({ id, label, keywords, requirement, ...extra });

const OBJECTIVE = (requirement: ContractSection['requirement']): ContractSection =>
  section('objective', 'Objetivo', ['objetivo', 'objective', 'goal', 'proposito', 'purpose'], requirement, {
    severity: 'high',
    repairTemplate: {
      heading: '## Objetivo',
      body: '> _Pendiente de completar_: describe en 1-2 frases el objetivo principal del artefacto.',
    },
  });

const SCOPE = (requirement: ContractSection['requirement']): ContractSection =>
  section('scope', 'Alcance', ['alcance', 'scope', 'in scope', 'out of scope', 'fuera de alcance'], requirement, {
    severity: 'medium',
    repairTemplate: {
      heading: '## Alcance',
      body: '- **Incluye:** _Pendiente de completar_\n- **Excluye:** _Pendiente de completar_',
    },
  });

const CONTEXT = (requirement: ContractSection['requirement']): ContractSection =>
  section('context', 'Contexto', ['contexto', 'context', 'background', 'antecedentes'], requirement, {
    severity: 'medium',
    repairTemplate: {
      heading: '## Contexto',
      body: '> _Pendiente de completar_: contexto de negocio y antecedentes relevantes.',
    },
  });

const ASSUMPTIONS = (requirement: ContractSection['requirement']): ContractSection =>
  section('assumptions', 'Supuestos', ['supuestos', 'assumptions', 'premisas'], requirement, {
    severity: 'low',
    repairTemplate: { heading: '## Supuestos', body: '- _Pendiente de completar_' },
  });

const RISKS = (requirement: ContractSection['requirement']): ContractSection =>
  section('risks', 'Riesgos', ['riesgos', 'risks', 'mitigaciones', 'mitigation'], requirement, {
    severity: 'medium',
    repairTemplate: {
      heading: '## Riesgos',
      body: '| Riesgo | Severidad | Mitigación |\n|---|---|---|\n| _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ |',
    },
  });

const ACCEPTANCE = (requirement: ContractSection['requirement']): ContractSection =>
  section(
    'acceptance',
    'Criterios de aceptación',
    ['criterios de aceptacion', 'acceptance criteria', 'definition of done', 'definicion de terminado'],
    requirement,
    {
      severity: 'medium',
      repairTemplate: {
        heading: '## Criterios de aceptación',
        body: '- [ ] _Pendiente de completar_: criterio medible y verificable.',
      },
    },
  );

const DEFAULT_RULES = {
  requireHeadings: true,
  requireTitle: true,
  forbidPlaceholders: true,
  expectsTables: false,
  expectsGherkin: false,
  expectsTraceabilityTable: false,
  allowSectionScaffolding: true,
} as const;

const DIAGRAM_RULES = {
  requireHeadings: false,
  requireTitle: false,
  forbidPlaceholders: false,
  expectsTables: false,
  expectsGherkin: false,
  expectsTraceabilityTable: false,
  allowSectionScaffolding: false,
} as const;

// ── Contracts ────────────────────────────────────────────────────────────────

export const ARTIFACT_CONTRACTS: ArtifactContract[] = [
  // 1 — Generic Markdown document
  {
    id: 'contract.document.markdown',
    label: 'Documento Markdown',
    appliesTo: ['markdown'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [OBJECTIVE('required'), CONTEXT('recommended'), SCOPE('recommended'), ASSUMPTIONS('recommended'), RISKS('recommended')],
    minWordCount: 80,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.markdown.structure',
        title: 'Refuerza la estructura jerárquica',
        detail: 'Usa encabezados ## para separar objetivo, contexto y conclusiones; mejora la navegación y la exportación.',
      },
    ],
  },

  // 2 — Hybrid text + diagram
  {
    id: 'contract.hybrid.text-diagram',
    label: 'Documento + Diagrama',
    appliesTo: ['hybrid-text-diagram'],
    representation: 'hybrid',
    defaultAudience: 'mixed',
    sections: [OBJECTIVE('required'), CONTEXT('recommended'), SCOPE('recommended'), RISKS('recommended')],
    minWordCount: 60,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 78, exportFloor: 50 },
    delegatesToDiagramGate: true,
    automaticRecommendations: [
      {
        id: 'rec.hybrid.alignment',
        title: 'Alinea narrativa y diagrama',
        detail: 'Asegura que el texto explique el diagrama y que cada nodo clave aparezca mencionado en la narrativa.',
      },
    ],
  },

  // 3 — Executive presentation (executive + summary briefing decks)
  {
    id: 'contract.presentation.executive',
    label: 'Presentación ejecutiva',
    appliesTo: ['presentation-executive', 'presentation-summary'],
    representation: 'document',
    defaultAudience: 'executive',
    sections: [
      OBJECTIVE('required'),
      CONTEXT('required'),
      section('decisions', 'Decisiones estratégicas', ['decisiones', 'decisions', 'adr'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Decisiones estratégicas',
          body: '- _Pendiente de completar_: decisión y justificación de negocio.',
        },
      }),
      RISKS('required'),
      section('next-steps', 'Próximos pasos', ['proximos pasos', 'next steps', 'roadmap'], 'recommended', {
        severity: 'low',
        repairTemplate: {
          heading: '## Próximos pasos',
          body: '- _Pendiente de completar_: define la siguiente acción concreta.',
        },
      }),
    ],
    minWordCount: 60,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 85, exportFloor: 55 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.executive.concise',
        title: 'Mantén el tono ejecutivo',
        detail: 'Prioriza decisiones, impacto y riesgos; evita detalle técnico profundo y frases largas.',
      },
    ],
  },

  // 4 — Technical presentation (technical + architecture overview decks)
  {
    id: 'contract.presentation.technical',
    label: 'Presentación técnica',
    appliesTo: ['presentation-technical', 'presentation-overview'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      OBJECTIVE('required'),
      CONTEXT('recommended'),
      SCOPE('recommended'),
      ASSUMPTIONS('recommended'),
      RISKS('recommended'),
      ACCEPTANCE('recommended'),
    ],
    minWordCount: 80,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.technical.depth',
        title: 'Documenta supuestos y restricciones',
        detail: 'Las presentaciones técnicas deben hacer explícitas las restricciones, dependencias y decisiones de diseño.',
      },
    ],
  },

  // 5 — BRD
  {
    id: 'contract.sdd.brd',
    label: 'SDD · Documento de Requisitos de Negocio (BRD)',
    appliesTo: ['sdd-brd'],
    representation: 'document',
    defaultAudience: 'mixed',
    sections: [
      section('business-objective', 'Objetivo de negocio', ['objetivo de negocio', 'business objective', 'objetivo'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Objetivo de negocio',
          body: '> _Pendiente de completar_: objetivo de negocio que justifica la iniciativa.',
        },
      }),
      SCOPE('required'),
      section('stakeholders', 'Stakeholders', ['stakeholders', 'interesados', 'partes interesadas'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Stakeholders',
          body: '| Stakeholder | Rol | Interés |\n|---|---|---|\n| _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ |',
        },
      }),
      section('functional-requirements', 'Requerimientos funcionales', ['requerimientos funcionales', 'functional requirements'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Requerimientos funcionales',
          body: '- **RF-01** _Pendiente de completar_.',
        },
      }),
      section('nfr', 'Requerimientos no funcionales', ['requerimientos no funcionales', 'non-functional requirements', 'nfr'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Requerimientos no funcionales',
          body: '- **RNF-01** _Pendiente de completar_.',
        },
      }),
      section('business-rules', 'Reglas de negocio', ['reglas de negocio', 'business rules'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Reglas de negocio', body: '- _Pendiente de completar_.' },
      }),
      ASSUMPTIONS('required'),
      RISKS('required'),
      ACCEPTANCE('required'),
    ],
    minWordCount: 140,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 82, exportFloor: 52 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.brd.measurable',
        title: 'Haz medibles los requerimientos',
        detail: 'Cada requerimiento debe ser verificable; vincula los funcionales con criterios de aceptación.',
      },
    ],
  },

  // 6 — Use case
  {
    id: 'contract.sdd.use-case',
    label: 'SDD · Especificación de Caso de Uso',
    appliesTo: ['sdd-use-case'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('primary-actor', 'Actor principal', ['actor principal', 'primary actor', 'actor'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Actor principal', body: '> _Pendiente de completar_: actor principal del caso de uso.' },
      }),
      section('preconditions', 'Precondiciones', ['precondiciones', 'preconditions'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Precondiciones', body: '- _Pendiente de completar_.' },
      }),
      section('main-flow', 'Flujo principal', ['flujo principal', 'main flow', 'basic flow'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Flujo principal', body: '1. _Pendiente de completar_.' },
      }),
      section('alternate-flows', 'Flujos alternos', ['flujos alternos', 'alternate flows', 'alternative flows'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Flujos alternos', body: '- _Pendiente de completar_.' },
      }),
      section('exceptions', 'Excepciones', ['excepciones', 'exceptions', 'error flows'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Excepciones', body: '- _Pendiente de completar_.' },
      }),
      section('postconditions', 'Postcondiciones', ['postcondiciones', 'postconditions'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Postcondiciones', body: '- _Pendiente de completar_.' },
      }),
      section('business-rules', 'Reglas de negocio', ['reglas de negocio', 'business rules'], 'recommended'),
      ACCEPTANCE('required'),
    ],
    minWordCount: 120,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 82, exportFloor: 52 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.usecase.flows',
        title: 'Cubre los caminos alternos',
        detail: 'Un caso de uso world-class documenta flujos alternos y excepciones, no sólo el camino feliz.',
      },
    ],
  },

  // 7 — User story
  {
    id: 'contract.sdd.user-story',
    label: 'SDD · Mapa de Historias de Usuario',
    appliesTo: ['sdd-user-story'],
    representation: 'document',
    defaultAudience: 'mixed',
    sections: [
      section('epics', 'Épicas', ['epicas', 'epics', 'epica'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Épicas', body: '- _Pendiente de completar_.' },
      }),
      section('user-stories', 'Historias de usuario', ['historias de usuario', 'user stories', 'historia de usuario'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Historias de usuario',
          body: '- **Como** _rol_, **quiero** _necesidad_, **para** _beneficio_. _(Pendiente de completar)_',
        },
      }),
      ACCEPTANCE('required'),
      section('priority', 'Prioridad', ['prioridad', 'priority', 'moscow'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Prioridad', body: '- _Pendiente de completar_.' },
      }),
      section('dependencies', 'Dependencias', ['dependencias', 'dependencies'], 'recommended'),
      RISKS('recommended'),
      section('definition-of-done', 'Definición de terminado', ['definicion de terminado', 'definition of done', 'dod'], 'recommended'),
    ],
    minWordCount: 110,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.userstory.invest',
        title: 'Aplica el principio INVEST',
        detail: 'Cada historia debe ser independiente, negociable, valiosa, estimable, pequeña y testeable.',
      },
    ],
  },

  // 8 — Domain model
  {
    id: 'contract.sdd.domain-model',
    label: 'SDD · Modelo de Dominio (DDD)',
    appliesTo: ['sdd-domain-model'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('entities', 'Entidades', ['entidades', 'entities', 'entidad'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Entidades', body: '- _Pendiente de completar_.' },
      }),
      section('attributes', 'Atributos principales', ['atributos', 'attributes'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Atributos principales', body: '- _Pendiente de completar_.' },
      }),
      section('relationships', 'Relaciones', ['relaciones', 'relationships'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Relaciones', body: '- _Pendiente de completar_.' },
      }),
      section('bounded-contexts', 'Bounded contexts', ['bounded contexts', 'contextos delimitados', 'bounded context'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Bounded contexts', body: '- _Pendiente de completar_.' },
      }),
      section('aggregates', 'Agregados', ['agregados', 'aggregates', 'aggregate'], 'recommended'),
      section('domain-rules', 'Reglas de dominio', ['reglas de dominio', 'domain rules', 'invariantes'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Reglas de dominio', body: '- _Pendiente de completar_.' },
      }),
    ],
    minWordCount: 120,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 82, exportFloor: 52 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.domain.ubiquitous',
        title: 'Usa lenguaje ubicuo',
        detail: 'Mantén un vocabulario consistente entre entidades, agregados y reglas de dominio.',
      },
    ],
  },

  // 9 — Event storming
  {
    id: 'contract.sdd.event-storming',
    label: 'SDD · Event Storming',
    appliesTo: ['sdd-event-storming'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('domain-events', 'Eventos de dominio', ['eventos de dominio', 'domain events', 'evento'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Eventos de dominio', body: '- _Pendiente de completar_.' },
      }),
      section('commands', 'Comandos', ['comandos', 'commands', 'comando'], 'required', {
        severity: 'high',
        repairTemplate: { heading: '## Comandos', body: '- _Pendiente de completar_.' },
      }),
      section('aggregates', 'Agregados', ['agregados', 'aggregates'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Agregados', body: '- _Pendiente de completar_.' },
      }),
      section('actors', 'Actores', ['actores', 'actors', 'actor'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Actores', body: '- _Pendiente de completar_.' },
      }),
      section('external-systems', 'Sistemas externos', ['sistemas externos', 'external systems'], 'recommended'),
      section('policies', 'Políticas', ['politicas', 'policies', 'policy'], 'recommended'),
      section('read-models', 'Read models', ['read models', 'lecturas', 'vistas de lectura'], 'recommended'),
    ],
    minWordCount: 110,
    rules: { ...DEFAULT_RULES },
    thresholds: { recommended: 78, exportFloor: 48 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.eventstorming.causality',
        title: 'Encadena causa y efecto',
        detail: 'Cada evento debe poder rastrearse hasta un comando y un actor o política que lo dispara.',
      },
    ],
  },

  // 10 — Glossary
  {
    id: 'contract.sdd.glossary',
    label: 'SDD · Glosario de Lenguaje Ubicuo',
    appliesTo: ['sdd-glossary'],
    representation: 'document',
    defaultAudience: 'mixed',
    sections: [
      section('terms', 'Términos', ['terminos', 'terms', 'termino', 'glosario'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Términos',
          body: '| Término | Definición | Dominio |\n|---|---|---|\n| _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ |',
        },
      }),
      section('definitions', 'Definiciones', ['definicion', 'definitions', 'definicion recomendada'], 'required', {
        severity: 'high',
      }),
      section('domain', 'Dominio', ['dominio', 'domain'], 'recommended'),
      section('synonyms', 'Sinónimos', ['sinonimos', 'synonyms'], 'recommended'),
      section('ambiguities', 'Ambigüedades', ['ambiguedades', 'ambiguities', 'ambiguedad'], 'recommended'),
      section('recommended-use', 'Uso recomendado', ['uso recomendado', 'recommended use'], 'recommended'),
    ],
    minWordCount: 60,
    rules: { ...DEFAULT_RULES, expectsTables: true },
    thresholds: { recommended: 75, exportFloor: 45 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.glossary.consistency',
        title: 'Resuelve ambigüedades',
        detail: 'Documenta sinónimos y términos en conflicto para evitar interpretaciones divergentes.',
      },
    ],
  },

  // 11 — NFR
  {
    id: 'contract.sdd.nfr',
    label: 'SDD · Requisitos No Funcionales (ISO 25010)',
    appliesTo: ['sdd-nfr'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('quality-attributes', 'Atributos de calidad', ['atributos de calidad', 'quality attributes', 'atributo de calidad'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Atributos de calidad',
          body: '| Atributo | Métrica | Umbral | Escenario | Medición | Riesgo |\n|---|---|---|---|---|---|\n| _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ |',
        },
      }),
      section('metrics', 'Métricas y umbrales', ['metrica', 'metrics', 'umbral', 'threshold'], 'required', {
        severity: 'high',
      }),
      section('quality-scenarios', 'Escenarios de calidad', ['escenarios de calidad', 'quality scenarios', 'escenario de calidad'], 'required', {
        severity: 'medium',
        repairTemplate: { heading: '## Escenarios de calidad', body: '- _Pendiente de completar_.' },
      }),
      section('measurement', 'Método de medición', ['metodo de medicion', 'measurement method', 'medicion'], 'required', {
        severity: 'medium',
      }),
      RISKS('required'),
      section('traceability', 'Evidencia / trazabilidad', ['evidencia', 'trazabilidad', 'traceability'], 'recommended'),
    ],
    minWordCount: 110,
    rules: { ...DEFAULT_RULES, expectsTables: true },
    thresholds: { recommended: 82, exportFloor: 52 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.nfr.measurable',
        title: 'Cada NFR debe ser medible',
        detail: 'Un atributo de calidad sin métrica y umbral no es verificable; añade escenario y método de medición.',
      },
    ],
  },

  // 12 — BDD
  {
    id: 'contract.sdd.bdd',
    label: 'SDD · Escenarios BDD (Gherkin)',
    appliesTo: ['sdd-bdd'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('scenarios', 'Escenarios', ['escenarios', 'scenarios', 'scenario', 'feature'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Escenarios',
          body: '```gherkin\nFeature: _Pendiente de completar_\n\n  Scenario: _Pendiente de completar_\n    Given _Pendiente de completar_\n    When _Pendiente de completar_\n    Then _Pendiente de completar_\n```',
        },
      }),
      section('business-rules', 'Reglas de negocio', ['reglas de negocio', 'business rules'], 'recommended'),
    ],
    minWordCount: 60,
    rules: { ...DEFAULT_RULES, expectsGherkin: true },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.bdd.negative',
        title: 'Cubre casos positivos y negativos',
        detail: 'Un set BDD world-class incluye escenarios de éxito y de error/excepción.',
      },
    ],
  },

  // 13 — Traceability matrix
  {
    id: 'contract.sdd.traceability',
    label: 'SDD · Matriz de Trazabilidad',
    appliesTo: ['sdd-traceability'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [
      section('matrix', 'Matriz de trazabilidad', ['matriz de trazabilidad', 'traceability matrix', 'trazabilidad'], 'required', {
        severity: 'high',
        repairTemplate: {
          heading: '## Matriz de trazabilidad',
          body: '| Requisito | Fuente | Artefacto | Caso de prueba | Estado | Riesgo | Cobertura |\n|---|---|---|---|---|---|---|\n| _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ | _Pendiente de completar_ |',
        },
      }),
      section('coverage', 'Cobertura', ['cobertura', 'coverage'], 'recommended'),
    ],
    minWordCount: 40,
    rules: { ...DEFAULT_RULES, expectsTables: true, expectsTraceabilityTable: true },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.traceability.coverage',
        title: 'Cierra la trazabilidad de extremo a extremo',
        detail: 'Cada requisito debe enlazar a una fuente, un artefacto de diseño y un caso de prueba con su estado.',
      },
    ],
  },

  // 14 — Mermaid diagrams (pattern-matched, delegates to diagram gate)
  {
    id: 'contract.diagram.mermaid',
    label: 'Diagrama Mermaid',
    appliesTo: [],
    pattern: 'mermaid-*',
    representation: 'diagram',
    defaultAudience: 'technical',
    sections: [],
    minWordCount: 0,
    rules: { ...DIAGRAM_RULES },
    thresholds: { recommended: 80, exportFloor: 50 },
    delegatesToDiagramGate: true,
    automaticRecommendations: [
      {
        id: 'rec.diagram.labels',
        title: 'Etiqueta nodos y relaciones',
        detail: 'Labels claros en nodos y aristas elevan la legibilidad y la calidad de exportación.',
      },
    ],
  },

  // 15 — ReactFlow graph
  {
    id: 'contract.diagram.react-flow',
    label: 'Grafo ReactFlow',
    appliesTo: ['react-flow-graph'],
    representation: 'diagram',
    defaultAudience: 'technical',
    sections: [],
    minWordCount: 0,
    rules: { ...DIAGRAM_RULES },
    thresholds: { recommended: 78, exportFloor: 48 },
    delegatesToDiagramGate: true,
    automaticRecommendations: [
      {
        id: 'rec.reactflow.connectivity',
        title: 'Evita nodos huérfanos',
        detail: 'Conecta cada nodo al grafo; los nodos aislados reducen la claridad del flujo de datos.',
      },
    ],
  },

  // 16 — YAML
  {
    id: 'contract.document.yaml',
    label: 'Especificación YAML',
    appliesTo: ['yaml'],
    representation: 'document',
    defaultAudience: 'technical',
    sections: [],
    minWordCount: 8,
    rules: {
      requireHeadings: false,
      requireTitle: false,
      forbidPlaceholders: true,
      expectsTables: false,
      expectsGherkin: false,
      expectsTraceabilityTable: false,
      allowSectionScaffolding: false,
    },
    thresholds: { recommended: 75, exportFloor: 45 },
    delegatesToDiagramGate: false,
    automaticRecommendations: [
      {
        id: 'rec.yaml.valid',
        title: 'Verifica la sintaxis YAML',
        detail: 'Mantén la indentación consistente y evita claves duplicadas para que el documento sea parseable.',
      },
    ],
  },
];

/** Safe fallback contract for any artifact type without an explicit match. */
export const FALLBACK_DOCUMENT_CONTRACT: ArtifactContract = {
  id: 'contract.document.fallback',
  label: 'Documento (genérico)',
  appliesTo: [],
  representation: 'document',
  defaultAudience: 'technical',
  sections: [OBJECTIVE('recommended')],
  minWordCount: 40,
  rules: { ...DEFAULT_RULES, requireTitle: false, allowSectionScaffolding: false },
  thresholds: { recommended: 75, exportFloor: 45 },
  delegatesToDiagramGate: false,
  automaticRecommendations: [],
};

export const FALLBACK_DIAGRAM_CONTRACT: ArtifactContract = {
  id: 'contract.diagram.fallback',
  label: 'Diagrama (genérico)',
  appliesTo: [],
  representation: 'diagram',
  defaultAudience: 'technical',
  sections: [],
  minWordCount: 0,
  rules: { ...DIAGRAM_RULES },
  thresholds: { recommended: 75, exportFloor: 45 },
  delegatesToDiagramGate: true,
  automaticRecommendations: [],
};
