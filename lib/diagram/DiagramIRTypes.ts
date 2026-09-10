/**
 * DiagramIR — the canonical, renderer-independent model of a diagram.
 *
 * The whole pipeline is built on these ten declarations: `mermaidToIR` produces
 * one, `irToReactFlow`, `irToExcalidraw` and `irToMermaid` consume it, and the
 * quality gates score it. They lived in the root `types.ts` — 400 of its 1.268
 * lines — which meant every one of the 244 files importing anything from that
 * file was recompiled when an edge label slot changed, the Training Center
 * included.
 *
 * Nothing here imports anything. The IR is deliberately closed over itself:
 * that is what lets the pipeline stay deterministic and what makes it possible
 * to move it at all.
 */

export type DiagramAudience = 'executive' | 'technical' | 'operations';

export type DiagramTheme = 'editorial' | 'whiteboard' | 'monochrome' | 'high-contrast';

export type DiagramDensity = 'compact' | 'standard' | 'rich';

/**
 * Canonical reasons that surface to the user when a diagram generation step
 * fails. Persisted on `Artifact.lastDiagramError` so the UI can replay the
 * latest failure across reloads and the corrective retry can use it as the
 * `lastFailure` hint when re-prompting the model.
 */
export type DiagramFailureReason =
  | 'no-mermaid'
  | 'empty-ir'
  | 'json-parse'
  | 'schema-violation'
  | 'transient'
  | 'skeleton-fallback';

export interface DiagramErrorRecord {
  reason: DiagramFailureReason;
  attempt: number;
  at: string;
  sample?: string;
  message?: string;
}

export type NodeShape = 'rectangle' | 'cylinder' | 'hexagon' | 'cloud' | 'person' | 'diamond' | 'tab-box';

export interface DiagramNodeData {
  label: string;
  type: string;
  description: string;
  // Enhanced visual metadata (all optional for backward compatibility)
  shape?: NodeShape;
  group?: string;
  status?: 'active' | 'warning' | 'error';
  badge?: string;
  icon?: string;
  color?: string;
  /** Canonical C4 kind when the node came from a C4 Mermaid source. */
  kind?: string;
  /** Technology hint (e.g. "PostgreSQL 15") surfaced as a tech badge. */
  technology?: string;
  /**
   * Canonical semantic role pre-computed by the IR pipeline. CustomNode
   * trusts this when present (avoids re-running the heuristic at render
   * time) and falls back to deriving it from `kind` / `label` otherwise.
   */
  semanticRole?:
    | 'person'
    | 'system'
    | 'gateway'
    | 'data'
    | 'messaging'
    | 'external'
    | 'service'
    | 'process'
    | 'generic';
  /**
   * Granular semantic classification (matches `DiagramIRNode.semanticType`).
   * Surfaced by the pipeline so renderers and the inspector can show the
   * full taxonomy without re-running the classifier.
   */
  semanticType?: DiagramIRNode['semanticType'];
  /**
   * Pre-resolved human-readable category label (Spanish). Replaces the raw
   * `kind` value in the node badge so the user no longer sees `"GENERIC"`
   * when the AI emits a placeholder kind.
   */
  category?: string;
}

export interface DiagramEdgeData {
  edgeType?: 'sync' | 'async' | 'data-flow' | 'dependency' | 'inheritance';
  animated?: boolean;
  /** Short protocol / technology label (e.g. "REST/HTTPS", "Kafka"). Renders as a badge next to the label. */
  protocol?: string;
  /** Direction marker — `bidirectional` adds reverse markers in the renderer. */
  direction?: 'unidirectional' | 'bidirectional';
  /** Criticality drives extra stroke weight and a glow when set to `critical`. */
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  /** Sensitivity classification surfaced in the inspector. */
  dataSensitivity?: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'phi' | 'pci';
  /** Free-text retry policy description for the inspector ("3 retries · exponential backoff"). */
  retryPolicy?: string;
  /** Granular semantic classification (matches `DiagramIREdge.semanticType`). */
  semanticType?: DiagramIREdge['semanticType'];
}

