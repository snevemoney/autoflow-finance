// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { byText, cleanup, click, render } from '@/test/dom';

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Cannot read properties of undefined (reading \'bgColor\')');
  return <p>All good</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows the fallback instead of a blank screen and logs the error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await render(<ErrorBoundary><Boom explode /></ErrorBoundary>);
    expect(r.text()).toContain('Something went wrong');
    expect(byText(r.container, 'Reload', 'button')).not.toBeNull();
    expect(byText(r.container, 'Go to dashboard', 'button')).not.toBeNull();
    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(log.mock.calls.some((c) => String(c[0]).includes('[AutoFlow] Something went wrong'))).toBe(true);
  });

  it('only replaces the broken part (route level) and leaves the rest on screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await render(
      <div>
        <nav>Sidebar</nav>
        <ErrorBoundary variant="inline"><Boom explode /></ErrorBoundary>
      </div>,
    );
    expect(r.text()).toContain('Sidebar');
    expect(r.text()).toContain('Something went wrong');
  });

  it('recovers when the reset key (the route) changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await render(<ErrorBoundary resetKey="/deals"><Boom explode /></ErrorBoundary>);
    expect(r.text()).toContain('Something went wrong');
    await r.rerender(<ErrorBoundary resetKey="/pipeline"><Boom explode={false} /></ErrorBoundary>);
    expect(r.text()).toContain('All good');
  });

  it('"Go to dashboard" leaves for the given home page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, reload: vi.fn() } });
    try {
      const r = await render(<ErrorBoundary homeHref="/portal"><Boom explode /></ErrorBoundary>);
      await click(byText(r.container, 'Go to dashboard', 'button'));
      expect(assign).toHaveBeenCalledWith('/portal');
      await click(byText(r.container, 'Reload', 'button'));
      expect(window.location.reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('renders children untouched when nothing fails', async () => {
    const r = await render(<ErrorBoundary><Boom explode={false} /></ErrorBoundary>);
    expect(r.text()).toBe('All good');
  });
});
