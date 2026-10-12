import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const request = vi.fn();
const toast = vi.fn();

vi.mock('../../context/OfficeContext', () => ({ useOffice: () => ({ requestCharterChanges: request }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: toast }) }));
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ t: (k: string) => k }) }));

import { CharterChangesRequest } from '../../components/architectureOffice/CharterChangesRequest';

describe('CharterChangesRequest', () => {
  it('envía el motivo escrito al contexto de la Oficina', async () => {
    request.mockResolvedValue({ ok: true });
    render(<CharterChangesRequest engagementId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: /charterChanges.open/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Falta alcance' } });
    fireEvent.click(screen.getByRole('button', { name: /charterChanges.send/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('e1', 'Falta alcance'));
  });
});
