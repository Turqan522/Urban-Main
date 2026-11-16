const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
function worker() {
  const events = {}, cache = new Map(), stores = new Map(), removed = [], added = [];
  const key = request => typeof request === "string" ? request : request.url;
  const bucket = { addAll: async urls => { added.push(...urls); }, add: async url => { added.push(url); }, put: async (request,response) => cache.set(key(request),response), match: async request => cache.get(key(request)) };
  stores.set("urban-crisis-shell-v1",{}); stores.set("unrelated-cache",{});
  const context = { URL, Response, Promise, self: { location:{origin:"https://crisis.test"}, addEventListener:(name,fn)=>events[name]=fn, skipWaiting:async()=>{}, clients:{claim:async()=>{}} }, caches: { open:async name=>{stores.set(name,bucket);return bucket;}, keys:async()=>[...stores.keys()], delete:async name=>{removed.push(name);stores.delete(name);}, match:bucket.match }, fetch:async()=>new Response("network") };
  vm.runInNewContext(readFileSync("public/sw.js","utf8"),context);
  return { events, context, cache, added, removed };
}
test("PWA installs the offline shell and deletes only its own obsolete caches",async()=>{
  const w=worker();let pending;w.events.install({waitUntil:p=>pending=p});await pending;
  assert.ok(w.added.includes("/"));assert.ok(w.added.includes("/manifest.json"));
  w.events.activate({waitUntil:p=>pending=p});await pending;
  assert.deepEqual(w.removed,["urban-crisis-shell-v1"]);
});
test("service worker never intercepts API requests or mutation bodies",()=>{
  const w=worker();
  for(const [url,method] of [["https://crisis.test/api/state","GET"],["https://crisis.test/api/sos","POST"],["https://other.test/asset.js","GET"]]) {
    w.events.fetch({request:{url,method,headers:new Headers(),mode:"cors",destination:"script"},respondWith:()=>assert.fail("must not intercept")});
  }
});
test("offline navigation returns saved application HTML",async()=>{
  const w=worker();w.cache.set("/",new Response("saved app shell"));w.context.fetch=async()=>{throw Error("offline");};let response;
  w.events.fetch({request:{url:"https://crisis.test/",method:"GET",headers:new Headers(),mode:"navigate"},respondWith:p=>response=p});
  assert.equal(await (await response).text(),"saved app shell");
});
test("previously cached static assets remain available without network",async()=>{
  const w=worker(),url="https://crisis.test/_next/static/app.js";w.cache.set(url,new Response("cached script"));w.context.fetch=async()=>assert.fail("cached assets should not require network");let response;
  w.events.fetch({request:{url,method:"GET",headers:new Headers(),mode:"cors",destination:"script"},respondWith:p=>response=p});
  assert.equal(await (await response).text(),"cached script");
});
test("asset warmup refuses API URLs and foreign origins",async()=>{
  const w=worker();let pending;
  w.events.message({data:{type:"CACHE_ASSETS",urls:["https://crisis.test/_next/static/app.js","https://crisis.test/api/state","https://other.test/style.css"]},waitUntil:p=>pending=p});await pending;
  assert.deepEqual(w.added,["https://crisis.test/_next/static/app.js"]);
});
test("manifest has installable local PNG icons with matching dimensions",()=>{
  const manifest=JSON.parse(readFileSync("public/manifest.json","utf8"));assert.equal(manifest.display,"standalone");
  for(const size of [192,512]){const icon=manifest.icons.find(x=>x.sizes===`${size}x${size}`);assert.ok(icon);const png=readFileSync(`public${icon.src}`);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
});
