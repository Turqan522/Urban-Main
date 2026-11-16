import type { State, Node, Road } from "./types";
export const DEFAULT_CONFIG = {
  windowSeconds: 300,
  sosThreshold: 5,
  radiusMeters: 500,
  routeLimit: 90,
  alertLimit: 95,
};
export function seed(now = Date.now()): State {
  const names = ["İçərişəhər", "Sahil", "Nəsimi", "Nərimanov"];
  const nodes: Node[] = [];
  const labels = [
    "Qala qapısı",
    "İstiqlaliyyət küçəsi",
    "Fəvvarələr meydanı",
    "Sahil keçidi",
    "Səbail mərkəzi",
    "Nizami küçəsi",
    "28 May keçidi",
    "Nəsimi meydanı",
    "Mərkəzi park",
    "Tibb məntəqəsi",
    "Dədə Qorqud parkı",
    "Gənclik keçidi",
    "Ehtiyat toplanış",
    "Təhlükəsiz keçid",
    "Nərimanov meydanı",
    "Şərq çıxışı",
  ];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++)
      nodes.push({
        id: `n${y * 4 + x}`,
        lat: 40.367 + y * 0.007,
        lng: 49.829 + x * 0.009,
        zone: names[y],
        label: labels[y * 4 + x],
      });
  const roads: Road[] = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const n = y * 4 + x;
      if (x < 3)
        roads.push({
          id: `r${n}-${n + 1}`,
          a: `n${n}`,
          b: `n${n + 1}`,
          name: `${labels[n]} → ${labels[n + 1]}`,
          closed: false,
          congestion: 1,
          accessible: n !== 5,
        });
      if (y < 3)
        roads.push({
          id: `r${n}-${n + 4}`,
          a: `n${n}`,
          b: `n${n + 4}`,
          name: `${labels[n]} → ${labels[n + 4]}`,
          closed: false,
          congestion: 1,
          accessible: n !== 6,
        });
    }
  return {
    safety: {},
    accessibleMode: {},
    checkins: [],
    receipts: {},
    volunteers: [],
    volunteerTasks: [],
    news: [],
    nodes,
    roads,
    shelters: [
      {
        id: "s1",
        accessible: true,
        qrCode: "QR-SHELTER-S1",
        resources: { waterLiters: 4000, waterMax: 5000, foodRations: 1600, foodMax: 2000, medicalKits: 80, medicalMax: 100, batteryPercent: 85, lastSuppliedAt: now },
        name: "Sahil təhlükəsiz toplanış",
        kind: "park",
        node: "n3",
        capacity: 500,
        occupied: 260,
        open: true,
        reserve: false,
      },
      {
        id: "s2",
        accessible: true,
        qrCode: "QR-SHELTER-S2",
        resources: { waterLiters: 1200, waterMax: 5000, foodRations: 300, foodMax: 2000, medicalKits: 45, medicalMax: 100, batteryPercent: 85, lastSuppliedAt: now },
        name: "Mərkəzi park sığınacağı",
        kind: "shelter",
        node: "n8",
        capacity: 800,
        occupied: 544,
        open: true,
        reserve: false,
      },
      {
        id: "s3",
        accessible: false,
        qrCode: "QR-SHELTER-S3",
        resources: { waterLiters: 3200, waterMax: 4000, foodRations: 1000, foodMax: 1500, medicalKits: 50, medicalMax: 100, batteryPercent: 76, lastSuppliedAt: now },
        name: "Gənclik toplanış stansiyası",
        kind: "station",
        node: "n11",
        capacity: 600,
        occupied: 504,
        open: true,
        reserve: false,
      },
      {
        id: "s4",
        accessible: true,
        qrCode: "QR-SHELTER-S4",
        resources: { waterLiters: 4500, waterMax: 6000, foodRations: 2500, foodMax: 3000, medicalKits: 90, medicalMax: 100, batteryPercent: 94, lastSuppliedAt: now },
        name: "Nərimanov təhlükəsiz parkı",
        kind: "park",
        node: "n14",
        capacity: 1000,
        occupied: 310,
        open: true,
        reserve: false,
      },
      {
        id: "s5",
        accessible: true,
        qrCode: "QR-SHELTER-S5",
        resources: { waterLiters: 5000, waterMax: 5000, foodRations: 2000, foodMax: 2000, medicalKits: 100, medicalMax: 100, batteryPercent: 100, lastSuppliedAt: now },
        name: "Ehtiyat toplanış məntəqəsi",
        kind: "shelter",
        node: "n12",
        capacity: 700,
        occupied: 0,
        open: false,
        reserve: true,
      },
    ],
    sos: [],
    teams: [
      {
        id: "t1",
        name: "Briqada Alfa",
        specialty: "Xilasetmə",
        node: "n5",
        status: "available",
      },
      {
        id: "t2",
        name: "Briqada Bravo",
        specialty: "Tibbi yardım",
        node: "n9",
        status: "available",
      },
      {
        id: "t3",
        name: "Briqada Delta",
        specialty: "Yanğın / xilasetmə",
        node: "n15",
        status: "available",
      },
    ],
    audit: [
      {
        id: crypto.randomUUID(),
        at: now,
        action: "START",
        detail:
          "Simulyasiya başladıldı. Məlumatlar real fövqəladə hal məlumatı deyil.",
      },
    ],
    decisions: [],
    config: { ...DEFAULT_CONFIG },
    revision: 0,
    updatedAt: now,
    scenario: "Normal vəziyyət",
  };
}
