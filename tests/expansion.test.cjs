const {test}=require("node:test"),assert=require("node:assert/strict");
const {seed}=require("../outputs/test-build/crisis/seed.js");
const {command}=require("../outputs/test-build/crisis/commands.js");
const {routes,alerts,publicState}=require("../outputs/test-build/crisis/engine.js");
const {waterPercent,foodPercent,isShelterEligible}=require("../outputs/test-build/crisis/resources.js");
const {matchingVolunteers}=require("../outputs/test-build/crisis/volunteers.js");
const {newsForPoint}=require("../outputs/test-build/crisis/news.js");
const {RoutingCircuitBreaker}=require("../outputs/test-build/crisis/circuit-breaker.js");
const {migrateState,migratePublicState}=require("../outputs/test-build/crisis/migrate.js");
const NOW=1800000000000,fresh=()=>seed(NOW);
test("one 503 opens the circuit and prevents a second external call",async()=>{
 let now=NOW,calls=0;const breaker=new RoutingCircuitBreaker(40,30000,()=>now);
 const failed=await breaker.executeWithFallback(async()=>{calls++;throw Error("HTTP 503 Service Unavailable")},()=>"local");
 assert.equal(failed.data,"local");assert.equal(failed.isFallback,true);assert.equal(failed.circuit,"OPEN");
 const skipped=await breaker.executeWithFallback(async()=>{calls++;return "external"},()=>"local");
 assert.equal(skipped.data,"local");assert.equal(calls,1);
 now+=30000;const probe=await breaker.executeWithFallback(async()=>{calls++;return "external"},()=>"local");
 assert.equal(probe.data,"external");assert.equal(probe.circuit,"CLOSED");assert.equal(calls,2);
});
test("a provider ignoring abort still times out and falls back",async()=>{
 const breaker=new RoutingCircuitBreaker(10,30000,()=>NOW);
 const result=await breaker.executeWithFallback(()=>new Promise(()=>{}),()=>["local"]);
 assert.deepEqual(result.data,["local"]);assert.equal(result.isFallback,true);assert.match(result.reason,/Timeout/);
});
test("only one half-open probe runs while other traffic uses fallback",async()=>{
 let now=NOW,release;const breaker=new RoutingCircuitBreaker(20,30000,()=>now);
 await breaker.executeWithFallback(async()=>{throw Error("503")},()=>"local");now+=30000;
 const probe=breaker.executeWithFallback(()=>new Promise(resolve=>release=resolve),()=>"local");
 await Promise.resolve();await Promise.resolve();
 const concurrent=await breaker.executeWithFallback(async()=>assert.fail("second probe"),()=>"local");
 assert.equal(concurrent.isFallback,true);release("external");assert.equal((await probe).circuit,"CLOSED");
});
test("water below 20 percent excludes a shelter and creates orange supply alert",()=>{
 const s=fresh();s.shelters[0].resources.waterLiters=999;
 assert.ok(waterPercent(s.shelters[0])<20);assert.equal(isShelterEligible(s.shelters[0],s),false);
 assert.ok(!routes(s,s.nodes[0]).some(r=>r.shelter.id==="s1"));
 assert.ok(alerts(s,NOW).some(a=>a.id==="resource:s1"));
});
test("food below 10 percent excludes; exact thresholds remain eligible",()=>{
 const s=fresh(),sh=s.shelters[0];sh.resources.waterLiters=1000;sh.resources.foodRations=200;
 assert.equal(waterPercent(sh),20);assert.equal(foodPercent(sh),10);assert.equal(isShelterEligible(sh,s),true);
 sh.resources.foodRations=199;assert.equal(isShelterEligible(sh,s),false);
});
test("one supply convoy fills all inventories and restores routing",()=>{
 let s=fresh();s=command(s,"resource-update",{id:"s1",waterLiters:100,foodRations:20,medicalKits:0,batteryPercent:5},"operator",NOW);
 assert.equal(isShelterEligible(s.shelters[0],s),false);
 s=command(s,"resource-resupply",{id:"s1"},"operator",NOW+1);
 assert.equal(s.shelters[0].resources.waterLiters,s.shelters[0].resources.waterMax);
 assert.equal(s.shelters[0].resources.foodRations,s.shelters[0].resources.foodMax);
 assert.equal(s.shelters[0].resources.medicalKits,s.shelters[0].resources.medicalMax);
 assert.equal(s.shelters[0].resources.batteryPercent,100);assert.equal(isShelterEligible(s.shelters[0],s),true);
 assert.equal(alerts(s,NOW+1).some(a=>a.id==="resource:s1"),false);
 const retry=command(s,"resource-resupply",{id:"s1"},"operator",NOW+2);assert.equal(retry,s);
});
test("invalid inventory changes are rejected without touching stored state",()=>{
 const s=fresh(),before=structuredClone(s);
 for(const value of [-1,5001,Infinity,"50"])assert.throws(()=>command(s,"resource-update",{id:"s1",waterLiters:value},"operator",NOW));
 assert.deepEqual(s,before);
});
function busyMedical(){let s=fresh();for(const team of s.teams){s.sos.push({id:`seed-${team.id}`,citizenId:`seed-${team.id}`,zone:"Sahil",lat:40.374,lng:49.838,type:"fire",priority:0,needsAccessible:false,createdAt:NOW,status:"active",assignedTeam:team.id});team.status="dispatched";team.incidentId=`seed-${team.id}`;}
 s=command(s,"sos",{lat:40.374,lng:49.838,type:"medical"},"patient",NOW);return s;}
