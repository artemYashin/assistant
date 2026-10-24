import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import { createApp } from "../server/app.js";
import { azurePatExpirySchema, azurePatReminderId } from "../server/azure-pat-reminder.js";
import { notificationItems } from "../server/calendar-notifications.js";
import { calendarStatus } from "../server/calendar-model.js";
function fixture(t: any) {
 const dir=mkdtempSync(join(tmpdir(),"orbit-pat-reminder-")),store=new Store(dir);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return store;
}
test("PAT reminder warns exactly seven days ahead, survives expiry, and does not expose secret", t=>{
 const store=fixture(t),calendar=new Calendar(store);
 store.set("settings",{...store.settings(),azurePatExpiresOn:"2026-11-02",syncSchedule:{...store.settings().syncSchedule,timeZone:"Asia/Bishkek"}});
 assert.equal(calendar.list().length,0);
 store.setSecret("azure.pat","test-secret-not-for-output");
 const item=calendar.list()[0];
 assert.equal(item.start,"2026-11-01T18:00:00.000Z");
 assert.equal(item.warningStart,"2026-10-25T18:00:00.000Z");
 assert.equal(notificationItems([item],525600,new Date("2026-10-25T17:59:59Z")).length,0);
 assert.equal(notificationItems([item],0,new Date(item.warningStart!)).length,1);
 assert.equal(notificationItems([item],0,new Date("2027-01-01T00:00:00Z")).length,1);
 assert.equal(calendarStatus(item,"2026-11-01T18:00:00Z"),"overdue");
 assert.ok(!JSON.stringify(item).includes("test-secret"));
 for(const mutate of [
  ()=>calendar.complete(item.id),()=>calendar.reopen(item.id),()=>calendar.remove(item.id),
  ()=>calendar.completeToday(item.id),()=>calendar.setLead(item.id,0),
  ()=>calendar.setVisibility(item.id,{notificationsHidden:true,calendarHidden:true}),
  ()=>calendar.save({title:"changed",start:null,end:null},item.id),
 ]) assert.throws(mutate,/Напоминание о PAT нельзя/);
 assert.equal(calendar.list()[0].completed,false);
 assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() && (store.db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get() as any).n,0);
 store.set("settings",{...store.settings(),azurePatExpiresOn:"2027-01-02"});
 assert.equal(calendar.list()[0].id,azurePatReminderId);
 assert.equal(notificationItems(calendar.list(),0,new Date("2026-11-01T18:00:00Z")).length,0);
});
test("settings expiry validates dates and preserves configured expiry for older clients",async t=>{
 const store=fixture(t),{app}=createApp(store);
 const headers={Host:"localhost:43871",Origin:"http://localhost:43871","X-Orbit-Request":"1"};
 const setup=await request(app).post("/api/auth/setup").set(headers).send({password:"long-enough-password"}).expect(200);
 const auth={...headers,Cookie:setup.headers["set-cookie"][0].split(";")[0],"X-CSRF-Token":setup.body.csrf};
 await request(app).put("/api/settings").set(auth).send({...store.settings(),azurePat:"test-secret",azurePatExpiresOn:"2026-11-02"}).expect(200);
 const old:any={...store.settings()};delete old.azurePatExpiresOn;
 await request(app).put("/api/settings").set(auth).send(old).expect(200);
 assert.equal(store.settings().azurePatExpiresOn,"2026-11-02");
 await request(app).put("/api/settings").set(auth).send({...store.settings(),azurePatExpiresOn:""}).expect(400);
 await request(app).put("/api/settings").set(auth).send({...store.settings(),azurePatExpiresOn:"2026-02-30",azurePat:"replacement"}).expect(400);
 assert.equal(store.secret("azure.pat"),"test-secret");
 const setSecret = store.setSecret.bind(store);
 store.setSecret = () => { throw new Error("Simulated write failure"); };
 await request(app).put("/api/settings").set(auth).send({...store.settings(),azurePatExpiresOn:"2026-12-02",azurePat:"replacement"}).expect(500);
 store.setSecret = setSecret;
 assert.equal(store.settings().azurePatExpiresOn,"2026-11-02");
 assert.equal(store.secret("azure.pat"),"test-secret");
 const response=await request(app).get("/api/calendar").set(auth).expect(200);
 assert.equal(response.body.items[0].systemKind,"azure_pat");
 assert.ok(!JSON.stringify(response.body).includes("test-secret"));
 for(const value of ["2026-02-30","abc","2026-1-2"]) assert.equal(azurePatExpirySchema.safeParse(value).success,false);
});
test("populated installations retain data and configured expiry across restarts without duplicate events",()=>{
 const dir=mkdtempSync(join(tmpdir(),"orbit-pat-upgrade-"));let store=new Store(dir);
 try {
  store.setSecret("azure.pat","existing");
  const event=new Calendar(store).save({title:"Existing",description:"Preserved",start:null,end:null});
  new Calendar(store).complete(event.id);
  const legacy:any={...store.settings()};delete legacy.azurePatExpiresOn;store.set("settings",legacy);
  store.close();store=new Store(dir);
  assert.equal(store.settings().azurePatExpiresOn,"");
  assert.equal(new Calendar(store).list().length,1);
  store.set("settings",{...store.settings(),azurePatExpiresOn:"2026-11-02"});
  for(let i=0;i<2;i++){
   store.close();store=new Store(dir);
   const list=new Calendar(store).list();assert.equal(list.length,2);
   assert.equal(list.find(item=>item.id===event.id)!.completed,true);
   assert.equal(list.find(item=>item.id===event.id)!.description,"Preserved");
   assert.equal(store.secret("azure.pat"),"existing");
  }
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
