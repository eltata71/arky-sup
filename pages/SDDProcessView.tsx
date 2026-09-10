import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppContext } from '@/context/AppContext';
import { ARTIFACT_TEMPLATES } from '@/constants';
import { Artifact, ArtifactTemplate, ArtifactType } from '@/types';
import { artifactGenerationService, documentGenerationService, classifyAIError, AIServiceError } from '../services/ai';
import { motion, AnimatePresence } from 'motion/react';
import { SafeRichText } from '../components/ui/SafeRichText';
import { useProjectArtifacts } from '../hooks/useProjectArtifacts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SDDPhase {
  id: number;
  name: string;
  description: string;
  icon: string;
  artifactTypes: ArtifactType[];
  requiredTemplateNames: string[];
}

interface ArtifactStatus {
  templateName: string;
  artifactType: ArtifactType;
  present: boolean;
  artifact?: Artifact;
  priority: 'critical' | 'high' | 'medium';
}

interface PhaseStatus {
  phase: SDDPhase;
  artifacts: ArtifactStatus[];
  completionPct: number;
}

// ─── SDD Phase Definitions ────────────────────────────────────────────────────

const SDD_PHASES: SDDPhase[] = [
  {
    id: 1,
    name: 'Fase 1: Requisitos',
    description: 'Elicitación y especificación formal de los requisitos de negocio.',
    icon: '📋',
    artifactTypes: ['sdd-brd', 'sdd-use-case', 'sdd-user-story'],
    requiredTemplateNames: [
      'BRD — Documento de Requisitos de Negocio',
      'Especificación de Casos de Uso',
      'User Story Map — Mapa de Historias de Usuario',
    ],
  },
  {
    id: 2,
    name: 'Fase 2: Arquitectura',
    description: 'Diseño del dominio y decisiones arquitectónicas fundamentales.',
    icon: '🏛️',
    artifactTypes: ['sdd-domain-model', 'sdd-event-storming', 'sdd-glossary'],
    requiredTemplateNames: [
      'Modelo de Dominio DDD',
      'Event Storming — Mapa de Eventos de Dominio',
      'Glosario — Lenguaje Ubicuo (Ubiquitous Language)',
    ],
  },
  {
    id: 3,
    name: 'Fase 3: Componentes',
    description: 'Especificación de contratos, APIs y esquemas de datos.',
    icon: '⚙️',
    artifactTypes: ['yaml', 'mermaid-erd', 'markdown'],
    requiredTemplateNames: [
      'Contrato de API (OpenAPI)',
      'Diagrama de Componentes (C4-N3)',
      'Modelo de Dominio (ERD)',
    ],
  },
  {
    id: 4,
    name: 'Fase 4: Calidad',
    description: 'Criterios de aceptación, pruebas y requisitos no funcionales.',
    icon: '✅',
    artifactTypes: ['sdd-nfr', 'sdd-bdd', 'sdd-traceability'],
    requiredTemplateNames: [
      'NFR — Requisitos No Funcionales (ISO 25010)',
      'Escenarios BDD — Gherkin (Given/When/Then)',
      'Matriz de Trazabilidad de Requisitos',
    ],
  },
  {
    id: 5,
    name: 'Fase 5: Despliegue',
    description: 'Especificación de infraestructura y pipeline de entrega.',
    icon: '🚀',
    artifactTypes: ['mermaid-c4-deployment', 'mermaid-graph', 'markdown'],
    requiredTemplateNames: [
      'Diagrama de Despliegue (C4-N4)',
      'Diagrama del Pipeline CI/CD',
      'Plan de Recuperación ante Desastres DRP',
    ],
  },
];

