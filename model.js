/* Modèle de buts : Poisson bivarié (correction Dixon-Coles) calibré sur les cotes
   justes 1N2 + plus/moins 2,5 de Pinnacle. Donne la proba de n'importe quel pari
   défini sur le score final, et la proba JOINTE de plusieurs paris du même match. */
const Model = (() => {
  const MAXG = 10, RHO = -0.08;
  const fact = [1]; for (let i = 1; i <= MAXG; i++) fact[i] = fact[i - 1] * i;
  const pois = (l, k) => Math.exp(-l) * l ** k / fact[k];

  function matrix(lh, la) {
    const m = [];
    for (let h = 0; h <= MAXG; h++) {
      m[h] = [];
      for (let a = 0; a <= MAXG; a++) {
        let p = pois(lh, h) * pois(la, a);
        if (h === 0 && a === 0) p *= 1 - lh * la * RHO;
        else if (h === 0 && a === 1) p *= 1 + lh * RHO;
        else if (h === 1 && a === 0) p *= 1 + la * RHO;
        else if (h === 1 && a === 1) p *= 1 - RHO;
        m[h][a] = p;
      }
    }
    let s = 0; for (const r of m) for (const v of r) s += v;
    for (const r of m) for (let a = 0; a <= MAXG; a++) r[a] /= s;
    return m;
  }
  const sum = (m, pred) => { let s = 0; for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) if (pred(h, a)) s += m[h][a]; return s; };

  /* calibrage : trouve (λ dom, λ ext) qui reproduisent p(1), p(N), p(2) et p(+2,5) */
  function fit(pH, pD, pA, pOver25) {
    const target = [pH, pD, pA, pOver25].filter(x => x != null);
    const err = (lh, la) => {
      const m = matrix(lh, la);
      const got = [sum(m, (h, a) => h > a), sum(m, (h, a) => h === a), sum(m, (h, a) => h < a), sum(m, (h, a) => h + a > 2.5)];
      let e = 0; for (let i = 0; i < 4; i++) if ([pH, pD, pA, pOver25][i] != null) e += (got[i] - [pH, pD, pA, pOver25][i]) ** 2;
      return e;
    };
    // Nelder-Mead 2D sur (log λh, log λa)
    let pts = [[Math.log(1.4), Math.log(1.1)], [Math.log(1.9), Math.log(1.0)], [Math.log(1.2), Math.log(1.5)]];
    const f = p => err(Math.exp(p[0]), Math.exp(p[1]));
    let vals = pts.map(f);
    for (let it = 0; it < 120; it++) {
      const o = [0, 1, 2].sort((i, j) => vals[i] - vals[j]); pts = o.map(i => pts[i]); vals = o.map(i => vals[i]);
      const c = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      const r = [c[0] + (c[0] - pts[2][0]), c[1] + (c[1] - pts[2][1])], fr = f(r);
      if (fr < vals[0]) { const e = [c[0] + 2 * (c[0] - pts[2][0]), c[1] + 2 * (c[1] - pts[2][1])], fe = f(e); if (fe < fr) { pts[2] = e; vals[2] = fe; } else { pts[2] = r; vals[2] = fr; } }
      else if (fr < vals[1]) { pts[2] = r; vals[2] = fr; }
      else { const k = [c[0] + .5 * (pts[2][0] - c[0]), c[1] + .5 * (pts[2][1] - c[1])], fk = f(k);
        if (fk < vals[2]) { pts[2] = k; vals[2] = fk; } else { for (let i = 1; i < 3; i++) { pts[i] = [pts[0][0] + .5 * (pts[i][0] - pts[0][0]), pts[0][1] + .5 * (pts[i][1] - pts[0][1])]; vals[i] = f(pts[i]); } } }
      if (Math.abs(vals[2] - vals[0]) < 1e-12) break;
    }
    const lh = Math.exp(pts[0][0]), la = Math.exp(pts[0][1]);
    return { lh, la, m: matrix(lh, la), err: vals[0] };
  }

  /* Un pari = prédicat sur (buts dom, buts ext). "side" : H dom, A ext. */
  const PRED = {
    h2h: (side) => side === 'H' ? (h, a) => h > a : side === 'A' ? (h, a) => h < a : (h, a) => h === a,
    double_chance: (side) => side === '1X' ? (h, a) => h >= a : side === 'X2' ? (h, a) => h <= a : (h, a) => h !== a,
    draw_no_bet: (side) => side === 'H' ? (h, a) => h > a : (h, a) => h < a,       // nul = remboursé (géré à part)
    totals: (side, pt) => side === 'O' ? (h, a) => h + a > pt : (h, a) => h + a < pt,
    team_totals: (side, pt, team) => team === 'H' ? (side === 'O' ? (h) => h > pt : (h) => h < pt) : (side === 'O' ? (h, a) => a > pt : (h, a) => a < pt),
    btts: (side) => side === 'Y' ? (h, a) => h > 0 && a > 0 : (h, a) => h === 0 || a === 0,
    spreads: (side, pt) => side === 'H' ? (h, a) => h + pt > a : (h, a) => a + pt > h,       // handicap (hors lignes quart / remboursement)
  };
  const pushPred = (sel) => PRED[sel.mkey](sel.side, sel.point, sel.team);

  /* proba d'un pari ; pour DNB / handicap entier on renvoie aussi la proba de remboursement */
  function prob(fit, sel) {
    const p = sum(fit.m, pushPred(sel));
    let push = 0;
    if (sel.mkey === 'draw_no_bet') push = sum(fit.m, (h, a) => h === a);
    if (sel.mkey === 'spreads' && Number.isInteger(sel.point)) push = sum(fit.m, (h, a) => (sel.side === 'H' ? h + sel.point === a : a + sel.point === h));
    return push ? p / (1 - push) : p;   // proba conditionnelle "hors remboursement"
  }
  /* proba jointe de plusieurs paris du même match (remboursements ignorés : rares dans un combiné) */
  function joint(fit, sels) {
    const preds = sels.map(pushPred);
    return sum(fit.m, (h, a) => preds.every(p => p(h, a)));
  }
  /* règlement d'un pari sur un score réel : 'win' | 'lose' | 'push' */
  function settle(sel, h, a) {
    if (sel.mkey === 'draw_no_bet' && h === a) return 'push';
    if (sel.mkey === 'spreads' && Number.isInteger(sel.point) && (sel.side === 'H' ? h + sel.point === a : a + sel.point === h)) return 'push';
    return pushPred(sel)(h, a) ? 'win' : 'lose';
  }
  return { fit, prob, joint, settle, sum };
})();
if (typeof module !== 'undefined') module.exports = Model;
