// Robot « modèle maison » : Dixon-Coles (attaque / défense par équipe, avantage
// du terrain, poids décroissant des vieux matchs) entraîné sur 3 saisons de
// football-data.co.uk, puis BACKTEST contre les cotes de clôture Pinnacle.
// Le poids de mélange publié est celui qui fait le mieux au backtest (0 si rien).
import { Engine, Model, ukSeason, closingFair, seasonCode, readJson, writeJson, log, UK_DIV } from "./lib.mjs";

const XI = +(process.env.MODEL_XI || 0.0019);           // décroissance / jour (demi-vie ≈ 1 an)
const LEAGUES = (process.env.MODEL_LEAGUES || Engine.DEFAULTS.championnats.join(",")).split(",").filter(l => UK_DIV[l]);
const now = new Date();
const cur = seasonCode(now), prev = s => `${String(+s.slice(0, 2) - 1).padStart(2, "0")}${s.slice(0, 2)}`;
const SEASONS = [prev(prev(cur)), prev(cur), cur];

/* ----- ajustement Dixon-Coles par montée de gradient (log-vraisemblance pondérée) ----- */
function fit(matches, asOf, iters = 500) {
  const teams = [...new Set(matches.flatMap(m => [m.home, m.away]))];
  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const att = new Float64Array(teams.length), def = new Float64Array(teams.length); let home = 0.25;
  const w = matches.map(m => Math.exp(-XI * Math.max(0, (asOf - Date.parse(m.date)) / 864e5)));
  let lr = 0.02;
  for (let it = 0; it < iters; it++) {
    const ga = new Float64Array(teams.length), gd = new Float64Array(teams.length); let gh = 0;
    for (let k = 0; k < matches.length; k++) {
      const m = matches[k], i = idx[m.home], j = idx[m.away];
      const lam = Math.exp(home + att[i] - def[j]), mu = Math.exp(att[j] - def[i]);
      const dx = w[k] * (m.hg - lam), dy = w[k] * (m.ag - mu);
      ga[i] += dx; gd[j] -= dx; gh += dx; ga[j] += dy; gd[i] -= dy;
    }
    const n = matches.length;
    for (let t = 0; t < teams.length; t++) { att[t] += lr * ga[t] / n * teams.length; def[t] += lr * gd[t] / n * teams.length; }
    home += lr * gh / n;
    const ma = att.reduce((a, b) => a + b, 0) / teams.length; for (let t = 0; t < teams.length; t++) { att[t] -= ma; def[t] -= ma; }   // identifiabilité (transformation invariante)
  }
  return { home_adv: home, teams: Object.fromEntries(teams.map((t, i) => [t, { att: +att[i].toFixed(4), def: +def[i].toFixed(4) }])) };
}
const probs = (p, h, a) => {
  if (!p.teams[h] || !p.teams[a]) return null;
  const lh = Math.exp(p.home_adv + p.teams[h].att - p.teams[a].def), la = Math.exp(p.teams[a].att - p.teams[h].def);
  const m = Model.matrixFor(lh, la);
  return { pH: Model.sum(m, (x, y) => x > y), pD: Model.sum(m, (x, y) => x === y), pA: Model.sum(m, (x, y) => x < y), pO: Model.sum(m, (x, y) => x + y > 2.5) };
};
const clamp = x => Math.min(.999, Math.max(.001, x));
const WEIGHTS = [0, 0.1, 0.2, 0.3, 0.4, 0.5];

const out = { updated: now.toISOString(), xi: XI, seasons: SEASONS, leagues: {}, backtest: { n: 0, ll: {}, ll_ou: {}, by_league: {} } };
const acc = { n: 0, ll: Object.fromEntries(WEIGHTS.map(w => [w, 0])), llm: 0, ou: { n: 0, market: 0, model: 0 } };

