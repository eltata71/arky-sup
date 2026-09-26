import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfficeAgentPicker } from '../../components/architectureOffice/OfficeAgentPicker';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';

describe('OfficeAgentPicker', () => {
  it('offers every registered persona and reports a keyboard/click selection', () => {
    const onSelect = vi.fn();
    render(<OfficeAgentPicker onSelect={onSelect} />);
    expect(screen.getAllByRole('button')).toHaveLength(Object.keys(OFFICE_AGENT_PERSONAS).length);
    fireEvent.click(screen.getByRole('button', { name: /Mauricio/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'mauricio' }));
  });
});
