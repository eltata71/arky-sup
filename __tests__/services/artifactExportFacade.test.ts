import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Artifact } from '../../lib/artifacts';

const exportArtifactMock = vi.fn();
const downloadFileMock = vi.fn();
const validateArtifactForExportMock = vi.fn();

vi.mock('../../services/export/exportService', () => ({
    exportArtifact: (...args: unknown[]) => exportArtifactMock(...args),
}));
vi.mock('../../services/export/downloadService', () => ({
    downloadFile: (...args: unknown[]) => downloadFileMock(...args),
}));
vi.mock('../../services/export/artifactExportValidation', async () => {
    const actual = await vi.importActual<typeof import('../../services/export/artifactExportValidation')>('../../services/export/artifactExportValidation');
    return {
        ...actual,
        validateArtifactForExport: (...args: unknown[]) => validateArtifactForExportMock(...args),
    };
});

const { performArtifactExport } = await import('../../services/artifacts/application/exportFacade');

const baseArtifact: Artifact = {
    id: 'a-1',
    versionGroupId: 'vg',
    version: 1,
    createdAt: '2026-05-11T00:00:00.000Z',
    name: 'Demo',
    type: 'markdown',
    phase: 'P',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '# Demo',
    objective: 'doc',
    keyConcepts: [],
    representation: 'document',
};

describe('performArtifactExport', () => {
    beforeEach(() => {
        exportArtifactMock.mockReset();
        downloadFileMock.mockReset();
        validateArtifactForExportMock.mockReset();
    });

    it('throws a Spanish-friendly error message when validation blocks the export', async () => {
        validateArtifactForExportMock.mockReturnValue({
            canExport: false,
            message: 'No hay diagrama exportable',
            suggestedAction: 'Genera contenido primero.',
            checks: [],
            classification: { primaryKind: 'document' },
            status: 'blocked',
            activeView: 'document',
            blockingScopes: ['diagram'],
        });

        await expect(
            performArtifactExport({
                artifact: baseArtifact,
                activeView: 'document',
                format: 'png',
            }),
        ).rejects.toThrow('No hay diagrama exportable Genera contenido primero.');

        expect(exportArtifactMock).not.toHaveBeenCalled();
    });

    it('runs export and skips download when not requested', async () => {
        validateArtifactForExportMock.mockReturnValue({ canExport: true, message: 'ok', checks: [], classification: { primaryKind: 'document' }, status: 'ready', activeView: 'document', blockingScopes: [] });
        exportArtifactMock.mockResolvedValue({
            file: { blob: new Blob(['x']), filename: 'demo.md', mimeType: 'text/markdown', extension: 'md', format: 'md' },
            trace: { id: 't-1' },
        });

        const result = await performArtifactExport({
            artifact: baseArtifact,
            activeView: 'document',
            format: 'md',
        });

        expect(exportArtifactMock).toHaveBeenCalledTimes(1);
        expect(downloadFileMock).not.toHaveBeenCalled();
        expect(result.result.operationId).toBe('t-1');
        expect(result.download).toBeUndefined();
    });

    it('runs export and downloads when requested', async () => {
        validateArtifactForExportMock.mockReturnValue({ canExport: true, message: 'ok', checks: [], classification: { primaryKind: 'document' }, status: 'ready', activeView: 'document', blockingScopes: [] });
        exportArtifactMock.mockResolvedValue({
            file: { blob: new Blob(['x']), filename: 'demo.md', mimeType: 'text/markdown', extension: 'md', format: 'md' },
            trace: { id: 't-2' },
        });
        downloadFileMock.mockResolvedValue({ filename: 'demo.md', size: 1024 });

        const result = await performArtifactExport({
            artifact: baseArtifact,
            activeView: 'document',
            format: 'md',
            download: true,
        });

        expect(downloadFileMock).toHaveBeenCalledTimes(1);
        expect(result.download).toEqual({ filename: 'demo.md', size: 1024 });
    });
});
