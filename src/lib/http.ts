import { supabase } from "@/integrations/supabase/client";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) throw error;
      await sleep(250 * 2 ** i);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  return withBackoff(async () => {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      const wrapped = new Error(error.message || "Function failed") as Error & { status?: number };
      if (status) wrapped.status = status;
      throw wrapped;
    }
    if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
      throw new Error(String((data as { error: string }).error));
    }
    return data as T;
  });
}
