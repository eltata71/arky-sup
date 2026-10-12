import type { Dictionary } from './translations';
import { esCore, SPANISH_SECTION_LOADERS } from './locales/spanish';

/**
 * El diccionario español vivo (14.6). Arranca con el núcleo y crece en sitio:
 * una ruta trae su sección antes de pintarse (`lazyWithRetry`), y en reposo se
 * completa con el resto como red de seguridad. Un único objeto, para que
 * `INITIAL_TRANSLATIONS.es` y `spanishFallback` lean siempre lo mismo.
 */
export const spanishDictionary: Dictionary = { ...esCore };

const listeners = new Set<() => void>();
const loaded = new Map<string, Promise<void>>();
let version = 0;

export const subscribeSpanish = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const getSpanishVersion = (): number => version;

/** Mezcla un trozo ya cargado. Las pruebas lo usan para sembrar el español completo. */
export function mergeSpanish(section: Dictionary): void {
  Object.assign(spanishDictionary, section);
  version += 1;
  listeners.forEach((listener) => listener());
}

function loadSection(name: string): Promise<void> {
  const existing = loaded.get(name);
  if (existing) return existing;
  const loader = SPANISH_SECTION_LOADERS[name];
  const pending = loader
    ? loader().then(mergeSpanish, () => { loaded.delete(name); })
    : Promise.resolve();
  loaded.set(name, pending);
  return pending;
}

/** Trae lo compartido y lo propio de una ruta. Nunca rechaza: una clave que falte se ve, pero la ruta abre. */
export async function ensureSpanishSections(chunkName?: string): Promise<void> {
  const wanted = ['shared'];
  if (chunkName) wanted.push(chunkName);
  await Promise.all(wanted.map(loadSection));
}

export async function ensureFullSpanish(): Promise<Dictionary> {
  await Promise.all(Object.keys(SPANISH_SECTION_LOADERS).map(loadSection));
  return spanishDictionary;
}

let idleScheduled = false;

/** Red de seguridad: completa el español cuando el navegador está libre. */
export function scheduleFullSpanishLoad(): void {
  if (idleScheduled || typeof window === 'undefined') return;
  idleScheduled = true;
  const run = () => { void ensureFullSpanish(); };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 8000 });
  else setTimeout(run, 4000);
}
