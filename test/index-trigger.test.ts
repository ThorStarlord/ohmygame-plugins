import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error: the Worker is plain JavaScript for wrangler.
import { dispatch, WORKFLOW } from "../workers/index-trigger/index.js";

test("the index trigger asks GitHub to run the Index workflow on main", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  await dispatch("token", async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(null, { status: 204 });
  });
  assert.equal(sent[0]!.url, WORKFLOW);
  assert.equal(sent[0]!.init.method, "POST");
  assert.equal((sent[0]!.init.headers as Record<string, string>).authorization, "Bearer token");
  assert.deepEqual(JSON.parse(String(sent[0]!.init.body)), { ref: "main" });
});

test("the index trigger fails when GitHub refuses", async () => {
  await assert.rejects(dispatch("old", async () => new Response("Bad credentials", { status: 401 })), /GitHub answered 401: Bad credentials/);
});
