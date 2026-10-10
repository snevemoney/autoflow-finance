// The pipeline's storage, backed by Supabase with the service role. Every write that could
// race with a person or another run is conditional (see the WHERE clauses below).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DocumentType } from "./classify.ts";
import type { SourceForMatch } from "./income.ts";
import {
  type AiUsageRow, type ClaimMode, claimableStatuses, claimPatch, DOC_COLUMNS, type DocRow, MAX_ATTEMPTS,
  type ProcessingStatus, type Repo, retryDueFilter, STALE_PROCESSING_MIN,
} from "./pipeline.ts";

const SOURCE_COLUMNS = "id, employer_name, is_primary, verification_status, stated_monthly_income, flag_reasons, source_type, "
  + "tip_percentage, calc_locked, calc_method, calculated_monthly_income, manual_override_amount, auto_fill_document_id, auto_filled_at";

function check(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function supabaseRepo(admin: SupabaseClient): Repo {
  return {
    async documentsByIds(ids) {
      if (!ids.length) return [];
      const { data, error } = await admin.from("documents").select(DOC_COLUMNS).in("id", ids);
      check("load documents", error);
      return (data ?? []) as unknown as DocRow[];
    },

    async dueDocuments(now, limit) {
      const { data, error } = await admin.from("documents").select(DOC_COLUMNS)
        .or(retryDueFilter(now))
        .order("created_at", { ascending: true })
        .limit(limit);
      check("load due documents", error);
      return (data ?? []) as unknown as DocRow[];
    },

    // UPDATE documents SET processing_status='processing', processing_started_at=now,
    //   attempt_count=<seen>+1 WHERE id=… AND attempt_count=<seen> AND processing_status IN (…) RETURNING …
    // Every claim bumps attempt_count, so two runs can never both claim the same row.
    async claimDocument(doc, mode: ClaimMode, now) {
      let q = admin.from("documents").update(claimPatch(doc, now))
        .eq("id", doc.id)
        .eq("attempt_count", doc.attempt_count)
        .in("processing_status", claimableStatuses(mode));
      if (mode === "normal") q = q.lt("attempt_count", MAX_ATTEMPTS);
      if (mode === "stale") {
        q = q.lt("processing_started_at", new Date(now.getTime() - STALE_PROCESSING_MIN * 60_000).toISOString());
      }
      const { data, error } = await q.select(DOC_COLUMNS);
      check("claim document", error);
      return ((data ?? [])[0] as unknown as DocRow) ?? null;
    },

    async setDocumentType(id, type, source, confidence) {
      const { data, error } = await admin.from("documents")
        .update({ type, type_source: source, classification_confidence: confidence })
        .eq("id", id)
        .neq("type_source", "manual")
        .select("id");
      check("save document type", error);
      return (data ?? []).length > 0;
    },

    async documentType(id) {
      const { data, error } = await admin.from("documents").select("type, type_source").eq("id", id).maybeSingle();
      check("read document type", error);
      return (data as { type: DocumentType; type_source: string } | null) ?? null;
    },

    async updateDocument(id, patch, onlyIfStatus?: ProcessingStatus) {
      let q = admin.from("documents").update(patch).eq("id", id);
      if (onlyIfStatus) q = q.eq("processing_status", onlyIfStatus);
      const { error } = await q;
      check("update document", error);
    },

    async download(path) {
      const clean = path.replace(/^documents\//, "");
      const { data, error } = await admin.storage.from("documents").download(clean);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async automations() {
      const { data } = await admin.from("app_settings").select("automations").maybeSingle();
      const a = (data?.automations ?? {}) as Record<string, boolean>;
      return { autoSort: a.auto_sort !== false, autoFill: a.auto_fill_income !== false };
    },

    async aiCallsToday(dealId) {
      const { data, error } = await admin.rpc("ai_calls_today", { _deal_id: dealId });
      check("count AI calls", error);
      return Number(data ?? 0) || 0;
    },

    async logAiUsage(row: AiUsageRow) {
      const { error } = await admin.from("ai_usage").insert(row);
      if (error) console.warn("ai_usage insert failed", error.message);
    },

    async timeline(dealId, description, metadata) {
      const { error } = await admin.from("deal_timeline")
        .insert({ deal_id: dealId, type: "automation", description, created_by: null, metadata });
      if (error) console.warn("timeline insert failed", error.message);
    },

    async incomeSources(dealId) {
      const { data, error } = await admin.from("income_sources").select(SOURCE_COLUMNS).eq("deal_id", dealId);
      check("load income sources", error);
      return (data ?? []) as unknown as SourceForMatch[];
    },

    async createPrimarySource(dealId, employer) {
      const { data: deal } = await admin.from("deals").select("customer_id, customers(monthly_income)").eq("id", dealId).maybeSingle();
      if (!deal) return null;
      const customer = (deal as { customers?: { monthly_income?: number | null } | null }).customers;
      const { data, error } = await admin.from("income_sources").insert({
        deal_id: dealId, customer_id: (deal as { customer_id: string }).customer_id, source_type: "salaried",
        employer_name: employer ?? "Employer on document", stated_monthly_income: Number(customer?.monthly_income ?? 0) || 0,
        is_primary: true, verification_status: "unverified", calc_method: "mi",
      }).select(SOURCE_COLUMNS).single();
      if (error) { console.warn("create income source failed", error.message); return null; }
      return data as unknown as SourceForMatch;
    },

    async extractionPayDate(documentId) {
      const { data } = await admin.from("extracted_income_data").select("pay_date").eq("document_id", documentId).maybeSingle();
      return (data as { pay_date: string | null } | null)?.pay_date ?? null;
    },

    async saveExtraction(row) {
      const { error } = await admin.from("extracted_income_data").upsert(row, { onConflict: "document_id" });
      check("save extraction", error);
    },

    // UPDATE income_sources SET … WHERE id=… AND calc_locked IS NOT TRUE AND verification_status <> 'verified'
    async updateIncomeSource(id, patch) {
      const write = (p: Record<string, unknown>) => admin.from("income_sources").update(p)
        .eq("id", id).not("calc_locked", "is", true).neq("verification_status", "verified").select("id");
      let { data, error } = await write(patch);
      // ytd_months holds whole months until the column becomes numeric
      if (error?.code === "22P02" && typeof patch.ytd_months === "number") {
        ({ data, error } = await write({ ...patch, ytd_months: Math.max(1, Math.round(patch.ytd_months)) }));
      }
      check("update income source", error);
      return (data ?? []).length > 0;
    },
  };
}
