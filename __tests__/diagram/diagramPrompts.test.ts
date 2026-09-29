import { describe, it, expect } from 'vitest';
import {
    buildAutoFixPrompt,
} from '../../services/ai/prompts/diagramPrompts';
describe('diagramPrompts', () => {
    it('auto-fix prompt includes the failing mermaid and the error message', () => {
        const prompt = buildAutoFixPrompt({ mermaid: 'flowchart LR\n A --> B', error: 'unexpected token' });
        expect(prompt).toContain('unexpected token');
        expect(prompt).toContain('flowchart LR');
    });
});
