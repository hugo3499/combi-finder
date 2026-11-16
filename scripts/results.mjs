// Robot « résultats » : règle les paris papier, calcule la valeur à la clôture
// (CLV) avec les cotes de clôture Pinnacle de football-data.co.uk, publie
// data/results.json (pour le carnet du téléphone) et data/paper.json (stats).
// Clé facultative : FOOTBALL_DATA_KEY (résultats de la Ligue des champions).
import { Engine, Model, ukSeason, closingFair, seasonCode, findResult, fdOrg, readJson, writeJson, listDir, log, sleep, UK_DIV, FD_CODE, dayOf } from "./lib.mjs";

const FD = process.env.FOOTBALL_DATA_KEY || "";
const now = new Date();
const dayFiles = listDir("data/paper").filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const days = dayFiles.map(f => readJson(`data/paper/${f}`)).filter(Boolean);

/* ---------- 1. résultats + cotes de clôture ---------- */
const rowsByLeague = {};            // sport_key → lignes (csv ou football-data.org)
const need = new Set(Engine.DEFAULTS.championnats);
for (const d of days) for (const e of d.events) need.add(e.sport_key);
const csvCache = {};
async function uk(div, season) {
  const k = div + season; if (csvCache[k]) return csvCache[k];
  try { csvCache[k] = await ukSeason(div, season); log(`csv ${div} ${season} : ${csvCache[k].length} matchs joués`); }
  catch (e) { log(`[!] csv ${div} ${season} : ${e.message}`); csvCache[k] = []; }
  return csvCache[k];
}
const seasons = [...new Set([seasonCode(now), seasonCode(new Date(now - 40 * 864e5))])];
for (const sk of need) {
  if (UK_DIV[sk]) { rowsByLeague[sk] = []; for (const s of seasons) rowsByLeague[sk].push(...await uk(UK_DIV[sk], s)); }
  else if (FD_CODE[sk] && FD) {
    try {
      const from = new Date(now - 60 * 864e5).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10);
      const d = await fdOrg(`/competitions/${FD_CODE[sk]}/matches?status=FINISHED&dateFrom=${from}&dateTo=${to}`, FD);
      rowsByLeague[sk] = (d?.matches || []).filter(m => m.score?.fullTime?.home != null).map(m => ({ div: FD_CODE[sk], date: dayOf(m.utcDate), home: m.homeTeam.name, away: m.awayTeam.name, hg: m.score.fullTime.home, ag: m.score.fullTime.away, close: {} }));
      log(`football-data.org ${FD_CODE[sk]} : ${rowsByLeague[sk].length} matchs terminés`); await sleep(6500);
    } catch (e) { log(`[!] football-data.org ${sk} : ${e.message}`); rowsByLeague[sk] = []; }
  } else rowsByLeague[sk] = [];
}

/* ---------- 2. règlement des journées papier ---------- */
let settledEvents = 0, settledSel = 0;
for (const d of days) {
  let changed = false;
  for (const e of d.events) {
    if (e.result || Date.parse(e.kickoff) > now - 2 * 3600e3) continue;
    const r = findResult(rowsByLeague[e.sport_key] || [], e.home, e.away, e.kickoff);
    if (!r) continue;
    const cf = closingFair(r);
    e.result = { hg: r.hg, ag: r.ag, closing: cf, src: r.div, close_src: r.close.src || null };
    const cfit = cf ? Model.fit(cf.pH, cf.pD, cf.pA, cf.pO) : null;
    for (const s of d.selections) {
      if (s.match_id !== e.id) continue;
      s.result = Model.settle(s, r.hg, r.ag);
      if (cfit) { s.prob_close = +Model.prob(cfit, s).toFixed(4); s.clv = +(s.price * s.prob_close - 1).toFixed(4); }
      settledSel++;
    }
    settledEvents++; changed = true;
  }
  if (changed) writeJson(`data/paper/${d.date}.json`, d);
}
log(`${settledEvents} matchs et ${settledSel} sélections réglés`);

