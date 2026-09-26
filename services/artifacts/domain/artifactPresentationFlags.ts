const flagEnabled = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value === null || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'disabled'].includes(normalized);
};

export const presentationCompilerFlags = {
  compilerEnabled: flagEnabled(import.meta.env?.VITE_PRESENTATION_COMPILER_ENABLED, true),
  publicationViewEnabled: flagEnabled(import.meta.env?.VITE_PUBLICATION_VIEW_ENABLED, true),
  presentationExportEnabled: flagEnabled(import.meta.env?.VITE_PRESENTATION_EXPORT_ENABLED, true),
};

export const isPresentationCompilerEnabled = (): boolean =>
  flagEnabled(import.meta.env?.VITE_PRESENTATION_COMPILER_ENABLED, true);

export const isPublicationViewEnabled = (): boolean =>
  flagEnabled(import.meta.env?.VITE_PUBLICATION_VIEW_ENABLED, true);

export const isPresentationExportEnabled = (): boolean =>
  flagEnabled(import.meta.env?.VITE_PRESENTATION_EXPORT_ENABLED, true);