for (const sk of LEAGUES) {
  const div = UK_DIV[sk]; let rows = [];
  for (const s of SEASONS) { try { const r = await ukSeason(div, s); rows.push(...r); log(`${div} ${s} : ${r.length} matchs`); } catch (e) { log(`[!] ${div} ${s} : ${e.message}`); } }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 200) { log(`${div} : trop peu de données, ignoré`); continue; }

  /* backtest glissant : blocs de 28 jours sur la saison passée + l'actuelle */
  const start = Date.parse(rows.find(r => r.date >= `${2000 + +SEASONS[1].slice(0, 2)}-07-01`)?.date || rows[Math.floor(rows.length / 3)].date);
  const L = { n: 0, ll: Object.fromEntries(WEIGHTS.map(w => [w, 0])), llm: 0, ou: { n: 0, market: 0, model: 0 } };
  const dbg = { test: 0, noMarket: 0, noModel: 0, blocks: 0, src: {} };
  for (let t = start; t < now; t += 28 * 864e5) {
    const train = rows.filter(r => Date.parse(r.date) < t), test = rows.filter(r => Date.parse(r.date) >= t && Date.parse(r.date) < t + 28 * 864e5);
    if (train.length < 150 || !test.length) continue;
    const p = fit(train, t, 300); dbg.blocks++;
    for (const r of test) {
      dbg.test++; const mk = closingFair(r), md = probs(p, r.home, r.away); if (!mk) dbg.noMarket++; if (!md) dbg.noModel++; if (!mk || !md) continue; dbg.src[r.close.src] = (dbg.src[r.close.src] || 0) + 1;
      const res = r.hg > r.ag ? "pH" : r.hg < r.ag ? "pA" : "pD";
      for (const w of WEIGHTS) { const pr = (1 - w) * mk[res] + w * md[res]; L.ll[w] -= Math.log(clamp(pr)); }
      L.llm -= Math.log(clamp(md[res])); L.n++;
      if (mk.pO != null) { const o = r.hg + r.ag > 2.5; L.ou.n++; L.ou.market -= Math.log(clamp(o ? mk.pO : 1 - mk.pO)); L.ou.model -= Math.log(clamp(o ? md.pO : 1 - md.pO)); }
    }
  }
  for (const w of WEIGHTS) acc.ll[w] += L.ll[w]; acc.llm += L.llm; acc.n += L.n; acc.ou.n += L.ou.n; acc.ou.market += L.ou.market; acc.ou.model += L.ou.model;
  out.backtest.by_league[sk] = { n: L.n, market: L.n ? +(L.ll[0] / L.n).toFixed(5) : null, model: L.n ? +(L.llm / L.n).toFixed(5) : null, best: L.n ? WEIGHTS.reduce((b, w) => L.ll[w] < L.ll[b] ? w : b, 0) : null };
  log(`${div} debug : ${JSON.stringify(dbg)}`);
  log(`${div} backtest : ${L.n} matchs, log-loss marché ${(L.ll[0] / L.n).toFixed(4)}, modèle ${(L.llm / L.n).toFixed(4)}, meilleur mélange w=${out.backtest.by_league[sk].best}`);

  /* modèle final sur toutes les données */
  const p = fit(rows, +now, 600);
  out.leagues[sk] = { div, home_adv: +p.home_adv.toFixed(4), n: rows.length, last: rows.at(-1).date, teams: p.teams };
}

/* ----- choix du poids ----- */
out.backtest.n = acc.n;
if (acc.n) {
  for (const w of WEIGHTS) out.backtest.ll[w] = +(acc.ll[w] / acc.n).toFixed(5);
  out.backtest.ll.model_only = +(acc.llm / acc.n).toFixed(5);
  out.backtest.ll_ou = acc.ou.n ? { n: acc.ou.n, market: +(acc.ou.market / acc.ou.n).toFixed(5), model: +(acc.ou.model / acc.ou.n).toFixed(5) } : null;
  let best = WEIGHTS.reduce((b, w) => acc.ll[w] < acc.ll[b] ? w : b, 0);
  const gain = (acc.ll[0] - acc.ll[best]) / acc.n;
  out.backtest.gain = +gain.toFixed(6);
  out.weight = gain > 0.0003 ? Math.min(best, 0.3) : 0;      // gain négligeable → le marché seul
  out.verdict = out.weight ? `Le mélange à ${Math.round(out.weight * 100)} % de modèle bat le marché seul au backtest (${acc.n} matchs).` : `Le modèle n'améliore pas le marché au backtest (${acc.n} matchs) : poids 0, le marché seul est utilisé.`;
} else { out.weight = 0; out.verdict = "Backtest impossible (pas de données)."; }
log(out.verdict);
writeJson("data/model.json", out);
