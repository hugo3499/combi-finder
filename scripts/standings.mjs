// Récupère les classements sur football-data.org et écrit data/standings.json
// Clé : variable d'environnement FOOTBALL_DATA_KEY (secret GitHub)
import { writeFileSync, mkdirSync } from "node:fs";
const KEY = process.env.FOOTBALL_DATA_KEY;
if (!KEY) { console.error("FOOTBALL_DATA_KEY manquante"); process.exit(1); }
const CODES = ["PL", "PD", "SA", "BL1", "FL1", "CL", "PPL", "DED"];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { updated: new Date().toISOString(), competitions: {} };
for (const code of CODES) {
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings`, { headers: { "X-Auth-Token": KEY } });
    if (!r.ok) { console.error(code, r.status, await r.text()); await sleep(7000); continue; }
    const d = await r.json();
    const total = d.season?.currentMatchday && d.competition?.code === "CL" ? 8 : null;
    const st = (d.standings || []).find(s => s.type === "TOTAL") || d.standings?.[0];
    const table = (st?.table || []).map(row => ({ position: row.position, team: row.team?.name, short: row.team?.shortName, tla: row.team?.tla, played: row.playedGames, points: row.points, gd: row.goalDifference }));
    const n = table.length;
    out.competitions[code] = { name: d.competition?.name, matchday: d.season?.currentMatchday, totalMatchdays: total ?? (n - 1) * 2, table };
    console.log(code, table.length, "équipes");
  } catch (e) { console.error(code, e.message); }
  await sleep(7000); // 10 requêtes / minute max sur l'offre gratuite
}
mkdirSync("data", { recursive: true });
writeFileSync("data/standings.json", JSON.stringify(out));
console.log("écrit data/standings.json");