test("volunteer demo starts with three busy teams and an unassigned medical SOS",()=>{
 const s=command(fresh(),"scenario",{name:"volunteer"},"operator",NOW);
 assert.equal(s.teams.filter(t=>t.status==="dispatched").length,3);
 assert.ok(s.sos.some(x=>x.type==="medical"&&x.status==="active"&&!x.assignedTeam));
 assert.ok(s.teams.every(t=>s.sos.some(x=>x.assignedTeam===t.id&&x.status==="active")));
});
function withVolunteer(){let s=busyMedical();s=command(s,"volunteer-register",{name:"Samir Aliyev",phone:"+994 50 123 45 67",skills:["first_aid"],lat:40.374,lng:49.838},"helper",NOW);const id=s.volunteers[0].id;s=command(s,"volunteer-verify",{id,verified:true},"operator",NOW);s=command(s,"volunteer-ready",{available:true,lat:40.374,lng:49.838},"helper",NOW);return s;}
test("unverified or unavailable volunteers are never recommended",()=>{
 let s=busyMedical();s=command(s,"volunteer-register",{name:"Samir Aliyev",phone:"+994 50 123 45 67",skills:["first_aid"],lat:40.374,lng:49.838},"helper",NOW);
 const medical=s.sos.find(x=>x.citizenId==="patient");assert.deepEqual(matchingVolunteers(s,medical),[]);
 s=command(s,"volunteer-verify",{id:s.volunteers[0].id,verified:true},"operator",NOW);assert.deepEqual(matchingVolunteers(s,medical),[]);
});
test("verified nearby helper is suggested only while professional teams are busy",()=>{
 const s=withVolunteer(),medical=s.sos.find(x=>x.citizenId==="patient");
 assert.equal(matchingVolunteers(s,medical)[0].volunteer.id,s.volunteers[0].id);
 s.teams[0].status="available";assert.deepEqual(matchingVolunteers(s,medical),[]);
});
test("far, wrong-skill and inaccessible helpers are excluded",()=>{
 const s=withVolunteer(),medical=s.sos.find(x=>x.citizenId==="patient");
 s.volunteers[0].location={lat:40.388,lng:49.856};assert.deepEqual(matchingVolunteers(s,medical),[]);
 s.volunteers[0].location={lat:40.374,lng:49.838};s.volunteers[0].skills=["rescue"];assert.deepEqual(matchingVolunteers(s,medical),[]);
 s.volunteers[0].skills=["first_aid"];s.roads.forEach(r=>r.accessible=false);s.volunteers[0].location={lat:40.367,lng:49.829};assert.deepEqual(matchingVolunteers(s,medical),[]);
});
test("volunteer assignment and status flow never close the professional SOS",()=>{
 let s=withVolunteer();const sos=s.sos.find(x=>x.citizenId==="patient"),id=s.volunteers[0].id;
 s=command(s,"volunteer-dispatch",{sosId:sos.id,volunteerId:id},"operator",NOW);
 assert.equal(s.volunteerTasks[0].status,"pending_acceptance");assert.equal(s.teams.filter(t=>t.status==="dispatched").length,3);
 for(const status of ["en_route","on_scene","completed"])s=command(s,"volunteer-status",{status},"helper",NOW);
 assert.equal(s.volunteerTasks[0].status,"completed");assert.equal(s.sos.find(x=>x.id===sos.id).status,"active");
 assert.equal(s.teams.filter(t=>t.status==="dispatched").length,3);
 s=command(s,"volunteer-ready",{available:true},"helper",NOW);assert.equal(s.volunteers[0].status,"idle");
});
test("wrong owner and illegal volunteer transitions are rejected",()=>{
 let s=withVolunteer(),sos=s.sos.find(x=>x.citizenId==="patient");s=command(s,"volunteer-dispatch",{sosId:sos.id,volunteerId:s.volunteers[0].id},"operator",NOW);
 assert.throws(()=>command(s,"volunteer-status",{status:"en_route"},"other",NOW));
 assert.throws(()=>command(s,"volunteer-status",{status:"completed"},"helper",NOW));
 assert.throws(()=>command(s,"volunteer-dispatch",{sosId:sos.id,volunteerId:s.volunteers[0].id},"operator",NOW));
});
test("public state never exposes volunteer phone or citizen identity",()=>{
 const s=withVolunteer(),view=publicState(s,"another",NOW);
 assert.equal("phone" in view.volunteers[0],false);assert.equal("citizenId" in view.volunteers[0],false);
 assert.equal(view.myVolunteer,null);assert.equal(publicState(s,"helper",NOW).myVolunteer.name,"Samir Aliyev");
});
test("confirmed cluster and closed road create targeted news once",()=>{
 let s=command(fresh(),"scenario",{name:"cluster"},"operator",NOW);
 const alert=alerts(s,NOW).find(a=>a.kind==="cluster");s=command(s,"confirm",{id:alert.id},"operator",NOW);
 assert.equal(s.news.filter(x=>x.incidentType==="cluster").length,1);
 s=command(s,"confirm",{id:alert.id},"operator",NOW);assert.equal(s.news.length,1);
 s=command(s,"road",{id:"r0-1",closed:true},"operator",NOW+1);assert.equal(s.news[0].incidentType,"road");
 assert.ok(newsForPoint(s,s.nodes[0]).some(x=>x.incidentType==="road"));
 assert.ok(!newsForPoint(s,s.nodes[15]).some(x=>x.incidentType==="road"));
});
test("legacy state migration adds expansion fields without resetting counts",()=>{
 const s=fresh();delete s.news;delete s.volunteers;delete s.volunteerTasks;s.shelters.forEach(sh=>delete sh.resources);s.shelters[0].occupied=333;s.revision=8;
 const next=migrateState(s);assert.equal(next.shelters[0].occupied,333);assert.equal(next.revision,8);
 assert.ok(next.shelters.every(sh=>sh.resources.waterMax>0));assert.deepEqual(next.news,[]);
});
test("legacy browser snapshot gains supply fields before offline route calculation",()=>{
 const cached=publicState(fresh(),"citizen",NOW);
 cached.shelters.forEach(sh=>delete sh.resources);
 delete cached.volunteers;delete cached.volunteerTasks;delete cached.news;
 const restored=migratePublicState(cached);
 assert.ok(restored.shelters.every(sh=>sh.resources.waterMax>0));
 assert.ok(routes(restored,restored.nodes[0]).length>0);
 assert.deepEqual(restored.volunteers,[]);
 assert.deepEqual(restored.news,[]);
});
