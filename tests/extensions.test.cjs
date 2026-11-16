const { test } = require("node:test");
const assert = require("node:assert/strict");
const { seed } = require("../outputs/test-build/crisis/seed.js");
const { command } = require("../outputs/test-build/crisis/commands.js");
const { accessibleRoutes, routes, alerts, teamRoute, shortestPath, publicState } = require("../outputs/test-build/crisis/engine.js");
const { migrateState } = require("../outputs/test-build/crisis/migrate.js");
const { transact } = require("../outputs/test-build/crisis/transaction.js");
const { classifyVoice } = require("../outputs/test-build/voice.js");
const { messages } = require("../outputs/test-build/i18n.js");
const { enqueue, readQueue, flushQueue, removeQueued } = require("../outputs/test-build/offline.js");
const NOW = 1800000000000, fresh = () => seed(NOW);
const report = (s, citizen = "c1", extra = {}) => command(s,"sos",{lat:40.374,lng:49.838,type:"fire",...extra},citizen,NOW);
function storage() { const map = new Map(); return { getItem:k=>map.get(k) ?? null,setItem:(k,v)=>map.set(k,v) }; }
function memoryPort(state = fresh()) {
  let stored = structuredClone(state), conflicts = 0;
  return { load:async()=>structuredClone(stored), compareAndSwap:async(before,after)=>{if(before.revision!==stored.revision){conflicts++;return false;}stored=structuredClone(after);return true;}, get state(){return stored;},get conflicts(){return conflicts;} };
}
test("accessible routing excludes steps and inaccessible shelter",()=>{
  const s=fresh(), result=accessibleRoutes(s,s.nodes[5]);
  assert.ok(result.length>0);
  for(const r of result){assert.ok(r.shelter.accessible);assert.ok(r.roadIds.every(id=>s.roads.find(x=>x.id===id).accessible));}
  assert.ok(!result.some(r=>r.shelter.id==="s3"));
});
test("accessible ETA uses 50 metres/minute, ordinary ETA uses 75",()=>{
  const s=fresh();s.roads.forEach(r=>r.accessible=true);s.shelters.forEach(sh=>sh.accessible=true);
  const normal=routes(s,s.nodes[0]), accessible=accessibleRoutes(s,s.nodes[0]);
  for(const r of accessible){const p=shortestPath(s,s.nodes[0].id,r.shelter.node,true);assert.equal(r.minutes,Math.max(1,Math.ceil(p.weightedMeters/50)));assert.ok(r.minutes>=normal.find(n=>n.shelter.id===r.shelter.id).minutes);}
});
test("no accessible roads or shelters returns no route",()=>{
  const s=fresh();s.roads.forEach(r=>r.accessible=false);assert.deepEqual(accessibleRoutes(s,s.nodes[5]),[]);
  s.shelters.forEach(sh=>sh.accessible=false);assert.deepEqual(accessibleRoutes(s,s.nodes[3]),[]);
});
test("accessibility sets critical priority and upgrades an existing active SOS",()=>{
  let s=report(fresh());s=command(s,"accessibility",{enabled:true},"c1",NOW);
  assert.equal(s.sos[0].priority,1);assert.equal(s.sos[0].needsAccessible,true);
  s=command(s,"safe",{},"c1",NOW);s=report(s);
  assert.equal(s.sos.at(-1).priority,1);
  assert.throws(()=>command(s,"accessibility",{enabled:"true"},"c1",NOW));
});
test("cluster exposes a priority flag",()=>{
  let s=command(fresh(),"scenario",{name:"cluster"},"op",NOW);
  s.sos[0].priority=1;assert.equal(alerts(s,NOW)[0].hasPriority,true);
});
test("five QR scans increase occupancy once and close own SOS only",()=>{
  let s=report(report(fresh()),"c2"), initial=s.shelters[0].occupied;
  for(let i=0;i<5;i++)s=command(s,"checkin",{qrCode:"QR-SHELTER-S1"},"c1",NOW+i);
  assert.equal(s.shelters[0].occupied,initial+1);assert.equal(s.checkins.length,1);
  assert.equal(s.sos.find(x=>x.citizenId==="c1").status,"safe");assert.equal(s.sos.find(x=>x.citizenId==="c2").status,"active");
  assert.equal(s.safety.c1.shelterId,"s1");assert.equal(s.audit.filter(x=>x.action==="CHECKIN").length,1);
});
test("checking in to another shelter cannot increment occupancy twice",()=>{
  let s=command(fresh(),"checkin",{shelterId:"s1"},"c1",NOW), before=structuredClone(s);
  s=command(s,"checkin",{shelterId:"s2"},"c1",NOW+1);
  assert.deepEqual(s,before);
});
test("invalid, closed and full shelters reject check-in without mutation",()=>{
  const s=fresh();assert.throws(()=>command(s,"checkin",{qrCode:"fake"},"c1",NOW));
  assert.throws(()=>command(s,"checkin",{shelterId:"s5"},"c1",NOW));
  s.shelters[0].occupied=s.shelters[0].capacity;
  assert.throws(()=>command(s,"checkin",{shelterId:"s1"},"c1",NOW));assert.equal(s.checkins.length,0);
});
test("check-in concurrent at last place admits one citizen only",async()=>{
  const s=fresh();s.shelters[0].occupied=499;const port=memoryPort(s);
  const results=await Promise.allSettled(["a","b"].map(c=>transact(port,"checkin",{shelterId:"s1"},c)));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(port.state.shelters[0].occupied,500);
});
test("CAS handles ten simultaneous distinct citizens without lost updates",async()=>{
  const port=memoryPort();await Promise.all(Array.from({length:10},(_,i)=>transact(port,"sos",{lat:40.374,lng:49.838,type:"fire"},`c${i}`)));
  assert.equal(port.state.sos.length,10);assert.equal(port.state.revision,10);assert.ok(port.conflicts>0);
});
test("ten concurrent duplicate check-ins report idempotent outcomes",async()=>{
  const port=memoryPort();const result=await Promise.all(Array.from({length:10},()=>transact(port,"checkin",{shelterId:"s1"},"c1")));
  assert.equal(result.filter(r=>r.unchanged).length,9);assert.equal(port.state.shelters[0].occupied,261);
});
test("dispatch records positive ETA, ordered route and opens reserve atomically",()=>{
  const s=command(fresh(),"scenario",{name:"cluster"},"op",NOW);
  s.teams[0].node="n0";
  const next=command(s,"confirm",{id:alerts(s,NOW)[0].id},"op",NOW),team=next.teams.find(t=>t.status==="dispatched");
  assert.ok(Number.isInteger(team.etaMinutes)&&team.etaMinutes>0);assert.equal(team.routePath[0],team.node);assert.equal(team.routePath.at(-1),team.targetNode);
  assert.equal(team.etaMinutes,teamRoute(s,team,team.targetNode).etaMinutes);assert.ok(next.shelters.find(sh=>sh.id==="s5").open);
  for(let i=1;i<team.routePath.length;i++)assert.ok(next.roads.some(r=>!r.closed&&[r.a,r.b].includes(team.routePath[i-1])&&[r.a,r.b].includes(team.routePath[i])));
});
test("failed dispatch leaves reserve closed and state unchanged",()=>{
  const s=command(fresh(),"scenario",{name:"cluster"},"op",NOW);s.teams.forEach(t=>t.status="dispatched");
  const before=structuredClone(s);assert.throws(()=>command(s,"confirm",{id:alerts(s,NOW)[0].id},"op",NOW));assert.deepEqual(s,before);
});
test("capacity confirmation selects nearest reachable reserve rather than array order",()=>{
  const s=fresh();s.shelters[0].occupied=485;s.shelters.push({...s.shelters[4],id:"near",node:"n2",qrCode:"QR-NEAR"});
  const next=command(s,"confirm",{id:"capacity:s1"},"op",NOW);assert.equal(next.decisions[0].shelterId,"near");
});
test("when all assigned citizens are safe, the team is released",()=>{
  let s=command(fresh(),"scenario",{name:"cluster"},"op",NOW);s=command(s,"confirm",{id:alerts(s,NOW)[0].id},"op",NOW);
  const id=s.teams.find(t=>t.status==="dispatched").id;
  for(const sos of [...s.sos])s=command(s,"checkin",{shelterId:"s1"},sos.citizenId,NOW);
  const team=s.teams.find(t=>t.id===id);assert.equal(team.status,"available");assert.equal(team.routePath,undefined);
});
test("road closures recalculate team paths and mark unreachable assignments",()=>{
  let s=command(fresh(),"scenario",{name:"cluster"},"op",NOW);s.teams.forEach(t=>t.node="n15");s=command(s,"confirm",{id:alerts(s,NOW)[0].id},"op",NOW);
  const id=s.teams.find(t=>t.status==="dispatched").id;
  for(const road of [...s.roads])s=command(s,"road",{id:road.id,closed:true},"op",NOW);
  const team=s.teams.find(t=>t.id===id);assert.equal(team.routeBlocked,true);assert.equal(team.routePath,undefined);assert.equal(team.etaMinutes,undefined);
});
test("request receipt prevents delayed SOS replay after a safe status",()=>{
  let s=report(fresh(),"c1",{requestId:"request-1234"});s=command(s,"safe",{},"c1",NOW+1);
  const before=s;s=report(s,"c1",{requestId:"request-1234"});assert.equal(s,before);assert.equal(s.sos.length,1);assert.equal(s.sos[0].status,"safe");
});
test("a duplicate active request gets a receipt so later retry cannot reopen SOS",()=>{
  let s=report(fresh());s=report(s,"c1",{requestId:"request-5678"});s=command(s,"safe",{},"c1",NOW+1);
  s=report(s,"c1",{requestId:"request-5678"});assert.equal(s.sos[0].status,"safe");assert.equal(s.sos.length,1);
});
test("expired-session queue is rejected instead of attributed to another citizen",()=>{
  assert.throws(()=>report(fresh(),"c2",{sessionId:"c1"}),/SESSION_EXPIRED/);
});
test("legacy snapshot migration preserves occupied counts and revision",()=>{
  const s=fresh();delete s.accessibleMode;delete s.checkins;delete s.receipts;s.revision=9;
  s.roads.forEach(r=>delete r.accessible);s.shelters.forEach(sh=>{delete sh.accessible;delete sh.qrCode;});
  const result=migrateState(s);assert.equal(result.revision,9);assert.equal(result.shelters[0].occupied,260);assert.equal(result.shelters[0].qrCode,"QR-SHELTER-S1");assert.equal(result.roads.find(r=>r.id==="r5-6").accessible,false);
});
test("public state exposes own preferences only and correct zone aggregates",()=>{
  let s=command(fresh(),"accessibility",{enabled:true},"c1",NOW);s=report(s);s=command(s,"checkin",{shelterId:"s1"},"other",NOW);
  const view=publicState(s,"c1",NOW);for(const key of ["accessibleMode","checkins","receipts","safety"])assert.equal(key in view,false);
  assert.equal(view.myAccessibleMode,true);assert.equal(view.myCheckin,null);assert.equal(view.zones.reduce((sum,z)=>sum+z.prioritySos,0),1);
});
test("AZ/EN speech detects hazards before generic help",()=>{
  for(const [text,type] of [["Yanğın!","fire"],["Fire, help!","fire"],["Dağıntı","collapse"],["Kömək","collapse"],["Su basması","flood"],["Flood","flood"],["Həkim","medical"],["Tibbi yardım","medical"],["Help","medical"]])assert.equal(classifyVoice(text),type,text);
  assert.equal(classifyVoice("salam"),null);
});
test("every interface message has Azerbaijani and English text",()=>{
  for(const [key,pair] of Object.entries(messages)){assert.equal(pair.length,2,key);assert.ok(pair.every(value=>typeof value==="string"&&value.length>0),key);}
});
test("queue survives reload, preserves accessibility/SOS/safe order and deduplicates",async()=>{
  const disk=storage();for(const [i,path] of ["accessibility","sos","safe"].entries())enqueue(disk,{id:`request-${i}`,path,body:{},createdAt:NOW});
  enqueue(disk,readQueue(disk)[0]);assert.equal(readQueue(disk).length,3);
  const sent=[];await flushQueue(disk,async item=>sent.push(item.path));assert.deepEqual(sent,["accessibility","sos","safe"]);assert.equal(readQueue(disk).length,0);
});
test("failed delivery retains head and subsequent requests for retry",async()=>{
  const disk=storage();enqueue(disk,{id:"failed",path:"sos",body:{},createdAt:NOW});enqueue(disk,{id:"next",path:"safe",body:{},createdAt:NOW});
  await assert.rejects(()=>flushQueue(disk,async()=>{throw Error("offline");}));assert.deepEqual(readQueue(disk).map(x=>x.id),["failed","next"]);
  removeQueued(disk,"failed");assert.equal(readQueue(disk)[0].id,"next");
});
test("enqueue during delivery is not overwritten by removal of prior request",async()=>{
  const disk=storage();enqueue(disk,{id:"first",path:"sos",body:{},createdAt:NOW});const sent=[];
  await flushQueue(disk,async item=>{sent.push(item.id);if(item.id==="first")enqueue(disk,{id:"second",path:"safe",body:{},createdAt:NOW});});
  assert.deepEqual(sent,["first","second"]);
});
test("unavailable local storage does not pretend a request was saved",()=>{
  const disk={getItem:()=>null,setItem:()=>{throw Error("quota");}};assert.throws(()=>enqueue(disk,{id:"first",path:"sos",body:{},createdAt:NOW}),/quota/);
});