// Canonical intermediate representation (DiagramIR)
export interface DiagramIRNode {
  id: string;
  label: string;
  kind: string;
  /**
   * Persisted canvas position. Written by the round-trip (`toDiagramIR`)
   * whenever the architect moves a node on the interactive canvas. When
   * `metadata.layoutMode === 'manual'` the renderers honour these positions
   * instead of recomputing an automatic layout, so manual adjustments
   * survive reloads, audience switches and re-renders.
   */
  position?: { x: number; y: number };
  description?: string;
  /**
   * Optional technology hint (e.g. "PostgreSQL 15", "Java, Spring Boot") used by
   * C4 Container/Component diagrams. Renderers surface it as a tech badge.
   */
  technology?: string;
  group?: string;
  shape?: NodeShape;
  icon?: string;
  status?: 'active' | 'warning' | 'error';
  badge?: string;
  tags?: string[];
  /**
   * Canonical semantic role resolved by `semanticRoleResolver`. When set, it
   * is the authoritative input for palette / icon selection. Renderers fall
   * back to deriving the role from `kind` + `label` when this field is
   * absent (legacy IR or content imported from an older snapshot).
   */
  semanticRole?:
    | 'person'
    | 'system'
    | 'gateway'
    | 'data'
    | 'messaging'
    | 'external'
    | 'service'
    | 'process'
    | 'generic';
  /**
   * Optional domain-level semantic classifier (backward compatible).
   * Used to distinguish business/technical node archetypes beyond UI role.
   */
  semanticType?:
    | 'human-actor'
    | 'business-role'
    | 'internal-system'
    | 'external-system'
    | 'legacy-system'
    | 'application'
    | 'portal'
    | 'api'
    | 'service'
    | 'microservice'
    | 'component'
    | 'c4-container'
    | 'database'
    | 'document-repository'
    | 'integration-platform'
    | 'messaging'
    | 'cloud-service'
    | 'security-service'
    | 'notification-service'
    | 'rules-engine'
    | 'business-process'
    | 'external-provider'
    | 'digital-channel'
    | 'batch-file'
    | 'report'
    | 'dashboard'
    | 'data-product'
    | 'analytics-system'
    | 'generic';
  /**
   * Phase 2 — extended governance / architecture metadata. All fields are
   * optional so legacy IRs continue to parse without migration.
   *
   * `owner` identifies the team or capability accountable for the node.
   * `domain` declares the business domain (e.g. "Claims", "Member").
   * `dataClassification` carries the data sensitivity (PHI/PII/etc.).
   * `securityLevel` describes the trust zone or applied controls.
   * `compliance` lists frameworks the node must satisfy (HIPAA, PCI...).
   * `criticality` mirrors the edge criticality scale for business impact.
   * `trust` captures the trust boundary the node lives in.
   * `businessMeaning` / `technicalMeaning` keep audience-specific copy
   * usable by the audience projector and the inspector without overloading
   * the description field.
   */
  owner?: string;
  domain?: string;
  dataClassification?: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'phi' | 'pci';
  securityLevel?: 'none' | 'standard' | 'elevated' | 'critical';
  compliance?: string[];
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  trust?: 'internal' | 'partner' | 'external' | 'public';
  businessMeaning?: string;
  technicalMeaning?: string;
}

