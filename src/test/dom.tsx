// Minimal DOM helpers for component tests (jsdom), without extra dependencies.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  rerender: (ui: ReactNode) => Promise<void>;
  unmount: () => void;
  text: () => string;
}

const mounted: Root[] = [];

export async function render(ui: ReactNode): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  await act(async () => { root.render(ui); });
  return {
    container,
    rerender: async (next) => { await act(async () => { root.render(next); }); },
    unmount: () => { act(() => root.unmount()); container.remove(); },
    text: () => container.textContent ?? '',
  };
}

export function cleanup() {
  while (mounted.length) {
    const root = mounted.pop()!;
    act(() => root.unmount());
  }
  document.body.innerHTML = '';
}

/** Retries `check` (flushing React work in between) until it stops throwing. */
export async function waitFor(check: () => void, timeout = 2000) {
  const started = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
  }
}

export async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await act(async () => { (el as HTMLElement).click(); });
}

export function byText(root: ParentNode, text: string | RegExp, selector = '*'): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return all.reverse().find((el) => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? ''))) ?? null;
}
