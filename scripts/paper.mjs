// Robot « test papier » : chaque jour de match, relève les cotes et enregistre
// les tickets des 4 profils + toutes les sélections, sans rien jouer.
// Secrets : ODDS_API_KEY (obligatoire), FOOTBALL_DATA_KEY (facultatif : évite
// de dépenser des crédits les jours sans match).
import { Engine, Model, oddsApi, fdOrg, readJson, writeJson, log, sleep, FD_CODE } from "./lib.mjs";

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("ODDS_API_KEY manquante (Settings → Secrets → Actions)"); process.exit(1); }
const FD = process.env.FOOTBALL_DATA_KEY || "";
const HORIZON_H = +(process.env.PAPER_HORIZON_H || 36);
const BOOKS = (process.env.PAPER_BOOKS || "betclic_fr").split(",");
const LEAGUES = (process.env.PAPER_LEAGUES || Engine.DEFAULTS.championnats.join(",")).split(",");
const BANKROLL = 100, STAKE_PCT = 0.02, TOP = 5;

const now = new Date(), until = new Date(now.getTime() + HORIZON_H * 3600e3);
const today = now.toISOString().slice(0, 10);
const index = readJson("data/paper/index.json", { days: [], seen: {} });
const model = readJson("data/model.json", null);
const weight = model && model.weight > 0 ? model.weight : 0;

/* 1. y a-t-il des matchs dans l'horizon ? (gratuit avec football-data.org) */
if (FD) {
  try {
    const codes = LEAGUES.map(l => FD_CODE[l]).filter(Boolean).join(",");
    const d = await fdOrg(`/matches?competitions=${codes}&dateFrom=${today}&dateTo=${until.toISOString().slice(0, 10)}`, FD);
    const n = (d?.matches || []).filter(m => Date.parse(m.utcDate) > now && Date.parse(m.utcDate) <= until && m.status !== "FINISHED").length;
    log(`football-data.org : ${n} matchs dans les ${HORIZON_H} h`);
    if (!n) { log("Aucun match : pas de relevé aujourd'hui, 0 crédit dépensé."); process.exit(0); }
  } catch (e) { log("football-data.org indisponible, on relève quand même :", e.message); }
}

/* 2. relevé des cotes */
const events = []; let remaining = null;
for (const sp of LEAGUES) {
  try {
    const { data, remaining: r } = await oddsApi(`/sports/${sp}/odds/?bookmakers=${["pinnacle", ...BOOKS].join(",")}&markets=h2h,totals&oddsFormat=decimal`, KEY);
    remaining = r;
    const inWin = data.filter(e => Date.parse(e.commence_time) > now && Date.parse(e.commence_time) <= until && !index.seen[e.id]);
    events.push(...inWin);
    log(`${sp} : ${data.length} matchs, ${inWin.length} nouveaux dans l'horizon (crédits restants ${r})`);
    await sleep(400);
  } catch (e) { log(`[!] ${sp} : ${e.message}`); if (/401/.test(e.message)) process.exit(1); }
}
if (!events.length) { log("Aucun nouveau match dans l'horizon."); process.exit(0); }

/* 3. sélections (probas marché + mélange modèle) et tickets par profil */
const baseCfg = { ...Engine.DEFAULTS, mes_bookmakers: BOOKS, marches: { "1N2": true, plus_moins_2_5: true, les_deux_marquent: false, extras: false }, classement: "mixte", paris_lies: true, nombre_de_combis_affiches: TOP, bankroll: BANKROLL, mise_fixe_pct: STAKE_PCT };
const market = Engine.analyse(events, baseCfg, {});                       // marché seul
const blend = weight ? Engine.analyse(events, baseCfg, { model, weight }) : market;
const pm = Object.fromEntries(market.selections.map(s => [s.id, s.prob]));
const selections = blend.selections.map(s => ({ ...s, prob_market: pm[s.id] ?? s.prob, prob_model: weight ? s.prob : null }));
const bySel = Object.fromEntries(selections.map(s => [s.id, s]));

const tickets = {};
for (const [name, p] of Object.entries(Engine.PRESETS)) {
  const cfg = { ...baseCfg, ...Object.fromEntries(Engine.PKEYS.map(k => [k, p[k]])) };
  tickets[name] = Engine.buildTickets(selections, blend.fitById, cfg).map(t => ({ legs: t.legs.map(l => l.id), odds: +t.odds.toFixed(3), prob: +t.prob.toFixed(4), linked: t.linked, stake: +t.stake.toFixed(2) }));
}
const day = {
  date: today, taken_at: now.toISOString(), weight, remaining,
  events: events.map(e => ({ id: e.id, sport_key: e.sport_key, home: e.home_team, away: e.away_team, kickoff: e.commence_time, market: blend.fitById[e.id] ? { pH: +blend.fitById[e.id].market.pH.toFixed(4), pD: +blend.fitById[e.id].market.pD.toFixed(4), pA: +blend.fitById[e.id].market.pA.toFixed(4), pO: blend.fitById[e.id].market.pO == null ? null : +blend.fitById[e.id].market.pO.toFixed(4) } : null })),
  selections: selections.map(s => ({ id: s.id, match_id: s.match_id, sport_key: s.sport_key, home: s.home, away: s.away, kickoff: s.kickoff, mkey: s.mkey, side: s.side, point: s.point, team: s.team, pick: s.pick, price: s.price, book: s.book, prob: +s.prob.toFixed(4), prob_market: +s.prob_market.toFixed(4) })),
  tickets,
};
const existing = readJson(`data/paper/${today}.json`, null);
if (existing) {            // deuxième passage le même jour : on fusionne
  day.events = [...existing.events, ...day.events]; day.selections = [...existing.selections, ...day.selections];
  for (const k of Object.keys(tickets)) day.tickets[k] = [...(existing.tickets[k] || []), ...tickets[k]];
}
writeJson(`data/paper/${today}.json`, day);
for (const e of events) index.seen[e.id] = today;
if (!index.days.includes(today)) index.days.push(today);
// on oublie les matchs vus il y a plus de 60 jours
for (const [id, d] of Object.entries(index.seen)) if ((now - Date.parse(d)) > 60 * 864e5) delete index.seen[id];
writeJson("data/paper/index.json", index);
log(`${events.length} matchs, ${selections.length} sélections, tickets : ${Object.entries(tickets).map(([k, v]) => `${k} ${v.length}`).join(", ")}. Poids modèle ${weight}.`);
