import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'autoflow.chunk-reload';

/** A dynamic import failed because the file is gone (usually: a new version was deployed). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Loading chunk/i.test(message);
}

/**
 * React.lazy for a route page. If the page's chunk can't be loaded because a newer build
 * replaced it, the browser reloads once to pick up the new version; any other failure (or a
 * second one) goes to the error boundary.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const mod = await load();
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* storage blocked */ }
      return mod;
    } catch (error) {
      let reloaded = true;
      try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* storage blocked */ }
      if (isChunkLoadError(error) && !reloaded) {
        try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* storage blocked */ }
        window.location.reload();
        return new Promise<never>(() => {}); // keep showing the fallback until the reload happens
      }
      throw error;
    }
  });
}
