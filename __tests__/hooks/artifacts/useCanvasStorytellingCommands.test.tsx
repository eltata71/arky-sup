import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useCanvasStorytellingCommands } from '../../../hooks/artifacts/useCanvasStorytellingCommands';
import type { CanvasStorytellingCommandsOptions } from '../../../hooks/artifacts/useCanvasStorytellingCommands';
import type { Command } from '../../../context/CommandPaletteContext';
import type { ReactFlowCanvasHandle } from '../../../components/ReactFlowCanvas';

const renderHook = (options: CanvasStorytellingCommandsOptions) => {
    const captured: { commands: Command[] } = { commands: [] };
    const Probe: React.FC<{ options: CanvasStorytellingCommandsOptions }> = ({ options: opts }) => {
        captured.commands = useCanvasStorytellingCommands(opts);
        return null;
    };
    const view = render(<Probe options={options} />);
    return { captured, rerender: (next: CanvasStorytellingCommandsOptions) => view.rerender(<Probe options={next} />) };
};

const baseOptions = (overrides: Partial<CanvasStorytellingCommandsOptions> = {}): CanvasStorytellingCommandsOptions => ({
    representation: 'diagram',
    hasIR: true,
    reactFlowRef: { current: null } as React.RefObject<ReactFlowCanvasHandle | null>,
    onOpenBrief: vi.fn(),
    onAudienceChange: vi.fn(),
    ...overrides,
});

describe('useCanvasStorytellingCommands', () => {
    it('offers presentation, brief and the three audiences for a parsed diagram', () => {
        const { captured } = renderHook(baseOptions());
        expect(captured.commands.map(c => c.id)).toEqual([
            'canvas.story.present',
            'canvas.story.brief',
            'canvas.audience.executive',
            'canvas.audience.technical',
            'canvas.audience.operations',
        ]);
    });

    it('offers nothing for a document artifact', () => {
        const { captured } = renderHook(baseOptions({ representation: 'document' }));
        expect(captured.commands).toEqual([]);
    });

    it('offers nothing when the diagram never parsed into an IR', () => {
        const { captured } = renderHook(baseOptions({ hasIR: false }));
        expect(captured.commands).toEqual([]);
    });

    it('starts the presentation on the canvas handle it was given', () => {
        const startPresentation = vi.fn();
        const reactFlowRef = { current: { startPresentation } } as unknown as React.RefObject<ReactFlowCanvasHandle | null>;
        const { captured } = renderHook(baseOptions({ reactFlowRef }));
        captured.commands.find(c => c.id === 'canvas.story.present')!.run();
        expect(startPresentation).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the canvas is not mounted yet', () => {
        const { captured } = renderHook(baseOptions());
        expect(() => captured.commands.find(c => c.id === 'canvas.story.present')!.run()).not.toThrow();
    });

    it('routes each audience command to its own audience', () => {
        const onAudienceChange = vi.fn();
        const { captured } = renderHook(baseOptions({ onAudienceChange }));
        captured.commands.find(c => c.id === 'canvas.audience.executive')!.run();
        captured.commands.find(c => c.id === 'canvas.audience.technical')!.run();
        captured.commands.find(c => c.id === 'canvas.audience.operations')!.run();
        expect(onAudienceChange.mock.calls.map(([a]) => a)).toEqual(['executive', 'technical', 'operations']);
    });

    it('opens the executive brief', () => {
        const onOpenBrief = vi.fn();
        const { captured } = renderHook(baseOptions({ onOpenBrief }));
        captured.commands.find(c => c.id === 'canvas.story.brief')!.run();
        expect(onOpenBrief).toHaveBeenCalledTimes(1);
    });

    it('keeps the same array identity across renders with stable inputs', () => {
        const options = baseOptions();
        const { captured, rerender } = renderHook(options);
        const first = captured.commands;
        rerender(options);
        expect(captured.commands).toBe(first);
    });
});