/* ---------- 3. results.json pour le carnet du téléphone (45 derniers jours) ---------- */
const matches = [];
for (const [sk, rows] of Object.entries(rowsByLeague)) for (const r of rows) {
  if ((now - Date.parse(r.date)) > 45 * 864e5) continue;
  matches.push({ sport_key: sk, date: r.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag, closing: closingFair(r), close_src: r.close.src || null });
}
writeJson("data/results.json", { updated: now.toISOString(), matches });

/* ---------- 4. statistiques du test papier ---------- */
const profiles = {}; const series = {}; const recent = [];
const allSel = days.flatMap(d => d.selections.map(s => ({ ...s, date: d.date })));
for (const name of Object.keys(Engine.PRESETS)) {
  const P = { name, label: Engine.PRESETS[name].label, n: 0, settled: 0, won: 0, staked: 0, profit: 0, clv: [], linked: 0 };
  series[name] = [];
  for (const d of days) for (const t of (d.tickets[name] || [])) {
    P.n++; const legs = t.legs.map(id => d.selections.find(s => s.id === id)).filter(Boolean);
    if (legs.length !== t.legs.length || legs.some(l => !l.result)) continue;
    P.settled++; P.staked += t.stake;
    const lost = legs.some(l => l.result === "lose");
    const odds = legs.reduce((a, l) => a * (l.result === "push" ? 1 : l.price), 1);
    const profit = lost ? -t.stake : t.stake * (odds - 1);
    if (!lost && odds > 1) P.won++;
    P.profit += profit; if (t.linked) P.linked++;
    const clvs = legs.map(l => l.clv).filter(x => x != null); if (clvs.length) P.clv.push(clvs.reduce((a, b) => a + b, 0) / clvs.length);
    series[name].push({ date: d.date, profit: +profit.toFixed(2) });
    recent.push({ profile: name, date: d.date, odds: +odds.toFixed(2), prob: t.prob, stake: t.stake, profit: +profit.toFixed(2), won: !lost && odds > 1, linked: t.linked,
      legs: legs.map(l => ({ match: `${l.home} - ${l.away}`, pick: l.pick, price: l.price, prob: l.prob, result: l.result, score: `${days.find(x => x.date === d.date).events.find(e => e.id === l.match_id)?.result?.hg}-${days.find(x => x.date === d.date).events.find(e => e.id === l.match_id)?.result?.ag}`, clv: l.clv })) });
  }
  let cum = 0; series[name] = series[name].map(p => ({ date: p.date, cum: +(cum += p.profit).toFixed(2) }));
  profiles[name] = { ...P, roi: P.staked ? P.profit / P.staked : null, clv_avg: P.clv.length ? P.clv.reduce((a, b) => a + b, 0) / P.clv.length : null, clv: undefined, profit: +P.profit.toFixed(2), staked: +P.staked.toFixed(2) };
}
const settled = allSel.filter(s => s.result && s.result !== "push");
const bucket = (lo, hi, key) => { const ls = settled.filter(s => s[key] >= lo && s[key] < hi); return { lo, hi, n: ls.length, hit: ls.length ? ls.filter(s => s.result === "win").length / ls.length : null, pred: ls.length ? ls.reduce((a, s) => a + s[key], 0) / ls.length : null }; };
const edges = [[0, .2], [.2, .35], [.35, .5], [.5, .65], [.65, .8], [.8, 1.01]];
const calib = { blend: edges.map(([a, b]) => bucket(a, b, "prob")), market: edges.map(([a, b]) => bucket(a, b, "prob_market")) };
const byMarket = {};
for (const s of settled) { const k = s.mkey + (s.point != null ? " " + s.point : ""); const m = (byMarket[k] = byMarket[k] || { n: 0, win: 0, pred: 0, flat: 0, clv: [] }); m.n++; if (s.result === "win") { m.win++; m.flat += s.price - 1; } else m.flat -= 1; m.pred += s.prob; if (s.clv != null) m.clv.push(s.clv); }
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