export interface DiagramIREdge {
  id: string;
  source: string;
  target: string;
  label: string;
  relation?: DiagramEdgeData['edgeType'] | 'default';
  protocol?: string;
  direction?: 'unidirectional' | 'bidirectional';
  criticality?: 'low' | 'medium' | 'high' | 'critical';
  animated?: boolean;
  dataSensitivity?: 'public' | 'internal' | 'confidential' | 'restricted' | 'pii' | 'phi' | 'pci';
  retryPolicy?: string;
  semanticType?:
    | 'rest-api'
    | 'soap'
    | 'graphql'
    | 'event'
    | 'async-messaging'
    | 'batch'
    | 'file-transfer'
    | 'query'
    | 'publish'
    | 'subscribe'
    | 'authentication'
    | 'authorization'
    | 'notification'
    | 'data-transfer'
    | 'synchronization'
    | 'orchestration'
    | 'composition'
    | 'dependency'
    | 'business-flow'
    | 'data-flow'
    | 'control-flow'
    | 'generic';
  /**
   * Phase 2 — extended interaction metadata. All optional, so legacy IRs
   * stay valid.
   *
   * `frequency` documents how often the interaction happens (real-time /
   * batch). `synchrony` differentiates sync/async beyond the relation
   * kind. `security` lists the applied controls (mTLS, JWT, OAuth...).
   * `payload` describes the data envelope (FHIR Bundle, X12 837, JSON).
   * `trust` mirrors the source/target trust zone hop.
   * `businessMeaning` / `technicalMeaning` mirror node-level audience
   * meanings.
   * `observability` captures the monitoring posture (metrics, traces,
   * logs). `sla` carries the SLA / SLO target.
   * `errorHandling` describes the failure compensation strategy.
   */
  frequency?: 'real-time' | 'near-real-time' | 'batch' | 'on-demand' | 'periodic';
  synchrony?: 'sync' | 'async' | 'fire-and-forget' | 'request-reply';
  security?: string;
  payload?: string;
  trust?: 'internal' | 'partner' | 'external' | 'public';
  businessMeaning?: string;
  technicalMeaning?: string;
  observability?: string;
  sla?: string;
  errorHandling?: string;
}

export interface DiagramIRGroup {
  id: string;
  label: string;
  nodeIds: string[];
  /**
   * Optional semantic kind. When omitted, defaults to a generic
   * translucent container.
   *
   *  - `swimlane`         — BPMN-style horizontal lane that owns a process
   *                          actor. Lanes stack vertically; the layout engine
   *                          arranges member nodes in a single horizontal row
   *                          per lane.
   *  - `system-boundary`  — C4 boundary box for the system of interest.
   *  - `enterprise`       — Higher-level wrapper grouping multiple systems
   *                          inside the same enterprise.
   *  - `security`         — Trust / security boundary.
   *  - `external-provider`— External provider perimeter.
   *  - `data`             — Data zone (databases / warehouses / lakes).
   *  - `cloud`            — Cloud-provider boundary (AWS / Azure / GCP).
   *  - `legacy`           — Legacy system perimeter.
   *  - `integration`      — Integration / iPaaS layer.
   *  - `cluster`          — Generic cluster (fallback when no specific kind
   *                          applies).
   */
  kind?:
    | 'swimlane'
    | 'system-boundary'
    | 'enterprise'
    | 'security'
    | 'external-provider'
    | 'data'
    | 'cloud'
    | 'legacy'
    | 'integration'
    | 'cluster';
  /**
   * Phase 2 — semantic boundary metadata. All optional.
   *
   * `purpose` describes WHY the boundary exists (e.g. "Isolate PHI",
   * "Per-tenant scope"). `boundaryType` differentiates the architectural
   * boundary category (trust, network, data, organizational). `owner`
   * names the team accountable for the boundary, and `trust` is the
   * trust zone the boundary represents.
   */
  purpose?: string;
  boundaryType?: 'trust' | 'network' | 'data' | 'organizational' | 'process' | 'compliance';
  owner?: string;
  trust?: 'internal' | 'partner' | 'external' | 'public';
}

