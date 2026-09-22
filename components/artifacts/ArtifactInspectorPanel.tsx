import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Tabs, TabList, Tab, TabPanel, Badge, Alert, Button } from '../ui';
import { ArrowLeftIcon } from '../Icons';
import type { Artifact } from '../../lib/artifacts';
import { type ArtifactCommentAuthor, type ArtifactReviewStatus, artifactReviewService } from '../../services/review';
import { OutlineSection } from '../../utils/markdownOutline';
import { ArtifactStatusBadge, deriveArtifactStatus } from './ArtifactStatusBadge';
import { ContextGraphPanel } from '../ContextGraphPanel';
import { ArchitectureKnowledgeGraphPanel } from '../ArchitectureKnowledgeGraphPanel';
import { CommentThread } from './CommentThread';
import { ReviewPanel } from './ReviewPanel';
import { DocumentOutline } from './DocumentOutline';
import { useOptionalAppContext } from '../../context/AppContext';
import {
    assessArtifactKnowledge,
    assessExportability,
    describeKnowledgeFreshness,
    describeQualityTier,
    type ArtifactQualityScope,
    type ArtifactQualitySeverity,
} from '../../services/artifacts/application/artifactAssessment';

interface ArtifactInspectorPanelProps {
    artifact: Artifact;
    projectId: string;
    author: ArtifactCommentAuthor;
    /** Persist a review status transition back onto the artifact. */
    onReviewStatusChange?: (status: ArtifactReviewStatus) => void;
    /** Initial tab — defaults to "estado". */
    initialTab?: InspectorTab;
}

type InspectorTab = 'estado' | 'secciones' | 'calidad' | 'contexto' | 'grafo' | 'comentarios' | 'revision';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="font-medium text-gray-900 dark:text-gray-100 text-right">{children}</span>
    </div>
);

const TRACE_STATUS_TONE = {
    clean: 'success',
    warning: 'warning',
    fallback: 'warning',
    failed: 'danger',
} as const;

