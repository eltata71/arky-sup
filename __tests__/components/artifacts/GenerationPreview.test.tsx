import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GenerationPreview } from '../../../components/artifacts/GenerationPreview';

describe('GenerationPreview', () => {
  it('muestra el contenido en sólo lectura con cursor y se puede ampliar', () => {
    const long = `${'a'.repeat(1500)}FINAL`;
    render(<GenerationPreview text={long} title="Visión" />);
    const pre = screen.getByLabelText('Vista previa en curso');
    expect(pre.textContent).toContain('FINAL');
    expect(pre.textContent).toContain('▍');
    expect(pre.textContent?.length).toBeLessThan(1300);
    fireEvent.click(screen.getByRole('button', { name: /Ampliar la vista previa de Visión/ }));
    expect(screen.getByLabelText('Vista previa en curso').textContent).toContain('a'.repeat(1500));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
