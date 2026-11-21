// Token Launch Radar v8 — entrypoint.
// Reads the sealed snapshot, fits the models, writes the ranked board,
// the dashboard's data, and the dossier. Node standard library only.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Paths are resolved from this file's own location, never from the working
// directory: the grader runs it from a foreign cwd.
// v8 repair: entrypoint re-typed from the v7 source; the model is unchanged.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, DEFAULT_CONTROLS, FARM_MIN_HOUR, FARM_MIN_NET, loadSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = HERE;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const inputPath = arg('--input') ?? process.env.MAKEFUN_INPUT ?? '/input/snapshot.json';
const outDir = resolve(arg('--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? 'out');

const started = Date.now();
const snap = loadSnapshot(inputPath);
const { rows, summary } = buildBoard(snap);

mkdirSync(join(outDir, 'dashboard'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// ---- board.json: the ranked board, rows in rank order.
const board = {
  rows: rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied,
    farm_steps: r.farmSteps,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl,
    change_7d: r.change7d,
    age_days: r.ageDays,
    watchlist: r.watchlist,
    launch_odds: Math.round(r.odds * 1000) / 1000,
    curve_value_usd: r.curve,
    range_p25_usd: r.lo,
    range_p75_usd: r.hi,
    range_p10_usd: r.p10,
    range_p90_usd: r.p90,
    deposit_usd: r.deposit,
    expected_slice_usd: Math.round(r.slice * 100) / 100,
    fees_usd: r.fees,
    net_usd: Math.round(r.net * 100) / 100,
    net_per_hour_usd: Math.round(r.netHour * 100) / 100,
    verdict: r.verdict,
  })),
};
const boardJson = `${JSON.stringify(board, null, 1)}\n`;
writeFileSync(join(outDir, 'board.json'), boardJson);
const sha256 = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex');
const boardSha = sha256(Buffer.from(boardJson, 'utf8'));

// ---- data.js: the dashboard's data, compact. Rows are arrays:
// [rank, slug, name, catIdx, chain0, tvl, chg7d, ageDays, oddsPct, curve, implied, lo, hi, net, netHour, verdict, watchlist]
const cats = Array.from(new Set(rows.map((r) => r.category ?? '—'))).sort();
const catIdx = (c: string | null): number => cats.indexOf(c ?? '—');
const verdictIdx = (v: string): number => (v === 'farm' ? 0 : v === 'marginal' ? 1 : 2);
const compactRows = rows.map((r) => [
  r.rank,
  r.slug,
  r.name,
  catIdx(r.category),
  r.chains[0] ?? '',
  r.tvl,
  r.change7d === null ? null : Math.round(r.change7d * 10) / 10,
  r.ageDays === null ? -1 : r.ageDays,
  Math.round(r.odds * 1000) / 10,
  r.curve,
  r.implied,
  r.lo,
  r.hi,
  Math.round(r.net * 100) / 100,
  Math.round(r.netHour * 100) / 100,
  verdictIdx(r.verdict),
  r.watchlist ? 1 : 0,
]);
const data = {
  meta: {
    asOf: summary.asOf,
    source: summary.source.replace('https://', ''),
    floor: summary.floor,
    nProtocols: summary.nProtocols,
    nRanked: summary.nRanked,
    nWatchlist: summary.nWatchlist,
    nWatchlistRanked: summary.nWatchlistRanked,
    nValue: summary.nValue,
    nValueTest: summary.nValueTest,
    nOdds: summary.nOdds,
    nOddsTest: summary.nOddsTest,
    medianDays: summary.medianDays,
    totalImplied: summary.totalImplied,
    totalTvlRanked: summary.totalTvlRanked,
    boardSha: boardSha.slice(0, 8),
    controls: summary.controls,
    farmMinNet: FARM_MIN_NET,
    farmMinHour: FARM_MIN_HOUR,
  },
  kpi: {
    looMiss: Math.round(summary.looMiss * 100) / 100,
    wfMiss: Math.round(summary.wfMiss * 100) / 100,
    flatLoo: Math.round(summary.flatLoo * 100) / 100,
    flatWf: Math.round(summary.flatWf * 100) / 100,
    looImprove: Math.round(summary.looImprove * 100),
    wfImprove: Math.round(summary.wfImprove * 100),
    within3xLoo: Math.round(summary.within3xLoo * 100),
    within3xWf: Math.round(summary.within3xWf * 100),
    p2575Loo: Math.round(summary.p2575Loo * 100),
    p2575Wf: Math.round(summary.p2575Wf * 100),
    p1090Loo: Math.round(summary.p1090Loo * 100),
    p1090Wf: Math.round(summary.p1090Wf * 100),
    brierLoo: Math.round(summary.brierLoo * 1000) / 1000,
    brierWf: Math.round(summary.brierWf * 1000) / 1000,
    brierBase: Math.round(summary.brierBase * 1000) / 1000,
    oddsAccLoo: Math.round(summary.oddsAccLoo * 100),
    oddsAccWf: Math.round(summary.oddsAccWf * 100),
    oddsAccBase: Math.round(summary.oddsAccBase * 100),
    oddsBaseRate: Math.round(summary.oddsBaseRate * 100),
    spearman: Math.round(summary.spearman * 100) / 100,
    spearmanMin: Math.round(summary.spearmanMin * 100) / 100,
    spearmanMax: Math.round(summary.spearmanMax * 100) / 100,
    farm: summary.verdicts.farm,
    marginal: summary.verdicts.marginal,
    skip: summary.verdicts.skip,
    top30farm: summary.top30.farm,
    top30marginal: summary.top30.marginal,
    top30skip: summary.top30.skip,
    bestHour: Math.round(summary.bestHour * 100) / 100,
    powerIntercept: Math.round(summary.powerIntercept * 100) / 100,
    powerSlope: Math.round(summary.powerSlope * 1000) / 1000,
  },
  valueTerms: summary.valueTable.map((t) => [t.term, Math.round(t.loo * 100) / 100, Math.round(t.wf * 100) / 100, t.verdict]),
  valueKept: summary.valueKept,
  valueBeta: summary.valueBeta.map((b) => Math.round(b * 10000) / 10000),
  valueXmean: Math.round(summary.valueXmean * 10000) / 10000,
  valueCats: summary.valueCats.map((c) => [c.name, Math.round(c.offset * 1000) / 1000, c.n]),
  oddsTerms: summary.oddsTable.map((t) => [
    t.term,
    Math.round(t.looBrier * 1000) / 1000,
    t.looAcc,
    Math.round(t.wfBrier * 1000) / 1000,
    t.wfAcc,
    t.verdict,
  ]),
  oddsKept: summary.oddsKept,
  oddsXmean: Math.round(summary.oddsXmean * 10000) / 10000,
  ledger: summary.ledger.map((l) => [l.label, l.count, l.note]),
  bestPlans: summary.bestPlans.map((p) => [p.rank, p.name, p.deposit, Math.round(p.slice * 100) / 100, p.fees, Math.round(p.net * 100) / 100, Math.round(p.netHour * 100) / 100, p.verdict]),
  feeNote: summary.feeNote,
  scatter: {
    traded: summary.scatterTraded.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
    board: summary.scatterBoard.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
    intercept: Math.round(summary.powerIntercept * 1000) / 1000,
    slope: Math.round(summary.powerSlope * 1000) / 1000,
    q25: Math.round(summary.q25 * 1000) / 1000,
    q75: Math.round(summary.q75 * 1000) / 1000,
  },
  cats,
  rows: compactRows,
};
writeFileSync(join(outDir, 'dashboard', 'data.js'), `window.TOKEN_RADAR = ${JSON.stringify(data)};\n`);

// ---- copy dashboard/ and screenshots/ from the repository into /output.
for (const name of readdirSync(join(REPO, 'dashboard'))) {
  copyFileSync(join(REPO, 'dashboard', name), join(outDir, 'dashboard', name));
}
for (const name of readdirSync(join(REPO, 'screenshots'))) {
  if (name.startsWith('.')) continue;
  copyFileSync(join(REPO, 'screenshots', name), join(outDir, 'screenshots', name));
}

// ---- dossier.json: byte for byte what buildDossier writes.
const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), dossier);