const StatusTab: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
    const trace = artifact.generationTrace;
    const status = deriveArtifactStatus(artifact);
    const warnings = trace?.warnings ?? [];
    const errorCount = trace?.errors?.filter((e) => e.status === 'error').length ?? 0;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <ArtifactStatusBadge status={status} />
                {trace && (
                    <Badge tone={TRACE_STATUS_TONE[trace.status]} size="sm">
                        Traza: {trace.status}
                    </Badge>
                )}
                {artifact.reviewStatus && (
                    <Badge tone="gray" size="sm">Revisión: {artifact.reviewStatus}</Badge>
                )}
            </div>

            {errorCount > 0 && (
                <Alert tone="danger" variant="soft" title={`${errorCount} error${errorCount === 1 ? '' : 'es'} en la generación`}>
                    Abre la traza técnica del artefacto para ver el detalle y reintentar.
                </Alert>
            )}
            {warnings.length > 0 && (
                <Alert tone="warning" variant="soft" title={`${warnings.length} advertencia${warnings.length === 1 ? '' : 's'}`}>
                    <ul className="list-disc pl-4 space-y-0.5">
                        {warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </Alert>
            )}

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 px-3">
                <Row label="Tipo">{artifact.type}</Row>
                <Row label="Versión">v{artifact.version}</Row>
                <Row label="Representación">{artifact.representation}</Row>
                {artifact.audience && <Row label="Audiencia">{artifact.audience}</Row>}
                {trace?.modelEffective && <Row label="Modelo">{trace.modelEffective.id}</Row>}
                {trace?.source && <Row label="Origen">{trace.source}</Row>}
                {typeof trace?.durationMs === 'number' && (
                    <Row label="Duración">{(trace.durationMs / 1000).toFixed(1)}s</Row>
                )}
                {trace?.irCounters && (
                    <Row label="Estructura">{trace.irCounters.nodes} nodos · {trace.irCounters.edges} relaciones</Row>
                )}
            </div>

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Persistencia</p>
                <div className="flex gap-2">
                    <Badge tone={trace?.persistence?.local === 'success' ? 'success' : 'gray'} size="sm" dot>
                        Local: {trace?.persistence?.local ?? 'n/d'}
                    </Badge>
                    <Badge
                        tone={
                            trace?.persistence?.remote === 'success' ? 'success'
                                : trace?.persistence?.remote === 'pending' ? 'warning'
                                : trace?.persistence?.remote ? 'danger' : 'gray'
                        }
                        size="sm"
                        dot
                    >
                        Remoto: {trace?.persistence?.remote ?? 'n/d'}
                    </Badge>
                </div>
            </div>

            {trace?.lifecycle && trace.lifecycle.length > 0 && (
                <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Ciclo de vida</p>
                    <ol className="flex flex-wrap gap-1.5">
                        {trace.lifecycle.map((state, i) => (
                            <li key={`${state}-${i}`}>
                                <Badge tone="primary" size="xs" outline>{state}</Badge>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
};

const QUALITY_TONE = (score: number): 'success' | 'warning' | 'danger' => {
    if (score >= 75) return 'success';
    if (score >= 50) return 'warning';
    return 'danger';
};

const SEVERITY_TONE: Record<ArtifactQualitySeverity, 'danger' | 'warning' | 'gray'> = {
    critical: 'danger',
    high: 'danger',
    medium: 'warning',
    low: 'gray',
    info: 'gray',
};

const SEVERITY_ORDER: readonly ArtifactQualitySeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SCOPE_LABEL: Record<ArtifactQualityScope, string> = {
    document: 'Documento',
    diagram: 'Diagrama',
    table: 'Tablas',
    matrix: 'Matrices',
    traceability: 'Trazabilidad',
    hybrid: 'Híbrido',
    export: 'Exportación',
};

/**
 * Architecture Knowledge Graph insight — an additional, graph-grounded
 * quality dimension surfaced inside the inspector. It reports how well the
 * artifact is integrated into the project's canonical model (coverage,
 * consistency issues, traceability gaps) and whether the compiler/reviewer
 * should warn or block on graph grounds. Degrades to nothing when the project
 * has no graph yet — backwards-compatible.
 */
const GraphInsightCard: React.FC<{ projectId: string; artifact: Artifact }> = ({
    projectId,
    artifact,
}) => {
    // Optional context: the card is a peripheral consumer, so it degrades to
    // nothing when rendered outside a provider (keeps the panel testable).
    const app = useOptionalAppContext();
    const project = app?.getProject(projectId);
    const globalContext = app?.settings.globalContext;
    // La regla —grafo persistido primero, construido en memoria si falta, y
    // `null` ante cualquier fallo— es de la capa de aplicación (F4-05).
    const insight = useMemo(
        () => assessArtifactKnowledge(project, artifact.id, globalContext ?? []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [projectId, project?.updatedAt, project?.artifacts.length, artifact.id, globalContext],
    );

    if (!insight) return null;
    const freshnessInfo = describeKnowledgeFreshness(
        app?.getArchitectureGraphFreshness(projectId) ?? 'missing',
    );
    const tone: 'success' | 'warning' | 'danger' = insight.shouldBlock
        ? 'danger'
        : insight.shouldWarn ? 'warning' : 'success';

    return (
        <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Grafo de conocimiento arquitectónico
            </p>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={QUALITY_TONE(insight.coverageScore)} size="sm">
                        Cobertura {insight.coverageScore}/100
                    </Badge>
                    <Badge tone="gray" size="xs">{insight.detectedEntityIds.length} entidades</Badge>
                    <Badge tone="gray" size="xs">{insight.detectedRelationIds.length} relaciones</Badge>
                    <Badge tone={freshnessInfo.tone} size="xs" dot>{freshnessInfo.label}</Badge>
                </div>
                <Alert tone={tone} variant="soft">
                    <span className="text-xs">{insight.recommendation}</span>
                </Alert>
                {(insight.consistencyIssues.length > 0 || insight.traceabilityGaps.length > 0) && (
                    <p className="text-2xs text-gray-500 dark:text-gray-400">
                        {insight.consistencyIssues.length} inconsistencia(s) · {insight.traceabilityGaps.length} vacío(s)
                        de trazabilidad asociados a este artefacto.
                    </p>
                )}
            </div>
        </div>
    );
};

/**
 * Quality tab — backed by the formal `ArtifactQualityReport`
 * (`buildArtifactQualityReport`). It no longer depends on `generationTrace`
 * or `ir.metadata.qualityReview`: the formal model is the source of truth for
 * the visible score, the document/diagram/table sub-scores, the evaluated
 * dimensions, the findings and the recommendations. The Architecture
 * Knowledge Graph contributes an extra, graph-grounded insight dimension.
 */
const QualityTab: React.FC<{ artifact: Artifact; projectId: string }> = ({ artifact, projectId }) => {
    const { report, state } = useMemo(
        () => assessExportability(artifact),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [artifact.id, artifact.content, artifact.ir, artifact.type],
    );
    const score = report.score.value;
    const tone = QUALITY_TONE(score);

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-center">
                <p className="text-2xs uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                    Reporte de calidad formal
                </p>
                <div className="text-4xl font-bold text-gray-900 dark:text-white tabular-nums">
                    {score}<span className="text-lg text-gray-400">/100</span>
                </div>
                <div className="mt-1 flex items-center justify-center gap-2">
                    <Badge tone={tone} size="sm">{describeQualityTier(report.score.tier)}</Badge>
                    <Badge tone="gray" size="sm">{report.profile.label}</Badge>
                </div>
                <div
                    className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Score de calidad ${score} de 100`}
                >
                    <div
                        className={
                            'h-full rounded-full ' +
                            (tone === 'success' ? 'bg-green-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-red-500')
                        }
                        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                    />
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{report.score.summary}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 text-center">
                    <p className="text-2xs uppercase tracking-wider text-gray-400">Documento</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {report.document ? `${report.document.score}/100` : 'N/A'}
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 text-center">
                    <p className="text-2xs uppercase tracking-wider text-gray-400">Diagrama</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {report.diagram ? `${report.diagram.score}/100` : 'N/A'}
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 text-center">
                    <p className="text-2xs uppercase tracking-wider text-gray-400">Tablas</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {report.tables ? `${report.tables.count}` : 'N/A'}
                    </p>
                </div>
            </div>

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Exportabilidad por familia</p>
                <div className="space-y-1">
                    {(['document', 'diagram', 'table'] as const).map((family) => {
                        const gate = state[family];
                        const label = family === 'document' ? 'Documento' : family === 'diagram' ? 'Diagrama' : 'Tablas';
                        return (
                            <div key={family} className="flex items-center justify-between gap-2 text-xs">
                                <span className="text-gray-600 dark:text-gray-300">{label}</span>
                                <Badge tone={gate.passed ? (gate.warnings.length > 0 ? 'warning' : 'success') : 'danger'} size="xs">
                                    {gate.passed ? (gate.warnings.length > 0 ? `Riesgo ${gate.risk}` : 'Listo') : 'Bloqueado'}
                                </Badge>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Dimensiones evaluadas ({report.dimensions.length})
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                    {report.dimensions.map((dim) => (
                        <div key={dim.id} className="rounded-md border border-gray-200 dark:border-gray-800 px-2 py-1">
                            <p className="text-2xs text-gray-500 dark:text-gray-400 truncate" title={`${dim.label} · ${SCOPE_LABEL[dim.scope]}`}>
                                {dim.label}
                            </p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{dim.score}</p>
                        </div>
                    ))}
                </div>
            </div>

            <GraphInsightCard projectId={projectId} artifact={artifact} />

            {report.issues.length > 0 ? (
                <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Hallazgos ({report.issues.length})
                    </p>
                    <ul className="space-y-2">
                        {SEVERITY_ORDER.flatMap((sev) =>
                            report.issues.filter((i) => i.severity === sev).map((issue) => (
                                <li key={issue.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5">
                                    <div className="flex items-center gap-2">
                                        <Badge tone={SEVERITY_TONE[issue.severity]} size="xs">{issue.severity}</Badge>
                                        <span className="text-sm text-gray-800 dark:text-gray-100">{issue.message}</span>
                                    </div>
                                    {issue.recommendation && (
                                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{issue.recommendation}</p>
                                    )}
                                </li>
                            )),
                        )}
                    </ul>
                </div>
            ) : (
                <Alert tone="success" variant="soft">Sin hallazgos de calidad pendientes.</Alert>
            )}

            {report.recommendations.length > 0 && (
                <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Próximos pasos</p>
                    <ul className="space-y-1.5">
                        {report.recommendations.map((rec) => (
                            <li key={rec.id} className="text-xs text-gray-700 dark:text-gray-200">
                                <strong>{rec.title}</strong> — {rec.detail}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

/**
 * Right-side contextual inspector for the active artifact. Consolidates the
 * artifact's status, quality, comments and review workflow into one panel
 * with accessible tabs — the "panel derecho contextual" of the workspace.
 *
 * Designed to be rendered inside a Drawer or a fixed side column.
 */
export const ArtifactInspectorPanel: React.FC<ArtifactInspectorPanelProps> = ({
    artifact,
    projectId,
    author,
    onReviewStatusChange,
    initialTab = 'estado',
}) => {
    const [tab, setTab] = useState<InspectorTab>(initialTab);
    const [selectedSection, setSelectedSection] = useState<OutlineSection | null>(null);
    const hasDocument = artifact.representation === 'document' || artifact.representation === 'hybrid';

    // Single subscription to the review store; both the total open count and
    // the per-section counts are derived from the same cached snapshot so the
    // badges stay reactive without extra subscriptions.
    const comments = useSyncExternalStore(
        useCallback((listener: () => void) => artifactReviewService.subscribe(listener), []),
        useCallback(() => artifactReviewService.listComments(artifact.id), [artifact.id]),
        useCallback(() => artifactReviewService.listComments(artifact.id), [artifact.id]),
    );
    const openComments = useMemo(
        () => comments.filter((c) => c.status === 'open').length,
        [comments],
    );
    const sectionCommentCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of comments) {
            if (c.status !== 'open' || c.anchor.kind !== 'document-section') continue;
            counts[c.anchor.sectionId] = (counts[c.anchor.sectionId] ?? 0) + 1;
        }
        return counts;
    }, [comments]);

    return (
        <div className="flex flex-col h-full">
            <Tabs
                value={tab}
                onChange={(v) => setTab(v as InspectorTab)}
                variant="underline"
                className="flex-1 min-h-0"
            >
                <div className="px-4 pt-3">
                    <TabList aria-label="Inspector del artefacto">
                        <Tab value="estado">Estado</Tab>
                        {hasDocument && <Tab value="secciones">Secciones</Tab>}
                        <Tab value="calidad">Calidad</Tab>
                        <Tab value="contexto">Contexto</Tab>
                        <Tab value="grafo">Grafo</Tab>
                        <Tab
                            value="comentarios"
                            badge={openComments > 0 ? <Badge tone="warning" size="xs">{openComments}</Badge> : undefined}
                        >
                            Comentarios
                        </Tab>
                        <Tab value="revision">Revisión</Tab>
                    </TabList>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                    <TabPanel value="estado">
                        <StatusTab artifact={artifact} />
                    </TabPanel>
                    {hasDocument && (
                        <TabPanel value="secciones">
                            {selectedSection ? (
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            leftIcon={<ArrowLeftIcon className="h-3.5 w-3.5" />}
                                            onClick={() => setSelectedSection(null)}
                                        >
                                            Todas las secciones
                                        </Button>
                                    </div>
                                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-800 px-3 py-2">
                                        <p className="text-2xs uppercase tracking-wider text-gray-400 dark:text-gray-500">Comentando la sección</p>
                                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedSection.title}</p>
                                    </div>
                                    <CommentThread
                                        artifactId={artifact.id}
                                        projectId={projectId}
                                        author={author}
                                        filterAnchor={{
                                            kind: 'document-section',
                                            sectionId: selectedSection.id,
                                            sectionTitle: selectedSection.title,
                                        }}
                                    />
                                </div>
                            ) : (
                                <DocumentOutline
                                    content={artifact.content}
                                    commentCounts={sectionCommentCounts}
                                    onNavigate={(section) => setSelectedSection(section)}
                                />
                            )}
                        </TabPanel>
                    )}
                    <TabPanel value="calidad">
                        <QualityTab artifact={artifact} projectId={projectId} />
                    </TabPanel>
                    <TabPanel value="contexto">
                        <ContextGraphPanel projectId={projectId} artifact={artifact} />
                    </TabPanel>
                    <TabPanel value="grafo">
                        <ArchitectureKnowledgeGraphPanel projectId={projectId} artifact={artifact} />
                    </TabPanel>
                    <TabPanel value="comentarios">
                        <CommentThread
                            artifactId={artifact.id}
                            projectId={projectId}
                            author={author}
                            defaultAnchor={{ kind: 'artifact' }}
                        />
                    </TabPanel>
                    <TabPanel value="revision">
                        <ReviewPanel
                            artifactId={artifact.id}
                            projectId={projectId}
                            author={author}
                            currentStatus={artifact.reviewStatus}
                            onStatusChange={onReviewStatusChange}
                        />
                    </TabPanel>
                </div>
            </Tabs>
        </div>
    );
};

export default ArtifactInspectorPanel;
