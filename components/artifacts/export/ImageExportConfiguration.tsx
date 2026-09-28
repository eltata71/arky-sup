import React from 'react';
import type { ExportFormatOption } from '../../../services/artifacts/application/artifactAssessment';

/**
 * La configuración de la imagen exportada (PNG/SVG): qué área, a qué escala,
 * con marco y leyenda o sin ellos, y los preajustes que agrupan esas cuatro
 * decisiones para un uso concreto (plan de diagramas, 3.4). Salió de
 * `ArtifactExportModal`, que era la capa de exportación entera en un fichero.
 */

export type ImageExportView = 'useful' | 'current' | 'executive' | 'technical' | 'full';
export type ImageExportScale = 1 | 2 | 3;

const IMAGE_EXPORT_STORAGE_KEY = 'arky.export.image-prefs.v1';

export interface ImageExportPrefs {
  view: ImageExportView;
  scale: ImageExportScale;
  frame: boolean;
  legend: boolean;
}

const DEFAULT_IMAGE_PREFS: ImageExportPrefs = {
  view: 'useful',
  scale: 2,
  frame: true,
  legend: true,
};

const VALID_VIEWS: readonly ImageExportView[] = ['useful', 'current', 'executive', 'technical', 'full'];
const VALID_SCALES: readonly ImageExportScale[] = [1, 2, 3];

export function loadImageExportPrefs(): ImageExportPrefs {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_IMAGE_PREFS;
  }
  try {
    const raw = window.localStorage.getItem(IMAGE_EXPORT_STORAGE_KEY);
    if (!raw) return DEFAULT_IMAGE_PREFS;
    const parsed = JSON.parse(raw) as Partial<ImageExportPrefs>;
    return {
      view: VALID_VIEWS.includes(parsed.view as ImageExportView) ? parsed.view as ImageExportView : DEFAULT_IMAGE_PREFS.view,
      scale: VALID_SCALES.includes(parsed.scale as ImageExportScale) ? parsed.scale as ImageExportScale : DEFAULT_IMAGE_PREFS.scale,
      frame: typeof parsed.frame === 'boolean' ? parsed.frame : DEFAULT_IMAGE_PREFS.frame,
      legend: typeof parsed.legend === 'boolean' ? parsed.legend : DEFAULT_IMAGE_PREFS.legend,
    };
  } catch {
    return DEFAULT_IMAGE_PREFS;
  }
}

export function saveImageExportPrefs(prefs: ImageExportPrefs): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(IMAGE_EXPORT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage may be disabled (private browsing, quota); ignore. */
  }
}

interface ImageExportViewMeta {
  value: ImageExportView;
  label: string;
  description: string;
  badge?: { label: string; tone: 'info' | 'warning' };
  formal: boolean;
}

const IMAGE_VIEW_META: readonly ImageExportViewMeta[] = [
  { value: 'useful', label: 'Área útil', description: 'Recomendada para presentaciones y documentación; recorta al contenido real.', formal: true, badge: { label: 'Recomendada', tone: 'info' } },
  { value: 'current', label: 'Vista actual', description: 'Captura lo que ves en pantalla; útil para revisión rápida. No es una exportación formal.', formal: false, badge: { label: 'Snapshot operativo', tone: 'warning' } },
  { value: 'executive', label: 'Vista ejecutiva', description: 'Reduce ruido visual y prioriza la narrativa para comités y stakeholders.', formal: true },
  { value: 'technical', label: 'Vista técnica', description: 'Conserva mayor detalle técnico y metadata para revisiones de arquitectura.', formal: true },
  { value: 'full', label: 'Vista completa', description: 'Útil cuando necesitas todos los boundaries y detalles; añade padding para evitar recortes.', formal: true },
];

/**
 * Preajustes: las cuatro decisiones de la imagen agrupadas para un uso concreto
 * (plan de diagramas, 3.4). Son opciones de exportación, no un campo del
 * diagrama: el mismo artefacto se exporta de las tres formas sin tocarse.
 */
