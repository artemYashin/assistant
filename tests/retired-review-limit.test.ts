import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import request from "supertest";
import {Store} from "../server/store.js";
import {createApp} from "../server/app.js";

test("populated upgrade ignores retired cap, preserves attempt history and accepts older settings clients",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"orbit-retired-review-cap-"));
 let store=new Store(dir);
 try {
  store.set("settings",{...store.settings(),prDailyLimit:1,reviewMaxToolCalls:17,reviewMaxTokens:76543,reviewTimeoutSeconds:900});
  store.db.prepare("INSERT INTO pr_review_attempts VALUES (?,?,?)").run("attempt","review","2026-10-26T00:00:00.000Z");
  for(let i=0;i<2;i++){
   store.close();store=new Store(dir);
   assert.equal("prDailyLimit" in store.settings(),false);
   assert.equal(store.settings().reviewMaxToolCalls,17);
   assert.equal(store.settings().reviewMaxTokens,76543);
   assert.equal(store.settings().reviewTimeoutSeconds,900);
   assert.equal((store.db.prepare("SELECT count(*) n FROM pr_review_attempts").get() as any).n,1);
  }
  const {app}=createApp(store);
  const headers={Host:"localhost:43871",Origin:"http://localhost:43871","X-Orbit-Request":"1"};
  const setup=await request(app).post("/api/auth/setup").set(headers).send({password:"correct-password-long"}).expect(200);
  const auth={...headers,Cookie:setup.headers["set-cookie"][0].split(";")[0],"X-CSRF-Token":setup.body.csrf};
  await request(app).put("/api/settings").set(auth).send({...store.settings(),prDailyLimit:1}).expect(200);
  assert.equal("prDailyLimit" in store.get<any>("settings",{}),false);
  assert.equal(store.settings().reviewMaxToolCalls,17);
  assert.equal((store.db.prepare("SELECT count(*) n FROM pr_review_attempts").get() as any).n,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
