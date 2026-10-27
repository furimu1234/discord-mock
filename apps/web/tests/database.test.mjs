import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";
import { setImmediate, setTimeout } from "node:timers/promises";
import { createBrowserFixture, textOf } from "./browser-fixture.mjs";

const script = new Script(await readFile(new URL("../dist/browser.js.txt", import.meta.url), "utf8"));

test("database tab opens without a key, renders safe cells, sorts, searches and pages", async () => {
  const fixture = createBrowserFixture("/database");
  const requests = [];
  let expired = false;
  let resolveStale;
  let delayNext = false;
  const fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    let result;
    if (url === "/_admin/session") {
      if (options.method === "POST") {
        assert.deepEqual(JSON.parse(options.body), {});
        assert.equal(options.headers["x-discord-mock-local"], "1");
      }
      result = { authenticated: true, databaseAvailable: true };
    } else if (expired) return { ok: false, status: 403 };
    else if (url.endsWith("/tables")) result = { tables: [{ schema: "example", name: "lvl", columnCount: 2 }] };
    else if (url.startsWith("/_admin/database/rows?")) {
      const query = new URL(url, "http://localhost").searchParams;
      result = {
        schema: "example", table: "lvl", columns: [{ name: "id", type: "integer", primaryKey: true }, { name: "name", type: "text", nullable: true }],
        rows: [[1, "<img src=x onerror=alert(1)>"], [2, null]], totalRows: 120,
        offset: Number(query.get("offset")), limit: Number(query.get("limit")), truncated: false,
      };
      if (delayNext) {
        delayNext = false;
        return new Promise((resolve) => { resolveStale = () => resolve({ ok: true, json: async () => result }); });
      }
    } else throw new Error(`Unexpected request ${url}`);
    return { ok: true, json: async () => result };
  };
  script.runInNewContext({ ...fixture.globals, fetch });
  await setImmediate();
  const e = fixture.elements;
  assert.equal(requests[0].url, "/_admin/session");
  assert.equal(requests[0].method, "POST");
  assert.equal(fixture.streams.length, 0);
  assert.equal(e["user-panel"].classes.has("hidden"), true);
  assert.equal(e["database-content"].classes.has("hidden"), false);
  assert.match(textOf(e["database-tables"]), /example.*lvl/);
  const table = e["database-grid"].children[0];
  assert.equal(table.children[1].children[0].children[2].textContent, "<img src=x onerror=alert(1)>");
  assert.equal(table.children[1].children[1].children[2].textContent, "NULL");
  table.children[0].children[0].children[1].children[0].onclick();
  await setImmediate();
  assert.match(requests.at(-1).url, /sort=id&direction=asc/);
  e["database-next"].onclick();
  await setImmediate();
  assert.match(requests.at(-1).url, /offset=50/);
  e["database-search"].value = "Alice%";
  e["database-search"].oninput();
  await setTimeout(300);
  assert.match(requests.at(-1).url, /search=Alice%25/);
  assert.match(requests.at(-1).url, /offset=0/);

  delayNext = true;
  e["database-next"].onclick();
  await setImmediate();
  expired = true;
  e["database-refresh"].onclick();
  await setImmediate();
  resolveStale();
  await setImmediate();
  assert.equal(e["database-grid"].children.length, 0, "late response must not restore records after access expires");
  assert.equal(e["database-tables"].children.length, 0);
  assert.equal(e["database-content"].classes.has("hidden"), true);
  assert.match(e["database-error"].textContent, /ローカル接続/);
  expired = false;
  e["database-retry"].onclick();
  await setImmediate();
  assert.equal(e["database-content"].classes.has("hidden"), false);
});

test("database tab explains unavailable DB", async () => {
  const fixture = createBrowserFixture("/database");
  script.runInNewContext({ ...fixture.globals, fetch: async () => ({ ok: true, json: async () => ({ authenticated: false, databaseAvailable: false }) }) });
  await setImmediate();
  assert.equal(fixture.elements["database-notice"].classes.has("hidden"), false);
  assert.match(fixture.elements["database-notice-text"].textContent, /pnpm app/);
});
