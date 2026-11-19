// Robot « test papier » : chaque jour de match, relève les cotes et enregistre
// les tickets des 4 profils + toutes les sélections, sans rien jouer.
// Secret : ODDS_API_KEY. Le calendrier (/events) est gratuit : les jours sans
// match ne coûtent rien.
import { Engine, Model, oddsApi, fdOrg, readJson, writeJson, log, sleep, FD_CODE } from "./lib.mjs";

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("ODDS_API_KEY manquante (Settings → Secrets → Actions)"); process.exit(1); }
const FD = process.env.FOOTBALL_DATA_KEY || "";
const HORIZON_H = +(process.env.PAPER_HORIZON_H || 48);
const BOOKS = (process.env.PAPER_BOOKS || "betclic_fr").split(",");
const LEAGUES = (process.env.PAPER_LEAGUES || Engine.LEAGUES.map(l => l[0]).join(",")).split(",");
const BANKROLL = 100, TOP = 5;   // mise : celle de chaque profil (Engine.PRESETS)

const now = new Date(), until = new Date(now.getTime() + HORIZON_H * 3600e3);
const today = now.toISOString().slice(0, 10);
const index = readJson("data/paper/index.json", { days: [], seen: {} });
const model = readJson("data/model.json", null);
const weight = model && model.weight > 0 ? model.weight : 0;

/* 1. quels championnats relever aujourd'hui ? Calendrier GRATUIT via /events de The Odds API
   - match dans les 48 h            → relevé du jour (cotes fraîches pour le test papier)
   - match dans les 6 jours          → relevé si le dernier a plus de 71 h (l'appli voit déjà le week-end)
   - pas de match dans les 6 jours   → rien, 0 crédit */
const APP_DAYS = +(process.env.APP_HORIZON_DAYS || 6), MIN_CREDITS = +(process.env.MIN_CREDITS || 15);
const prev = readJson("data/latest.json", {}) || {};
const prevByLeague = prev.by_league || {};
const nextKick = {};            // sport_key → date du prochain match
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
let calendarOk = true;
for (const sk of LEAGUES) {
  try {
    const { data } = await oddsApi(`/sports/${sk}/events?commenceTimeFrom=${iso(now)}&commenceTimeTo=${iso(new Date(now.getTime() + APP_DAYS * 864e5))}`, KEY);
    for (const e of data || []) { const t = Date.parse(e.commence_time); if (t > now && (!nextKick[sk] || t < nextKick[sk])) nextKick[sk] = t; }
  } catch (e) { if (/401/.test(e.message)) { log("Clé refusée"); process.exit(1); } if (!/404|422/.test(e.message)) { calendarOk = false; log(`[!] calendrier ${sk} : ${e.message}`); } }
  await sleep(250);
}
log("Prochains matchs :", LEAGUES.map(l => `${l.replace("soccer_", "")} ${nextKick[l] ? new Date(nextKick[l]).toISOString().slice(5, 16) : "—"}`).join(" · "));
const toFetch = LEAGUES.filter(l => {
  const last = prevByLeague[l]?.fetched_at ? Date.parse(prevByLeague[l].fetched_at) : 0;
  const age = (now - last) / 3600e3;
  const nk = nextKick[l]; if (!nk) return !calendarOk && age > 47; // calendrier en panne : tous les 2 jours
  if (nk <= until) return age > 12;                                 // match dans les 36 h
  return age > 71;                                                  // match dans les 6 jours : tous les 3 jours
});
log(`À relever : ${toFetch.length ? toFetch.join(", ") : "rien"} (${toFetch.length * 2} crédits)`);
if (!toFetch.length) { log("Rien à relever aujourd'hui, 0 crédit dépensé."); process.exit(0); }

/* 2. relevé des cotes */
const events = []; let remaining = null; const byLeague = { ...prevByLeague };
for (const sp of toFetch) {
  if (remaining != null && remaining < MIN_CREDITS) { log(`Crédits bas (${remaining}) : arrêt pour ne pas vider le quota.`); break; }
  try {
    const { data, remaining: r } = await oddsApi(`/sports/${sp}/odds/?bookmakers=${["pinnacle", ...BOOKS].join(",")}&markets=h2h,totals&oddsFormat=decimal`, KEY);
    remaining = r;
    byLeague[sp] = { fetched_at: now.toISOString(), events: data.filter(e => Date.parse(e.commence_time) > now) };
    const inWin = data.filter(e => Date.parse(e.commence_time) > now && Date.parse(e.commence_time) <= until && !index.seen[e.id]);
    events.push(...inWin);
    log(`${sp} : ${data.length} matchs, ${inWin.length} nouveaux dans les ${HORIZON_H} h (crédits restants ${r})`);
    await sleep(400);
  } catch (e) { log(`[!] ${sp} : ${e.message}`); if (/401/.test(e.message)) process.exit(1); }
}
/* cotes pour l'appli : dernières connues de chaque championnat, matchs passés retirés */
for (const k of Object.keys(byLeague)) { byLeague[k].events = byLeague[k].events.filter(e => Date.parse(e.commence_time) > now); if (!LEAGUES.includes(k)) delete byLeague[k]; }
const allEvents = Object.values(byLeague).flatMap(b => b.events);
const stamps = Object.values(byLeague).map(b => b.fetched_at).sort();
writeJson("data/latest.json", { fetched_at: stamps.at(-1) || now.toISOString(), oldest: stamps[0] || null, remaining: remaining ?? prev.remaining ?? null, leagues: Object.keys(byLeague), books: BOOKS, by_league: byLeague });
log(`data/latest.json : ${allEvents.length} matchs à venir pour l'appli`);
if (!events.length) { log(`Pas de nouveau match dans les ${HORIZON_H} h : pas de tickets papier aujourd'hui.`); process.exit(0); }

/* 3. sélections (probas marché + mélange modèle) et tickets par profil */
const baseCfg = { ...Engine.DEFAULTS, mes_bookmakers: BOOKS, marches: { "1N2": true, plus_moins_2_5: true, les_deux_marquent: false, extras: false }, nombre_de_combis_affiches: TOP, bankroll: BANKROLL };
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
