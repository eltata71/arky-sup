import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { Project, Settings } from '../../types';
import { CustomArtifactRequestModal } from '../../components/CustomArtifactRequestModal';

const settings: Settings = {
  globalContext: [],
  language: 'es',
  theme: 'dark',
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.2,
    tone: 'Profesional',
    languageStyle: 'es',
    apiKeySource: 'global',
  },
};

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ settings }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const project: Project = {
  id: 'p1',
  name: 'Core bancario',
  description: 'Plataforma core con APIs y eventos de dominio.',
  projectContext: ['El API Gateway es el punto de entrada.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('CustomArtifactRequestModal — structured brief flow', () => {
  it('#28/#33 adjunta el contrato estructurado y entrega un ArtifactTemplate a onGenerate', async () => {
    const onGenerate = vi.fn().mockResolvedValue(true);
    render(
      <CustomArtifactRequestModal
        isOpen
        project={project}
        onClose={vi.fn()}
        onGenerate={onGenerate}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Ejemplo:/i), {
      target: { value: 'Necesito un documento que explique la arquitectura de integración del core.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Crear brief estructurado/i }));

    await screen.findByText(/Brief estructurado editable/i);
    expect(screen.getByText(/Brief determinístico/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continuar a fuentes/i }));
    fireEvent.click(screen.getByRole('button', { name: /Construir recomendaciones/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar selección/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Generar con contrato/i }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const template = onGenerate.mock.calls[0][0];
    expect(template.requestContext?.generationContract).toBeDefined();
    expect(template.requestContext?.generationContract?.originalRequest).toContain('arquitectura de integración');
  });
});
