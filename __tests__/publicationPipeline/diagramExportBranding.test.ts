/**
 * La marca de la organización en la exportación de un diagrama (plan de
 * diagramas, 2.3): sólo la configurada, nunca el logo, y un color sin contraste
 * se rechaza con motivo.
 */
import { describe, expect, it } from 'vitest';
import type { PublicationPackage } from '../../services/publicationPipeline';
import { resolveDiagramExportBranding } from '../../services/publicationPipeline/diagramExportBranding';

type Pkg = Pick<PublicationPackage, 'artifactRefs' | 'branding' | 'updatedAt'>;

const ref = (artifactId: string, versionGroupId = artifactId) =>
  ({ artifactId, versionGroupId, version: 1, name: 'x', type: 'mermaid-graph' }) as PublicationPackage['artifactRefs'][number];

const branding = (overrides: Partial<NonNullable<Pkg['branding']>> = {}): NonNullable<Pkg['branding']> => ({
  organizationName: 'Seguros Andinos',
  productName: 'Arky',
  confidentiality: 'Uso interno',
  accentColor: '#1d4ed8',
  footerText: 'x',
  logoUrl: 'https://cdn.example.com/logo.png',
  ...overrides,
});

const artifact = { id: 'a2', versionGroupId: 'a1' };

describe('resolveDiagramExportBranding', () => {
  it('sin paquete con marca no hay marca: la exportación queda como antes', () => {
    expect(resolveDiagramExportBranding(undefined, artifact, { isDark: false })).toBeNull();
    expect(resolveDiagramExportBranding([{ artifactRefs: [ref('a1')], updatedAt: '2026-09-01' }], artifact, { isDark: false })).toBeNull();
    expect(resolveDiagramExportBranding([{ artifactRefs: [ref('otro')], branding: branding(), updatedAt: '2026-09-01' }], artifact, { isDark: false })).toBeNull();
  });

  it('usa el paquete más reciente que incluye el artefacto (por id o por su grupo de versiones)', () => {
    const result = resolveDiagramExportBranding([
      { artifactRefs: [ref('a1')], branding: branding({ organizationName: 'Antigua' }), updatedAt: '2026-08-01' },
      { artifactRefs: [ref('v9', 'a1')], branding: branding({ organizationName: 'Seguros Andinos' }), updatedAt: '2026-09-20' },
    ], artifact, { isDark: false });
    expect(result).toEqual({ organizationName: 'Seguros Andinos', confidentiality: 'Uso interno', accentColor: '#1d4ed8' });
  });

  it('nunca lleva el logo: es una URL externa y rompería la exportación autocontenida', () => {
    const result = resolveDiagramExportBranding([{ artifactRefs: [ref('a2')], branding: branding(), updatedAt: '2026-09-01' }], artifact, { isDark: false });
    expect(JSON.stringify(result)).not.toContain('logo');
  });

  it('un color que no se distingue del fondo se rechaza con motivo, y el resto de la marca se conserva', () => {
    const pkgs = [{ artifactRefs: [ref('a2')], branding: branding({ accentColor: '#fafafa' }), updatedAt: '2026-09-01' }];
    const result = resolveDiagramExportBranding(pkgs, artifact, { isDark: false });
    expect(result?.accentColor).toBeUndefined();
    expect(result?.organizationName).toBe('Seguros Andinos');
    expect(result?.issue).toMatch(/#fafafa.*contraste 1,\d:1, mínimo 3:1/);
  });

  it('el contraste se mide contra el fondo del tema que se exporta', () => {
    const pkgs = [{ artifactRefs: [ref('a2')], branding: branding({ accentColor: '#1e1b4b' }), updatedAt: '2026-09-01' }];
    expect(resolveDiagramExportBranding(pkgs, artifact, { isDark: false })?.accentColor).toBe('#1e1b4b');
    expect(resolveDiagramExportBranding(pkgs, artifact, { isDark: true })?.issue).toBeDefined();
  });
});
