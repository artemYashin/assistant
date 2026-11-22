import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";
import { Agent } from "../services/backend/src/agent.js";
import { llmConfig, llmReady, llmSelection } from "../services/backend/src/llm-provider.js";
import { openChatRuntime, chatRuntimeKey } from "../services/backend/src/chat-runtime.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-providers-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
function external(store: Store) {
  store.set("settings", {
    ...store.settings(),
    assistantProvider: "openai",
    openaiBaseUrl: "http://localhost:1234/v1",
    openaiModel: "local-chat",
    openaiReviewModel: "local-review",
  });
}
test("provider settings preserve populated legacy installs, independent choices and secrets across old-client writes", async (t) => {
  const store = fixture(t);
  store.set("settings", {
    model: "old-chat",
    reviewModel: "old-review",
    instructions: "Existing choices",
  });
  store.setSecret("github.token", "github-test");
  const { app } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app).post("/api/auth/setup").set(headers).send({}).expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const old = (await request(app).get("/api/settings").set(auth).expect(200)).body;
  for (const key of [
    "assistantProvider",
    "reviewProvider",
    "openaiBaseUrl",
    "openaiWireApi",
    "openaiModel",
    "openaiReviewModel",
    "openaiApiKeySet",
    "assistantConnected",
    "reviewConnected",
  ])
    delete old[key];
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({
      ...old,
      assistantProvider: "openai",
      openaiBaseUrl: "http://localhost:1234/v1",
      openaiModel: "local-chat",
      openaiReviewModel: "local-review",
      openaiApiKey: "secret-test",
    })
    .expect(200);
  await request(app).put("/api/settings").set(auth).send(old).expect(200);
  const saved = (await request(app).get("/api/settings").set(auth).expect(200)).body;
  assert.equal(saved.assistantProvider, "openai");
  assert.equal(saved.reviewProvider, "copilot");
  assert.equal(saved.model, "old-chat");
  assert.equal(saved.reviewModel, "old-review");
  assert.equal(saved.assistantConnected, true);
  assert.equal(saved.reviewConnected, true);
  assert.equal(saved.openaiApiKeySet, true);
  assert.ok(!JSON.stringify(saved).includes("secret-test"));
  assert.equal(store.secret("github.token"), "github-test");
  const metadata = (await request(app).get("/api/llm/models?purpose=chat").set(auth).expect(200))
    .body;
  assert.deepEqual(metadata.models, [{ id: "local-chat", name: "local-chat" }]);
  assert.equal(metadata.provider, "openai");
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({
      ...saved,
      openaiBaseUrl: "http://user:password@localhost/v1",
      openaiApiKey: "replacement",
    })
    .expect(400);
  assert.equal(store.secret("openai.apiKey"), "secret-test");
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...saved, openaiApiKey: "" })
    .expect(200);
  assert.equal(store.secret("openai.apiKey"), "secret-test");
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...saved, clearOpenaiApiKey: true })
    .expect(200);
  assert.equal(store.secret("openai.apiKey"), undefined);
  for (let i = 0; i < 2; i++) {
    const reopened = new Store(store.dir);
    assert.equal(reopened.settings().assistantProvider, "openai");
    assert.equal(reopened.settings().model, "old-chat");
    assert.equal(reopened.secret("github.token"), "github-test");
    reopened.close();
  }
});

test("review runtime connection changes refuse continuation without overwriting original transcript and key rotation preserves it", async (t) => {
  const store = fixture(t);
  external(store);
  const original = { sessionId: "old", source: "source", lastSequence: 42 };
  store.set(chatRuntimeKey("chat"), original);
  const client: any = {
    resumeSession: async (id: string) => ({ sessionId: id }),
    createSession: async () => {
      throw Error("Must not create");
    },
  };
  const selected = llmConfig(store, "chat");
  await assert.rejects(
    openChatRuntime(client, {} as any, store, "chat", "source", selected.connectionId),
    /Подключение модели изменилось/,
  );
  assert.deepEqual(store.get(chatRuntimeKey("chat"), null), original);
  assert.equal((await openChatRuntime(client, {} as any, store, "chat", "source")).resumed, true);
  store.set(chatRuntimeKey("external"), { ...original, connectionId: selected.connectionId });
  store.setSecret("openai.apiKey", "rotated");
  assert.equal(
    (
      await openChatRuntime(
        client,
        {} as any,
        store,
        "external",
        "source",
        llmConfig(store, "chat").connectionId,
      )
    ).resumed,
    true,
  );
  store.set("settings", { ...store.settings(), openaiBaseUrl: "http://localhost:9876/v1" });
  await assert.rejects(
    openChatRuntime(
      client,
      {} as any,
      store,
      "external",
      "source",
      llmConfig(store, "chat").connectionId,
    ),
    /Подключение модели изменилось/,
  );
});

test("external assistant and Copilot reviews use independent session configuration without external model discovery", async (t) => {
  const store = fixture(t);
  external(store);
  store.set("settings", { ...store.settings(), reviewModel: "copilot-review" });
  const configs: any[] = [];
  let models = 0;
  const client: any = {
    start: async () => {},
    stop: async () => {},
    listModels: async () => {
      models++;
      return [];
    },
    createSession: async (config: any) => {
      configs.push(config);
      return {
        sessionId: String(configs.length),
        on: () => {},
        sendAndWait: async () => ({ data: { content: "OK" } }),
        disconnect: async () => {},
        abort: async () => {},
      };
    },
  };
  const chat = new Agent(store, () => client),
    review = new Agent(store, () => client);
  const [a, b] = await Promise.all([
    chat.chat("Hello", { client: "", project: "" }),
    review.chat("Review", { client: "", project: "" }, true),
  ]);
  assert.equal(a.body, "OK");
  assert.equal(b.body, "OK");
  assert.equal(models, 0);
  const externalConfig = configs.find((config) => config.provider);
  assert.equal(externalConfig.model, "local-chat");
  assert.equal(externalConfig.provider.baseUrl, "http://localhost:1234/v1");
  assert.equal(configs.find((config) => !config.provider).model, "copilot-review");
  assert.equal(llmReady(store, "chat"), true);
  assert.equal(llmReady(store, "review"), false);
  assert.equal(llmSelection(store.settings(), "review").provider, "copilot");
});

