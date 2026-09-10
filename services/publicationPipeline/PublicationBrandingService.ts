/**
 * Branding for published deliverables.
 *
 * Branding is intentionally minimal and secret-free: it only carries display
 * metadata (organisation, confidentiality label, accent colour, footer). The
 * manifest service and export orchestrator consume it; it never leaks API
 * keys or sensitive configuration.
 */

import type { PublicationAudience, PublicationBranding } from './PublicationPipelineTypes';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Conservative, professional default branding. */
export const DEFAULT_PUBLICATION_BRANDING: PublicationBranding = {
  organizationName: 'Arquitectura Empresarial',
  productName: 'Arky Pro',
  confidentiality: 'Confidencial',
  accentColor: '#4f46e5',
  footerText: 'Generado con Arky Pro — Pipeline de Publicación Profesional',
};

/** Per-audience accent presets so deliverables read consistently. */
const AUDIENCE_ACCENT: Record<PublicationAudience, string> = {
  executive: '#4f46e5',
  technical: '#0f766e',
  operations: '#b45309',
  vendor: '#7c3aed',
  audit: '#b91c1c',
  'architecture-board': '#1d4ed8',
  'implementation-team': '#0e7490',
};

/** Resolve the default branding for an audience. */
export const resolveDefaultBranding = (audience: PublicationAudience): PublicationBranding => ({
  ...DEFAULT_PUBLICATION_BRANDING,
  accentColor: AUDIENCE_ACCENT[audience] ?? DEFAULT_PUBLICATION_BRANDING.accentColor,
});

/**
 * Normalise a (possibly partial / corrupt) branding object into a safe value.
 * Never throws — invalid fields fall back to defaults. Logo URLs that are not
 * http(s) are dropped so the manifest never embeds unbounded data URIs.
 */
export const sanitizeBranding = (
  input: unknown,
  audience: PublicationAudience = 'executive',
): PublicationBranding => {
  const base = resolveDefaultBranding(audience);
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<PublicationBranding>;

  const text = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : fallback;
  };

  const accentColor = typeof raw.accentColor === 'string' && HEX_COLOR.test(raw.accentColor.trim())
    ? raw.accentColor.trim()
    : base.accentColor;

  const logoUrl = typeof raw.logoUrl === 'string' && /^https?:\/\//i.test(raw.logoUrl.trim())
    ? raw.logoUrl.trim()
    : undefined;

  return {
    organizationName: text(raw.organizationName, base.organizationName),
    productName: text(raw.productName, base.productName),
    confidentiality: text(raw.confidentiality, base.confidentiality),
    accentColor,
    footerText: text(raw.footerText, base.footerText),
    ...(logoUrl ? { logoUrl } : {}),
  };
};

/** Build the page footer string shown on every published page. */
export const buildBrandingFooter = (
  branding: PublicationBranding,
  generatedAt: string,
): string => {
  const date = generatedAt.slice(0, 10);
  return `${branding.organizationName} · ${branding.confidentiality} · ${branding.footerText} · ${date}`;
};
