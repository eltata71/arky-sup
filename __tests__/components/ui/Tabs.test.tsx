import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { Tabs, TabList, Tab, TabPanel } from '../../../components/ui/Tabs';

const Harness: React.FC<{ initial?: string; onChange?: (v: string) => void }> = ({ initial = 'a', onChange }) => {
    const [value, setValue] = useState(initial);
    return (
        <Tabs value={value} onChange={(v) => { setValue(v); onChange?.(v); }}>
            <TabList aria-label="Secciones">
                <Tab value="a">Alpha</Tab>
                <Tab value="b">Beta</Tab>
                <Tab value="c">Gamma</Tab>
            </TabList>
            <TabPanel value="a">Contenido A</TabPanel>
            <TabPanel value="b">Contenido B</TabPanel>
            <TabPanel value="c">Contenido C</TabPanel>
        </Tabs>
    );
};

describe('Tabs', () => {
    it('renders the active panel only by default', () => {
        render(<Harness />);
        expect(screen.getByText('Contenido A')).toBeInTheDocument();
        expect(screen.queryByText('Contenido B')).not.toBeInTheDocument();
    });

    it('exposes proper ARIA roles and selection state', () => {
        render(<Harness />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
        // Tablist labelled
        expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Secciones');
    });

    it('activates a tab via click', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
        expect(onChange).toHaveBeenCalledWith('b');
        expect(screen.getByText('Contenido B')).toBeInTheDocument();
    });

    it('activates a tab via Enter key', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const beta = screen.getByRole('tab', { name: 'Beta' });
        beta.focus();
        fireEvent.keyDown(beta, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('b');
    });

    it('moves focus with ArrowRight / ArrowLeft', () => {
        render(<Harness />);
        const [alpha, beta, gamma] = screen.getAllByRole('tab');
        alpha.focus();
        fireEvent.keyDown(alpha, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(beta);
        fireEvent.keyDown(beta, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(gamma);
        fireEvent.keyDown(gamma, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(beta);
    });

    it('jumps to first/last with Home/End', () => {
        render(<Harness />);
        const [alpha, , gamma] = screen.getAllByRole('tab');
        alpha.focus();
        fireEvent.keyDown(alpha, { key: 'End' });
        expect(document.activeElement).toBe(gamma);
        fireEvent.keyDown(gamma, { key: 'Home' });
        expect(document.activeElement).toBe(alpha);
    });

    it('uses roving tabindex: only the active tab has tabIndex=0', () => {
        render(<Harness />);
        const tabs = screen.getAllByRole('tab');
        expect(tabs[0].tabIndex).toBe(0);
        expect(tabs[1].tabIndex).toBe(-1);
        expect(tabs[2].tabIndex).toBe(-1);
    });
});
