/**
 * Canonical C4 ribbon definitions.
 *
 * Used by `components/CustomNode.tsx` to render a standardised hierarchy chip
 * (PERSON / SYSTEM / CONTAINER / COMPONENT / GATEWAY / DATA / …).  Colours
 * intentionally mirror the semantic palette in `lib/diagramTokens.ts` so
 * ribbons harmonise with the node fill derived from `inferPalette`.
 */

export interface C4Ribbon {
    readonly match: RegExp;
    readonly label: string;
    /** Tailwind utility classes (kept inline so CustomNode can compose them). */
    readonly bg: string;
    readonly darkBg: string;
    readonly text: string;
    readonly darkText: string;
}

export const C4_RIBBONS: readonly C4Ribbon[] = [
    { match: /^(person|actor)$/i,                                    label: 'PERSON',     bg: 'bg-blue-500',     darkBg: 'dark:bg-blue-600',    text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^softwaresystem$|^system$|^system_ext$|^context$/i,   label: 'SYSTEM',     bg: 'bg-indigo-600',   darkBg: 'dark:bg-indigo-500',  text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^container$|^container_ext$|^containerdb$|^containerqueue$/i, label: 'CONTAINER',  bg: 'bg-violet-600',   darkBg: 'dark:bg-violet-500',  text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^component$|^component_ext$|^componentdb$|^componentqueue$/i, label: 'COMPONENT',  bg: 'bg-fuchsia-600',  darkBg: 'dark:bg-fuchsia-500', text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^deployment_node$|^node$/i,                            label: 'DEPLOYMENT', bg: 'bg-slate-700',    darkBg: 'dark:bg-slate-500',   text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^boundary$|^enterprise_boundary$|^system_boundary$|^container_boundary$|^component_boundary$/i,
      label: 'BOUNDARY',   bg: 'bg-slate-500',    darkBg: 'dark:bg-slate-400',   text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^gateway$/i,                                           label: 'GATEWAY',    bg: 'bg-purple-600',   darkBg: 'dark:bg-purple-500',  text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^data$/i,                                              label: 'DATA',       bg: 'bg-emerald-600',  darkBg: 'dark:bg-emerald-500', text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^messaging$/i,                                         label: 'MESSAGING',  bg: 'bg-amber-500',    darkBg: 'dark:bg-amber-500',   text: 'text-amber-950', darkText: 'dark:text-amber-950' },
    { match: /^external$/i,                                          label: 'EXTERNAL',   bg: 'bg-sky-600',      darkBg: 'dark:bg-sky-500',     text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^process$/i,                                           label: 'PROCESS',    bg: 'bg-pink-600',     darkBg: 'dark:bg-pink-500',    text: 'text-white',     darkText: 'dark:text-white' },
    { match: /^subsystem$/i,                                         label: 'SUBSYSTEM',  bg: 'bg-indigo-400',   darkBg: 'dark:bg-indigo-300',  text: 'text-white',     darkText: 'dark:text-indigo-950' },
    { match: /^service$/i,                                           label: 'SERVICE',    bg: 'bg-indigo-500',   darkBg: 'dark:bg-indigo-400',  text: 'text-white',     darkText: 'dark:text-white' },
];

export function detectC4Ribbon(kind?: string): C4Ribbon | null {
    if (!kind) return null;
    const clean = kind.trim();
    if (!clean || clean.toLowerCase() === 'unknown' || clean.toLowerCase() === 'component') return null;
    return C4_RIBBONS.find(r => r.match.test(clean)) ?? null;
}