export interface DiagramCallout {
  id: string;
  targetId: string; // nodeId or edgeId
  targetKind?: 'node' | 'edge';
  index?: number;
  text: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface DiagramScene {
  id: string;
  title: string;
  focusNodeIds: string[];
  focusEdgeIds: string[];
  insight?: string;
}

export interface DiagramNarrative {
  title?: string;
  summary?: string;
  callouts?: DiagramCallout[];
  scenes?: DiagramScene[];
  /**
   * Who wrote this. `authored` is the architect's or the model's story;
   * `derived` is a summary the repair pass composed from the topology when
   * the diagram arrived without one.
   *
   * The field exists because the repair used to write its synthesis into the
   * same shape as a written story and the quality engine then paid for it: a
   * dimension called *narrativa* awarded ten points for the field being
   * non-empty, which the repair guaranteed on every diagram. An estimate
   * presented with the authority of a statement is the failure this marks.
   * Absent means `authored` — everything written before this field existed
   * came from a model or a person.
   */
  source?: 'authored' | 'derived';
}

export interface DiagramIR {
  nodes: DiagramIRNode[];
  edges: DiagramIREdge[];
  groups: DiagramIRGroup[];
  metadata?: {
    sourceFormat?: 'react-flow' | 'mermaid' | 'excalidraw' | 'unknown';
    audience?: DiagramAudience;
    generatedAt?: string;
    title?: string;
    /**
     * Narrative payload. Accepts legacy string form for backwards compatibility
     * with earlier persisted artifacts that only stored a summary.
     */
    narrative?: string | DiagramNarrative;
    theme?: DiagramTheme;
    density?: DiagramDensity;
    qualityReview?: {
      score?: number;
      issues?: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; message: string; recommendation?: string }>;
    };
    originalDialect?: string;
    degradationReason?: string;
    /**
     * Marks the IR as the deterministic skeleton fallback produced after
     * exhausting AI retries. Renderers add a "Esqueleto base — edítame"
     * badge and the quality service caps the score so the user is nudged
     * to regenerate with more context.
     */
    fallback?: 'skeleton';
    repairHistory?: Array<{
      at: string;
      reason: string;
      changes: string[];
    }>;
    exportMetadata?: {
      requestedAt?: string;
      format?: 'png' | 'svg' | 'mermaid' | 'markdown' | 'json';
      scale?: number;
    };
    /**
     * Phase 2 — explicit diagram archetype, independent from the artifact
     * type. The pipeline derives it from heuristics when missing, but
     * downstream renderers/validators should prefer the explicit value
     * when present.
     */
    diagramType?:
      | 'c4-context'
      | 'c4-container'
      | 'c4-component'
      | 'c4-deployment'
      | 'integration'
      | 'bpmn-process'
      | 'value-stream'
      | 'data-flow'
      | 'deployment'
      | 'sequence'
      | 'erd'
      | 'generic';
    /**
     * Phase 2 — last layout plan applied. Used by diagnostics, the
     * inspector and the export frame to surface which engine produced
     * the current positions. Persisted across reloads so we can detect
     * regressions.
     *
     * Gap 3: when `userOverride` is true the layout selector honours the
     * stored `direction` / `density` instead of recomputing them from the
     * archetype heuristics. This is how the deterministic suggestion
     * actions (set-layout-direction, set-layout-density) survive across
     * reloads and ELK re-passes.
     */
    layoutPlan?: {
      backend: 'dagre' | 'elk';
      algorithm?: string;
      direction?: 'TB' | 'LR' | 'BT' | 'RL';
      density?: 'compact' | 'normal' | 'spacious';
      orthogonal?: boolean;
      rationale?: string;
      computedAt?: string;
      userOverride?: boolean;
    };
    /**
     * `manual` when the architect repositioned nodes on the canvas: the
     * per-node `DiagramIRNode.position` values become the source of truth
     * and the automatic layout engines (dagre/ELK) are skipped. `auto`
     * (or absent) keeps the canonical layout pipeline in charge.
     */
    layoutMode?: 'auto' | 'manual';
    /** Bumped by `irMigration` whenever the persisted schema changes. */
    schemaVersion?: number;
  };
}
