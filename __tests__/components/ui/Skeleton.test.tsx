import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { Skeleton, SkeletonGroup } from '../../../components/ui/Skeleton';

describe('Skeleton', () => {
    it('renders an aria-hidden block by default', () => {
        const { container } = render(<Skeleton width="w-32" height="h-3" />);
        const block = container.firstChild as HTMLElement;
        expect(block).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders multiple lines for shape="text" with lines>1', () => {
        const { container } = render(<Skeleton shape="text" lines={3} />);
        // Each line gets its own block, so we expect 3 inner aria-hidden bars.
        const bars = container.querySelectorAll('.skeleton-shimmer');
        expect(bars.length).toBe(3);
    });

    it('exposes the group label to assistive tech with role="status" + aria-busy', () => {
        render(
            <SkeletonGroup label="Cargando proyecto…">
                <Skeleton width="w-40" />
            </SkeletonGroup>,
        );
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Cargando proyecto…')).toBeInTheDocument();
    });
});