export const IMAGE_EXPORT_PRESETS: ReadonlyArray<{ id: string; label: string; description: string; prefs: ImageExportPrefs }> = [
  {
    id: 'presentation',
    label: 'Presentación',
    description: 'Vista ejecutiva a máxima resolución, con marco y leyenda: lista para una diapositiva.',
    prefs: { view: 'executive', scale: 3, frame: true, legend: true },
  },
  {
    id: 'documentation',
    label: 'Documentación técnica',
    description: 'Vista técnica completa, con marco y leyenda, al tamaño de un documento.',
    prefs: { view: 'technical', scale: 2, frame: true, legend: true },
  },
  {
    id: 'snapshot',
    label: 'Captura rápida',
    description: 'Lo que ves en pantalla, sin marco: para compartir en un chat.',
    prefs: { view: 'current', scale: 1, frame: false, legend: false },
  },
];

/** El preajuste que coincide con las preferencias actuales, si alguno. */
export const matchImagePreset = (prefs: ImageExportPrefs): string | null =>
  IMAGE_EXPORT_PRESETS.find((preset) =>
    preset.prefs.view === prefs.view && preset.prefs.scale === prefs.scale
    && preset.prefs.frame === prefs.frame && preset.prefs.legend === prefs.legend)?.id ?? null;

/**
 * "Configuración de imagen" section. Visible only when PNG or SVG is
 * actually offered by the format catalog so the section never appears
 * on artefacts where the image pipeline does not apply (pure documents,
 * tables).
 *
 * Exposes three controls:
 *  - Area / view: useful / current / executive / technical / full.
 *  - Scale: 1× / 2× / 3× for PNG; disabled with an explanation for SVG.
 *  - Frame toggle + legend toggle: control the editorial frame applied
 *    on top of the captured image.
 */
