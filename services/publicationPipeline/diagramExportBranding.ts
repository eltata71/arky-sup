/**
 * La marca de la organización en la exportación de un diagrama (plan de
 * diagramas, 2.3).
 *
 * La marca ya la gestiona la publicación, por paquete. Un diagrama exportado
 * desde el lienzo la ignoraba: salía con el marco genérico aunque el mismo
 * artefacto viajara en un paquete con organización, clasificación y color.
 *
 * Tres decisiones:
 *
 * 1. **Sólo si alguien la configuró.** La marca sale del paquete más reciente
 *    que incluye este artefacto y declara `branding`. Sin eso, `null`, y la
 *    exportación es exactamente la de antes: rellenar con la marca por defecto
 *    cambiaría cada imagen exportada del producto.
 * 2. **Nunca el logo.** `logoUrl` es una URL externa, e incrustarla rompería
 *    la exportación autocontenida (2.2).
 * 3. **Un color sin contraste se rechaza con motivo.** El acento es una franja
 *    —un elemento gráfico, no texto—, así que debe distinguirse del fondo del
 *    marco que se exporta (claro u oscuro) al menos 3:1 (WCAG 2.2 · 1.4.11).
 *    Si no, se exporta sin franja y `issue` dice por qué.
 */

import { contrastRatio, parseColor } from '../../lib/colorContrast';
import { sanitizeBranding } from './PublicationBrandingService';
import type { PublicationPackage } from './PublicationPipelineTypes';

/** El fondo de la cabecera del marco sobre el que se pinta la franja (`diagramExportFrame`). */
export const EXPORT_FRAME_BAND = { light: '#ffffff', dark: '#13131a' } as const;
const MIN_NON_TEXT_CONTRAST = 3;

export interface DiagramExportBranding {
  readonly organizationName: string;
  readonly confidentiality: string;
  /** Ausente cuando el color configurado no se distingue del fondo. */
  readonly accentColor?: string;
  /** Por qué no se usó el color, en una frase para la persona. */
  readonly issue?: string;
}

const formatRatio = (ratio: number): string => ratio.toFixed(1).replace('.', ',');

export function resolveDiagramExportBranding(
  packages: readonly Pick<PublicationPackage, 'artifactRefs' | 'branding' | 'updatedAt'>[] | undefined,
  artifact: { readonly id: string; readonly versionGroupId: string },
  options: { readonly isDark: boolean },
): DiagramExportBranding | null {
  const source = (packages ?? [])
    .filter((pkg) => pkg.branding && pkg.artifactRefs.some(
      (ref) => ref.artifactId === artifact.id || ref.versionGroupId === artifact.versionGroupId,
    ))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!source?.branding) return null;

  const branding = sanitizeBranding(source.branding);
  const accent = parseColor(branding.accentColor);
  const band = parseColor(options.isDark ? EXPORT_FRAME_BAND.dark : EXPORT_FRAME_BAND.light)!;
  const ratio = accent ? contrastRatio(accent, band) : 0;

  const base = { organizationName: branding.organizationName, confidentiality: branding.confidentiality };
  if (ratio >= MIN_NON_TEXT_CONTRAST) return { ...base, accentColor: branding.accentColor };
  return {
    ...base,
    issue: `El color de la marca (${branding.accentColor}) no se distingue del fondo del marco `
      + `(contraste ${formatRatio(ratio)}:1, mínimo 3:1); se exportó sin la franja de color.`,
  };
}
