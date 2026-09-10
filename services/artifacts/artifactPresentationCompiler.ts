import type { Artifact } from '../../types';
import {
  ARTIFACT_PRESENTATION_COMPILER_VERSION,
  type ArtifactPresentationCompileOptions,
  type ArtifactPresentationCompileResult,
  type ArtifactPresentationModel,
  type ArtifactPresentationTraceEvent,
  type PresentationAudience,
  type PresentationMode,
} from '../../lib/artifacts/artifactPresentationModel';
import { isPresentationCompilerEnabled } from './artifactPresentationFlags';
import { compileMarkdownPresentation } from './markdownPresentationCompiler';
import { compileDiagramPresentation } from './diagramPresentationCompiler';
import { isHybridArtifact, mergeHybridPresentationParts } from './hybridPresentationCompiler';
import { evaluateArtifactPresentationQuality } from './artifactPresentationQualityService';
import { resolveArtifactExportProfile } from './artifactExportProfileService';

const nowIso = (override?: string): string => override ?? new Date().toISOString();
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
const idSafe = (value: string): string => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact';


export interface ArtifactPresentationCacheKey {
  artifactId: string;
  version: number;
  updatedAt?: string;
  contentHash: string;
  irHash?: string;
  audience: PresentationAudience;
  mode: PresentationMode;
}

