import { useEffect, useRef, useState } from 'react';

export interface PresenterWindowState {
  /** Where to portal the presenter view, once the window is open. */
  container: HTMLElement | null;
  /** The window itself, so its keys can drive the deck too. */
  win: Window | null;
  /** The browser refused to open it; the caller shows the view in place. */
  blocked: boolean;
}

const WINDOW_NAME = 'arky-presenter';
const WINDOW_FEATURES = 'popup,width=1100,height=720';

/**
 * Opens the presenter view in a second window (12.4) and hands back a node to
 * portal into. It is the same React tree, so the slide index, the clock and
 * the notes are one state on two screens — nothing is synchronised because
 * nothing is copied.
 *
 * The window starts as `about:blank`, so the app's stylesheets are cloned
 * into it with absolute URLs; without them the view arrives unstyled. Closing
 * the window reports through `onClosed`; ending the presentation closes it.
 */
export function usePresenterWindow(requested: boolean, title: string, onClosed: () => void): PresenterWindowState {
  const [state, setState] = useState<PresenterWindowState>({ container: null, win: null, blocked: false });
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (!requested) {
      setState({ container: null, win: null, blocked: false });
      return undefined;
    }
    const win = window.open('', WINDOW_NAME, WINDOW_FEATURES);
    if (!win) {
      setState({ container: null, win: null, blocked: true });
      return undefined;
    }
    const doc = win.document;
    doc.documentElement.lang = document.documentElement.lang || 'es';
    doc.title = title;
    doc.head.replaceChildren();
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      const copy = node.cloneNode(true) as HTMLElement;
      if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
      doc.head.appendChild(copy);
    });
    doc.body.replaceChildren();
    doc.body.className = 'bg-gray-950 text-white antialiased';
    const container = doc.createElement('div');
    container.className = 'min-h-screen';
    doc.body.appendChild(container);
    setState({ container, win, blocked: false });

    const handleClosed = () => onClosedRef.current();
    win.addEventListener('pagehide', handleClosed);
    return () => {
      win.removeEventListener('pagehide', handleClosed);
      setState({ container: null, win: null, blocked: false });
      win.close();
    };
  }, [requested, title]);

  return state;
}
