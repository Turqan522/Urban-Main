import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base=process.argv[2]??"http://localhost:5173";
if(!["localhost","127.0.0.1","[::1]"].includes(new URL(base).hostname))throw Error("Security smoke test is local only");
let count=0;
async function call(path,body,options={}){
 const response=await fetch(`${base}/api/${path}`,{method:body===undefined?"GET":"POST",headers:{...(body!==undefined?{"Content-Type":"application/json"}:{}),...(options.token?{Authorization:`Bearer ${options.token}`}:{ }),...(options.cookie?{Cookie:`crisis_citizen=${options.cookie}`}:{ }),...(options.ip?{"CF-Connecting-IP":options.ip}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json();return {status:response.status,data};
}
function check(condition,label){assert.ok(condition,label);count++;console.log("PASS",label);}
const operator=(await call("auth/login",{username:"operator",password:process.env.CRISIS_OPERATOR_PASSWORD||"crisis2026"})).data.token;
const admin=(await call("auth/login",{username:"admin",password:process.env.CRISIS_ADMIN_PASSWORD||"admin2026"})).data.token;
check(typeof operator==="string"&&typeof admin==="string","operator and admin login issue tokens");
try{
 await call("scenario",{name:"reset"},{token:operator});
 check((await call("confirm",{id:"missing"})).status===401,"protected dispatch requires login");
 check((await call("confirm",{id:"missing"},{token:"forged"})).status===401,"forged token is rejected");
 check((await call("config",{sosThreshold:5},{token:operator})).status===403,"operator cannot change admin rules");
 check((await call("config",{sosThreshold:5},{token:admin})).status===200,"admin can change rules");
 const demo=await call("security-demo",{},{token:operator});
 check(demo.status===200&&demo.data.synthetic&&demo.data.counts.accepted===200&&demo.data.counts.RATE_GLOBAL===300,"synthetic 500-request limit demo counts 200 accepted and 300 blocked");
 const citizen=randomUUID();
 for(let i=0;i<3;i++){
   const result=await call("sos",{lat:40.374,lng:49.838,type:["fire","medical","flood"][i]},{cookie:citizen});
   check(result.status===200,`citizen SOS ${i+1} accepted`);
   await call("safe",{},{cookie:citizen});
 }
 const fourth=await call("sos",{lat:40.374,lng:49.838,type:"collapse"},{cookie:citizen});
 check(fourth.status===429&&fourth.data.code==="RATE_CITIZEN","fourth citizen SOS is limited");
 const nodes=(await call("state")).data.nodes;
 const ip="198.51.100.42";
 for(let i=0;i<10;i++){
   const result=await call("sos",{lat:nodes[i].lat,lng:nodes[i].lng,type:"fire"},{cookie:randomUUID(),ip});
   check(result.status===200,`IP SOS ${i+1} accepted`);
   await new Promise(resolve=>setTimeout(resolve,550));
 }
 const eleventh=await call("sos",{lat:nodes[10].lat,lng:nodes[10].lng,type:"fire"},{cookie:randomUUID(),ip});
 check(eleventh.status===429&&eleventh.data.code==="RATE_IP","eleventh IP SOS is limited");
 const outside=await call("sos",{lat:40.35,lng:49.81,type:"fire"},{cookie:randomUUID()});
 check(outside.status===400,"in-bounds point outside mapped roads is rejected");
 const health=await call("health");check(health.status===200&&health.data.persistence==="D1","dispatcher health remains available");
}finally{await call("scenario",{name:"reset"},{token:operator});}
console.log(`${count} security API assertions passed; demo reset.`);