test('incident display groups accessibility and medical reports before other incidents', () => {
  const { compareIncidentDisplay } = require('../outputs/test-build/crisis/presentation.js');
  const reports = [
    { type: 'fire', priority: 0, createdAt: 30 },
    { type: 'medical', priority: 0, createdAt: 10 },
    { type: 'flood', priority: 1, createdAt: 5 },
    { type: 'medical', priority: 0, createdAt: 20 },
  ];
  assert.deepEqual(reports.sort(compareIncidentDisplay).map(x => x.createdAt), [5, 20, 10, 30]);
});

test('SOS optional details are validated and visible only to their owner or operator', () => {
  const s = command(fresh(), 'sos', {lat:40.374,lng:49.838,type:'fire',details:{people:3,injured:true,setting:'indoors',note:'3rd floor'}}, 'owner', NOW);
  assert.equal(publicState(s,'owner',NOW).sos[0].details.note, '3rd floor');
  assert.equal(publicState(s,'other',NOW).sos[0].details, undefined);
  assert.equal(publicState(s,'operator',NOW,true).sos[0].details.people, 3);
  assert.throws(() => command(fresh(),'sos',{lat:40.374,lng:49.838,type:'fire',details:{people:1001}},'owner',NOW));
});
test('safety sharing code is private and invalidated by a new SOS', () => {
  const safe = command(fresh(), 'safe', {}, 'owner', NOW);
  const code = publicState(safe,'owner',NOW).mySafety.shareCode;
  assert.match(code, /^[a-f0-9]{32}$/);
  assert.equal(publicState(safe,'other',NOW).mySafety, null);
  const active = command(safe,'sos',{lat:40.374,lng:49.838,type:'fire'},'owner',NOW+1);
  assert.equal(active.safety.owner, undefined);
});

test('impact safe status count includes current records but does not reveal other safety codes', () => {
  let s=command(fresh(),'safe',{},'one',NOW);
  s=command(s,'safe',{},'two',NOW+1);
  const view=publicState(s,'observer',NOW+2);
  assert.equal(view.safetyCount,2);
  assert.equal(view.mySafety,null);
  assert.equal(JSON.stringify(view).includes(s.safety.one.shareCode),false);
});
