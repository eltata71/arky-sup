import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInterface } from '../../components/ChatInterface';
import type { Settings } from '../../types';

const sendGuidedMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/ai/generation/guidedProjectCreationService', () => ({
  sendGuidedProjectCreationMessage: sendGuidedMock,
}));

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
  useAppContext: () => ({
    projects: [],
    settings,
    t: (key: string) => key === 'respondHere' ? 'Responde aquí...' : key,
    loadChatHistory: vi.fn(),
    saveChatHistory: vi.fn(),
    getProject: vi.fn(),
  }),
}));

vi.mock('../../hooks/useLMS', () => ({
  useLMS: () => ({ courses: [] }),
}));

describe('ChatInterface guided creation resilience', () => {
  beforeEach(() => {
    sendGuidedMock.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows the successful direct-fallback response without surfacing proxy-local errors', async () => {
    sendGuidedMock.mockResolvedValue({
      requestId: 'ai-guided-1',
      promptSize: 512,
      text: 'Perfecto. Ahora dime el objetivo principal del proyecto.',
    });

    render(
      <ChatInterface
        purpose="guided-creation"
        initialPrompt="Para empezar, ¿cuál es el nombre de tu proyecto?"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Responde aquí...'), {
      target: { value: 'Implementación de plataforma de beneficios' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Responde aquí...'), { key: 'Enter' });

    expect(await screen.findByText(/Perfecto\. Ahora dime el objetivo principal/i)).toBeInTheDocument();
    expect(screen.queryByText(/Canal de IA limitado|Límite de Gemini alcanzado/i)).not.toBeInTheDocument();
    expect(sendGuidedMock).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate guided creation calls on double Enter while a request is in flight', async () => {
    let resolveRequest: (value: { requestId: string; promptSize: number; text: string }) => void = () => undefined;
    sendGuidedMock.mockImplementation(() => new Promise(resolve => {
      resolveRequest = resolve;
    }));

    render(
      <ChatInterface
        purpose="guided-creation"
        initialPrompt="Para empezar, ¿cuál es el nombre de tu proyecto?"
      />,
    );

    const input = screen.getByPlaceholderText('Responde aquí...');
    fireEvent.change(input, { target: { value: 'Cotizador empresarial' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(sendGuidedMock).toHaveBeenCalledTimes(1);

    resolveRequest({ requestId: 'ai-guided-2', promptSize: 480, text: 'Describe el alcance.' });
    await waitFor(() => expect(screen.getByText('Describe el alcance.')).toBeInTheDocument());
  });
});
