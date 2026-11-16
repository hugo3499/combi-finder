// Outils communs aux robots (Node 20+)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const Model = require(join(ROOT, "model.js"));
export const Engine = require(join(ROOT, "engine.js"));

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function readJson(rel, fallback = null) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
export function writeJson(rel, obj) {
  const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj));
}
export const listDir = rel => existsSync(join(ROOT, rel)) ? readdirSync(join(ROOT, rel)) : [];

export async function fetchText(url, opts = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 429 && i < tries) { await sleep(8000 * i); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(/apiKey=[^&]+/, "apiKey=***")}`);
      return { text: await r.text(), headers: r.headers };
    } catch (e) { if (i === tries) throw e; await sleep(3000 * i); }
  }
}
export async function fetchJson(url, opts) { const { text, headers } = await fetchText(url, opts); return { data: JSON.parse(text), headers }; }

/* ---------- The Odds API ---------- */
const ODDS = "https://api.the-odds-api.com/v4";
export async function oddsApi(path, key) {
  const { data, headers } = await fetchJson(`${ODDS}${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`);
  const rem = headers.get("x-requests-remaining");
  return { data, remaining: rem != null ? Math.round(+rem) : null };
}

/* ---------- football-data.org (clé optionnelle) ---------- */
export async function fdOrg(path, key) {
  if (!key) return null;
  const { data } = await fetchJson(`https://api.football-data.org/v4${path}`, { headers: { "X-Auth-Token": key } });
  return data;
}

/* ---------- football-data.co.uk (CSV) ---------- */
export function seasonCode(d = new Date()) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;      // saison = juillet → juin
  const start = m >= 7 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}
export function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const split = l => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
  const head = split(lines[0]).map(h => h.trim());
  return lines.slice(1).map(l => { const v = split(l); const o = {}; head.forEach((h, i) => o[h] = (v[i] ?? "").trim()); return o; }).filter(o => o.HomeTeam && o.AwayTeam);
}
export function parseUkDate(s) {   // dd/mm/yy ou dd/mm/yyyy → YYYY-MM-DD
  const [d, m, y] = s.split("/"); const yy = y.length === 2 ? "20" + y : y;
  return `${yy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
const num = v => { const x = parseFloat(v); return Number.isFinite(x) && x > 1 ? x : null; };
/* télécharge une saison d'une ligue : lignes normalisées */
export async function ukSeason(div, season) {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`;
  const { text } = await fetchText(url);
  return parseCsv(text).map(r => ({
    div, date: parseUkDate(r.Date), home: r.HomeTeam, away: r.AwayTeam,
    hg: r.FTHG === "" ? null : +r.FTHG, ag: r.FTAG === "" ? null : +r.FTAG,
    close: { H: num(r.PSCH) ?? num(r.PSH), D: num(r.PSCD) ?? num(r.PSD), A: num(r.PSCA) ?? num(r.PSA), O: num(r["PC>2.5"]) ?? num(r["P>2.5"]), U: num(r["PC<2.5"]) ?? num(r["P<2.5"]) },
  })).filter(r => r.hg != null && r.ag != null);
}
/* probabilités justes de clôture (Pinnacle) d'une ligne CSV, ou null */
export function closingFair(row) {
  const c = row.close; if (!(c.H && c.D && c.A)) return null;
  const [pH, pD, pA] = Engine.devig([c.H, c.D, c.A]);
  const pO = c.O && c.U ? Engine.devig([c.O, c.U])[0] : null;
  return { pH, pD, pA, pO };
}
export const dayOf = iso => iso.slice(0, 10);
export const daysBetween = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);

/* trouve la ligne de résultat correspondant à un match (ligue, date ±1 j, noms) */
export function findResult(rows, home, away, kickoffIso) {
  const d = dayOf(kickoffIso);
  const cands = rows.filter(r => daysBetween(r.date, d) <= 1.01);
  let best = null, bs = 0;
  for (const r of cands) { const s = Engine.sim(home, r.home) + Engine.sim(away, r.away); if (s > bs) { bs = s; best = r; } }
  return bs >= 1.2 ? best : null;
}
export const UK_DIV = Object.fromEntries(Engine.LEAGUES.filter(l => l[3]).map(l => [l[0], l[3]]));
export const FD_CODE = Object.fromEntries(Engine.LEAGUES.filter(l => l[2]).map(l => [l[0], l[2]]));
