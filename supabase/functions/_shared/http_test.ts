// deno test supabase/functions/_shared
// CORS, generic error replies, the internal-secret comparison and document storage paths.
import nodeAssert from "node:assert/strict";
import { AiError } from "./ai.ts";
import {
  aiFailure, corsHeadersFor, DEFAULT_ALLOWED_ORIGINS, ERR, isUuid, originAllowed, parseOrigins, responder, secretsEqual,
} from "./http.ts";
import { objectPath, pathFor } from "./storage.ts";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

const req = (origin: string | null, method = "POST") =>
  new Request("https://fn.example/process-document", { method, headers: origin ? { Origin: origin } : {} });

Deno.test("allowed origins come from the setting, with the app's own addresses as the default", () => {
  assertEquals(parseOrigins(undefined), DEFAULT_ALLOWED_ORIGINS);
  assertEquals(parseOrigins(""), DEFAULT_ALLOWED_ORIGINS);
  assert(DEFAULT_ALLOWED_ORIGINS.includes("https://autoflow-kappa-two.vercel.app"));
  assertEquals(parseOrigins(" https://App.Example/ , http://localhost:5173,,"), ["https://app.example", "http://localhost:5173"]);
});

Deno.test("CORS reflects only a listed origin and always varies on Origin", () => {
  const allowed = parseOrigins("https://autoflow-kappa-two.vercel.app,http://localhost:5173");
  const ok = corsHeadersFor("https://autoflow-kappa-two.vercel.app", allowed);
  assertEquals(ok["Access-Control-Allow-Origin"], "https://autoflow-kappa-two.vercel.app");
  assertEquals(ok.Vary, "Origin");
  const evil = corsHeadersFor("https://evil.example", allowed);
  assertEquals(evil["Access-Control-Allow-Origin"], undefined);
  assertEquals(evil.Vary, "Origin");
  assert(!JSON.stringify(corsHeadersFor(null, allowed)).includes('"*"'), "never a wildcard");
  // look-alikes don't pass
  assert(!originAllowed("https://autoflow-kappa-two.vercel.app.evil.example", allowed));
  assert(!originAllowed("null", allowed));
  // server-to-server calls (the database cron) send no Origin
  assert(originAllowed(null, allowed));
});

Deno.test("preflight and replies: listed origins pass, others are refused", async () => {
  const allowed = DEFAULT_ALLOWED_ORIGINS;
  const good = responder(req("http://localhost:5173", "OPTIONS"), allowed).preflight();
  assertEquals(good.status, 204);
  assertEquals(good.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  const bad = responder(req("https://evil.example", "OPTIONS"), allowed);
  assertEquals(bad.originOk, false);
  assertEquals(bad.preflight().status, 403);
  const reply = responder(req("http://localhost:5173"), allowed).error(ERR.notFound, 404);
  assertEquals(reply.status, 404);
  assertEquals(await reply.json(), { error: "Not found" });
  assertEquals(reply.headers.get("Vary"), "Origin");
});

Deno.test("AI failures reach callers as a meaningful status with a generic message", () => {
  const upstream = "Provider returned error: key sk-or-v1-abc quota for org 42 exceeded";
  const cases: [unknown, number][] = [
    [new AiError(upstream, 429, "rate_limit"), 429],
    [new AiError(upstream, 408, "timeout"), 504],
    [new AiError(upstream, 402, "credits"), 503],
    [new AiError(upstream, 401, "auth"), 503],
    [new AiError(upstream, 502, "bad_reply"), 502],
    [new Error(`duplicate key value violates unique constraint: ${upstream}`), 500],
  ];
  for (const [e, status] of cases) {
    const f = aiFailure(e);
    assertEquals(f.status, status);
    assert(!f.message.includes("sk-or") && !f.message.includes("Provider") && !f.message.includes("constraint"), f.message);
  }
});

Deno.test("the internal secret is compared in constant time and never matches empty", async () => {
  assert(await secretsEqual("s3cret-value", "s3cret-value"));
  assert(!(await secretsEqual("s3cret-value", "s3cret-valuf")));
  assert(!(await secretsEqual("short", "a-much-longer-secret")));
  assert(!(await secretsEqual("", "")));
});

Deno.test("ids are validated before they reach the database", () => {
  assert(isUuid("6f1e7c3a-2b4d-4c5e-8f9a-0b1c2d3e4f5a"));
  assert(!isUuid("6f1e7c3a-2b4d-4c5e-8f9a-0b1c2d3e4f5a,abc"));
  assert(!isUuid(42));
});

Deno.test("signed links are only made for objects in the documents bucket", () => {
  const deal = "6f1e7c3a-2b4d-4c5e-8f9a-0b1c2d3e4f5a";
  assertEquals(objectPath(`${deal}/stub.pdf`), `${deal}/stub.pdf`);
  assertEquals(objectPath(`documents/${deal}/stub.pdf`), `${deal}/stub.pdf`);
  assertEquals(objectPath(`https://x.supabase.co/storage/v1/object/public/documents/${deal}/a%20b.pdf`), `${deal}/a b.pdf`);
  assertEquals(objectPath("https://x.supabase.co/storage/v1/object/public/avatars/me.png"), null);
  assertEquals(objectPath("https://evil.example/file.pdf"), null);
  assertEquals(objectPath(`${deal}/../other/file.pdf`), null);
  assertEquals(objectPath(""), null);
  const doc = { storage_path: `${deal}/f.pdf`, file_url: "ignored", preview_path: `${deal}/f.jpg` };
  assertEquals(pathFor(doc, "file"), `${deal}/f.pdf`);
  assertEquals(pathFor(doc, "preview"), `${deal}/f.jpg`);
  assertEquals(pathFor({ ...doc, preview_path: null }, "preview"), null);
  assertEquals(pathFor({ ...doc, storage_path: null, file_url: `documents/${deal}/old.pdf` }, "file"), `${deal}/old.pdf`);
});
