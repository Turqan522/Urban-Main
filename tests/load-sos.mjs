import { randomUUID } from "node:crypto";
const base=process.argv[2]??"http://localhost:5173";
if(!["localhost","127.0.0.1","[::1]"].includes(new URL(base).hostname))throw Error("Load test is local only and resets the demo database");
const api=async(path,body,token)=>fetch(`${base}/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
const login=await api("auth/login",{username:"operator",password:process.env.CRISIS_OPERATOR_PASSWORD||"crisis2026"});
const token=(await login.json()).token;
if(!token)throw Error("Operator login failed");
await api("scenario",{name:"reset"},token);
const started=performance.now();
try{
 const jobs=Array.from({length:500},(_,index)=>{
  const start=performance.now(),cookie=randomUUID();
  return fetch(`${base}/api/sos`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:`crisis_citizen=${cookie}`,"CF-Connecting-IP":`198.19.${Math.floor(index/256)}.${index%256}`},body:JSON.stringify({lat:40.367+(index%4)*0.007+((index%11)-5)*0.00017,lng:49.829+(Math.floor(index/4)%4)*0.009+((index%13)-6)*0.00017,type:["fire","medical","flood","collapse"][index%4]}),signal:AbortSignal.timeout(30000)}).then(async response=>({status:response.status,body:await response.json(),ms:performance.now()-start}));
 });
 const results=await Promise.allSettled(jobs),fulfilled=results.filter(x=>x.status==="fulfilled").map(x=>x.value),failures=results.filter(x=>x.status==="rejected");
 const statuses=Object.fromEntries([...new Set(fulfilled.map(x=>x.status))].map(status=>[status,fulfilled.filter(x=>x.status===status).length]));
 const times=fulfilled.map(x=>x.ms).sort((a,b)=>a-b);
 console.log(JSON.stringify({total:500,fulfilled:fulfilled.length,networkFailures:failures.length,statuses,averageMs:times.reduce((a,b)=>a+b,0)/times.length,p99Ms:times[Math.floor(times.length*0.99)]??null,elapsedMs:performance.now()-started},null,2));
 if(failures.length)process.exitCode=1;
}finally{await api("scenario",{name:"reset"},token);console.log("Demo reset.");}
