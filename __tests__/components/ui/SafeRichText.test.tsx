/**
 * `SafeRichText` rendered in a real React tree.
 *
 * `__tests__/security/` covers the sanitiser as a function and the absence of
 * other sinks as a source-level fact. This covers the join between them: that
 * the component the seventeen replaced call sites now share actually puts the
 * rendered Markdown on screen, and actually refuses the payload — measured
 * through the DOM, the way the user meets it.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeRichText } from '../../../components/ui/SafeRichText';

describe('rendering Markdown', () => {
  it('renders formatted content, not the source', () => {
    const { container } = render(<SafeRichText markdown={'## Título\n\nTexto con **énfasis**.'} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Título');
    expect(container.querySelector('strong')).toHaveTextContent('énfasis');
    expect(container.textContent).not.toContain('##');
  });

  it('renders a table, which chat and lesson content rely on', () => {
    const { container } = render(<SafeRichText markdown={'| A | B |\n| - | - |\n| 1 | 2 |'} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('treats a single newline as a line break, as a chat bubble should', () => {
    const { container } = render(<SafeRichText markdown={'línea uno\nlínea dos'} />);
    expect(container.querySelector('br')).toBeTruthy();
  });

  it('renders nothing for empty or absent content', () => {
    const { container } = render(<SafeRichText markdown="" />);
    expect(container.firstElementChild?.innerHTML).toBe('');
  });
});

describe('refusing payloads through the DOM', () => {
  it('does not create a script element from Markdown', () => {
    const { container } = render(<SafeRichText markdown={'Hola\n\n<script>window.__pwned = true;</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('does not keep an event handler on an element it renders', () => {
    const { container } = render(<SafeRichText markdown={'<img src=x onerror="window.__pwned = true">'} />);
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('does not produce a javascript: link', () => {
    const { container } = render(<SafeRichText markdown={'[click](javascript:alert(1))'} />);
    // The attribute is dropped outright rather than rewritten to a harmless
    // target, which leaves the anchor genuinely inert. Either outcome is safe;
    // asserting the absence of the scheme states the guarantee without pinning
    // the mechanism.
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('javascript:');
    // The link text survives — sanitising must not silently delete content.
    expect(container.textContent).toContain('click');
  });

  it('sanitises pre-rendered HTML too, whatever produced it', () => {
    // The `html` prop exists for pipelines that already sanitised. It is
    // sanitised again regardless: a prop whose safety depends on the caller is
    // not a boundary.
    const { container } = render(<SafeRichText html={'<p>ok</p><script>window.__pwned = true;</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('p')).toHaveTextContent('ok');
  });
});

describe('the container contract the call sites depend on', () => {
  it('keeps the className, so existing prose styling still applies', () => {
    const { container } = render(<SafeRichText className="prose prose-sm" markdown="hola" />);
    expect(container.firstElementChild).toHaveClass('prose', 'prose-sm');
  });

  it('renders the requested element', () => {
    const { container } = render(<SafeRichText as="section" markdown="hola" />);
    expect(container.firstElementChild?.tagName).toBe('SECTION');
  });

  it('forwards accessibility attributes, which the diagram views need for their name', () => {
    render(<SafeRichText containerProps={{ role: 'img', 'aria-label': 'Diagrama de la lección' }} html="<svg></svg>" />);
    expect(screen.getByRole('img', { name: 'Diagrama de la lección' })).toBeTruthy();
  });

  it('prefers the Markdown source when both props are given', () => {
    // The un-rendered source cannot already have been through a renderer that
    // widened anything, so it wins.
    const { container } = render(<SafeRichText markdown="**fuente**" html="<em>previo</em>" />);
    expect(container.querySelector('strong')).toHaveTextContent('fuente');
    expect(container.querySelector('em')).toBeNull();
  });
});
