import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardEyebrow } from '../../../components/ui/Card';
import React from 'react';

describe('Card', () => {
    it('renders children inside a div by default', () => {
        render(<Card><span>inner</span></Card>);
        expect(screen.getByText('inner')).toBeInTheDocument();
    });

    it('applies the AI tone gradient classes', () => {
        const { container } = render(<Card tone="ai">x</Card>);
        expect(container.firstChild).toHaveClass('from-ai-50/80');
    });

    it('applies an audience-exec tone', () => {
        const { container } = render(<Card tone="audience-exec">x</Card>);
        expect(container.firstChild).toHaveClass('bg-sky-50/70');
    });

    it('toggles interactive hover affordances', () => {
        const { container } = render(<Card interactive>x</Card>);
        const el = container.firstChild as HTMLElement;
        expect(el.className).toMatch(/cursor-pointer/);
        expect(el.className).toMatch(/hover:shadow-md/);
    });

    it('renders the header / title / description / footer subcomponents', () => {
        render(
            <Card>
                <CardHeader>
                    <CardEyebrow>EYE</CardEyebrow>
                    <CardTitle>Title</CardTitle>
                </CardHeader>
                <CardDescription>Desc</CardDescription>
                <CardFooter>Foot</CardFooter>
            </Card>,
        );
        expect(screen.getByText('EYE')).toBeInTheDocument();
        expect(screen.getByText('Title')).toBeInTheDocument();
        expect(screen.getByText('Desc')).toBeInTheDocument();
        expect(screen.getByText('Foot')).toBeInTheDocument();
    });
});
