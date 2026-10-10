// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryError } from './QueryError';
import { StatusBadge } from './deals/StatusBadge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, unmount: () => act(() => root.unmount()) };
}
afterEach(() => {
  container?.remove();
  container = null;
});

describe('<QueryError>', () => {
  it('says what failed, shows the reason and retries', () => {
    const onRetry = vi.fn();
    const { container: el, unmount } = render(<QueryError what="the deals" error={new Error('500 Internal Server Error')} onRetry={onRetry} />);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toContain("We couldn't load the deals.");
    expect(el.textContent).toContain('500 Internal Server Error');
    const button = el.querySelector('button')!;
    expect(button.textContent).toContain('Try again');
    act(() => button.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('has no retry button without onRetry', () => {
    const { container: el, unmount } = render(<QueryError what="reports" />);
    expect(el.querySelector('button')).toBeNull();
    unmount();
  });
});

describe('<StatusBadge>', () => {
  it('renders an unknown status instead of crashing', () => {
    const { container: el, unmount } = render(<StatusBadge status="on_hold" />);
    expect(el.textContent).toBe('On hold');
    unmount();
  });
});
