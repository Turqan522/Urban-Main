const {test}=require("node:test"),assert=require("node:assert/strict");
const {SosRateGuard,TokenBucketLimiter,simulateFlood}=require("../outputs/test-build/crisis/rate-limiter.js");
const {SpamDetector}=require("../outputs/test-build/crisis/spam-detector.js");
const {signToken,verifyToken,authorize,login}=require("../outputs/test-build/crisis/auth.js");
const {seed}=require("../outputs/test-build/crisis/seed.js"),{command}=require("../outputs/test-build/crisis/commands.js");
const NOW=1800000000000,secret="test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
test("citizen token bucket rejects a fourth distinct SOS and refills",()=>{
 let now=NOW;const guard=new SosRateGuard(()=>now);
 for(let i=0;i<3;i++)assert.equal(guard.check("c1",null,`request-${i}`).allowed,true);
 const rejected=guard.check("c1",null,"request-4");assert.equal(rejected.code,"RATE_CITIZEN");assert.equal(rejected.status,429);
 now+=100000;assert.equal(guard.check("c1",null,"request-5").allowed,true);
});
test("duplicate retries do not spend additional quota",()=>{
 const guard=new SosRateGuard(()=>NOW);
 for(let i=0;i<10;i++)assert.equal(guard.check("citizen",null,"same-request").allowed,true);
 for(let i=0;i<2;i++)assert.equal(guard.check("citizen",null,`other-${i}`).allowed,true);
 assert.equal(guard.check("citizen",null,"fourth").code,"RATE_CITIZEN");
});
test("IP bucket rejects an eleventh distinct citizen without blocking a different IP",()=>{
 const guard=new SosRateGuard(()=>NOW);
 for(let i=0;i<10;i++)assert.equal(guard.check(`citizen-${i}`,"1.2.3.4",`r-${i}`).allowed,true);
 assert.equal(guard.check("eleven","1.2.3.4","r-11").code,"RATE_IP");
 assert.equal(guard.check("other","5.6.7.8","other").allowed,true);
});
test("global bucket gives 503 after 200 new requests",()=>{
 const guard=new SosRateGuard(()=>NOW);
 for(let i=0;i<200;i++)assert.equal(guard.check(`c-${i}`,`10.0.${Math.floor(i/256)}.${i%256}`,`r-${i}`).allowed,true);
 const rejected=guard.check("last","10.1.1.1","last");assert.equal(rejected.code,"RATE_GLOBAL");assert.equal(rejected.status,503);assert.ok(guard.overloadedUntil>NOW);
});
test("old buckets are pruned",()=>{
 let now=NOW;const limiter=new TokenBucketLimiter(1,1,1000,()=>now);
 assert.equal(limiter.take("a"),true);assert.equal(limiter.take("a"),false);
 now+=1100;limiter.prune();assert.equal(limiter.take("a"),true);
});
test("spam detector catches rapid same-IP and four-cookie same-location patterns",()=>{
 let now=NOW;const detector=new SpamDetector(()=>now);
 assert.equal(detector.check({citizenId:"a",ip:"1.2.3.4",lat:40.374,lng:49.838,type:"fire",at:now}).spam,false);
 now+=100;assert.equal(detector.check({citizenId:"b",ip:"1.2.3.4",lat:40.380,lng:49.850,type:"fire",at:now}).spam,true);
 for(let i=1;i<3;i++){now+=600;assert.equal(detector.check({citizenId:`c${i}`,ip:"1.2.3.4",lat:40.374,lng:49.838,type:"fire",at:now}).spam,false);}
 now+=600;assert.equal(detector.check({citizenId:"c3",ip:"1.2.3.4",lat:40.374,lng:49.838,type:"fire",at:now}).spam,true);
});
test("spam detector keeps at most 1000 recent entries",()=>{
 let now=NOW;const detector=new SpamDetector(()=>now);
 for(let i=0;i<1200;i++){now+=600;detector.check({citizenId:`c${i}`,ip:`ip-${i}`,lat:40.374,lng:49.838,type:"fire",at:now});}
 assert.ok(detector.size<=1000);
});
test("JWT rejects tampering and expiry; role checks enforce operator/admin",async()=>{
 const issued=Date.now(),token=await signToken("operator","operator","Operator",secret,issued);
 assert.equal((await verifyToken(token,secret,issued)).role,"operator");
 const parts=token.split(".");parts[2]=(parts[2][0]==="a"?"b":"a")+parts[2].slice(1);
 assert.equal(await verifyToken(parts.join("."),secret,issued),null);
 assert.equal(await verifyToken(token,secret,issued+8*3600000+1000),null);
 assert.equal((await authorize("confirm",null,secret)).status,401);
 assert.equal((await authorize("confirm",`Bearer ${token}`,secret)).ok,true);
 assert.equal((await authorize("config",`Bearer ${token}`,secret)).status,403);
 const admin=await signToken("admin","admin","Admin",secret,issued);
 assert.equal((await authorize("config",`Bearer ${admin}`,secret)).ok,true);
});
test("login requires correct password and produces an eight-hour token",async()=>{
 const config={secret,operatorPassword:"crisis2026",adminPassword:"admin2026"};
 assert.equal(await login("operator","wrong",config),null);
 const result=await login("operator","crisis2026",config);
 assert.equal(result.role,"operator");assert.ok(result.expiresAt>Date.now());
});
test("SOS inside broad bounds but far from the road graph is rejected",()=>{
 assert.throws(()=>command(seed(NOW),"sos",{lat:40.35,lng:49.81,type:"fire"},"citizen",NOW),/yol şəbəkəsindən/);
});
test("500-request limiter simulation is bounded and does not write SOS",()=>{
 const result=simulateFlood();assert.equal(result.total,500);assert.equal(result.counts.accepted,200);assert.equal(result.counts.RATE_GLOBAL,300);
});


test("citizen account passwords are salted and verification rejects wrong passwords", async () => {
  const {makePassword,verifyPassword,validCredentials} = require("../outputs/test-build/crisis/password.js");
  assert.equal(validCredentials("student_1","strong-password"),true);
  assert.equal(validCredentials("student_1","x"),true);
  assert.equal(validCredentials("a","short"),false);
  assert.equal(validCredentials("person@gmail.com","1"),true);
  assert.equal(validCredentials("person@gmail.com",""),false);
  const first=await makePassword("strong-password"), second=await makePassword("strong-password");
  assert.notEqual(first.salt,second.salt);
  assert.notEqual(first.hash,second.hash);
  assert.equal(await verifyPassword("strong-password",first.salt,first.hash),true);
  assert.equal(await verifyPassword("wrong-password",first.salt,first.hash),false);
});
test("citizen token cannot authorize dispatcher operations",async()=>{
  const {signToken,authorize} = require("../outputs/test-build/crisis/auth.js");
  const secret="x".repeat(32),token=await signToken("user","citizen","student",secret);
  const result=await authorize("road",`Bearer ${token}`,secret);
  assert.equal(result.ok,false);
  assert.equal(result.status,403);
});
