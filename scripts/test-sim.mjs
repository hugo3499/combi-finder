// Simulation hors ligne des trois robots : fausses réponses réseau, vraies fonctions.
// node scripts/test-sim.mjs   (n'est pas utilisé par GitHub)
import { rmSync, existsSync } from "node:fs";
const TEAMS = { F1: ["Paris SG", "Marseille", "Lyon", "Monaco", "Lille", "Lens", "Nice", "Rennes", "Strasbourg", "Brest", "Toulouse", "Nantes", "Auxerre", "Angers", "Le Havre", "Montpellier", "St Etienne", "Reims"],
  E0: ["Arsenal", "Man City", "Liverpool", "Chelsea", "Tottenham", "Aston Villa", "Newcastle", "Brighton", "Fulham", "Brentford", "West Ham", "Bournemouth", "Nott'm Forest", "Crystal Palace", "Everton", "Wolves", "Leicester", "Ipswich", "Southampton", "Man United"] };
const ODDS_NAME = { "Paris SG": "Paris Saint Germain", "Man City": "Manchester City", "Man United": "Manchester United", "Nott'm Forest": "Nottingham Forest", "St Etienne": "Saint-Étienne", "Wolves": "Wolverhampton Wanderers" };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = l => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const strength = {}; for (const d of Object.keys(TEAMS)) TEAMS[d].forEach((t, i) => strength[t] = { att: 0.35 - i * 0.04, def: 0.3 - i * 0.035 });
const fmt = d => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const devigInv = (ps, margin = 1.03) => ps.map(p => +(1 / (p * margin)).toFixed(2));
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const Model = require("../model.js");
function csvFor(div, seasonStartYear, untilDate) {
  const teams = TEAMS[div]; const rows = ["Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,PSCH,PSCD,PSCA,PC>2.5,PC<2.5"];
  let d = new Date(Date.UTC(seasonStartYear, 7, 10));
  for (let r = 0; r < 34; r++) {
    for (let i = 0; i < teams.length / 2; i++) {
      const h = teams[(r + i) % teams.length], a = teams[(r + teams.length - 1 - i) % teams.length]; if (h === a) continue;
      if (d > untilDate) break;
      const lh = Math.exp(0.25 + strength[h].att - strength[a].def), la = Math.exp(strength[a].att - strength[h].def);
      const m = Model.matrixFor(lh, la); const pH = Model.sum(m, (x, y) => x > y), pD = Model.sum(m, (x, y) => x === y), pA = 1 - pH - pD, pO = Model.sum(m, (x, y) => x + y > 2.5);
      const [oh, od, oa] = devigInv([pH, pD, pA]), [oo, ou] = devigInv([pO, 1 - pO], 1.02);
      const hg = pois(lh), ag = pois(la);
      rows.push(`${div},${fmt(d)},20:00,${h},${a},${hg},${ag},${hg > ag ? "H" : hg < ag ? "A" : "D"},${oh},${od},${oa},${oo},${ou}`);
    }
    d = new Date(d.getTime() + 7 * 864e5);
  }
  return rows.join("\n");
}
let NOW = new Date("2026-03-07T08:00:00Z");
const fixtures = [];   // matchs à venir pour l'Odds API
for (const [div, sk] of [["F1", "soccer_france_ligue_one"], ["E0", "soccer_epl"]]) {
  const teams = TEAMS[div];
  for (let i = 0; i < 4; i++) { const h = teams[i * 2], a = teams[i * 2 + 1];
    const lh = Math.exp(0.25 + strength[h].att - strength[a].def), la = Math.exp(strength[a].att - strength[h].def);
    const m = Model.matrixFor(lh, la); const pH = Model.sum(m, (x, y) => x > y), pD = Model.sum(m, (x, y) => x === y), pO = Model.sum(m, (x, y) => x + y > 2.5);
    const [oh, od, oa] = devigInv([pH, pD, 1 - pH - pD]), [oo, ou] = devigInv([pO, 1 - pO], 1.02);
    const H = ODDS_NAME[h] || h, A = ODDS_NAME[a] || a;
    fixtures.push({ id: `ev${div}${i}`, sport_key: sk, sport_title: sk, home_team: H, away_team: A, commence_time: new Date(NOW.getTime() + (8 + i * 6) * 3600e3).toISOString(),
      bookmakers: [{ key: "pinnacle", markets: [{ key: "h2h", outcomes: [{ name: H, price: oh }, { name: "Draw", price: od }, { name: A, price: oa }] }, { key: "totals", outcomes: [{ name: "Over", price: oo, point: 2.5 }, { name: "Under", price: ou, point: 2.5 }] }] },
        { key: "betclic_fr", markets: [{ key: "h2h", outcomes: [{ name: H, price: +(oh * 0.97).toFixed(2) }, { name: "Draw", price: +(od * 0.96).toFixed(2) }, { name: A, price: +(oa * 0.96).toFixed(2) }] }, { key: "totals", outcomes: [{ name: "Over", price: +(oo * 0.97).toFixed(2), point: 2.5 }, { name: "Under", price: +(ou * 0.97).toFixed(2), point: 2.5 }] }] }], _div: div, _h: h, _a: a });
  }
}
let phase = "paper";
globalThis.fetch = async (url) => {
  const u = String(url);
  const ok = (body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "x-requests-remaining": "444", ...headers } });
  if (u.includes("football-data.co.uk")) {
    const [, season, div] = u.match(/mmz4281\/(\d{4})\/(\w+)\.csv/); const y = 2000 + +season.slice(0, 2);
    const until = phase === "results" ? new Date(NOW.getTime() + 3 * 864e5) : NOW;   // après règlement : les matchs du week-end sont joués
    const text = csvFor(div, y, until);
    if (phase === "results" && process.env.SIM_SLOW_CSV) return ok(text);
    if (phase === "results") {   // ajoute les résultats des matchs papier avec clôture
      const extra = fixtures.filter(f => f._div === div).map(f => { const lh = Math.exp(0.25 + strength[f._h].att - strength[f._a].def), la = Math.exp(strength[f._a].att - strength[f._h].def); const hg = pois(lh), ag = pois(la); const pin = f.bookmakers[0].markets; return `${div},${fmt(new Date(f.commence_time))},20:00,${f._h},${f._a},${hg},${ag},${hg > ag ? "H" : hg < ag ? "A" : "D"},${pin[0].outcomes[0].price},${pin[0].outcomes[1].price},${pin[0].outcomes[2].price},${pin[1].outcomes[0].price},${pin[1].outcomes[1].price}`; });
      return ok(text + "\n" + extra.join("\n"));
    }
    return ok(text);
  }
  if (u.includes("api.the-odds-api.com") && u.includes("/events?")) { const sk = u.match(/sports\/([^/]+)\/events/)?.[1]; return ok(fixtures.filter(f => f.sport_key === sk).map(f => ({ id: f.id, commence_time: f.commence_time }))); }
  if (u.includes("api.the-odds-api.com")) { const sk = u.match(/sports\/([^/]+)\/odds/)?.[1]; return ok(fixtures.filter(f => f.sport_key === sk)); }
  if (u.includes("api.football-data.org")) {
    if (phase === "results" && u.includes("FINISHED")) { const code = u.match(/competitions\/(\w+)\//)[1]; const div = { FL1: "F1", PL: "E0" }[code];
      return ok({ matches: fixtures.filter(f => f._div === div).map(f => ({ utcDate: f.commence_time, homeTeam: { name: f._h + " FC" }, awayTeam: { name: f._a }, score: { fullTime: { home: 1, away: 0 } } })) }); }
    return ok({ matches: [] }); }
  throw new Error("URL inattendue " + u);
};
const realDate = Date; globalThis.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW.getTime(); } };
process.env.ODDS_API_KEY = "x"; process.env.FOOTBALL_DATA_KEY = "y"; process.env.PAPER_LEAGUES = "soccer_france_ligue_one,soccer_epl"; process.env.MODEL_LEAGUES = "soccer_france_ligue_one,soccer_epl";
for (const f of ["data/paper", "data/paper.json", "data/results.json", "data/model.json", "data/latest.json"]) if (existsSync(f)) rmSync(f, { recursive: true });
console.log("=== model ==="); await import("./model.mjs");
console.log("=== paper ==="); await import("./paper.mjs");
phase = "results"; NOW = new realDate(NOW.getTime() + 3 * 864e5);
process.env.SIM_SLOW_CSV = "1"; console.log("=== results (CSV pas encore à jour) ==="); await import("./results.mjs?slow");
delete process.env.SIM_SLOW_CSV; console.log("=== results (CSV arrivé) ==="); await import("./results.mjs?full");
const paper = JSON.parse((await import("node:fs")).readFileSync("data/paper.json", "utf8"));
console.log("profils :", Object.values(paper.profiles).map(p => `${p.name} ${p.won}/${p.settled} roi ${p.roi == null ? "-" : (p.roi * 100).toFixed(0) + "%"} clv ${p.clv_avg == null ? "-" : (p.clv_avg * 100).toFixed(1) + "%"}`).join(" | "));
console.log("clv global :", paper.clv, "logloss :", paper.logloss, "marchés :", Object.keys(paper.byMarket));
const model = JSON.parse((await import("node:fs")).readFileSync("data/model.json", "utf8"));
console.log("modèle :", model.verdict, model.backtest.ll);
console.log("PSG estimé :", model.leagues.soccer_france_ligue_one.teams["Paris SG"], "réel", strength["Paris SG"]);