test("connection test has no user context and sanitizes provider errors", async (t) => {
  const store = fixture(t);
  external(store);
  store.setSecret("openai.apiKey", "private-key");
  let stopped = false;
  const agent = new Agent(
    store,
    () =>
      ({
        start: async () => {},
        stop: async () => {
          stopped = true;
        },
        createSession: async () => ({
          sendAndWait: async () => {
            throw Error("private-key remote-body");
          },
        }),
      }) as any,
  );
  await assert.rejects(
    agent.testProvider("chat"),
    (error) => !String(error).includes("private-key") && !String(error).includes("remote-body"),
  );
  assert.equal(stopped, true);
});

test("queued reviews bind their connection and reject a changed provider before reading remote data", async (t) => {
  const store = fixture(t);
  external(store);
  const context = { client: "C", project: "P" };
  store.addContext(context);
  store.set("settings", {
    ...store.settings(),
    ...context,
    azureUrl: "https://ado.test/org",
    azureProject: "P",
    reviewProvider: "openai",
  });
  store.setSecret("azure.pat", "test-pat");
  const service = new PullRequests(store, {
    active: () => null,
    chat: async () => {
      throw Error("Must not call");
    },
  });
  service.save({ ...context, repository: "repo", mode: "all", enabled: true });
  const monitor = service.monitors()[0].id;
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      monitor,
      "repo",
      1,
      "Synthetic",
      "Author",
      "https://ado.test/pr",
      "head",
      "target",
      0,
      1,
      "now",
    );
  const id = service.requestReview(monitor, "repo", 1, { readCode: false, readTickets: false });
  const row = () =>
    store.db.prepare("SELECT options,status,error FROM pr_reviews WHERE id=?").get(id) as any;
  assert.equal(JSON.parse(row().options).model, "local-review");
  assert.equal(
    JSON.parse(row().options).connectionId,
    llmSelection(store.settings(), "review").connectionId,
  );
  store.set("settings", { ...store.settings(), reviewProvider: "copilot" });
  await service.reviewNext();
  assert.equal(row().status, "error");
  assert.match(row().error, /Подключение модели изменилось/);
});

test("populated legacy chat continues with an external provider and preserves its history", async (t) => {
  const store = fixture(t);
  const context = { client: "", project: "" };
  const chat = store.createChat(context);
  store.say("user", "Existing synthetic history", context, [], chat.id);
  external(store);
  const prompts: string[] = [];
  const client: any = {
    start: async () => {},
    stop: async () => {},
    createSession: async (config: any) => {
      assert.equal(config.provider.baseUrl, "http://localhost:1234/v1");
      return {
        sessionId: "external-legacy",
        on: () => {},
        sendAndWait: async ({ prompt }: any) => {
          prompts.push(prompt);
          return { data: { content: "Continued response" } };
        },
        disconnect: async () => {},
        abort: async () => {},
      };
    },
  };
  const agent = new Agent(store, () => client);
  await agent.chat("Continue", context, false, undefined, chat.id);
  assert.match(prompts[0], /Existing synthetic history/);
  assert.match(prompts[0], /Continue/);
  assert.equal((store.history(context, chat.id)[0] as any).body, "Existing synthetic history");
  assert.equal(store.get<any>(chatRuntimeKey(chat.id), null).sessionId, "external-legacy");
});

test("Copilot remains default and a missing token still prevents real client creation", async (t) => {
  const store = fixture(t);
  const agent = new Agent(store);
  await assert.rejects(
    agent.chat("Hello", { client: "", project: "" }),
    /Подключите GitHub Copilot/,
  );
  external(store);
  assert.equal(llmConfig(store, "chat").config?.apiKey, undefined);
  store.set("settings", { ...store.settings(), openaiModel: "" });
  assert.throws(() => llmConfig(store, "chat"), /Укажите адрес/);
  assert.equal(llmConfig(store, "chat", "explicit-model").model, "explicit-model");
});

test("external chat binding survives local-only replies and reset removes the binding", async (t) => {
  const store = fixture(t);
  external(store);
  const context = { client: "", project: "" },
    chat = store.createChat(context);
  let starts = 0;
  const agent = new Agent(
    store,
    () =>
      ({
        start: async () => {
          starts++;
          throw Error("No SDK required");
        },
        stop: async () => {},
      }) as any,
  );
  await agent.chat("Что думаешь о тикете #123?", context, false, undefined, chat.id);
  assert.equal(starts, 0);
  assert.equal(store.get(chatRuntimeKey(chat.id), null), null);
  assert.equal(
    store.get(`chat.provider:${chat.id}`, null),
    llmSelection(store.settings(), "chat").connectionId,
  );
  await agent.chat("Что думаешь о тикете #124?", context, false, undefined, chat.id);
  assert.equal(starts, 0);
  store.clearHistory(context, chat.id);
  assert.equal(store.get(`chat.provider:${chat.id}`, null), null);
});
