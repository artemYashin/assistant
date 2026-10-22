import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  LocalDevelopers,
  localDeveloperTools,
} from "../server/local-developers.js";
const context = { client: "Customer", project: "Project" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-dev-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
function ticket(store: Store) {
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      store.source(),
      42,
      "Ticket",
      "Active",
      "Azure person",
      "Bug",
      "url",
      "",
      "",
    );
}
test("local developers support scoped multi-assignment, renaming and retired names without Azure", (t) => {
  const store = fixture(t),
    service = new LocalDevelopers(store);
  ticket(store);
  service.add(["Global"], {client:"",project:""});
  service.add(["Customer dev"], {...context,project:""});
  service.add(["Project dev", "Anna", "Boris"], context);
  assert.equal(service.list(context).length,5);
  assert.equal(service.list({client:"Other",project:"Other"}).length,1);
  const ids = service.list(context).map((d) => d.id);
  assert.equal(service.assign(42, ids, context).developers.length, 5);
  assert.equal(service.assign(42, ids, context).azureChanged, false);
  service.edit(ids[0], "Renamed");
  service.remove(ids[0]);
  assert.equal(
    service.assigned(42).find((d) => d.id === ids[0])?.name,
    "Renamed",
  );
  assert.equal(service.assigned(42).find((d) => d.id === ids[0])?.active, 0);
  assert.equal(service.list(context).length, 4);
  service.assign(42, [], context);
  assert.equal(service.assigned(42).length, 0);
  assert.throws(() => service.assign(42, ["unknown"], context), /недоступен/);
  assert.throws(
    () => service.assign(42, [], context, "other-source"),
    /Подключение/,
  );
});
test("chat assignment requires current user intent and preserves selected people", async (t) => {
  const store = fixture(t),
    service = new LocalDevelopers(store);
  ticket(store);
  const people = service.add(["Anna", "Boris"], context);
  const tool = (prompt: string) =>
    localDeveloperTools(store, context, prompt, () => {}).find(
      (t) => t.name === "set_local_ticket_developers",
    )!;
  await assert.rejects(
    async () =>
      tool("Show ticket 42").handler!(
        { ticketId: 42, developerIds: people.map((p) => p.id) },
        {} as any,
      ),
    /явная команда/,
  );
  await assert.rejects(
    async () =>
      tool("Назначь Anna на 42").handler!(
        { ticketId: 42, developerIds: people.map((p) => p.id) },
        {} as any,
      ),
    /точные имена/,
  );
  const result: any = await tool("Назначь Anna и Boris на тикет 42").handler!(
    { ticketId: 42, developerIds: people.map((p) => p.id) },
    {} as any,
  );
  assert.equal(result.developers.length, 2);
  assert.equal(result.azureChanged, false);
});
test("legacy Azure-based assignments are migrated into the local directory once", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-migrate-"));
  let store = new Store(dir);
  try {
    store.db
      .prepare(
        "INSERT INTO ticket_local(source,id,developer_id,developer_name) VALUES (?,?,?,?)",
      )
      .run("source", 42, "azure-id", "Existing person");
    store.set("migration.localDevelopers", false);
    store.close();
    store = new Store(dir);
    assert.equal(
      new LocalDevelopers(store).assigned(42, "source")[0].name,
      "Existing person",
    );
    store.close();
    store = new Store(dir);
    assert.equal(new LocalDevelopers(store).assigned(42, "source").length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("promoting developers preserves IDs and assignments and widens visibility", t=>{
  const store=fixture(t),service=new LocalDevelopers(store);
  ticket(store);
  const [person]=service.add(["Alice"],context);
  service.assign(42,[person.id],context);
  const sibling={...context,project:"Second"};
  assert.equal(service.list(sibling).length,0);
  service.edit(person.id,"Alice",{client:context.client,project:""});
  assert.equal(service.list(sibling)[0].id,person.id);
  assert.equal(service.assigned(42)[0].id,person.id);
  assert.equal(service.list({client:"Other",project:"P"}).length,0);
  service.edit(person.id,"Alice",{client:"",project:""});
  assert.equal(service.list({client:"Other",project:"P"})[0].id,person.id);
  assert.equal(service.assigned(42)[0].id,person.id);
  service.add(["Bob"],{client:"",project:""});
  assert.throws(()=>service.edit(person.id,"Bob",{client:"",project:""}),/уже есть/);
});

test("chat tools discover inherited developers, assign across scopes and retain existing assignments", async t => {
  const { Agent } = await import("../server/agent.js");
  const { Approvals } = await import("../server/approvals.js");
  const { listLocalTickets } = await import("../server/ticket-list.js");
  const store=fixture(t), service=new LocalDevelopers(store);
  store.set("settings",{...store.rawSettings(),...context});
  store.addContext(context);
  ticket(store);
  service.add(["Global"],{client:"",project:""});
  service.add(["Customer dev"],{client:context.client,project:""});
  service.add(["Project dev"],context);
  service.add(["Sibling"],{...context,project:"Sibling"});
  service.add(["Other"],{client:"Other",project:"Other"});
  const visible=service.list(context);
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("Local developer tools must not request Azure");});
  const client={start:async()=>{},stop:async()=>{},createSession:async(config:any)=>{
    let available=config.tools;
    return {on:()=>{},abort:async()=>{},setTools:async(tools:any[])=>{available=tools;},
      sendAndWait:async()=>{
        const call=async(name:string,args:any)=>{calls++;return available.find((tool:any)=>tool.name===name).handler(args,{});};
        await call("load_tools",{names:["list_local_developers","set_local_ticket_developers"]});
        const result=await call("list_local_developers",{ticketId:42});
        assert.deepEqual(result.developers.map((p:any)=>p.name).sort(),["Customer dev","Global","Project dev"]);
        assert.equal(result.developers.find((p:any)=>p.name==="Global").client,"");
        const assigned=await call("set_local_ticket_developers",{ticketId:42,developerIds:visible.map(p=>p.id)});
        assert.equal(assigned.azureChanged,false);
        assert.equal(assigned.developers.length,3);
        return {data:{content:"Поручение обновлено."}};
      }};
  }};
  const agent=new Agent(store,new Approvals(store,async()=>({id:"unused"})),()=>client as any);
  await agent.chat("Назначь Global, Customer dev и Project dev на тикет 42",context);
  assert.equal(calls,3);
  const listed=listLocalTickets(store,{ids:[42],fields:["localDevelopers"]});
  assert.equal(listed.tickets[0].localDevelopers.length,3);
  const person=visible.find(p=>p.name==="Project dev")!;
  service.edit(person.id,person.name,{client:"Other",project:"Other"});
  const tools=localDeveloperTools(store,context,"Убери Global из тикета 42",()=>{});
  const readTool=tools.find(tool=>tool.name==="list_local_developers") as {handler:(args:{ticketId:number},context:any)=>Promise<any>};
  const read=await readTool.handler({ticketId:42},{});
  assert.ok(!read.developers.some((p:any)=>p.id===person.id));
  assert.ok(read.assigned.some((p:any)=>p.id===person.id));
  await tools[1].handler!({ticketId:42,developerIds:read.assigned.filter((p:any)=>p.name!=="Global").map((p:any)=>p.id)},{} as any);
  assert.equal(service.assigned(42).length,2);
  const foreign=service.list({client:"Other",project:"Other"}).find(p=>p.name==="Other")!;
  const denied=localDeveloperTools(store,context,"Назначь Other на тикет 42",()=>{})[1];
  await assert.rejects(async()=>denied.handler!({ticketId:42,developerIds:[foreign.id]},{} as any));
});
