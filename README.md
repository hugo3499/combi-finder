# Combi Finder

Application de combinés (2 à 4 paris) qui tourne entièrement dans le téléphone :
`https://hugo3499.github.io/combi-finder/` puis « Ajouter à l'écran d'accueil ».

## Clés et secrets
- **The Odds API** (cotes) : collée dans l'appli, elle reste dans le téléphone.
  Pour le robot du test papier, la même clé va aussi dans les secrets GitHub : `ODDS_API_KEY`.
- **football-data.org** (classements, calendrier, résultats Ligue des champions) : secret `FOOTBALL_DATA_KEY`.

Secrets : *Settings → Secrets and variables → Actions → New repository secret*.

## Robots (onglet Actions)
| Robot | Quand | Fait quoi | Crédits Odds API |
|---|---|---|---|
| Classements | chaque matin | `data/standings.json` (enjeu des matchs) | 0 |
| Test papier | chaque jour, 8 h 25 | calendrier gratuit, puis relève les 10 championnats qui jouent bientôt (matchs à 48 h : chaque jour ; à 6 jours : tous les 3 jours) ; 5 tickets × 4 profils | ≈ 2 par championnat relevé |
| Résultats | chaque nuit | règle les paris papier, cotes de clôture Pinnacle (CLV), `data/results.json` pour le carnet | 0 |
| Modèle maison | chaque lundi | Dixon-Coles sur 3 saisons + backtest contre Pinnacle → `data/model.json` | 0 |

Pour lancer un robot tout de suite : Actions → le robot → *Run workflow*.

## Fichiers
`index.html` page · `app.js` appli · `engine.js` moteur partagé (téléphone + robots) · `model.js` modèle de buts
· `scripts/*.mjs` robots · `scripts/test-sim.mjs` simulation hors ligne (`node scripts/test-sim.mjs`).
