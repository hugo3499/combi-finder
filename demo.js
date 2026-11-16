/* Données fictives pour tester l'appli sans clé */
const Demo = (() => {
  const ko = () => { const d = new Date(Date.now() + 2 * 864e5); d.setHours(20, 0, 0, 0); return d.toISOString(); };
  const ev = (id, home, away, sk, title, books) => ({ id, sport_key: sk, sport_title: title, home_team: home, away_team: away, commence_time: ko(),
    bookmakers: Object.entries(books).map(([k, [h, d, a, o, u, y, n]]) => ({ key: k, markets: [
      { key: "h2h", outcomes: [{ name: home, price: h }, { name: "Draw", price: d }, { name: away, price: a }] },
      { key: "totals", outcomes: [{ name: "Over", price: o, point: 2.5 }, { name: "Under", price: u, point: 2.5 }] },
      { key: "btts", outcomes: [{ name: "Yes", price: y }, { name: "No", price: n }] }] })) });
  const events = () => [
    ev("d1", "PSG", "Lens", "soccer_france_ligue_one", "Ligue 1", { pinnacle: [1.45, 4.70, 7.40, 1.55, 2.55, 1.85, 1.98], winamax_fr: [1.50, 4.40, 6.50, 1.52, 2.40, 1.80, 1.90], betclic_fr: [1.42, 4.60, 7.00, 1.50, 2.45, 1.83, 1.88], unibet_fr: [1.47, 4.50, 6.80, 1.53, 2.42, 1.78, 1.95] }),
    ev("d2", "Arsenal", "Chelsea", "soccer_epl", "Premier League", { pinnacle: [2.05, 3.55, 3.75, 1.80, 2.08, 1.68, 2.25], winamax_fr: [2.15, 3.40, 3.50, 1.75, 2.00, 1.65, 2.15], betclic_fr: [2.00, 3.50, 3.60, 1.78, 1.98, 1.66, 2.10], unibet_fr: [2.02, 3.45, 3.95, 1.74, 2.05, 1.70, 2.12] }),
    ev("d3", "Inter", "Milan", "soccer_italy_serie_a", "Serie A", { pinnacle: [1.95, 3.60, 4.10, 1.95, 1.92, 1.80, 2.04], winamax_fr: [1.90, 3.75, 4.00, 1.88, 1.87, 1.75, 1.98], betclic_fr: [1.98, 3.50, 4.05, 1.90, 1.85, 1.77, 1.96], unibet_fr: [1.92, 3.55, 4.30, 1.86, 1.90, 1.74, 2.00] }),
    ev("d4", "Real Madrid", "Sevilla", "soccer_spain_la_liga", "Liga", { pinnacle: [1.38, 5.20, 8.50, 1.50, 2.70, 2.00, 1.83], winamax_fr: [1.40, 5.00, 8.00, 1.48, 2.55, 1.95, 1.78], betclic_fr: [1.43, 4.90, 7.50, 1.45, 2.60, 1.92, 1.80], unibet_fr: [1.36, 5.10, 8.80, 1.49, 2.50, 1.97, 1.76] }),
    ev("d5", "Dortmund", "Leipzig", "soccer_germany_bundesliga", "Bundesliga", { pinnacle: [2.30, 3.70, 3.00, 1.48, 2.75, 1.50, 2.62], winamax_fr: [2.40, 3.60, 2.85, 1.45, 2.60, 1.48, 2.50], betclic_fr: [2.25, 3.65, 3.05, 1.46, 2.65, 1.47, 2.55], unibet_fr: [2.35, 3.80, 2.95, 1.47, 2.58, 1.49, 2.48] }),
    ev("d6", "Marseille", "Lyon", "soccer_france_ligue_one", "Ligue 1", { pinnacle: [2.10, 3.50, 3.60, 1.85, 2.02, 1.72, 2.18], winamax_fr: [2.05, 3.45, 3.70, 1.80, 1.95, 1.70, 2.10], betclic_fr: [2.12, 3.40, 3.55, 1.82, 1.97, 1.68, 2.12], unibet_fr: [2.08, 3.60, 3.50, 1.79, 1.98, 1.69, 2.08] }),
    // match européen 3 jours avant PSG - Lens, pour montrer la fatigue
    (() => { const e = ev("d7", "PSG", "Bayern", "soccer_uefa_champs_league", "Ligue des champions", { pinnacle: [2.60, 3.70, 2.60, 1.65, 2.30, 1.60, 2.35], betclic_fr: [2.55, 3.60, 2.55, 1.62, 2.25, 1.58, 2.30] }); const d = new Date(e.commence_time); d.setDate(d.getDate() - 3); e.commence_time = d.toISOString(); return e; })()
  ];
  const extras = () => {
    const x = (home, away, dc, dnb, alt, tt) => ({ bookmakers: [{ key: "betclic_fr", markets: [
      { key: "double_chance", outcomes: [{ name: `${home} or Draw`, price: dc[0] }, { name: `Draw or ${away}`, price: dc[1] }, { name: `${home} or ${away}`, price: dc[2] }] },
      { key: "draw_no_bet", outcomes: [{ name: home, price: dnb[0] }, { name: away, price: dnb[1] }] },
      { key: "alternate_totals", outcomes: [{ name: "Over", point: 1.5, price: alt[0] }, { name: "Under", point: 1.5, price: alt[1] }, { name: "Over", point: 3.5, price: alt[2] }, { name: "Under", point: 3.5, price: alt[3] }] },
      { key: "team_totals", outcomes: [{ name: "Over", description: home, point: 0.5, price: tt[0] }, { name: "Over", description: away, point: 0.5, price: tt[1] }, { name: "Over", description: home, point: 1.5, price: tt[2] }] }] }] });
    return {
      d1: x("PSG", "Lens", [1.12, 2.55, 1.20], [1.22, 4.10], [1.18, 4.40, 2.25, 1.58], [1.05, 1.60, 1.40]),
      d4: x("Real Madrid", "Sevilla", [1.10, 2.90, 1.18], [1.17, 4.80], [1.16, 4.60, 2.10, 1.65], [1.04, 1.75, 1.38]),
      d2: x("Arsenal", "Chelsea", [1.30, 1.75, 1.33], [1.55, 2.45], [1.25, 3.60, 2.70, 1.42], [1.14, 1.22, 1.85]),
      d3: x("Inter", "Milan", [1.28, 1.85, 1.32], [1.48, 2.70], [1.22, 3.90, 2.50, 1.48], [1.12, 1.28, 1.80])
    };
  };
  return { events, extras };
})();
