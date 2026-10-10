/**
 * What an application says beyond being an inventory item (11.5): the two
 * measured axes TIME rationalisation reads. Absent means not assessed, never 0.
 */

export const FIT_SCORES = [1, 2, 3, 4, 5] as const;
export type FitScore = (typeof FIT_SCORES)[number];

export interface ApplicationAttributes {
  /** How well the application serves the business function (1 poor … 5 excellent). */
  readonly functionalFit?: FitScore;
  /** How sound it is as technology: supportable, secure, evolvable (1 poor … 5 excellent). */
  readonly technicalFit?: FitScore;
}

export const isFitScore = (value: unknown): value is FitScore => FIT_SCORES.includes(value as FitScore);

export const readApplicationAttributes = (raw: unknown): ApplicationAttributes | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const attributes: ApplicationAttributes = {
    ...(isFitScore(r.functionalFit) ? { functionalFit: r.functionalFit } : {}),
    ...(isFitScore(r.technicalFit) ? { technicalFit: r.technicalFit } : {}),
  };
  return Object.keys(attributes).length ? attributes : undefined;
};
