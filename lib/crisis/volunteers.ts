import type { Point, State, Sos, Volunteer } from "./types";
import { distance, nearestNode, shortestPath } from "./engine";
export function matchingVolunteers(s: State, sos: Pick<Sos,"status"|"type"|"lat"|"lng">) {
  if (sos.status !== "active" || sos.type !== "medical" || s.teams.some(t => t.status === "available")) return [];
  return s.volunteers.filter(v => v.verified && v.available && v.status === "idle" && v.skills.some(skill => skill === "first_aid" || skill === "paramedic") && distance(v.location,sos) <= 1000)
    .flatMap(volunteer => { const path = shortestPath(s,nearestNode(s,volunteer.location).id,nearestNode(s,sos).id,true); return path ? [{ volunteer, meters: Math.round(distance(volunteer.location,sos)), routePath: path.nodeIds }] : []; })
    .sort((a,b) => a.meters-b.meters);
}
export function volunteerRoute(s: State, volunteer: Volunteer, incident: Point) {
  return shortestPath(s,nearestNode(s,volunteer.location).id,nearestNode(s,incident).id,true);
}
