import test from "node:test";
import assert from "node:assert/strict";
import { PublicClientApplication } from "@azure/msal-node";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { IntegrationsAuth } from "../server/auth.js";
function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-auth-"));
  const store = new Store(dir);
  store.set("settings", {
    ...store.settings(),
    microsoftTenantId: "tenant",
    microsoftClientId: "client",
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("Graph uses the explicitly selected account even when another account is first in cache", async (t) => {
  const store = setup(t);
  store.set("microsoft.connected", true);
  store.set("microsoft.account:tenant|client", "chosen");
  t.mock.method(
    PublicClientApplication.prototype,
    "getTokenCache",
    () =>
      ({
        getAllAccounts: async () => [
          { homeAccountId: "other" },
          { homeAccountId: "chosen" },
        ],
      }) as any,
  );
  let selected = "";
  t.mock.method(
    PublicClientApplication.prototype,
    "acquireTokenSilent",
    async (req: any) => {
      selected = req.account.homeAccountId;
      return { accessToken: "test-access-token" } as any;
    },
  );
  assert.equal(
    await new IntegrationsAuth(store).graphToken(),
    "test-access-token",
  );
  assert.equal(selected, "chosen");
});
test("a missing selected account never falls back to another cached account", async (t) => {
  const store = setup(t);
  store.set("microsoft.connected", true);
  store.set("microsoft.account:tenant|client", "missing");
  t.mock.method(
    PublicClientApplication.prototype,
    "getTokenCache",
    () => ({ getAllAccounts: async () => [{ homeAccountId: "other" }] }) as any,
  );
  let calls = 0;
  t.mock.method(
    PublicClientApplication.prototype,
    "acquireTokenSilent",
    async () => {
      calls++;
      return {} as any;
    },
  );
  await assert.rejects(
    new IntegrationsAuth(store).graphToken(),
    (error: any) => error.status === 401,
  );
  assert.equal(calls, 0);
});
test("signing in as another Microsoft account expires old drafts and clears old chat data", async (t) => {
  const store = setup(t);
  store.set("microsoft.account:tenant|client", "old");
  store.db
    .prepare("INSERT INTO chats(id,name) VALUES (?,?)")
    .run("old-chat", "Old team");
  store.db
    .prepare(
      "INSERT INTO approvals(id,chat_id,chat_name,body,created_at,expires_at) VALUES (?,?,?,?,?,?)",
    )
    .run("draft", "old-chat", "Old team", "Hello", "2026-01-01", "2027-01-01");
  t.mock.method(
    PublicClientApplication.prototype,
    "acquireTokenByDeviceCode",
    async (req: any) => {
      req.deviceCodeCallback({
        userCode: "TEST",
        verificationUri: "https://microsoft.com/devicelogin",
        expiresIn: 60,
      });
      return {
        account: { homeAccountId: "new", username: "test@example.invalid" },
      } as any;
    },
  );
  const auth = new IntegrationsAuth(store);
  await auth.startMicrosoft();
  await new Promise((r) => setImmediate(r));
  assert.equal(store.get("microsoft.account:tenant|client", ""), "new");
  assert.equal(
    (store.db.prepare("SELECT status FROM approvals").get() as any).status,
    "expired",
  );
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM chats").get() as any).n,
    0,
  );
  assert.equal(auth.microsoftStatus().status, "connected");
});
