import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { codeTools } from "../server/code-tools.js";
import { calendarTools } from "../server/calendar-tools.js";
import { ticketExportTool } from "../server/ticket-export-tool.js";
import { withChatCodeGuidance } from "../server/chat-code-guidance.js";
import { createToolDiscovery } from "../server/tool-discovery.js";
import { SYSTEM_POLICY } from "../server/chat-policy.js";

test("domain rules stay out of initial context and load with their actual tools", async t => {
  const dir=mkdtempSync(join(tmpdir(),"orbit-tool-guidance-"));
  const store=new Store(dir);
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const originals=codeTools(store,{client:"",project:""},()=>{},undefined,undefined,()=>true);
  const chat=withChatCodeGuidance(originals);
  // Chat guidance must not mutate shared tools used by the review agent.
  assert.doesNotMatch(originals.find(tool=>tool.name==="code_search")!.description!,/branch open in the UI/);
  for(const tool of originals) {
    const enriched=chat.find(entry=>entry.name===tool.name)!;
    assert.equal(enriched.handler,tool.handler);
    assert.equal(enriched.parameters,tool.parameters);
  }
  const tools=[...chat,...calendarTools(store,()=>{}),ticketExportTool(store,()=>{},undefined,undefined,true)];
  let published: typeof tools=[];
  const discovery=createToolDiscovery(tools,async next=>{published=next;},()=>{});
  for(const content of [SYSTEM_POLICY,discovery.description!]) {
    assert.doesNotMatch(content,/repeatWeekdays ISO|reminder.start=null|40–100 lines|same turn\. Follow nextOffset|detached duplicate button/);
  }
  assert.match(SYSTEM_POLICY,/get_calendar_context/);
  assert.match(SYSTEM_POLICY,/show_ticket_export.*edit_ticket_export/);
  assert.match(SYSTEM_POLICY,/never deletes the ticket or clears its deadline/);
  await discovery.handler!({names:["code_search","code_read_file","cite_code","save_calendar_reminder","change_calendar_reminders","edit_ticket_export"]},{} as any);
  const description=(name:string)=>published.find(tool=>tool.name===name)!.description!;
  assert.match(description("code_search"),/explicit user branch overrides/i);
  assert.match(description("code_read_file"),/40–100 lines/);
  assert.match(description("cite_code"),/file-only link omit line parameters/);
  assert.match(description("save_calendar_reminder"),/repeatWeekdays/);
  assert.match(description("save_calendar_reminder"),/warningDefaults/);
  assert.match(description("change_calendar_reminders"),/collect all pages before mutating/);
  assert.match(description("change_calendar_reminders"),/COMPLETED instead of deleted/);
  assert.match(description("edit_ticket_export"),/Before EVERY edit_ticket_export call/);
  assert.match(description("edit_ticket_export"),/separate explicit import authorization/);
  assert.equal((store.db.prepare("SELECT COUNT(*) n FROM calendar_events").get() as any).n,0);
});
