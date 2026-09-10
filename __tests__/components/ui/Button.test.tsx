import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Button } from '../../../components/ui/Button';
import React from 'react';

describe('Button', () => {
    it('renders the label', () => {
        render(<Button>Hola</Button>);
        expect(screen.getByRole('button', { name: 'Hola' })).toBeInTheDocument();
    });

    it('uses the primary variant by default', () => {
        render(<Button>Send</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toMatch(/bg-primary-600/);
    });

    it('renders danger variant correctly', () => {
        render(<Button variant="danger">Delete</Button>);
        expect(screen.getByRole('button').className).toMatch(/bg-red-600/);
    });

    it('shows a spinner and disables the button while loading', () => {
        render(<Button loading>Saving</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('forwards onClick when not disabled', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Tap</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick when disabled', () => {
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>Tap</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('renders left and right icons', () => {
        render(
            <Button leftIcon={<span data-testid="left" />} rightIcon={<span data-testid="right" />}>X</Button>,
        );
        expect(screen.getByTestId('left')).toBeInTheDocument();
        expect(screen.getByTestId('right')).toBeInTheDocument();
    });

    it('applies fullWidth class', () => {
        render(<Button fullWidth>Wide</Button>);
        expect(screen.getByRole('button').className).toMatch(/\bw-full\b/);
    });

    it('applies the AI variant gradient class', () => {
        render(<Button variant="ai">Magic</Button>);
        expect(screen.getByRole('button').className).toMatch(/bg-ai-gradient/);
    });

    it('respects iconOnly sizing', () => {
        render(<Button iconOnly aria-label="x"><span /></Button>);
        const btn = screen.getByRole('button', { name: 'x' });
        expect(btn.className).toMatch(/\bw-10\b/);
    });
});
