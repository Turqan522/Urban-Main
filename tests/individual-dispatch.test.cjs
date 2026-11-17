const {test}=require('node:test');
const assert=require('node:assert/strict');
const {seed}=require('../outputs/test-build/crisis/seed.js');
const {command}=require('../outputs/test-build/crisis/commands.js');
const {authorize}=require('../outputs/test-build/crisis/auth.js');
const now=1800000000000;
test('individual SOS can be viewed, assigned and completed',()=>{
 let s=seed(now); s=command(s,'sos',{lat:40.374,lng:49.838,type:'medical'},'citizen',now);
 const id=s.sos[0].id; const team=s.teams.find(x=>x.status==='available');
 s=command(s,'sos-view',{id},'operator',now+1000); assert.equal(s.sos[0].viewedAt,now+1000);
 s=command(s,'sos-dispatch',{id,teamId:team.id},'operator',now+2000);
 assert.equal(s.sos[0].assignedTeam,team.id); assert.equal(s.sos[0].assignedAt,now+2000);
 assert.throws(()=>command(s,'sos-dispatch',{id,teamId:team.id},'operator',now+3000));
 s=command(s,'team-complete',{id:team.id},'operator',now+5000);
 assert.equal(s.sos[0].status,'resolved'); assert.equal(s.sos[0].completedAt,now+5000);
 assert.equal(s.teams.find(x=>x.id===team.id).status,'available');
});
test('individual dispatch is restricted to authenticated operators',async()=>{
 const result=await authorize('sos-dispatch',null,'x'.repeat(32));assert.equal(result.ok,false);
});
