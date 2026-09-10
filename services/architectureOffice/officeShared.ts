/**
 * El formato del código lo define `lib/eaTerminology`, que es donde vive el
 * vocabulario del producto. Aquí había una copia literal de la misma expresión
 * regular: dos definiciones del mismo concepto, y una de ellas condenada a
 * quedarse atrás. `BUSINESS_PROJECT_ID_PATTERN` se reexporta porque el nombre
 * está en uso, pero la fuente es una sola.
 */
import { INITIATIVE_CODE_PATTERN, toInitiativeCode, type BusinessInitiativeCode } from '../../lib/eaTerminology';

export const BUSINESS_PROJECT_ID_PATTERN = INITIATIVE_CODE_PATTERN;

export const foldOfficeText = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const normalizeBusinessProjectId = (value: unknown): BusinessInitiativeCode | null =>
  toInitiativeCode(value);

export const normalizeBusinessProjectIds = (values: unknown): BusinessInitiativeCode[] => {
  if (!Array.isArray(values)) return [];
  const valid = values
    .map(normalizeBusinessProjectId)
    .filter((value): value is BusinessInitiativeCode => value !== null);
  return Array.from(new Set(valid));
};

export const hasExactOfficeMention = (message: string, alias: string): boolean => {
  const normalized = foldOfficeText(message.trim());
  const normalizedAlias = foldOfficeText(alias);
  const escapedAlias = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)@${escapedAlias}(?=$|[\\s,.:;!?])`).test(normalized)
    || normalized.startsWith(`${normalizedAlias},`)
    || normalized.startsWith(`${normalizedAlias}:`);
};
