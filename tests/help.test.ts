import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HelpLibrary, helpTools } from "../services/backend/src/help.js";
import { createToolDiscovery } from "../services/backend/src/tool-discovery.js";
import { SYSTEM_POLICY } from "../services/backend/src/chat-policy.js";

test("help searches titles and excerpts with strict bounded output, no article bodies", () => {
  const help = new HelpLibrary();
  const results = help.search({ query: "PAT", scope: "titles" });
  assert.equal(results.results[0].id, "azure-setup");
  assert.ok(results.results.length <= 5);
  assert.ok(results.results.every((r) => r.snippet.length <= 240 && !("content" in r)));
  assert.ok(JSON.stringify(results).length < 5000);
  assert.ok(
    help.search({ query: "связанные тикеты" }).results.some((r) => r.id === "pr-ticket-links"),
  );
  assert.ok(
    help.search({ query: "переимпортировать" }).results.some((r) => r.id === "pr-completed"),
  );
  assert.throws(() => help.search({ query: "x", limit: 500 }));
  assert.throws(() => help.search({ query: "x", offset: -1 }));
  assert.equal(help.search({ query: "zzznothingmatcheszzzz" }).total, 0);
});

test("error phrases rank relevant evidence first without publishing the whole catalog", () => {
  const help = new HelpLibrary();
  const result = help.search({ query: "Локальный кэш сохранён" });
  assert.ok(result.results[0].id.startsWith("errors-"));
  assert.match(result.results[0].snippet, /Локальный кэш сохранён/);
  assert.ok(help.read({ id: result.results[0].id }).content.includes("Локальный кэш сохранён"));
});

test("article pagination reconstructs exact Markdown; IDs cannot access arbitrary files", () => {
  const help = new HelpLibrary();
  const whole = help.read({ id: "pr-completed", length: 10000 });
  let content = "",
    offset: number | null = 0;
  while (offset !== null) {
    const part = help.read({ id: "pr-completed", offset, length: 200 });
    assert.ok(part.content.length <= 200);
    content += part.content;
    offset = part.nextOffset;
  }
  assert.equal(content, whole.content);
  assert.match(content, /## Переимпортировать/);
  for (const id of ["../../.env", "/etc/passwd", "missing", "../articles/start"])
    assert.throws(() => help.read({ id }), /не найдена/);
  assert.throws(() => help.read({ id: "start", length: 10001 }));
  assert.equal(help.read({ id: "start", offset: 999999 }).nextOffset, null);
});

test("catalog pagination has no duplicates and every article has valid metadata", () => {
  const help = new HelpLibrary(),
    ids: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = help.search({ offset, limit: 8 });
    ids.push(...page.results.map((r) => r.id));
    for (const r of page.results) {
      assert.ok(r.title.length <= 160 && r.summary.length <= 320);
      assert.ok(help.read({ id: r.id }).content.startsWith("# "));
    }
    offset = page.nextOffset;
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 100);
});

test("title scope excludes body-only matches; symlinks are not articles", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-help-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "articles"));
  mkdirSync(join(directory, "generated"));
  writeFileSync(
    join(directory, "articles", "one.md"),
    '<!-- orbit-help {"id":"one","title":"Тема","summary":"Описание","keywords":[]} -->\n# Тема\n\nunique-body-term',
  );
  writeFileSync(join(directory, "outside.md"), "SECRET");
  symlinkSync(join(directory, "outside.md"), join(directory, "articles", "linked.md"));
  const help = new HelpLibrary(directory);
  assert.equal(help.search({ query: "unique-body-term", scope: "titles" }).total, 0);
  assert.equal(help.search({ query: "unique-body-term", scope: "all" }).results[0].id, "one");
  assert.equal(help.search({ query: "SECRET" }).total, 0);
});

