import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_DOCUMENT_FALLBACK_MARKER,
  SKELETON_FALLBACK_MARKER,
  containsSkeletonFallbackMarker,
  detectArtifactFallbackContent,
  markDocumentAsDeterministicFallback,
  markHybridAsDeterministicFallback,
} from '../../services/artifacts/domain/artifactFallbackDetection';

const diagram = `flowchart LR
  A["Usuario"] --> B["Portal"]
`;

describe('detectArtifactFallbackContent', () => {
  it('flags the canonical Mermaid skeleton marker', () => {
    const result = detectArtifactFallbackContent({ content: `${SKELETON_FALLBACK_MARKER}\n${diagram}` });
    expect(result.isSkeleton).toBe(true);
    expect(result.isFallback).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.marker).toBe(SKELETON_FALLBACK_MARKER);
  });

  it('flags the deterministic document marker', () => {
    const result = detectArtifactFallbackContent({ content: `${DETERMINISTIC_DOCUMENT_FALLBACK_MARKER}\n# Doc` });
    expect(result.isFallback).toBe(true);
    expect(result.isSkeleton).toBe(false);
  });

  it('flags the deterministic document fallback prose', () => {
    const result = detectArtifactFallbackContent({
      content: '# Plan\n\n> Contenido local de respaldo generado porque el servicio de IA no respondió.',
    });
    expect(result.isFallback).toBe(true);
  });

  it('flags the deterministic YAML fallback status line', () => {
    const result = detectArtifactFallbackContent({ content: 'artifact: "X"\nstatus: "fallback-local"\n' });
    expect(result.isFallback).toBe(true);
  });

  it('flags IR metadata fallback', () => {
    const result = detectArtifactFallbackContent({ content: diagram, irMetadata: { fallback: 'skeleton' } });
    expect(result.isSkeleton).toBe(true);
    expect(result.isFallback).toBe(true);
  });

  it('flags a persisted skeleton-fallback diagram error', () => {
    const result = detectArtifactFallbackContent({
      content: diagram,
      lastDiagramError: { reason: 'skeleton-fallback', attempt: 3, at: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.isSkeleton).toBe(true);
    expect(result.isFallback).toBe(true);
  });

  it('flags an empty-ir diagram error as fallback (not skeleton)', () => {
    const result = detectArtifactFallbackContent({
      content: diagram,
      lastDiagramError: { reason: 'empty-ir', attempt: 3, at: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.isFallback).toBe(true);
    expect(result.isSkeleton).toBe(false);
  });

  it('flags a fallback generation trace status', () => {
    const result = detectArtifactFallbackContent({ content: diagram, generationTraceStatus: 'fallback' });
    expect(result.isFallback).toBe(true);
  });

  it('does not flag clean content', () => {
    const result = detectArtifactFallbackContent({ content: diagram, generationTraceStatus: 'clean' });
    expect(result.isFallback).toBe(false);
    expect(result.isSkeleton).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('does not produce a false positive from a textual mention of the word "fallback"', () => {
    const result = detectArtifactFallbackContent({
      content: '# Estrategia de resiliencia\n\nEl sistema implementa un fallback ante fallos del proveedor de pagos.',
    });
    expect(result.isFallback).toBe(false);
  });

  it('collects auditable reasons for every signal that fired', () => {
    const result = detectArtifactFallbackContent({
      content: `${SKELETON_FALLBACK_MARKER}\n${diagram}`,
      generationTraceStatus: 'fallback',
    });
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fallback marker helpers', () => {
  it('containsSkeletonFallbackMarker is a safe predicate', () => {
    expect(containsSkeletonFallbackMarker(`${SKELETON_FALLBACK_MARKER}\n${diagram}`)).toBe(true);
    expect(containsSkeletonFallbackMarker(diagram)).toBe(false);
    expect(containsSkeletonFallbackMarker(null)).toBe(false);
    expect(containsSkeletonFallbackMarker(undefined)).toBe(false);
  });

  it('markDocumentAsDeterministicFallback is idempotent', () => {
    const once = markDocumentAsDeterministicFallback('# Doc\n\nContenido.');
    const twice = markDocumentAsDeterministicFallback(once);
    expect(once).toContain(DETERMINISTIC_DOCUMENT_FALLBACK_MARKER);
    expect(twice).toBe(once);
    expect(detectArtifactFallbackContent({ content: once }).isFallback).toBe(true);
  });

  it('markHybridAsDeterministicFallback marks inside the Mermaid fence', () => {
    const hybrid = '# Vista\n\nNarrativa.\n\n```mermaid\n' + diagram + '```\n';
    const marked = markHybridAsDeterministicFallback(hybrid);
    expect(containsSkeletonFallbackMarker(marked)).toBe(true);
    expect(marked.match(/```mermaid/gi) ?? []).toHaveLength(1);
  });

  it('markHybridAsDeterministicFallback falls back to the document marker without a fence', () => {
    const marked = markHybridAsDeterministicFallback('# Solo texto\n\nSin diagrama.');
    expect(marked).toContain(DETERMINISTIC_DOCUMENT_FALLBACK_MARKER);
  });
});