// ─── Priority Map ─────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, 'critical' | 'high' | 'medium'> = {
  'BRD — Documento de Requisitos de Negocio': 'critical',
  'Especificación de Casos de Uso': 'critical',
  'User Story Map — Mapa de Historias de Usuario': 'high',
  'Modelo de Dominio DDD': 'critical',
  'Event Storming — Mapa de Eventos de Dominio': 'high',
  'Glosario — Lenguaje Ubicuo (Ubiquitous Language)': 'high',
  'Contrato de API (OpenAPI)': 'high',
  'Diagrama de Componentes (C4-N3)': 'medium',
  'Modelo de Dominio (ERD)': 'high',
  'NFR — Requisitos No Funcionales (ISO 25010)': 'critical',
  'Escenarios BDD — Gherkin (Given/When/Then)': 'high',
  'Matriz de Trazabilidad de Requisitos': 'high',
  'Diagrama de Despliegue (C4-N4)': 'medium',
  'Diagrama del Pipeline CI/CD': 'medium',
  'Plan de Recuperación ante Desastres DRP': 'medium',
};

// ─── Helper: Priority Badge ───────────────────────────────────────────────────

const PriorityBadge: React.FC<{ priority: 'critical' | 'high' | 'medium' }> = ({ priority }) => {
  const config = {
    critical: { label: 'Crítico', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    high:     { label: 'Alto',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
    medium:   { label: 'Medio',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  };
  const { label, cls } = config[priority];
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface SDDProcessViewProps {
  projectId: string;
}

const SDDProcessView: React.FC<SDDProcessViewProps> = ({ projectId }) => {
  // Reads artifact content to assess SDD coverage, so it needs the documents.
  useProjectArtifacts(projectId);
  const { projects, settings, createArtifact } = useAppContext();
  const navigate = useNavigate();

  const project = projects.find(p => p.id === projectId);

  const [activePhase, setActivePhase] = useState<number>(1);
  const [sddPlan, setSddPlan] = useState<string>('');
  const [healthReport, setHealthReport] = useState<string>('');
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [activeTab, setActiveTab] = useState<'process' | 'plan' | 'report'>('process');
  const [generatingArtifact, setGeneratingArtifact] = useState<string | null>(null);
  const [recentlyGenerated, setRecentlyGenerated] = useState<{ name: string; id: string } | null>(null);
  const [copiedArtifact, setCopiedArtifact] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // ── Compute phase statuses ────────────────────────────────────────────────

  const phaseStatuses: PhaseStatus[] = SDD_PHASES.map(phase => {
    const artifacts: ArtifactStatus[] = phase.requiredTemplateNames.map(templateName => {
      const existing = project?.artifacts.find(a => a.name === templateName);
      return {
        templateName,
        artifactType: phase.artifactTypes[phase.requiredTemplateNames.indexOf(templateName)] as ArtifactType,
        present: !!existing,
        artifact: existing,
        priority: PRIORITY_MAP[templateName] ?? 'medium',
      };
    });

    const completionPct = artifacts.length === 0
      ? 0
      : Math.round((artifacts.filter(a => a.present).length / artifacts.length) * 100);

    return { phase, artifacts, completionPct };
  });

  const overallPct = Math.round(
    phaseStatuses.reduce((sum, ps) => sum + ps.completionPct, 0) / phaseStatuses.length
  );

  // Markdown is rendered where it is shown, by `SafeRichText`. The two
  // effects that used to mirror `sddPlan`/`healthReport` into pre-rendered
  // HTML state are gone: derived state that lags its source by a render is a
  // bug waiting to happen, and holding raw HTML in state was what made the
  // unsanitised insertion below look reasonable.

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleGeneratePlan = useCallback(async () => {
    if (!project) return;
    setIsGeneratingPlan(true);
    setActiveTab('plan');
    try {
      const text = await documentGenerationService.generateSDDProcessPlan(project, settings);
      setSddPlan(text);
    } catch (error) {
      console.error('[SDDProcess] SDD plan generation failed', error);
      setSddPlan('Error al generar el plan SDD. Verifique su API key en Configuración.');
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [project, settings]);

  const handleGenerateReport = useCallback(async () => {
    if (!project) return;
    setIsGeneratingReport(true);
    setActiveTab('report');
    try {
      const text = await documentGenerationService.generateSDDHealthReport(project, settings);
      setHealthReport(text);
    } catch (error) {
      console.error('[SDDProcess] health report generation failed', error);
      setHealthReport('Error al generar el reporte. Verifique su API key en Configuración.');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [project, settings]);

  const handleGenerateArtifact = useCallback(async (templateName: string) => {
    if (!project) return;
    const template = ARTIFACT_TEMPLATES.find(t => t.name === templateName);
    if (!template) {
      setGenerationError(`No se encontró la plantilla "${templateName}". Verifica el catálogo SDD.`);
      return;
    }

    setGenerationError(null);
    setGeneratingArtifact(templateName);

    try {
      const content = await artifactGenerationService.generateArtifactContent(project, template as ArtifactTemplate, settings);
      const newArtifact = createArtifact(project.id, {
        name: template.name,
        type: template.type,
        phase: template.phase,
        architecturalView: template.architecturalView,
        content,
        objective: template.objective,
        keyConcepts: template.keyConcepts,
        representation: template.representation,
        isFavorite: false,
      });
      setRecentlyGenerated({ name: template.name, id: newArtifact.id });
      // Open the canvas for the just-generated artifact (same behaviour as traditional artifacts).
      navigate(`/workspace/${project.id}?artifact=${newArtifact.id}&source=sdd`, { replace: false });
    } catch (e: unknown) {
      const friendly = e instanceof AIServiceError ? e : classifyAIError(e);
      console.error('[SDDProcess] artifact generation failed', { name: template.name, category: friendly.category, status: friendly.status });
      setGenerationError(`No se pudo generar "${template.name}". ${friendly.userMessage}`);
    } finally {
      setGeneratingArtifact(null);
    }
  }, [project, settings, createArtifact, navigate]);

  const handleCopyContent = useCallback(async (artifact: Artifact, templateName: string) => {
    await navigator.clipboard.writeText(artifact.content);
    setCopiedArtifact(templateName);
    setTimeout(() => setCopiedArtifact(null), 2000);
  }, []);

  const handleDownload = useCallback((artifact: Artifact) => {
    const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleOpenArtifact = useCallback((artifactId: string) => {
    navigate(`/workspace/${projectId}?artifact=${artifactId}`);
  }, [navigate, projectId]);

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <p>Proyecto no encontrado. <button onClick={() => navigate('/projects')} className="underline text-primary-600">Ver proyectos</button></p>
      </div>
    );
  }

  // ── Active phase ──────────────────────────────────────────────────────────

  const activePhaseStatus = phaseStatuses.find(ps => ps.phase.id === activePhase)!;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 overflow-hidden md:pl-14">
      <AnimatePresence>
        {generatingArtifact && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center px-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900/95 text-white shadow-2xl p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-primary-300 animate-pulse" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l1.7 4.6L18 8.3l-4.3 1.7L12 14.6l-1.7-4.6L6 8.3l4.3-1.7L12 2zm7 11l.9 2.5L22 16.4l-2.1.9L19 20l-.9-2.7-2.1-.9 2.1-.9L19 13zM5 14l.9 2.5 2.1.9-2.1.9L5 21l-.9-2.7L2 17.4l2.1-.9L5 14z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold mb-2">Generando Artefacto</h3>
              <p className="text-sm text-gray-300">Generando: {generatingArtifact}</p>
              <p className="text-xs text-gray-400 mt-3">Aplicando el mismo flujo estándar de generación del Workspace.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/workspace/${projectId}`)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
              title="Volver al Workspace"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-900 dark:text-white">SDD Process</span>
                <span className="text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 px-2 py-0.5 rounded-full">
                  Specification-Driven Development
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-sm">{project.name}</p>
            </div>
          </div>

          {/* Overall progress */}
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-500 dark:text-gray-400">Completitud SDD</p>
              <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{overallPct}%</p>
            </div>
            <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden hidden sm:block">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-700"
                style={{ width: `${overallPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 mt-4">
          {(['process', 'plan', 'report'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {tab === 'process' && 'Proceso SDD'}
              {tab === 'plan' && 'Plan SDD'}
              {tab === 'report' && 'Reporte de Salud'}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {/* ── TAB: Process ─────────────────────────────────────── */}
        {activeTab === 'process' && (
          <div className="flex h-full">
            {/* Phase sidebar */}
            <aside className="w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto">
              <div className="p-3 space-y-1">
                {phaseStatuses.map(ps => (
                  <button
                    key={ps.phase.id}
                    onClick={() => setActivePhase(ps.phase.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                      activePhase === ps.phase.id
                        ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base">{ps.phase.icon}</span>
                      <span className={`text-xs font-semibold ${
                        activePhase === ps.phase.id
                          ? 'text-primary-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-200'
                      }`}>
                        {ps.phase.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            ps.completionPct === 100 ? 'bg-green-500' :
                            ps.completionPct > 0 ? 'bg-yellow-500' :
                            'bg-gray-300 dark:bg-gray-600'
                          }`}
                          style={{ width: `${ps.completionPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">
                        {ps.completionPct}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Action buttons */}
              <div className="p-3 border-t border-gray-200 dark:border-gray-800 space-y-2 mt-2">
                <button
                  onClick={handleGeneratePlan}
                  disabled={isGeneratingPlan}
                  className="w-full text-xs font-medium bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  {isGeneratingPlan ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Generando plan...
                    </>
                  ) : (
                    <>
                      <span>✨</span> Generar Plan SDD
                    </>
                  )}
                </button>
                <button
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="w-full text-xs font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  {isGeneratingReport ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Analizando...
                    </>
                  ) : (
                    <>
                      <span>📊</span> Reporte de Salud
                    </>
                  )}
                </button>
              </div>
            </aside>

            {/* Phase detail */}
            <main className="flex-1 overflow-y-auto p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activePhase}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Info banner — artifact storage */}
                  <div className="mb-5 flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
                    <svg className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                      Los artefactos generados se guardan automáticamente en el <strong>Workspace</strong> del proyecto. Accede a ellos desde el <strong>Panel de Artefactos</strong> (barra lateral) para ver versiones, conversar con la IA o exportarlos. Usa los botones <strong>Copiar</strong> y <strong>Descargar</strong> para compartir con tu equipo de desarrollo.
                    </p>
                  </div>

                  {/* Error banner — generation failure */}
                  {generationError && (
                    <div className="mb-4 flex items-start gap-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10A8 8 0 112 10a8 8 0 0116 0zM9 7a1 1 0 012 0v4a1 1 0 11-2 0V7zm1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z" clipRule="evenodd" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{generationError}</p>
                      </div>
                      <button
                        onClick={() => setGenerationError(null)}
                        className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
                        title="Cerrar"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Success toast — recently generated artifact */}
                  <AnimatePresence>
                    {recentlyGenerated && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="mb-4 flex items-center justify-between gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <p className="text-xs text-green-700 dark:text-green-300 truncate">
                            <strong>"{recentlyGenerated.name}"</strong> generado y guardado en el Workspace.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => { handleOpenArtifact(recentlyGenerated.id); setRecentlyGenerated(null); }}
                            className="text-xs font-semibold text-green-700 dark:text-green-300 hover:underline whitespace-nowrap"
                          >
                            Abrir artefacto →
                          </button>
                          <button
                            onClick={() => setRecentlyGenerated(null)}
                            className="text-green-500 hover:text-green-700 dark:hover:text-green-300"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Phase header */}
                  <div className="mb-6">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-2xl">{activePhaseStatus.phase.icon}</span>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {activePhaseStatus.phase.name}
                      </h2>
                      <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${
                        activePhaseStatus.completionPct === 100
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : activePhaseStatus.completionPct > 0
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {activePhaseStatus.completionPct}% completo
                      </span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                      {activePhaseStatus.phase.description}
                    </p>
                  </div>

                  {/* Artifact cards */}
                  <div className="grid grid-cols-1 gap-4">
                    {activePhaseStatus.artifacts.map(as => (
                      <div
                        key={as.templateName}
                        className={`bg-white dark:bg-gray-900 border rounded-xl p-4 transition-all ${
                          as.present
                            ? 'border-green-200 dark:border-green-800'
                            : 'border-gray-200 dark:border-gray-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            {/* Status indicator */}
                            <div className={`mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center ${
                              as.present
                                ? 'bg-green-100 dark:bg-green-900/40'
                                : 'bg-gray-100 dark:bg-gray-800'
                            }`}>
                              {as.present ? (
                                <svg className="w-3 h-3 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                </svg>
                              )}
                            </div>

                            {/* Name + metadata */}
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-gray-900 dark:text-white leading-tight">
                                {as.templateName}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <PriorityBadge priority={as.priority} />
                                <span className="text-xs text-gray-400 font-mono">{as.artifactType}</span>
                              </div>
                              {as.artifact && (
                                <p className="text-xs text-gray-400 mt-1">
                                  v{as.artifact.version} · {new Date(as.artifact.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex-shrink-0 flex items-center gap-1.5">
                            {as.present && as.artifact ? (
                              <>
                                {/* Copy to clipboard */}
                                <button
                                  onClick={() => as.artifact && handleCopyContent(as.artifact, as.templateName)}
                                  title="Copiar contenido Markdown"
                                  className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
                                >
                                  {copiedArtifact === as.templateName ? (
                                    <>
                                      <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                      <span className="text-green-600 dark:text-green-400">¡Copiado!</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                      Copiar
                                    </>
                                  )}
                                </button>
                                {/* Download .md */}
                                <button
                                  onClick={() => as.artifact && handleDownload(as.artifact)}
                                  title="Descargar como archivo .md"
                                  className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  Descargar
                                </button>
                                {/* Open in workspace */}
                                <button
                                  onClick={() => as.artifact && handleOpenArtifact(as.artifact.id)}
                                  className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline px-3 py-1.5 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                >
                                  Abrir
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleGenerateArtifact(as.templateName)}
                                disabled={generatingArtifact === as.templateName}
                                className="text-xs font-medium bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                              >
                                {generatingArtifact === as.templateName ? (
                                  <>
                                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Generando...
                                  </>
                                ) : (
                                  <>✨ Generar</>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Phase completion banner */}
                  {activePhaseStatus.completionPct === 100 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center gap-2"
                    >
                      <span className="text-green-500">✅</span>
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        Fase {activePhaseStatus.phase.id} completa — todos los artefactos SDD generados.
                      </p>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )}

        {/* ── TAB: Plan ─────────────────────────────────────────── */}
        {activeTab === 'plan' && (
          <div className="h-full flex flex-col">
            {isGeneratingPlan ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500 dark:text-gray-400">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary-500/20 rounded-full blur-xl animate-pulse" />
                  <svg className="relative animate-spin h-12 w-12 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
                <p className="text-sm animate-pulse">Generando plan SDD personalizado...</p>
              </div>
            ) : sddPlan ? (
              <div className="flex-1 overflow-y-auto p-6 md:p-10">
                <SafeRichText
                  className="prose prose-sm dark:prose-invert max-w-4xl mx-auto"
                  markdown={sddPlan}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
                <span className="text-5xl">📋</span>
                <p className="text-sm">Haz clic en <strong>Generar Plan SDD</strong> para obtener un plan personalizado.</p>
                <button
                  onClick={handleGeneratePlan}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  ✨ Generar Plan SDD
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Report ───────────────────────────────────────── */}
        {activeTab === 'report' && (
          <div className="h-full flex flex-col">
            {isGeneratingReport ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500 dark:text-gray-400">
                <div className="relative">
                  <div className="absolute inset-0 bg-primary-500/20 rounded-full blur-xl animate-pulse" />
                  <svg className="relative animate-spin h-12 w-12 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
                <p className="text-sm animate-pulse">Analizando artefactos SDD del proyecto...</p>
              </div>
            ) : healthReport ? (
              <div className="flex-1 overflow-y-auto p-6 md:p-10">
                <SafeRichText
                  className="prose prose-sm dark:prose-invert max-w-4xl mx-auto"
                  markdown={healthReport}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
                <span className="text-5xl">📊</span>
                <p className="text-sm">Haz clic en <strong>Reporte de Salud</strong> para analizar el estado SDD del proyecto.</p>
                <button
                  onClick={handleGenerateReport}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  📊 Generar Reporte de Salud
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SDDProcessView;