test("help schemas load lazily and search does not eagerly read articles into model output", async () => {
  const tools = helpTools();
  let published: string[] = [];
  const discovery = createToolDiscovery(
    tools,
    async (tools) => {
      published = tools.map((t) => t.name);
    },
    () => {},
  );
  assert.equal(published.length, 0);
  assert.doesNotMatch(discovery.description!, /Порядок источников|##|6000/);
  await discovery.handler!({ names: ["search_app_help"] }, {} as any);
  assert.deepEqual(published, ["load_tools", "search_app_help"]);
  const result = (await tools[0].handler!({ query: "PAT", scope: "titles" }, {} as any)) as any;
  assert.equal(result.results[0].id, "azure-setup");
  assert.ok(!JSON.stringify(result).includes("## Права PAT"));
  assert.match(SYSTEM_POLICY, /general "what can you do"/);
  assert.match(SYSTEM_POLICY, /do not preload documentation/);
  assert.ok(readFileSync("Dockerfile", "utf8").includes("docs/help ./docs/help"));
});

test("greetings and capability questions start with discovery only, no help/article payload", async (t) => {
  const { Store } = await import("../services/backend/src/store.js");
  const { Agent } = await import("../services/backend/src/agent.js");
  const directory = mkdtempSync(join(tmpdir(), "orbit-help-agent-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let published = 0;
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (config: any) => {
      assert.deepEqual(
        config.tools.map((tool: any) => tool.name),
        ["load_tools"],
      );
      assert.match(config.tools[0].description, /search_app_help/);
      assert.doesNotMatch(config.systemMessage.content, /## Права PAT/);
      return {
        on: () => {},
        abort: async () => {},
        setTools: async () => {
          published++;
        },
        sendAndWait: async () => ({ data: { content: "Помогаю с рабочими задачами." } }),
      };
    },
  };
  const agent = new Agent(store, () => client as any);
  await agent.chat("Привет", { client: "", project: "" });
  await agent.chat("Что ты умеешь?", { client: "", project: "" });
  assert.equal(published, 0);
});

test("an app-help turn can discover, search and read the relevant article through agent tools", async (t) => {
  const { Store } = await import("../services/backend/src/store.js");
  const { Agent } = await import("../services/backend/src/agent.js");
  const directory = mkdtempSync(join(tmpdir(), "orbit-help-flow-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const loaded: string[][] = [];
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (config: any) => {
      let available = config.tools;
      return {
        on: () => {},
        abort: async () => {},
        setTools: async (tools: any[]) => {
          available = tools;
          loaded.push(tools.map((tool) => tool.name));
        },
        sendAndWait: async () => {
          const call = (name: string, args: any) =>
            available.find((tool: any) => tool.name === name).handler(args, {});
          await call("load_tools", { names: ["search_app_help"] });
          const found = await call("search_app_help", { query: "PAT", scope: "titles" });
          assert.equal(found.results[0].id, "azure-setup");
          await call("load_tools", { names: ["read_app_help"] });
          const article = await call("read_app_help", { id: found.results[0].id });
          assert.match(article.content, /Personal Access Token/);
          return { data: { content: "Настройки → Azure DevOps → Personal Access Token." } };
        },
      };
    },
  };
  const agent = new Agent(store, () => client as any);
  const result = await agent.chat("Помоги настроить PAT в приложении", { client: "", project: "" });
  assert.match(result.body, /Personal Access Token/);
  assert.deepEqual(loaded, [
    ["load_tools", "search_app_help"],
    ["load_tools", "search_app_help", "read_app_help"],
  ]);
});

test("review sessions do not receive app help tools", async (t) => {
  const { Store } = await import("../services/backend/src/store.js");
  const { Agent } = await import("../services/backend/src/agent.js");
  const directory = mkdtempSync(join(tmpdir(), "orbit-help-review-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const client = {
    start: async () => {},
    stop: async () => {},
    createSession: async (config: any) => {
      assert.ok(
        config.tools.every(
          (tool: any) => !["search_app_help", "read_app_help"].includes(tool.name),
        ),
      );
      return {
        on: () => {},
        abort: async () => {},
        sendAndWait: async () => ({ data: { content: "Ревью готово." } }),
      };
    },
  };
  const agent = new Agent(store, () => client as any);
  await agent.chat("Review", { client: "", project: "" }, true, { readCode: false });
});

test("agent help inventories cover the shared chat catalog and review allowlists", async () => {
  const chat = readFileSync(
    new URL("../docs/help/articles/chat-agent-tools.md", import.meta.url),
    "utf8",
  );
  const review = readFileSync(
    new URL("../docs/help/articles/review-agent-tools.md", import.meta.url),
    "utf8",
  );
  const catalog = readFileSync(
    new URL("../services/backend/src/tool-discovery.ts", import.meta.url),
    "utf8",
  ).split("const schema =")[0];
  for (const match of catalog.matchAll(/^ {2}([a-z_]+):/gm))
    assert.ok(chat.includes("`" + match[1] + "`"), match[1]);
  const { reviewBaseTools, reviewCodeTools, reviewTicketTools } =
    await import("../services/backend/src/review-progress.js");
  for (const name of [...reviewBaseTools, ...reviewCodeTools, ...reviewTicketTools])
    assert.ok(review.includes("`" + name + "`"), name);
});

test("ticket row colours are discoverable separately from Azure workflow status colours", () => {
  const help = new HelpLibrary();
  for (const query of [
    "Azure тикеты красные синие оранжевые белые",
    "цвета строк",
    "не импортирован",
    "ажур цвет",
  ]) {
    assert.ok(
      help.search({ query, scope: "titles" }).results.some((r) => r.id === "ticket-row-colors"),
      query,
    );
  }
  const article = help.read({ id: "ticket-row-colors" }).content;
  assert.match(article, /Не добавлен/);
  assert.match(article, /находится в корзине/);
  assert.match(article, /при наведении мыши/);
  assert.match(article, /не равен фону всей строки/);
});
