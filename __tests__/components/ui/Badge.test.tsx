import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Badge } from '../../../components/ui/Badge';
import React from 'react';

describe('Badge', () => {
    it('renders text children', () => {
        render(<Badge>v1</Badge>);
        expect(screen.getByText('v1')).toBeInTheDocument();
    });

    it('uses the gray solid tone by default', () => {
        render(<Badge>x</Badge>);
        expect(screen.getByText('x').className).toMatch(/bg-gray-100/);
    });

    it('switches to outline mode', () => {
        render(<Badge outline tone="primary">x</Badge>);
        expect(screen.getByText('x').className).toMatch(/border-primary-300/);
    });

    it('renders the dot when requested', () => {
        const { container } = render(<Badge dot tone="success">ok</Badge>);
        const dot = container.querySelector('span > span');
        expect(dot).toBeTruthy();
    });
});
