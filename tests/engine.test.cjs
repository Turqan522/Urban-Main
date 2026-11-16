const { test } = require("node:test");
const assert = require("node:assert/strict");
const { seed } = require("../outputs/test-build/crisis/seed.js");
const {
  routes,
  alerts,
  distance,
  publicState,
  shortestPath,
} = require("../outputs/test-build/crisis/engine.js");
const { command, coordinates } = require("../outputs/test-build/crisis/commands.js");
const NOW = 1800000000000;
const fresh = () => seed(NOW);
function reports(n = 5) {
  const s = fresh();
  for (let i = 0; i < n; i++)
    s.sos.push({
      id: "sos" + i,
      citizenId: "c" + i,
      lat: 40.374,
      lng: 49.838,
      zone: "Sahil",
      type: "medical",
      createdAt: NOW,
      status: "active",
    });
  return s;
}
const cluster = (s) => alerts(s, NOW).filter((a) => a.kind === "cluster");
test("4 unique SOS do not create a hotspot", () =>
  assert.equal(cluster(reports(4)).length, 0));
test("5 unique SOS create one hotspot", () =>
  assert.equal(cluster(reports()).length, 1));
test("duplicate citizen identity counts only once", () => {
  const s = reports();
  s.sos[4].citizenId = "c0";
  assert.equal(cluster(s).length, 0);
});
test("exactly five minutes is included", () => {
  const s = reports();
  s.sos[0].createdAt = NOW - 300000;
  assert.equal(cluster(s).length, 1);
});
test("older than five minutes is excluded", () => {
  const s = reports();
  s.sos[0].createdAt = NOW - 300001;
  assert.equal(cluster(s).length, 0);
});
test("future report cannot influence current alert", () => {
  const s = reports();
  s.sos[0].createdAt = NOW + 1;
  assert.equal(cluster(s).length, 0);
});
test("safe and resolved reports are excluded", () => {
  const s = reports();
  s.sos[0].status = "safe";
  assert.equal(cluster(s).length, 0);
  s.sos[0].status = "resolved";
  assert.equal(cluster(s).length, 0);
});
test("radius grouping works across zone boundaries", () => {
  const s = reports();
  s.sos.forEach((x, i) => {
    x.zone = "zone" + i;
    x.lat += i * 0.0001;
  });
  assert.equal(cluster(s).length, 1);
});
test("same zone works even outside radius", () => {
  const s = reports();
  s.sos.forEach((x, i) => (x.lng += i * 0.02));
  assert.equal(cluster(s).length, 1);
});
test("separate zones outside radius do not cluster", () => {
  const s = reports();
  s.sos.forEach((x, i) => {
    x.zone = "zone" + i;
    x.lng += i * 0.02;
  });
  assert.equal(cluster(s).length, 0);
});
test("exactly 500m is included within floating tolerance", () => {
  const s = reports();
  s.config.radiusMeters = 500;
  s.sos.forEach((x, i) => {
    x.zone = "zone" + i;
    x.lat = 40.374 + (i ? ((499.999 / 6371000) * 180) / Math.PI : 0);
  });
  assert.equal(cluster(s).length, 1);
});
test("chain-connected points cannot form a false 500m cluster", () => {
  const s = reports();
  s.sos.forEach((x, i) => {
    x.zone = "z" + i;
    x.lng += i * 0.005;
  });
  assert.equal(cluster(s).length, 0);
});
test("95 percent capacity is not critical, above 95 is", () => {
  let s = fresh();
  s.shelters[0].occupied = 475;
  assert.equal(alerts(s, NOW).length, 0);
  s.shelters[0].occupied = 476;
  assert.equal(alerts(s, NOW)[0].kind, "capacity");
});
test("90 percent shelter is excluded from evacuation routes", () => {
  const s = fresh();
  s.shelters[0].occupied = 450;
  assert.ok(!routes(s, s.nodes[0]).some((r) => r.shelter.id === "s1"));
  s.shelters[0].occupied = 449;
  assert.ok(routes(s, s.nodes[0]).some((r) => r.shelter.id === "s1"));
});
test("closed reserve shelter is not recommended", () =>
  assert.ok(
    !routes(fresh(), fresh().nodes[0]).some((r) => r.shelter.id === "s5"),
  ));