const presentationCache = new Map<string, ArtifactPresentationCompileResult>();
const MAX_CACHE_ENTRIES = 60;
const stableHash = (value: unknown): string => {
  const input = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const cacheKeyFor = (artifact: Artifact, audience: PresentationAudience, mode: PresentationMode): ArtifactPresentationCacheKey => ({
  artifactId: artifact.id,
  version: artifact.version,
  updatedAt: artifact.compilation?.compiledAt ?? artifact.generationTrace?.completedAt ?? artifact.createdAt,
  contentHash: stableHash(`${artifact.content}|${artifact.objective}|${artifact.type}|${artifact.representation}`),
  irHash: artifact.ir ? stableHash(artifact.ir) : undefined,
  audience,
  mode,
});

const cacheKeyString = (key: ArtifactPresentationCacheKey): string => JSON.stringify(key);
const setCache = (key: string, result: ArtifactPresentationCompileResult): void => {
  if (!result.model) return;
  presentationCache.set(key, result);
  while (presentationCache.size > MAX_CACHE_ENTRIES) {
    const first = presentationCache.keys().next().value;
    if (!first) break;
    presentationCache.delete(first);
  }
};

export const clearArtifactPresentationCache = (): void => presentationCache.clear();

const event = (
  code: ArtifactPresentationTraceEvent['code'],
  level: ArtifactPresentationTraceEvent['level'],
  message: string,
  at: string,
): ArtifactPresentationTraceEvent => ({ id: `${code}-${at}`, code, level, message, at });

const audienceFor = (artifact: Artifact, requested?: PresentationAudience): PresentationAudience => {
  if (requested) return requested;
  if (artifact.audience === 'executive' || artifact.audience === 'technical' || artifact.audience === 'operations') return artifact.audience;
  return artifact.representation === 'hybrid' ? 'mixed' : 'technical';
};

const isDocumentLike = (artifact: Artifact): boolean => artifact.representation === 'document' || artifact.representation === 'hybrid';
const isTableLike = (artifact: Artifact): boolean => /traceability|glossary|matrix|matriz|table|tabla|sdd-traceability|sdd-glossary/i.test(`${artifact.type} ${artifact.name} ${artifact.content}`);

export const compileArtifactPresentation = (
  artifact: Artifact,
  options: ArtifactPresentationCompileOptions = {},
): ArtifactPresentationCompileResult => {
  const at = nowIso(options.now);
  const trace: ArtifactPresentationTraceEvent[] = [event('presentation.compile.started', 'info', 'Compilación de presentación iniciada.', at)];
  const enabled = options.compilerEnabled ?? isPresentationCompilerEnabled();
  if (!enabled) {
    return {
      enabled: false,
      model: null,
      warnings: ['Artifact Presentation Compiler deshabilitado por feature flag.'],
      errors: [],
      trace,
    };
  }

  try {
    const resolvedAudience = audienceFor(artifact, options.audience);
    const resolvedMode = options.mode ?? 'publication';
    const cacheKey = cacheKeyString(cacheKeyFor(artifact, resolvedAudience, resolvedMode));
    if (!options.now) {
      const cached = presentationCache.get(cacheKey);
      if (cached) return cached;
    }
    const markdown = isDocumentLike(artifact) || isTableLike(artifact)
      ? compileMarkdownPresentation(artifact)
      : compileMarkdownPresentation({ ...artifact, content: artifact.objective || artifact.name, representation: 'document', type: 'markdown' });
    const diagram = !isDocumentLike(artifact) || isHybridArtifact(artifact) || Boolean(artifact.ir)
      ? compileDiagramPresentation(artifact)
      : { diagrams: [], callouts: [], warnings: [] };
    const parts = isHybridArtifact(artifact) ? mergeHybridPresentationParts(markdown, diagram) : { ...markdown, ...diagram, callouts: diagram.callouts, warnings: [...markdown.warnings, ...diagram.warnings] };

    const baseModel = {
      id: `presentation-${artifact.id}-${idSafe(artifact.name)}`,
      artifactId: artifact.id,
      artifactName: artifact.name,
      artifactType: artifact.type,
      compilerVersion: ARTIFACT_PRESENTATION_COMPILER_VERSION,
      audience: resolvedAudience,
      mode: resolvedMode,
      title: parts.title ?? artifact.name,
      subtitle: parts.subtitle,
      executiveSummary: parts.executiveSummary || parts.diagrams[0]?.executiveSummary,
      purpose: parts.purpose || artifact.objective,
      scope: parts.scope,
      sections: parts.sections,
      diagrams: parts.diagrams,
      tables: parts.tables,
      callouts: [...parts.callouts],
      decisions: parts.decisions,
      risks: parts.risks,
      assumptions: parts.assumptions,
      nextSteps: parts.nextSteps,
      traceability: parts.traceability,
      exportProfile: {
        recommendedFormats: [],
        availableFormats: [],
        blockedFormats: [],
        defaultFormat: 'json' as const,
        canExportAsPublication: false,
        requiresUserReview: true,
      },
      theme: {
        name: artifact.audience === 'executive' ? 'executive' as const : artifact.representation === 'diagram' ? 'technical' as const : 'audit' as const,
        density: parts.sections.length > 8 ? 'compact' as const : 'comfortable' as const,
        colorMode: 'adaptive' as const,
      },
      trace: [] as ArtifactPresentationTraceEvent[],
      createdAt: at,
      updatedAt: at,
    } satisfies Omit<ArtifactPresentationModel, 'quality'>;

    const quality = evaluateArtifactPresentationQuality(baseModel, artifact.content, artifact);
    const exportProfile = resolveArtifactExportProfile({
      artifact,
      hasDocument: baseModel.sections.length > 0 && artifact.content.trim().length > 0,
      hasDiagram: baseModel.diagrams.some((item) => item.nodeCount > 0 || Boolean(item.mermaid)),
      hasTables: baseModel.tables.length > 0,
      quality,
    });

    const warnings = [...parts.warnings, ...quality.warnings];
    const finalTrace = [
      ...trace,
      ...warnings.map((warning) => event('presentation.compile.warning', 'warning', warning, at)),
      event('presentation.quality.evaluated', 'info', `Score de presentación: ${quality.score}/100.`, at),
      event('presentation.export-profile.resolved', 'info', `Formatos recomendados: ${exportProfile.recommendedFormats.join(', ') || 'ninguno'}.`, at),
      event('presentation.compile.success', 'info', 'Compilación de presentación completada sin bloquear el canvas.', at),
    ];

    const model: ArtifactPresentationModel = {
      ...baseModel,
      quality,
      exportProfile,
      callouts: [
        ...baseModel.callouts,
        ...quality.blockers.map((blocker, index) => ({ id: `publication-blocker-${index + 1}`, type: 'warning' as const, title: 'Bloqueador de publicación', content: blocker, severity: 'critical' as const })),
      ],
      trace: finalTrace,
    };

    const result = { enabled: true, model, warnings, errors: [], trace: finalTrace };
    if (!options.now) setCache(cacheKey, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido compilando presentación.';
    const failedTrace = [...trace, event('presentation.compile.failed-non-blocking', 'error', message, at)];
    return { enabled: true, model: null, warnings: [], errors: [message], trace: failedTrace };
  }
};

export const getArtifactPresentationStatus = (artifact: Artifact): {
  enabled: boolean;
  readyForPublication: boolean;
  score: number | null;
  warnings: string[];
} => {
  const result = compileArtifactPresentation(artifact);
  return {
    enabled: result.enabled,
    readyForPublication: Boolean(result.model?.quality.readyForPublication),
    score: result.model?.quality.score ?? null,
    warnings: result.model ? [...result.model.quality.blockers, ...result.model.quality.warnings] : result.warnings,
  };
};