export const ImageExportConfiguration: React.FC<{
  formatOptions: ExportFormatOption[];
  prefs: ImageExportPrefs;
  onChange: (patch: Partial<ImageExportPrefs>) => void;
}> = ({ formatOptions, prefs, onChange }) => {
  const offersPng = formatOptions.some((opt) => opt.format === 'png' && opt.enabled);
  const offersSvg = formatOptions.some((opt) => opt.format === 'svg' && opt.enabled);
  if (!offersPng && !offersSvg) return null;

  const scaleAppliesToCurrentFormat = offersPng;
  const selectedView = IMAGE_VIEW_META.find((v) => v.value === prefs.view) ?? IMAGE_VIEW_META[0];
  const previewIsOperational = selectedView.value === 'current';

  return (
    <section
      className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-gray-900"
      aria-label="Configuración de imagen"
      data-testid="image-export-configuration"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-bold text-slate-900 dark:text-white">Configuración de imagen</h4>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">PNG · SVG</span>
      </div>

      {/* Preajustes (3.4): cuatro decisiones de una vez */}
      <div role="group" aria-label="Preajustes de imagen" className="mb-3 flex flex-wrap gap-1.5">
        {IMAGE_EXPORT_PRESETS.map((preset) => {
          const active = matchImagePreset(prefs) === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(preset.prefs)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                active
                  ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      {(() => {
        const active = IMAGE_EXPORT_PRESETS.find((preset) => preset.id === matchImagePreset(prefs));
        return active ? <p className="-mt-1.5 mb-3 text-[11px] text-slate-500 dark:text-slate-400">{active.description}</p> : null;
      })()}

      {/* View / area selector */}
      <fieldset className="mb-3">
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Área a exportar
        </legend>
        <div
          role="radiogroup"
          aria-label="Vista de exportación de imagen"
          className="grid gap-2 sm:grid-cols-2"
        >
          {IMAGE_VIEW_META.map((view) => {
            const checked = prefs.view === view.value;
            const badgeTone = view.badge?.tone === 'warning'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
              : 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200';
            return (
              <label
                key={view.value}
                className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer transition-colors ${checked ? 'border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}
                title={view.description}
              >
                <input
                  type="radio"
                  name="image-export-view"
                  value={view.value}
                  checked={checked}
                  onChange={() => onChange({ view: view.value })}
                  className="mt-0.5"
                  aria-label={view.label}
                  data-testid={`image-export-view-${view.value}`}
                />
                <span className="flex-1">
                  <span className="flex items-center gap-1.5">
                    <strong>{view.label}</strong>
                    {view.badge && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${badgeTone}`}>
                        {view.badge.label}
                      </span>
                    )}
                  </span>
                  <span className="block mt-0.5 text-slate-500 dark:text-slate-400">{view.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Scale selector */}
      <fieldset className="mb-3">
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Resolución (escala)
        </legend>
        {scaleAppliesToCurrentFormat ? (
          <div
            role="radiogroup"
            aria-label="Escala de exportación de imagen"
            className="flex flex-wrap gap-2"
          >
            {([1, 2, 3] as const).map((s) => {
              const checked = prefs.scale === s;
              const labels: Record<ImageExportScale, { label: string; hint: string }> = {
                1: { label: '1×', hint: 'rápido / liviano' },
                2: { label: '2×', hint: 'recomendado' },
                3: { label: '3×', hint: 'alta resolución' },
              };
              return (
                <label
                  key={s}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer transition-colors ${checked ? 'border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'}`}
                  title={`${labels[s].label} — ${labels[s].hint}`}
                >
                  <input
                    type="radio"
                    name="image-export-scale"
                    value={s}
                    checked={checked}
                    onChange={() => onChange({ scale: s })}
                    aria-label={`Escala ${labels[s].label} ${labels[s].hint}`}
                    data-testid={`image-export-scale-${s}`}
                  />
                  <span>
                    <strong>{labels[s].label}</strong>
                    <span className="ml-1 text-slate-500 dark:text-slate-400">{labels[s].hint}</span>
                    {s === 2 && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200">Recomendada</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p
            className="rounded-md bg-slate-50 dark:bg-white/5 px-2.5 py-1.5 text-slate-600 dark:text-slate-300"
            data-testid="image-export-scale-na"
          >
            La escala no aplica a SVG porque es un formato vectorial — el archivo escala sin pérdida.
          </p>
        )}
      </fieldset>

      {/* Frame configuration */}
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          Frame profesional
        </legend>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.frame}
            onChange={(e) => onChange({ frame: e.target.checked })}
            className="mt-0.5"
            aria-label="Activar frame profesional con título, fecha y confidencialidad"
            data-testid="image-export-frame-toggle"
          />
          <span>
            <strong>Frame profesional con título, fecha y confidencialidad.</strong>
            <span className="block mt-0.5 text-slate-500 dark:text-slate-400">
              Activado por defecto para exportación formal. Desactívalo si quieres compartir un snapshot informal sin sello editorial.
            </span>
          </span>
        </label>
        <label className={`mt-2 flex items-start gap-2 cursor-pointer ${!prefs.frame ? 'opacity-50' : ''}`}>
          <input
            type="checkbox"
            checked={prefs.legend}
            disabled={!prefs.frame}
            onChange={(e) => onChange({ legend: e.target.checked })}
            className="mt-0.5"
            aria-label="Incluir leyenda en el footer del frame"
            aria-describedby={!prefs.frame ? 'image-export-legend-disabled-hint' : undefined}
            data-testid="image-export-legend-toggle"
          />
          <span>
            <strong>Incluir leyenda en el footer.</strong>
            <span className="block mt-0.5 text-slate-500 dark:text-slate-400">
              {prefs.frame
                ? 'Lista los tipos de nodos y relaciones presentes en el diagrama.'
                : 'Activa primero el frame profesional para añadir la leyenda.'}
            </span>
            {!prefs.frame && (
              <span id="image-export-legend-disabled-hint" className="sr-only">
                Deshabilitado: requiere activar el frame profesional.
              </span>
            )}
          </span>
        </label>
      </fieldset>

      {previewIsOperational && (
        <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Vista actual seleccionada:</strong> el archivo capturará exactamente lo que ves en pantalla y saltará el preflight formal. Úsala como snapshot operativo, no como entregable.
        </p>
      )}
    </section>
  );
};