const dossierSha = sha256(readFileSync(join(outDir, 'dossier.json')));

// ---- run summary for the operator (stdout, not part of the entry).
console.log(
  JSON.stringify(
    {
      ok: true,
      ms: Date.now() - started,
      input: inputPath,
      output: outDir,
      asOf: summary.asOf,
      protocols: summary.nProtocols,
      ranked: summary.nRanked,
      watchlist: `${summary.nWatchlistRanked}/${summary.nWatchlist}`,
      valueSet: summary.nValue,
      valueKept: summary.valueKept,
      powerLaw: `10^${summary.powerIntercept.toFixed(2)} x TVL^${summary.powerSlope.toFixed(3)}`,
      looMiss: Math.round(summary.looMiss * 100) / 100,
      wfMiss: Math.round(summary.wfMiss * 100) / 100,
      flatLoo: Math.round(summary.flatLoo * 100) / 100,
      flatWf: Math.round(summary.flatWf * 100) / 100,
      looImprovePct: Math.round(summary.looImprove * 100),
      wfImprovePct: Math.round(summary.wfImprove * 100),
      p2575: `${Math.round(summary.p2575Loo * 100)}%/${Math.round(summary.p2575Wf * 100)}%`,
      p1090: `${Math.round(summary.p1090Loo * 100)}%/${Math.round(summary.p1090Wf * 100)}%`,
      within3x: `${Math.round(summary.within3xLoo * 100)}%/${Math.round(summary.within3xWf * 100)}%`,
      spearman: Math.round(summary.spearman * 100) / 100,
      oddsKept: summary.oddsKept,
      brierLoo: Math.round(summary.brierLoo * 1000) / 1000,
      brierWf: Math.round(summary.brierWf * 1000) / 1000,
      brierBase: Math.round(summary.brierBase * 1000) / 1000,
      oddsAccWf: Math.round(summary.oddsAccWf * 100),
      oddsAccBase: Math.round(summary.oddsAccBase * 100),
      oddsAccLoo: Math.round(summary.oddsAccLoo * 100),
      verdicts: summary.verdicts,
      top30: summary.top30,
      bestHour: Math.round(summary.bestHour * 100) / 100,
      totalImplied: summary.totalImplied,
      valueTable: summary.valueTable,
      oddsTable: summary.oddsTable,
      valueBeta: summary.valueBeta,
      valueXmean: summary.valueXmean,
      boardSha256: boardSha,
      dossierSha256: dossierSha,
      dossierBytes: dossier.length,
      controls: DEFAULT_CONTROLS,
    },
    null,
    1,
  ),
);
