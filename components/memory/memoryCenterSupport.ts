export type ScopeAction =
    | { mode: 'list' }
    | { mode: 'view'; entryId: string | null; derivedIndex?: number }
    | { mode: 'edit'; entryId: string }
    | { mode: 'create' };

export const ACCEPTED_TYPES = '.txt,.md,.markdown,.pdf,.doc,.docx,.gdoc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

export const readFileAsBase64 = (file: File): Promise<{ name: string; type: string; base64Data: string }> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve({ name: file.name, type: file.type || 'application/octet-stream', base64Data: base64 });
        };
        reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });

export const deriveInitialCaptureFallback = (project: { description?: string; projectContext?: string[] }): string[] => {
    const fallback: string[] = [];
    const trimmedDescription = project.description?.trim();
    if (trimmedDescription) fallback.push(`Descripción inicial del proyecto: ${trimmedDescription}`);
    (project.projectContext ?? []).forEach(item => {
        const trimmed = typeof item === 'string' ? item.trim() : '';
        if (trimmed && !fallback.includes(trimmed)) fallback.push(trimmed);
    });
    return fallback;
};
