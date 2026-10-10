/**
 * One shared Supabase realtime channel per table, reference-counted across every component that
 * listens to it. Listeners get the change payload and decide which query keys to invalidate;
 * `KeyBatcher` collects those keys and invalidates them once after a short pause, so a burst of
 * changes (e.g. ten documents sorted in a row) refetches each affected query only once.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export { KeyBatcher } from './batcher';

export interface ChangePayload {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

type Listener = (p: ChangePayload) => void;

interface Entry { channel: RealtimeChannel; listeners: Set<Listener> }

const channels = new Map<string, Entry>();

export function subscribeTable(table: string, listener: Listener): () => void {
  let entry = channels.get(table);
  if (!entry) {
    const listeners = new Set<Listener>();
    const channel = supabase.channel(`af-${table}`);
    (channel as unknown as {
      on: (type: string, filter: Record<string, string>, cb: (payload: Record<string, unknown>) => void) => RealtimeChannel;
    }).on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      const p: ChangePayload = {
        table,
        eventType: String(payload.eventType ?? ''),
        new: (payload.new as Record<string, unknown> | null) ?? null,
        old: (payload.old as Record<string, unknown> | null) ?? null,
      };
      listeners.forEach((l) => {
        try { l(p); } catch (e) { console.warn('realtime listener failed', e); }
      });
    });
    channel.subscribe();
    entry = { channel, listeners };
    channels.set(table, entry);
  }
  entry.listeners.add(listener);
  return () => {
    const e = channels.get(table);
    if (!e) return;
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      channels.delete(table);
      supabase.removeChannel(e.channel);
    }
  };
}

/** Number of tables with an open channel (tests / debugging). */
export const openChannelCount = () => channels.size;

/** The id of the deal a row belongs to (deals.id, or <table>.deal_id). */
export function dealIdOf(p: ChangePayload): string | null {
  const row = p.new && Object.keys(p.new).length ? p.new : p.old;
  if (!row) return null;
  const v = p.table === 'deals' ? row.id : row.deal_id;
  return typeof v === 'string' ? v : null;
}
