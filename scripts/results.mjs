// Robot « résultats » : règle les paris papier, calcule la valeur à la clôture
// (CLV) avec les cotes de clôture Pinnacle de football-data.co.uk, publie
// data/results.json (pour le carnet du téléphone) et data/paper.json (stats).
// Clé facultative : FOOTBALL_DATA_KEY (résultats de la Ligue des champions).
import { Engine, Model, ukSeason, closingFair, seasonCode, findResult, fdOrg, oddsApi, fetchJson, readJson, writeJson, listDir, log, sleep, UK_DIV, FD_CODE, dayOf } from "./lib.mjs";

const FD = process.env.FOOTBALL_DATA_KEY || "";
const now = new Date();
const dayFiles = listDir("data/paper").filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const days = dayFiles.map(f => readJson(`data/paper/${f}`)).filter(Boolean);

/* ---------- 1. résultats + cotes de clôture ----------
   Deux sources :
   - RAPIDE (scores le lendemain) : football-data.org pour les championnats couverts,
     The Odds API (2 crédits) pour les autres, seulement s'il reste des paris en attente ;
   - LENTE (1 à 2 fois par semaine) : CSV football-data.co.uk, qui apporte en plus les
     cotes de clôture → la valeur à la clôture (CLV) est ajoutée quand elles arrivent. */
