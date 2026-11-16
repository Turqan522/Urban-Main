import assert from "node:assert/strict";
const base=process.argv[2] ?? "http://127.0.0.1:4173";
if(!["127.0.0.1","localhost","[::1]"].includes(new URL(base).hostname))throw Error("Demo reset is local only");
let cookie="",token="",count=0;
async function api(path,body){const response=await fetch(`${base}/api/${path}`,{signal:AbortSignal.timeout(15000),headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{"Content-Type":"application/json"}:{})},...(body?{method:"POST",body:JSON.stringify(body)}:{})});cookie ||= response.headers.get("set-cookie")?.split(";")[0] ?? "";const data=await response.json();if(!response.ok)throw Error(`${path}: ${response.status} ${data.error}`);return data;}
function check(value,label){assert.ok(value,label);count++;console.log("PASS",label);}
await api("state");
token=(await api("auth/login",{username:"operator",password:process.env.CRISIS_OPERATOR_PASSWORD||"crisis2026"})).token;
try {
  await api("scenario",{name:"reset"});
  let state=await api("state");
  check(state.shelters.every(sh=>sh.resources.waterMax>0&&sh.resources.foodMax>0),"resource snapshot initialized");
  check(Array.isArray(state.news)&&Array.isArray(state.volunteers),"expansion state initialized");
  const baseline=(await api("routes?lat=40.367&lng=49.847")).routes;
  check(baseline.some(r=>r.shelter.id==="s1"),"baseline route includes Sahil");
  state=await api("resource-update",{id:"s1",waterLiters:400});
  check(state.alerts.some(a=>a.kind==="resource"&&a.shelterId==="s1"),"low water creates supply alert");
  check(!(await api("routes?lat=40.367&lng=49.847")).routes.some(r=>r.shelter.id==="s1"),"low water reroutes citizens");
  state=await api("resource-resupply",{id:"s1"});
  check(state.shelters.find(sh=>sh.id==="s1").resources.waterLiters===state.shelters.find(sh=>sh.id==="s1").resources.waterMax,"convoy replenishes water");
  check((await api("routes?lat=40.367&lng=49.847")).routes.some(r=>r.shelter.id==="s1"),"supply restores routing");
  state=await api("volunteer-register",{name:"Samir Aliyev",phone:"+994 50 123 45 67",skills:["first_aid"],lat:40.374,lng:49.838});
  check(!!state.myVolunteer&&!state.myVolunteer.verified,"volunteer registers awaiting verification");
  check(!("phone" in state.volunteers[0])&&!('citizenId' in state.volunteers[0]),"public volunteers hide phone and identity");
  state=await api("volunteer-verify",{id:state.myVolunteer.id,verified:true});
  state=await api("volunteer-ready",{available:true,lat:40.374,lng:49.838});
  check(state.myVolunteer.verified&&state.myVolunteer.available,"verified volunteer becomes ready");
  state=await api("road",{id:"r0-1",closed:true});
  check(state.news.some(item=>item.incidentType==="road"),"road closure publishes official news");
  check((await api("news?lat=40.367&lng=49.829")).news.some(item=>item.incidentType==="road"),"news reaches targeted area");
  check(!(await api("news?lat=40.388&lng=49.856")).news.some(item=>item.incidentType==="road"),"distant area is excluded");
  state=await api("scenario",{name:"volunteer"});
  check(state.teams.every(team=>team.status==="dispatched")&&state.sos.some(s=>s.type==="medical"&&!s.assignedTeam),"volunteer demo leaves a medical SOS awaiting professional help");
  state=await api("volunteer-register",{name:"Samir Aliyev",phone:"+994 50 123 45 67",skills:["first_aid"],lat:40.374,lng:49.838});
  const volunteerId=state.myVolunteer.id,medicalId=state.sos.find(s=>s.type==="medical"&&!s.assignedTeam).id;
  await api("volunteer-verify",{id:volunteerId,verified:true});
  await api("volunteer-ready",{available:true,lat:40.374,lng:49.838});
  state=await api("volunteer-dispatch",{sosId:medicalId,volunteerId});
  check(state.volunteerTasks.some(task=>task.sosId===medicalId&&task.status==="pending_acceptance"),"operator can dispatch a nearby verified volunteer");
  for(const status of ["en_route","on_scene","completed"])state=await api("volunteer-status",{status});
  check(state.sos.find(s=>s.id===medicalId).status==="active","volunteer completion keeps professional SOS active");
  const failed=await api("routes?lat=40.374&lng=49.838&external=503");
  check(failed.routing.source==="LOCAL_FALLBACK"&&failed.routing.circuit==="OPEN"&&failed.routes.length>0,"503 opens circuit and returns local routes");
  const skipped=await api("routes?lat=40.374&lng=49.838");
  check(skipped.routing.source==="LOCAL_FALLBACK","subsequent request stays on local fallback");
} finally { await api("scenario",{name:"reset"}); }
console.log(`${count} expansion API assertions passed; demo reset.`);
