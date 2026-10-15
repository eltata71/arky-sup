import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveAgentProfile } from '../../services/architectureOffice/domain/officeAgentProfile';
import { AgentProfileSheet } from '../../components/architectureOffice/agentProfile/AgentProfileSheet';

vi.mock('../../lib/i18n/UiTranslationContext', () => ({
  useUiTranslation: () => (key: string) => key,
}));
vi.mock('../../hooks/useEffectiveAgentModel', () => ({
  useEffectiveAgentModel: () => 'gemini-3.1-flash-lite',
}));

describe('AgentProfileSheet model tier', () => {
  it('shows the model id resolved for the agent tier', () => {
    render(<AgentProfileSheet profile={resolveAgentProfile('tomas')} onClose={() => {}} onEdit={() => {}} />);
    expect(screen.getByText('agent.effectiveModel: gemini-3.1-flash-lite')).toBeTruthy();
  });
});