const csvRows = {}, fastRows = {};
const need = new Set(Engine.DEFAULTS.championnats);
for (const d of days) for (const e of d.events) need.add(e.sport_key);
const pendingIn = sk => days.some(d => d.events.some(e => e.sport_key === sk && !e.result && Date.parse(e.kickoff) < now - 2 * 3600e3));
const csvCache = {};
async function uk(div, season) {
  const k = div + season; if (csvCache[k]) return csvCache[k];
  try { csvCache[k] = await ukSeason(div, season); log(`csv ${div} ${season} : ${csvCache[k].length} matchs joués, dernier le ${csvCache[k].at(-1)?.date || "—"}`); }
  catch (e) { log(`[!] csv ${div} ${season} : ${e.message}`); csvCache[k] = []; }
  return csvCache[k];
}
const seasons = [...new Set([seasonCode(now), seasonCode(new Date(now - 40 * 864e5))])];
for (const sk of need) {
  csvRows[sk] = [];
  if (UK_DIV[sk]) for (const s of seasons) csvRows[sk].push(...await uk(UK_DIV[sk], s));
  fastRows[sk] = [];
  if (FD_CODE[sk] && FD) {
    try {
      const from = new Date(now - 45 * 864e5).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10);
      const d = await fdOrg(`/competitions/${FD_CODE[sk]}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}`, FD);
      fastRows[sk] = (d?.matches || []).filter(m => m.score?.fullTime?.home != null).map(m => ({ div: FD_CODE[sk], date: dayOf(m.utcDate), home: m.homeTeam.name, away: m.awayTeam.name, hg: m.score.fullTime.home, ag: m.score.fullTime.away, close: {} }));
      log(`football-data.org ${FD_CODE[sk]} : ${fastRows[sk].length} matchs terminés`); await sleep(6500);
    } catch (e) { log(`[!] football-data.org ${sk} : ${e.message}`); }
  }
}
/* NBA : scores gratuits via le tableau des scores public d'ESPN (sans clé) */
const ESPN = { basketball_nba: "basketball/nba" };
for (const sk of need) {
  if (!ESPN[sk] || !pendingIn(sk)) continue;
  const dates = new Set();
  for (const d of days) for (const e of d.events) if (e.sport_key === sk && !e.result && Date.parse(e.kickoff) < now - 2 * 3600e3)
    for (const off of [0, -1]) dates.add(new Date(Date.parse(e.kickoff) + off * 864e5).toISOString().slice(0, 10).replace(/-/g, ""));
  for (const ds of dates) {
    try {
      const { data } = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${ESPN[sk]}/scoreboard?dates=${ds}`);
      for (const ev of data.events || []) {
        const c = ev.competitions?.[0]; if (!c || !c.status?.type?.completed) continue;
        const h = c.competitors.find(x => x.homeAway === "home"), a = c.competitors.find(x => x.homeAway === "away");
        fastRows[sk].push({ div: "espn", date: dayOf(ev.date), home: h.team.displayName, away: a.team.displayName, hg: +h.score, ag: +a.score, close: {} });
      }
    } catch (e) { log(`[!] ESPN ${sk} ${ds} : ${e.message}`); }
  }
  if (dates.size) log(`ESPN ${sk} : ${fastRows[sk].length} matchs terminés (${dates.size} jours)`);
}
/* sans source rapide gratuite (Ligue 2, Ligue Europa) : The Odds API si des paris
   attendent leur résultat depuis plus de 2 h et que le CSV ne l'a pas encore */
const ODDS_KEY = process.env.ODDS_API_KEY || "";
for (const sk of need) {
  if (fastRows[sk].length || !ODDS_KEY || !pendingIn(sk)) continue;
  const stillMissing = days.some(d => d.events.some(e => e.sport_key === sk && !e.result && Date.parse(e.kickoff) < now - 2 * 3600e3 && Date.parse(e.kickoff) > now - 3 * 864e5 && !findResult(csvRows[sk], e.home, e.away, e.kickoff)));
  if (!stillMissing) continue;
  try {
    const { data, remaining } = await oddsApi(`/sports/${sk}/scores/?daysFrom=3`, ODDS_KEY);
    fastRows[sk] = (data || []).filter(g => g.completed && g.scores).map(g => { const sc = Object.fromEntries(g.scores.map(s => [s.name, +s.score])); return { div: "odds-api", date: dayOf(g.commence_time), home: g.home_team, away: g.away_team, hg: sc[g.home_team], ag: sc[g.away_team], close: {} }; }).filter(x => x.hg != null && x.ag != null);
    log(`scores ${sk} via The Odds API : ${fastRows[sk].length} matchs (crédits restants ${remaining})`);
  } catch (e) { log(`[!] scores ${sk} : ${e.message}`); }
}

/* ---------- 2. règlement des journées papier ---------- */
let settledEvents = 0, settledSel = 0, clvAdded = 0;
for (const d of days) {
  let changed = false;
  for (const e of d.events) {
    if ((e.result && e.result.closing) || Date.parse(e.kickoff) > now - 2 * 3600e3) continue;
    const csvR = findResult(csvRows[e.sport_key] || [], e.home, e.away, e.kickoff);
    const r = csvR || findResult(fastRows[e.sport_key] || [], e.home, e.away, e.kickoff);
    if (!r) continue;
    if (!e.result) {
      e.result = { hg: r.hg, ag: r.ag, closing: null, src: r.div, close_src: null };
      for (const s of d.selections) if (s.match_id === e.id) { s.result = Model.settle(s, r.hg, r.ag); settledSel++; }
      settledEvents++; changed = true;
    }
    const cf = csvR ? closingFair(csvR) : null;
    if (cf) {
      e.result.closing = cf; e.result.close_src = csvR.close.src || null;
      const cfit = Model.fit(cf.pH, cf.pD, cf.pA, cf.pO);
      for (const s of d.selections) if (s.match_id === e.id) { s.prob_close = +Model.prob(cfit, s).toFixed(4); s.clv = +(s.price * s.prob_close - 1).toFixed(4); }
      clvAdded++; changed = true;
    }
  }
  if (changed) writeJson(`data/paper/${d.date}.json`, d);
}
log(`${settledEvents} matchs et ${settledSel} sélections réglés, cote de clôture ajoutée pour ${clvAdded} matchs`);

/* ---------- 3. results.json pour le carnet du téléphone (45 derniers jours) ---------- */
const matches = [];
for (const sk of need) {
  const csv = csvRows[sk].filter(r => (now - Date.parse(r.date)) <= 45 * 864e5);
  for (const r of csv) matches.push({ sport_key: sk, date: r.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag, closing: closingFair(r), close_src: r.close.src || null });
  for (const r of fastRows[sk]) {
    if ((now - Date.parse(r.date)) > 45 * 864e5) continue;
    if (findResult(csv, r.home, r.away, r.date + "T12:00:00Z")) continue;      // déjà là avec la clôture
    matches.push({ sport_key: sk, date: r.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag, closing: null, close_src: null });
  }
}
writeJson("data/results.json", { updated: now.toISOString(), matches });

/* ---------- 4. statistiques du test papier ---------- */
const profiles = {}; const series = {}; const recent = [];
const allSel = days.flatMap(d => d.selections.map(s => ({ ...s, date: d.date })));
const sportsSeen = [...new Set(["foot", ...days.flatMap(d => Object.values(d.tickets).flat().map(t => t.sport || "foot"))])];
for (const sport of sportsSeen) for (const name of Object.keys(Engine.PRESETS)) {
  const key = `${sport}:${name}`;
  const P = { key, sport, name, label: Engine.PRESETS[name].label, n: 0, settled: 0, won: 0, staked: 0, profit: 0, clv: [], linked: 0 };
  series[key] = [];
  for (const d of days) for (const t of (d.tickets[name] || [])) {
    if ((t.sport || "foot") !== sport) continue;
    P.n++; const legs = t.legs.map(id => d.selections.find(s => s.id === id)).filter(Boolean);
    if (legs.length !== t.legs.length) continue;
    if (legs.some(l => !l.result) && !legs.some(l => l.result === "lose")) continue;   // un pari perdu suffit à régler le ticket
    P.settled++; P.staked += t.stake;
    const lost = legs.some(l => l.result === "lose");
    const odds = legs.reduce((a, l) => a * (l.result === "push" ? 1 : l.price), 1);
    const profit = lost ? -t.stake : t.stake * (odds - 1);
    if (!lost && odds > 1) P.won++;
    P.profit += profit; if (t.linked) P.linked++;
    const clvs = legs.map(l => l.clv).filter(x => x != null); if (clvs.length) P.clv.push(clvs.reduce((a, b) => a + b, 0) / clvs.length);
    series[key].push({ date: d.date, profit: +profit.toFixed(2) });
    recent.push({ sport, profile: name, date: d.date, odds: +odds.toFixed(2), prob: t.prob, stake: t.stake, profit: +profit.toFixed(2), won: !lost && odds > 1, linked: t.linked,
      legs: legs.map(l => ({ match: `${l.home} - ${l.away}`, pick: l.pick, price: l.price, prob: l.prob, result: l.result || "pending", score: (() => { const res = days.find(x => x.date === d.date).events.find(e => e.id === l.match_id)?.result; return res ? `${res.hg}-${res.ag}` : "à jouer"; })(), clv: l.clv })) });
  }
  let cum = 0; series[key] = series[key].map(p => ({ date: p.date, cum: +(cum += p.profit).toFixed(2) }));
  profiles[key] = { ...P, roi: P.staked ? P.profit / P.staked : null, clv_avg: P.clv.length ? P.clv.reduce((a, b) => a + b, 0) / P.clv.length : null, clv: undefined, profit: +P.profit.toFixed(2), staked: +P.staked.toFixed(2) };
}
const settled = allSel.filter(s => s.result && s.result !== "push");
const bucket = (lo, hi, key) => { const ls = settled.filter(s => s[key] >= lo && s[key] < hi); return { lo, hi, n: ls.length, hit: ls.length ? ls.filter(s => s.result === "win").length / ls.length : null, pred: ls.length ? ls.reduce((a, s) => a + s[key], 0) / ls.length : null }; };
const edges = [[0, .2], [.2, .35], [.35, .5], [.5, .65], [.65, .8], [.8, 1.01]];
const calib = { blend: edges.map(([a, b]) => bucket(a, b, "prob")), market: edges.map(([a, b]) => bucket(a, b, "prob_market")) };
const byMarket = {};
for (const s of settled) { const k = (Engine.sportOf(s.sport_key) === "foot" ? "" : Engine.SPORTS[Engine.sportOf(s.sport_key)] + " ") + s.mkey + (s.point != null ? " " + s.point : ""); const m = (byMarket[k] = byMarket[k] || { n: 0, win: 0, pred: 0, flat: 0, clv: [] }); m.n++; if (s.result === "win") { m.win++; m.flat += s.price - 1; } else m.flat -= 1; m.pred += s.prob; if (s.clv != null) m.clv.push(s.clv); }
for (const m of Object.values(byMarket)) { m.hit = m.win / m.n; m.pred /= m.n; m.roi = m.flat / m.n; m.clv_avg = m.clv.length ? m.clv.reduce((a, b) => a + b, 0) / m.clv.length : null; delete m.clv; delete m.flat; }
const clvAll = settled.map(s => s.clv).filter(x => x != null);
const logloss = key => { const ls = settled.filter(s => s[key] != null); if (!ls.length) return null; return -ls.reduce((a, s) => a + Math.log(Math.min(.999, Math.max(.001, s.result === "win" ? s[key] : 1 - s[key]))), 0) / ls.length; };
writeJson("data/paper.json", {
  updated: now.toISOString(), days: days.length, first_day: days[0]?.date || null, events: days.reduce((a, d) => a + d.events.length, 0), selections: allSel.length, settled: settled.length,
  profiles, series, calib, byMarket, clv: { n: clvAll.length, avg: clvAll.length ? clvAll.reduce((a, b) => a + b, 0) / clvAll.length : null, positive: clvAll.length ? clvAll.filter(x => x > 0).length / clvAll.length : null },
  logloss: { blend: logloss("prob"), market: logloss("prob_market") }, weight_used: days.at(-1)?.weight ?? 0,
  recent: recent.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40),
});
log("data/results.json et data/paper.json écrits");
