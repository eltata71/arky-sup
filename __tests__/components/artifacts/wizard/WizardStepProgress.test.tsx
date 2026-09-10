import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WizardStepProgress, type WizardStepDescriptor } from '../../../../components/artifacts/wizard/WizardStepProgress';

const STEPS: WizardStepDescriptor[] = [
  { number: 1, label: 'Idea' },
  { number: 2, label: 'Brief' },
  { number: 3, label: 'Fuentes' },
  { number: 4, label: 'Recomendaciones' },
  { number: 5, label: 'Confirmación' },
];

describe('WizardStepProgress', () => {
  it('marks the current step with aria-current="step"', () => {
    render(<WizardStepProgress steps={STEPS} currentStep={3} />);
    const current = screen.getByLabelText(/3 · Fuentes/i);
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('renders completed steps with a checkmark and makes them navigable', () => {
    const onNavigate = vi.fn();
    render(
      <WizardStepProgress
        steps={STEPS}
        currentStep={3}
        completedSteps={[1, 2]}
        navigableSteps={[1, 2, 3]}
        onNavigate={onNavigate}
      />,
    );
    const completed = screen.getByRole('button', { name: /1 · Idea/i });
    fireEvent.click(completed);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('renders upcoming, non-navigable steps as non-button status nodes', () => {
    render(
      <WizardStepProgress
        steps={STEPS}
        currentStep={2}
        navigableSteps={[1, 2]}
      />,
    );
    // Step 4 is upcoming and not navigable — it should not be rendered as a button.
    expect(screen.queryByRole('button', { name: /4 · Recomendaciones/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/4 · Recomendaciones/i)).toBeInTheDocument();
  });
});
