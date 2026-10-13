import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../../components/ui/Modal';

afterEach(() => vi.restoreAllMocks());

describe('Modal keyboard focus', () => {
  it('traps Tab, closes with Escape, and restores the opener focus', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.append(opener);
    opener.focus();

    const { rerender, unmount } = render(
      <Modal isOpen onClose={onClose} ariaLabel="Actions">
        <button>First</button><button>Last</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Actions' })).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'First' })).toHaveFocus());
    screen.getByRole('button', { name: 'Last' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<Modal isOpen={false} onClose={onClose} ariaLabel="Actions"><button>First</button></Modal>);
    expect(opener).toHaveFocus();
    unmount();
    opener.remove();
  });
});
