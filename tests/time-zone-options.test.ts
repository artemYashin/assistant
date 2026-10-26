import test from "node:test";
import assert from "node:assert/strict";
import {timeZoneOffset,timeZoneOptions} from "../src/shared/lib/time-zone/index.js";
test("timezone labels show current offsets including DST and fractional hours",()=>{
 const winter=new Date("2026-01-15T12:00:00Z"), summer=new Date("2026-07-15T12:00:00Z");
 assert.equal(timeZoneOffset("UTC",winter),"UTC");
 assert.equal(timeZoneOffset("Asia/Bishkek",winter),"UTC+06:00");
 assert.equal(timeZoneOffset("Asia/Kathmandu",winter),"UTC+05:45");
 assert.equal(timeZoneOffset("America/New_York",winter),"UTC-05:00");
 assert.equal(timeZoneOffset("America/New_York",summer),"UTC-04:00");
});
test("saved aliases and unsupported choices retain their original IDs",()=>{
 for(const current of ["US/Eastern","Etc/GMT-6","Legacy/Unknown"]){
  const options=timeZoneOptions(current,new Date("2026-01-15T12:00:00Z"));
  assert.equal(options.filter(o=>o.value===current).length,1);
  assert.equal(options[0].value,"UTC");
  assert.match(options.find(o=>o.value===current)!.label,new RegExp(current));
 }
});
test("older browser fallback retains saved timezone",t=>{
 t.mock.method(Intl,"supportedValuesOf",()=>{throw Error("unsupported");});
 const options=timeZoneOptions("Pacific/Chatham");
 assert.ok(options.some(o=>o.value==="Pacific/Chatham"));
 assert.ok(options.some(o=>o.value==="Asia/Bishkek"));
});
