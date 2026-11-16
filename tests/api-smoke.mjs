import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw new Error("This destructive demo test runs only on local development.");
let count = 0;
let authToken = "";
async function call(path, { cookie = "", body, raw, origin, retry = false } = {}) {
  const r = await fetch(base + "/api/" + path, {
    signal: AbortSignal.timeout(15000),
    method: body !== undefined || raw !== undefined ? "POST" : "GET",
    headers: {
      ...(body !== undefined || raw !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const responseText = await r.text();
  if (path === "not-real" && !retry && r.status === 503 && responseText.startsWith("Your worker restarted mid-request"))
    return call(path, { cookie, body, raw, origin, retry: true });
  return {
    r,
    data: JSON.parse(responseText),
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}
function ok(condition, message) {
  assert.ok(condition, message);
  count++;
  console.log("PASS", message);
}
const root = await call("state");
const cookie = root.cookie;
authToken = (await call("auth/login", { cookie, body: { username: "operator", password: process.env.CRISIS_OPERATOR_PASSWORD || "crisis2026" } })).data.token;
if (!authToken) throw new Error("Operator login failed");
try {
ok(!!cookie, "server issues citizen cookie");
await call("scenario", { cookie, body: { name: "reset" } });
const req = { cookie, body: { lat: 40.374, lng: 49.838, type: "medical" } };
const repeated = await Promise.all(
  Array.from({ length: 4 }, () => call("sos", req)),
);
ok(
  repeated.every((x) => x.r.ok),
  "concurrent duplicate SOS requests succeed safely",
);
let state = (await call("state", { cookie })).data;
ok(
  state.sos.length === 1,
  "CAS preserves exactly one active report per citizen",
);
ok(
  state.sos[0].mine === true && !("citizenId" in state.sos[0]),
  "public state hides citizen identity",
);
await call("safe", { cookie, body: {} });
state = (await call("state", { cookie })).data;
ok(
  state.mySafety.status === "safe" && state.sos[0].status === "safe",
  "safe status is persisted",
);
const people = await Promise.all(
  Array.from({ length: 10 }, () => call("state")),
);
const batch = await Promise.all(
  people.map((p) =>
    call("sos", {
      cookie: p.cookie,
      body: { lat: 40.374, lng: 49.838, type: "fire" },
    }),
  ),
);
ok(
  batch.every((x) => x.r.ok),
  "ten concurrent distinct citizens accepted",
);
state = (await call("state", { cookie })).data;
ok(
  state.sos.filter((x) => x.status === "active").length === 10,
  "no concurrent updates were lost",
);
ok(
  state.alerts.filter((x) => x.kind === "cluster").length === 1,
  "ten citizens create one critical alert",
);
const alert = state.alerts.find((x) => x.kind === "cluster");
await Promise.all([
  call("confirm", { cookie, body: { id: alert.id } }),
  call("confirm", { cookie, body: { id: alert.id } }),
]);
state = (await call("state", { cookie })).data;
ok(
  state.teams.filter((x) => x.status === "dispatched").length === 1,
  "concurrent confirmation dispatches only one team",
);
const newer = await call("state");
await call("sos", {
  cookie: newer.cookie,
  body: { lat: 40.374, lng: 49.838, type: "medical" },
});
state = (await call("state", { cookie })).data;
ok(
  state.alerts.find((a) => a.kind === "cluster").decision &&
    state.sos.filter((x) => x.status === "active").every((x) => x.assignedTeam),
  "new SOS joins acknowledged active incident",
);
ok(state.teams.find(x => x.status === "dispatched").etaMinutes > 0, "dispatch records a positive ETA");
ok(state.shelters.find(x => x.id === "s5").open, "cluster confirmation also opens a reserve");
await call("scenario", { cookie, body: { name: "reset" } });
await call("accessibility", { cookie, body: { enabled: true } });
const priority = await call("sos", { cookie, body: { ...req.body, requestId: "api-priority-sos" } });
ok(priority.data.sos.find(x => x.mine).priority === 1, "accessible citizen SOS receives priority one");
const accessible = (await call("routes?lat=40.374&lng=49.838", { cookie })).data.routes;
ok(accessible.length <= 3 && accessible.every(r => r.shelter.accessible && r.roadIds.every(id => priority.data.roads.find(x => x.id === id).accessible)), "routes API honours session accessibility and returns at most three routes");
const checkins = await Promise.all(Array.from({ length: 10 }, () => call("checkin", { cookie, body: { qrCode: "QR-SHELTER-S1" } })));
ok(checkins.every(x => x.r.ok) && checkins.filter(x => x.data.alreadyCheckedIn).length === 9, "ten QR requests return nine idempotent acknowledgements");
state = (await call("state", { cookie })).data;
ok(state.shelters[0].occupied === 261 && state.sos.find(x => x.mine).status === "safe", "check-in increments once and closes citizen SOS");
const duplicateElsewhere = await call("checkin", { cookie, body: { shelterId: "s2" } });
ok(duplicateElsewhere.data.alreadyCheckedIn && duplicateElsewhere.data.shelters[1].occupied === 544, "a second shelter cannot count the same citizen again");
await call("sos", { cookie, body: { ...req.body, requestId: "api-priority-sos" } });
state = (await call("state", { cookie })).data;
ok(!state.sos.some(x => x.mine && x.status === "active"), "delayed SOS delivery cannot reopen a checked-in report");
ok((await call("sos", { cookie, body: { ...req.body, sessionId: "expired-session" } })).r.status === 400, "expired-session queue rejected");
await call("scenario", { cookie, body: { name: "reset" } });
const before = (await call("routes?lat=40.367&lng=49.847", { cookie })).data
  .routes[0];
ok(before.shelter.id === "s1", "nearest reachable shelter recommended");
await call("occupancy", { cookie, body: { id: "s1", occupied: 475 } });
state = (await call("state", { cookie })).data;
ok(
  !state.alerts.some((x) => x.kind === "capacity"),
  "exact 95% does not create critical capacity alert",
);
await call("occupancy", { cookie, body: { id: "s1", occupied: 485 } });
state = (await call("state", { cookie })).data;
const capacity = state.alerts.find((x) => x.kind === "capacity");
ok(!!capacity, "97% creates critical capacity alert");
const after = (await call("routes?lat=40.367&lng=49.847", { cookie })).data
  .routes[0];
ok(after.shelter.id !== "s1", "full shelter is excluded from routes");
await call("confirm", { cookie, body: { id: capacity.id } });
state = (await call("state", { cookie })).data;
ok(
  state.shelters.find((x) => x.id === "s5").open,
  "confirmation durably opens reserve shelter",
);
const road = after.roadIds[0];
await call("road", { cookie, body: { id: road, closed: true } });
const reroute = (await call("routes?lat=40.367&lng=49.847", { cookie })).data
  .routes;
ok(
  reroute.every((x) => !x.roadIds.includes(road)),
  "closed road is absent from every returned route",
);
ok(
  (await call("occupancy", { cookie, body: { id: "s1", occupied: 501 } })).r
    .status === 400,
  "capacity overflow rejected",
);
ok(
  (await call("sos", { cookie, body: { lat: 0, lng: 0, type: "fire" } })).r
    .status === 400,
  "out of bounds coordinates rejected",
);
ok(
  (await call("safe", { cookie, raw: "{bad" })).r.status === 400,
  "malformed JSON rejected",
);
ok(
  (
    await call("safe", {
      cookie,
      body: {},
      origin: "https://untrusted.invalid",
    })
  ).r.status === 403,
  "cross-origin mutation rejected",
);
ok(
  (await call("not-real", { cookie, body: {} })).r.status === 404,
  "unknown endpoint rejected",
);
console.log(
  `\n${count} API integration assertions passed.`,
);
} finally {
  await call("scenario", { cookie, body: { name: "reset" } });
  console.log("Demo reset to initial state.");
}
