import { describe, expect, it } from 'vitest';
import { buildDocumentIR } from '../../lib/artifacts/documentIR';
import type {
    ArtifactDiagnostic,
    ArtifactEnvelope,
    ArtifactPersistenceState,
    ArtifactRenderState,
    ArtifactValidationState,
    ArtifactViewModel,
    DocumentIR,
    ExportRequest,
    ExportResult,
    GenerationTrace,
} from '../../lib/artifacts/contracts';

// These tests pin the canonical contracts: removing or renaming a field
// breaks compilation, which is the desired behaviour during the Phase 1
// stabilisation freeze.
describe('lib/artifacts/contracts', () => {
    it('keeps ArtifactViewModel additive', () => {
        const vm: ArtifactViewModel = {
            id: 'a-1',
            name: 'Demo',
            type: 'markdown',
            representation: 'document',
            audience: 'technical',
            theme: 'editorial',
            content: '# Hello',
            hasIR: false,
            hasDiagram: false,
            hasDocument: true,
            hasMermaid: false,
            hasMarkdown: true,
        };
        expect(vm.hasDocument).toBe(true);
    });

    it('keeps ArtifactRenderState additive', () => {
        const state: ArtifactRenderState = {
            viewMode: 'document',
            diagram: { status: 'empty', nodeCount: 0, edgeCount: 0, source: 'unknown', fallbackUsed: false },
            document: { status: 'rendered', htmlLength: 10, hasMarkdownSource: true },
            diagnostics: [],
        };
        expect(state.diagram.status).toBe('empty');
    });

    it('keeps ArtifactPersistenceState additive', () => {
        const state: ArtifactPersistenceState = { local: 'success', remote: 'pending' };
        expect(state.local).toBe('success');
    });

    it('keeps ExportRequest/ExportResult shapes additive', () => {
        // Constructed via type assertion (cannot mint a real Blob in jsdom-free env).
        const req = {
            artifact: { id: 'a' } as ExportRequest['artifact'],
            activeView: 'document',
            format: 'md',
        } as ExportRequest;
        expect(req.format).toBe('md');
        const res = {
            file: {} as ExportResult['file'],
            trace: {} as ExportResult['trace'],
            operationId: 'op-1',
        };
        expect(res.operationId).toBe('op-1');
    });

    it('exposes DocumentIR shape', () => {
        const ir: DocumentIR = { blocks: [], hasFrontMatter: false, tableCount: 0, mermaidBlockCount: 0, warnings: [] };
        expect(ir.blocks).toEqual([]);
    });

    it('re-exports GenerationTrace + ArtifactEnvelope + ArtifactDiagnostic + ArtifactValidationState', () => {
        const diag = { stage: 'rendering', level: 'info', code: 'ok', message: 'ok', at: 'now' } as ArtifactDiagnostic;
        const envelope = {} as ArtifactEnvelope;
        const trace = {} as GenerationTrace;
        const validation = {} as ArtifactValidationState;
        expect(diag.stage).toBe('rendering');
        expect(envelope).toBeDefined();
        expect(trace).toBeDefined();
        expect(validation).toBeDefined();
    });
});

describe('buildDocumentIR', () => {
    it('produces an empty IR for empty markdown', () => {
        const ir = buildDocumentIR('');
        expect(ir.blocks).toEqual([]);
        expect(ir.hasFrontMatter).toBe(false);
        expect(ir.tableCount).toBe(0);
    });

    it('extracts headings and paragraphs preserving order', () => {
        const ir = buildDocumentIR('# Title\n\nIntro paragraph.\n\n## Section\n\nDetails.');
        expect(ir.title).toBe('Title');
        expect(ir.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);
        const headings = ir.blocks.filter((b) => b.kind === 'heading');
        expect(headings.map((h) => h.level)).toEqual([1, 2]);
    });

    it('detects fenced mermaid blocks and counts tables', () => {
        const md = [
            '# Hybrid artifact',
            '',
            '```mermaid',
            'flowchart LR',
            '  A --> B',
            '```',
            '',
            '| Header | Value |',
            '| --- | --- |',
            '| Foo | Bar |',
            '',
        ].join('\n');
        const ir = buildDocumentIR(md);
        expect(ir.mermaidBlockCount).toBe(1);
        expect(ir.tableCount).toBe(1);
        const tableBlock = ir.blocks.find((b) => b.kind === 'table');
        expect(tableBlock?.text).toContain('| Foo | Bar |');
        const mermaidBlock = ir.blocks.find((b) => b.kind === 'mermaid');
        expect(mermaidBlock?.text).toContain('flowchart LR');
    });

    it('records a warning for unterminated code fences', () => {
        const ir = buildDocumentIR('# Title\n\n```\nopen fence\nnever closes');
        expect(ir.warnings).toContain('unterminated-code-fence');
    });

    it('strips YAML front-matter and exposes the flag', () => {
        const md = '---\ntitle: Foo\n---\n\n# Body';
        const ir = buildDocumentIR(md);
        expect(ir.hasFrontMatter).toBe(true);
        expect(ir.blocks[0]).toMatchObject({ kind: 'heading', text: 'Body' });
    });
});