test("blocking selected edge produces a genuinely different path", () => {
  const s = fresh();
  const before = routes(s, s.nodes[5])[0];
  assert.ok(before.roadIds.length);
  const edge = before.roadIds[0];
  s.roads.find((r) => r.id === edge).closed = true;
  const after = routes(s, s.nodes[5])[0];
  assert.ok(after);
  assert.ok(!after.roadIds.includes(edge));
  assert.notDeepEqual(after.roadIds, before.roadIds);
});
test("all roads blocked produces no route from unhosted node", () => {
  const s = fresh();
  s.roads.forEach((r) => (r.closed = true));
  assert.equal(routes(s, s.nodes[5]).length, 0);
});
test("origin equal to shelter produces zero-edge valid route", () => {
  const s = fresh();
  assert.equal(routes(s, s.nodes[3])[0].roadIds.length, 0);
});
test("all shelters full produces an empty route list", () => {
  const s = fresh();
  s.shelters.forEach((sh) => (sh.occupied = sh.capacity));
  assert.equal(routes(s, s.nodes[0]).length, 0);
});
test("SOS retry creates one active report", () => {
  let s = command(
    fresh(),
    "sos",
    { type: "fire", lat: 40.374, lng: 49.838 },
    "c1",
    NOW,
  );
  s = command(
    s,
    "sos",
    { type: "fire", lat: 40.374, lng: 49.838 },
    "c1",
    NOW + 1,
  );
  assert.equal(s.sos.length, 1);
  assert.equal(s.revision, 1);
});
test("safe status can only close the callers own SOS", () => {
  let s = reports();
  s = command(s, "safe", {}, "c0", NOW);
  assert.equal(s.sos[0].status, "safe");
  assert.equal(s.sos[1].status, "active");
});
test("confirmation dispatches exactly one team and is retry-safe", () => {
  const s = reports(),
    a = cluster(s)[0];
  const next = command(s, "confirm", { id: a.id }, "operator", NOW);
  assert.equal(next.teams.filter((t) => t.status === "dispatched").length, 1);
  const retry = command(next, "confirm", { id: a.id }, "operator", NOW);
  assert.equal(retry.teams.filter((t) => t.status === "dispatched").length, 1);
  assert.equal(retry.revision, next.revision);
});
test("completing team resolves assigned reports and releases team", () => {
  const s = reports(),
    a = cluster(s)[0];
  const next = command(s, "confirm", { id: a.id }, "op", NOW);
  const team = next.teams.find((t) => t.status === "dispatched");
  const done = command(next, "team-complete", { id: team.id }, "op", NOW);
  assert.equal(done.sos.filter((x) => x.status === "active").length, 0);
  assert.equal(done.teams.find((x) => x.id === team.id).status, "available");
});
test("no available team prevents false confirmation", () => {
  const s = reports();
  s.teams.forEach((t) => (t.status = "dispatched"));
  assert.throws(
    () => command(s, "confirm", { id: cluster(s)[0].id }, "op", NOW),
    /briqada yoxdur/,
  );
});
test("unreachable teams cannot be dispatched", () => {
  const s = reports();
  s.teams.forEach((t) => (t.node = "n15"));
  s.roads.forEach((r) => (r.closed = true));
  assert.throws(
    () => command(s, "confirm", { id: cluster(s)[0].id }, "op", NOW),
    /briqada yoxdur/,
  );
});
test("capacity confirmation opens actual reserve shelter", () => {
  const s = fresh();
  s.shelters[0].occupied = 485;
  const a = alerts(s, NOW)[0];
  const after = command(s, "confirm", { id: a.id }, "op", NOW);
  assert.equal(after.shelters.find((x) => x.id === "s5").open, true);
  assert.equal(after.decisions[0].shelterId, "s5");
});
test("no reserve shelter prevents false opening", () => {
  const s = fresh();
  s.shelters[0].occupied = 485;
  s.shelters[4].open = true;
  assert.throws(
    () => command(s, "confirm", { id: alerts(s, NOW)[0].id }, "op", NOW),
    /ehtiyat məntəqə yoxdur/,
  );
});
test("stale alert cannot be confirmed after window expires", () => {
  const s = reports();
  assert.throws(
    () => command(s, "confirm", { id: cluster(s)[0].id }, "op", NOW + 300001),
    /aktiv deyil/,
  );
});
test("capacity input rejects overflow, negative and noninteger", () => {
  for (const n of [-1, 501, 2.5])
    assert.throws(() =>
      command(fresh(), "occupancy", { id: "s1", occupied: n }, "op", NOW),
    );
});
test("coordinate validation rejects invalid, infinite and out-of-area values", () => {
  for (const lat of [null, NaN, Infinity, 41, "40.37"])
    assert.throws(() => coordinates({ lat, lng: 49.838 }));
  assert.deepEqual(coordinates({ lat: 40.374, lng: 49.838 }), {
    lat: 40.374,
    lng: 49.838,
  });
});
test("challenge config changes threshold immediately", () => {
  const s = command(reports(3), "config", { sosThreshold: 3 }, "op", NOW);
  assert.equal(cluster(s).length, 1);
});
test("config rejects unknown keys and inverted thresholds", () => {
  assert.throws(() => command(fresh(), "config", { fake: 5 }, "op", NOW));
  assert.throws(() =>
    command(fresh(), "config", { routeLimit: 95, alertLimit: 90 }, "op", NOW),
  );
});
test("public response removes private citizen identity", () => {
  const s = publicState(reports(), "c0", NOW);
  assert.equal(s.sos[0].mine, true);
  assert.equal(s.sos[1].mine, false);
  assert.equal("citizenId" in s.sos[0], false);
});
test("reset removes demo events but preserves monotonic revision", () => {
  let s = command(fresh(), "scenario", { name: "cluster" }, "op", NOW);
  s = command(s, "scenario", { name: "reset" }, "op", NOW);
  assert.equal(s.sos.length, 0);
  assert.equal(s.revision, 2);
});
test("distance is geographic meters and symmetric", () => {
  const a = { lat: 40, lng: 49 },
    b = { lat: 40.001, lng: 49 };
  assert.ok(distance(a, b) > 110 && distance(a, b) < 112);
  assert.equal(distance(a, b), distance(b, a));
  assert.equal(distance(a, a), 0);
});
test("new SOS in an acknowledged zone joins the existing team without alert duplication", () => {
  let s = reports();
  const id = cluster(s)[0].id;
  s = command(s, "confirm", { id }, "op", NOW);
  s = command(
    s,
    "sos",
    { lat: 40.374, lng: 49.838, type: "fire" },
    "new",
    NOW + 1,
  );
  assert.equal(cluster(s)[0].id, id);
  assert.equal(s.decisions.length, 1);
  assert.ok(s.sos.find((x) => x.citizenId === "new").assignedTeam);
  assert.equal(s.teams.filter((t) => t.status === "dispatched").length, 1);
});
test("safe status is durable even without an earlier SOS", () => {
  const s = command(fresh(), "safe", {}, "new", NOW);
  assert.equal(publicState(s, "new", NOW).mySafety.status, "safe");
  assert.equal(publicState(s, "other", NOW).mySafety, null);
});
