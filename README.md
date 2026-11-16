# Combi Finder

Application de combinés (2 à 4 paris) qui tourne entièrement dans le téléphone.
Ouvre `https://hugo3499.github.io/combi-finder/` puis « Ajouter à l'écran d'accueil ».

## Clés
- **The Odds API** (cotes) : collée dans l'appli, elle reste dans le téléphone.
- **football-data.org** (classements, pour l'enjeu des matchs) : à mettre dans
  *Settings → Secrets and variables → Actions → New repository secret*, nom `FOOTBALL_DATA_KEY`.
  Le robot (`.github/workflows/standings.yml`) met à jour `data/standings.json` chaque matin.
  Pour le lancer tout de suite : onglet *Actions* → « Classements » → *Run workflow*.

## Fichiers
- `index.html` : la page · `app.js` : l'appli · `model.js` : modèle de buts (Poisson / Dixon-Coles)
- `demo.js` : données fictives · `scripts/standings.mjs` : récupération des classements
