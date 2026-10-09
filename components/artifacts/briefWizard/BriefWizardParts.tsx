import React from 'react';
import { CheckCircleIcon, InformationCircleIcon, MagnifyingGlassIcon, XCircleIcon } from '../../Icons';
import { CollapsibleSection } from '../wizard';

export const ReadinessCard: React.FC<{ ready: boolean; message: string }> = ({ ready, message }) => (
  <div
    role="status"
    aria-live="polite"
    className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
      ready
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
    }`}
  >
    {ready ? <CheckCircleIcon className="mt-0.5 h-4 w-4" /> : <InformationCircleIcon className="mt-0.5 h-4 w-4" />}
    <div>
      <p className="font-semibold">Criterio para avanzar</p>
      <p className="mt-0.5 leading-snug">{message}</p>
    </div>
  </div>
);

interface BriefTraceabilityProps {
  briefAcceptedAiFields: string[];
  briefRejectedAiFields: string[];
}

export const BriefTraceabilityDisclosure: React.FC<BriefTraceabilityProps> = ({ briefAcceptedAiFields, briefRejectedAiFields }) => (
  <CollapsibleSection
    label="Ver trazabilidad del brief"
    openLabel="Ocultar trazabilidad del brief"
    tone="subtle"
    className="mt-4"
  >
    <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
      <div className="flex flex-wrap items-center gap-2">
        {briefAcceptedAiFields.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/60">
            IA aceptó {briefAcceptedAiFields.length} campo(s)
          </span>
        )}
        {briefRejectedAiFields.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60">
            IA rechazó {briefRejectedAiFields.length} campo(s)
          </span>
        )}
      </div>
      {briefAcceptedAiFields.length > 0 && (
        <p>Campos sugeridos por IA y aceptados tras validación determinística: <span className="font-semibold">{briefAcceptedAiFields.join(', ')}</span>.</p>
      )}
      {briefRejectedAiFields.length > 0 && (
        <p>Campos descartados por seguridad o por fallo de validación: <span className="font-semibold">{briefRejectedAiFields.join(', ')}</span>.</p>
      )}
    </div>
  </CollapsibleSection>
);

interface SourceCountSummaryProps {
  counts: { suggested: number; required: number; optional: number; excluded: number };
}

export const OriginalIdeaPreview: React.FC<{ originalRequest: string }> = ({ originalRequest }) => {
  const trimmed = originalRequest.trim();
  if (!trimmed) return null;
  return (
    <CollapsibleSection
      label="Ver idea original"
      openLabel="Ocultar idea original"
      tone="subtle"
      className="mt-3"
    >
      <blockquote className="whitespace-pre-wrap rounded-xl border-l-2 border-primary-300 bg-primary-50/40 px-3 py-2 text-sm italic text-gray-700 dark:border-primary-700 dark:bg-primary-950/20 dark:text-gray-200">
        “{trimmed}”
      </blockquote>
    </CollapsibleSection>
  );
};

interface SourceFilterInputProps {
  query: string;
  onChange: (value: string) => void;
  matchedCount: number;
  totalCount: number;
}

export const SourceFilterInput: React.FC<SourceFilterInputProps> = ({ query, onChange, matchedCount, totalCount }) => (
  <div className="mt-3 space-y-1.5">
    <label className="block">
      <span className="sr-only">Filtrar fuentes</span>
      <span className="relative block">
        <MagnifyingGlassIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
        />
        <input
          type="search"
          value={query}
          onChange={event => onChange(event.target.value)}
          placeholder="Filtrar por nombre, tipo, vista o fase..."
          className="w-full min-h-[44px] rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-10 text-sm text-gray-900 transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpiar filtro de fuentes"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <XCircleIcon className="h-4 w-4" />
          </button>
        )}
      </span>
    </label>
    <p className="text-[11px] text-gray-500 dark:text-gray-400" aria-live="polite">
      {query.length === 0
        ? `Mostrando ${totalCount} fuente${totalCount === 1 ? '' : 's'}.`
        : `Mostrando ${matchedCount} de ${totalCount} fuente${totalCount === 1 ? '' : 's'}.`}
    </p>
  </div>
);

export const SourceCountSummary: React.FC<SourceCountSummaryProps> = ({ counts }) => (
  <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
    <SummaryStat label="Fuentes sugeridas" value={counts.suggested} tone="neutral" />
    <SummaryStat label="Obligatorias" value={counts.required} tone="emerald" />
    <SummaryStat label="Opcionales" value={counts.optional} tone="blue" />
    <SummaryStat label="Excluidas" value={counts.excluded} tone="rose" />
  </dl>
);

const SummaryStat: React.FC<{ label: string; value: number; tone: 'neutral' | 'emerald' | 'blue' | 'rose' }> = ({ label, value, tone }) => {
  const palette = {
    neutral: 'bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-800',
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/60',
    blue: 'bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/60',
    rose: 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/60',
  }[tone];
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${palette}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold leading-none">{value}</dd>
    </div>
  );
};

interface ConfirmationSummaryProps {
  artifactName: string;
  catalogName: string;
  audience: string;
  purpose: string;
  detailLevel: string;
  family: string;
  requiredCount: number;
  optionalCount: number;
  excludedCount: number;
  acceptanceCriteria: string[];
}

export const ConfirmationSummary: React.FC<ConfirmationSummaryProps> = ({ artifactName, catalogName, audience, purpose, detailLevel, family, requiredCount, optionalCount, excludedCount, acceptanceCriteria }) => (
  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
    <SummaryRow label="Artefacto" value={artifactName} emphasis />
    <SummaryRow label="Catálogo base" value={catalogName} />
    <SummaryRow label="Audiencia" value={audience} />
    <SummaryRow label="Propósito" value={purpose} />
    <SummaryRow label="Nivel de detalle" value={detailLevel} />
    <SummaryRow label="Familia" value={family} />
    <SummaryRow label="Fuentes seleccionadas" value={String(requiredCount + optionalCount)} />
    <SummaryRow label="Excluidas" value={String(excludedCount)} />
    {acceptanceCriteria.length > 0 && (
      <div className="sm:col-span-2 rounded-xl bg-white/80 p-3 text-sm shadow-sm ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:ring-emerald-900/60">
        <p className="font-semibold text-gray-900 dark:text-white">Criterios de aceptación</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          {acceptanceCriteria.map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    )}
  </div>
);

const SummaryRow: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({ label, value, emphasis = false }) => (
  <div className="rounded-xl bg-white/80 px-3 py-2 ring-1 ring-emerald-100 dark:bg-gray-900/70 dark:ring-emerald-900/60">
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
    <dd className={`mt-0.5 ${emphasis ? 'text-base font-bold text-gray-900 dark:text-white' : 'text-sm text-gray-700 dark:text-gray-200'}`}>{value}</dd>
  </div>
);

export const WizardFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="sticky bottom-0 mt-5 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white/90 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80 sm:flex-row sm:justify-between sm:gap-3 sm:px-5">
    {children}
  </div>
);

interface FooterButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children: React.ReactNode;
}

export const FooterPrimary: React.FC<FooterButtonProps> = ({ onClick, disabled, loading, leftIcon, rightIcon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-busy={loading || undefined}
    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-950"
  >
    {leftIcon}
    <span>{children}</span>
    {rightIcon}
  </button>
);

export const FooterSecondary: React.FC<FooterButtonProps> = ({ onClick, disabled, leftIcon, rightIcon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus-visible:ring-offset-gray-950"
  >
    {leftIcon}
    <span>{children}</span>
    {rightIcon}
  </button>
);
