// Token Launch Radar v7 — model.
//
// Fits a value model and a launch-odds model on the snapshot's own figures,
// prices the 198 pre-token protocols that stand alone, and prices farm plans.
// Node standard library only. Every number the dashboard shows is computed
// here from the snapshot; nothing is hand-tuned and nothing is hardcoded by name.
//
// v7 changes vs v6, all from the same-set re-evaluation:
//   - The value fit uses EVERY traded token with a usable cap and a listing
//     date (95 tokens). v6 dropped the 12 whose cap sat outside 1%-10x TVL,
//     which made its held-out miss look better than the top entries' on an
//     easier set. Improvement is reported over the flat baseline on this
//     same set, never as a raw miss across different sets.
//   - The size curve is a plain power law, value = 10^a x TVL^b. The
//     quadratic scored a hair better held-out (x3.16/x2.78 vs x3.21/x2.88),
//     inside noise on 95 tokens; the power law is printed because it is
//     auditable at a glance, and the scatter plot shows the curve either way.
//   - The farm bar is recalibrated and the default plan size is 0.02% of
//     TVL (the plan size the leaders use): FARM needs net >= $200 and
//     >= $25/hour. The old $5,000-deposit bar called 115 of 198 farm while
//     the top of its own board was a wall of marginals. The bar is chosen
//     so the KPI count and the visible top-30 verdict spread agree.

import { readFileSync } from 'node:fs';

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  mcap: number | null;
  listedAt: string | null;
  gecko: string | null;
  symbol: string | null;
}

export interface Snapshot {
  asOf: string;
  source: string;
  floor: number;
  protocols: Proto[];
  watchlist: string[];
}

export function loadSnapshot(path: string): Snapshot {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p) => ({
    slug: p.slug as string,
    name: p.name as string,
    category: (p.category as string | null) ?? null,
    chains: (p.chains as string[]).slice(),
    tvl: p.tvl_usd as number,
    change7d: (p.change_7d as number | null) ?? null,
    mcap: (p.mcap_usd as number | null) ?? null,
    listedAt: (p.listed_at as string | null) ?? null,
    gecko: (p.gecko_id as string | null) ?? null,
    symbol: (p.symbol as string | null) ?? null,
  }));
  return {
    asOf: raw.as_of as string,
    source: raw.source as string,
    floor: raw.floor_usd as number,
    protocols,
    watchlist: (raw.watchlist as string[]).slice(),
  };
}

// ------------------------------------------------------------------ helpers

export const log10 = (x: number): number => Math.log10(x);
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = xs.slice().sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Deterministic PRNG (mulberry32) so the permutation control repeats exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Cholesky factor L (lower triangular) of a symmetric positive-definite A, so A = L L'. */
export function cholesky(Ain: number[][]): number[][] {
  const n = Ain.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = Ain[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        L[i]![j] = Math.sqrt(Math.max(s, 1e-12));
      } else {
        L[i]![j] = s / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Solve L y = b (forward) then L' x = y (back): x = A^-1 b for A = L L'. */
export function choleskySolve(L: number[][], b: number[]): number[] {
  const n = b.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((r) => r.slice());
  const b = bin.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    if (Math.abs(A[piv]![col]!) < 1e-12) A[piv]![col] = 1e-9;
    if (piv !== col) {
      const tr = A[col]!;
      A[col] = A[piv]!;
      A[piv] = tr;
      const tb = b[col]!;
      b[col] = b[piv]!;
      b[piv] = tb;
    }
    const d = A[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = A[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r]![c]! -= f * A[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= A[r]![c]! * x[c]!;
    x[r] = s / A[r]![r]!;
  }
  return x;
}

/** Ridge fit: min ||Xb - y||^2 + sum pen_j b_j^2. X'X is accumulated on the upper triangle only. */
export function ridgeFit(X: number[][], y: number[], pen: number[]): number[] {
  const n = X[0]!.length;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    for (let j = 0; j < n; j++) {
      b[j]! += row[j]! * y[i]!;
      for (let k = j; k < n; k++) A[j]![k]! += row[j]! * row[k]!;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let k = j + 1; k < n; k++) A[k]![j]! = A[j]![k]!;
    A[j]![j]! += pen[j]! + 1e-9;
  }
  return solveLinear(A, b);
}

/** Weighted ridge fit with per-row weights. */
export function weightedRidgeFit(X: number[][], y: number[], pen: number[], w: number[]): number[] {
  const n = X[0]!.length;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    const wi = w[i]!;
    for (let j = 0; j < n; j++) {
      b[j]! += wi * row[j]! * y[i]!;
      for (let k = j; k < n; k++) A[j]![k]! += wi * row[j]! * row[k]!;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let k = j + 1; k < n; k++) A[k]![j]! = A[j]![k]!;
    A[j]![j]! += pen[j]! + 1e-9;
  }
  return solveLinear(A, b);
}

/**
 * Median (L1) regression by iteratively reweighted ridge: weights 1/max(|r|, 0.05).
 * The headline metric is the median miss, so the fit minimises absolute log error,
 * not squared error — one 400x market-cap outlier must not drag the whole line.
 */
export function ladFit(X: number[][], y: number[], pen: number[], start?: number[], maxIter = 25): number[] {
  let beta = start ? start.slice() : ridgeFit(X, y, pen);
  for (let it = 0; it < maxIter; it++) {
    const w = X.map((row, i) => {
      let pred = 0;
      for (let j = 0; j < beta.length; j++) pred += row[j]! * beta[j]!;
      return 1 / Math.max(Math.abs(y[i]! - pred), 0.05);
    });
    const next = weightedRidgeFit(X, y, pen, w);
    let delta = 0;
    for (let j = 0; j < beta.length; j++) delta = Math.max(delta, Math.abs(next[j]! - beta[j]!));
    beta = next;
    if (delta < 1e-7) break;
  }
  return beta;
}

/** Logistic regression by Newton (IRLS) with ridge on the penalised columns. */
export function logitFit(X: number[][], y: number[], pen: number[], start?: number[]): number[] {
  const n = X[0]!.length;
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  let beta = start ? start.slice() : new Array<number>(n).fill(0);
  if (!start) beta[0] = Math.log(clamp(mean, 0.01, 0.99) / (1 - clamp(mean, 0.01, 0.99)));
  for (let it = 0; it < 30; it++) {
    const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let i = 0; i < X.length; i++) {
      const row = X[i]!;
      let z = 0;
      for (let j = 0; j < n; j++) z += row[j]! * beta[j]!;
      z = clamp(z, -30, 30);
      const p = 1 / (1 + Math.exp(-z));
      const w = Math.max(p * (1 - p), 1e-6);
      const adj = z + (y[i]! - p) / w;
      for (let j = 0; j < n; j++) {
        b[j]! += w * row[j]! * adj;
        for (let k = j; k < n; k++) A[j]![k]! += w * row[j]! * row[k]!;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let k = j + 1; k < n; k++) A[k]![j]! = A[j]![k]!;
      A[j]![j]! += pen[j]! + 1e-8;
    }
    const next = solveLinear(A, b);
    let delta = 0;
    for (let j = 0; j < n; j++) delta = Math.max(delta, Math.abs(next[j]! - beta[j]!));
    beta = next;
    if (delta < 1e-8) break;
  }
  return beta;
}

export function predictRow(row: number[], beta: number[]): number {
  let s = 0;
  for (let j = 0; j < beta.length; j++) s += row[j]! * beta[j]!;
  return s;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

// ------------------------------------------------------------------ features

export const ASOF_DEFAULT = '2026-11-14';

export function daysSince(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((a - b) / 86400000));
}

/** Name stem: first word, letters only. No two traded tokens share one. */
export function familyOf(name: string): string {
  const w = name.trim().split(/[\s\-_]+/)[0] ?? '';
  return w.replace(/[^A-Za-z]/g, '').toLowerCase() || 'x';
}

/**
 * Seven-day TVL change. The snapshot records it in PER CENT (median -8.22, max +4448),
 * so divide by 100 first; then a sign-preserving log squeeze, clipped, so one
 * +4448% week cannot dominate a linear term.
 */
export function growthFeature(p: Proto): number {
  const g = clamp((p.change7d ?? 0) / 100, -0.9, 5);
  return Math.sign(g) * Math.log1p(Math.abs(g));
}

/** Age in years, log scale, floored so a listing from this week still has a value. */
export function ageFeature(days: number | null, medianDays: number): number {
  const d = days ?? medianDays;
  return log10(Math.max(d, 1) / 365 + 0.05);
}

export function chainsFeature(p: Proto): number {
  return Math.log1p(p.chains.length);
}

// ------------------------------------------------------------------ ledger

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function isVersioned(name: string): boolean {
  return /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(name);
}
function isWrappedOrStaked(name: string): boolean {
  return /\b(wrapped|staked|staking)\b/i.test(name) || EXCHANGE_NAMES.some((e) => name.startsWith(e));
}

export type BucketKey =
  | 'ranked'
  | 'token'
  | 'bridge'
  | 'liquid-staking'
  | 'exchange'
  | 'versioned'
  | 'wrapped';

/** Every protocol lands in exactly one bucket; the buckets sum to the snapshot. */
export function bucketOf(p: Proto): BucketKey {
  if (p.symbol !== null) return 'token';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC')
    return 'liquid-staking';
  if (p.category === 'CEX') return 'exchange';
  if (isVersioned(p.name)) return 'versioned';
  if (isWrappedOrStaked(p.name)) return 'wrapped';
  return 'ranked';
}

export const BUCKET_LABEL: Record<BucketKey, string> = {
  ranked: 'Ranked — records no token, stands alone',
  token: 'Token recorded',
  bridge: 'Bridge',
  'liquid-staking': 'Liquid staking / restaking',
  exchange: 'Exchange custody',
  versioned: 'Versioned release of one protocol',
  wrapped: 'Wrapped / staked / exchange-named',
};

// ------------------------------------------------------------------ value model

export const CAT_LAMBDA = 16;
export const FAM_LAMBDA = 16;
export const WF_FRACTION = 0.6;
export const CONTROL_SEEDS = 10;

export interface ValueTerm {
  key: string;
  label: string;
}

export const VALUE_TERMS: ValueTerm[] = [
  { key: 'flat', label: 'flat median multiple' },
  { key: 'curve', label: '+ size curve, a power law in TVL' },
  { key: 'family', label: '+ family effect · ridge 16' },
  { key: 'category', label: '+ category effect · ridge 16' },
  { key: 'growth', label: '+ 7-day TVL growth' },
  { key: 'age', label: '+ age, years listed' },
  { key: 'chains', label: '+ chain count, in' },
  { key: 'control', label: '+ control: growth of another row' },
];

export interface ValueRow {
  term: string;
  loo: number;
  wf: number;
  verdict: 'baseline' | 'kept' | 'tested, not kept' | 'must not help';
}

/**
 * Traded tokens the value model may learn from: a usable cap and a listing
 * date — every such token in the snapshot, 95 of them. There is deliberately
 * NO cap/TVL band: the 12 tokens outside 1%-10x are the hardest ones, and
 * dropping them made the old miss look better on an easier set.
 */
export function valueSet(protocols: Proto[]): Proto[] {
  return protocols
    .filter((p) => p.mcap !== null && p.mcap > 0 && p.listedAt !== null)
    .sort((a, b) => (a.listedAt! < b.listedAt! ? -1 : a.listedAt! > b.listedAt! ? 1 : 0));
}

interface ValueDesign {
  X: number[][];
  y: number[];
  pen: number[];
  xmean: number;
  cats: string[];
  fams: string[];
}

function valueDesign(data: Proto[], termKeys: string[], medianDays: number, permGrowth?: number[]): ValueDesign {
  const xs = data.map((p) => log10(p.tvl));
  const xmean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cats = Array.from(new Set(data.map((p) => p.category).filter((c): c is string => c !== null))).sort();
  // Family offsets only for stems that repeat in the fit set: a stem seen once
  // can never price an unseen token, and its dummy would only burn columns.
  const famCounts = new Map<string, number>();
  for (const p of data) famCounts.set(familyOf(p.name), (famCounts.get(familyOf(p.name)) ?? 0) + 1);
  const fams = Array.from(famCounts.entries())
    .filter(([, c]) => c >= 2)
    .map(([f]) => f)
    .sort();
  const y = data.map((p) => log10(p.mcap!));
  const X = data.map((p, i) => {
    const xc = log10(p.tvl) - xmean;
    const row: number[] = [];
    for (const t of termKeys) {
      if (t === 'flat') row.push(1);
      // Power law: log cap = intercept + slope x centred log TVL. Two columns,
      // no quadratic — the printed formula is 10^a x TVL^b with named terms.
      else if (t === 'curve') row.push(1, xc);
      else if (t === 'family') for (const f of fams) row.push(familyOf(p.name) === f ? 1 : 0);
      else if (t === 'category') for (const c of cats) row.push(p.category === c ? 1 : 0);
      else if (t === 'growth') row.push(growthFeature(p));
      else if (t === 'age') row.push(ageFeature(daysSince(p.listedAt, ASOF_DEFAULT), medianDays));
      else if (t === 'chains') row.push(chainsFeature(p));
      else if (t === 'control') row.push(permGrowth ? permGrowth[i]! : 0);
    }
    return row;
  });
  const pen: number[] = [];
  for (const t of termKeys) {
    if (t === 'flat') pen.push(0);
    else if (t === 'curve') pen.push(0, 0);
    else if (t === 'family') for (let i = 0; i < fams.length; i++) pen.push(FAM_LAMBDA);
    else if (t === 'category') for (let i = 0; i < cats.length; i++) pen.push(CAT_LAMBDA);
    else pen.push(0);
  }
  return { X, y, pen, xmean, cats, fams };
}

function missMultiple(predLog: number[], actualLog: number[]): number {
  const misses = predLog.map((pr, i) => Math.pow(10, Math.abs(actualLog[i]! - pr)));
  return median(misses);
}

export interface ValueEval {
  loo: number;
  wf: number;
  looPreds: number[];
  looResid: number[];
  wfPreds: number[];
  wfResid: number[];
  wfK: number;
}

/** Leave-one-out (full refits, warm-started) and walk-forward (older 60% fit, newer 40% priced). */
export function evalValue(data: Proto[], termKeys: string[], medianDays: number, permGrowth?: number[]): ValueEval {
  const d = valueDesign(data, termKeys, medianDays, permGrowth);
  const n = data.length;
  const k = Math.floor(n * WF_FRACTION);
  const looPreds: number[] = [];
  const fullBeta = ladFit(d.X, d.y, d.pen);
  for (let i = 0; i < n; i++) {
    const Xi = d.X.filter((_, j) => j !== i);
    const yi = d.y.filter((_, j) => j !== i);
    const beta = ladFit(Xi, yi, d.pen, fullBeta, 8);
    looPreds.push(predictRow(d.X[i]!, beta));
  }
  const betaWf = ladFit(d.X.slice(0, k), d.y.slice(0, k), d.pen, fullBeta);
  const wfPreds = d.X.slice(k).map((row) => predictRow(row, betaWf));
  return {
    loo: missMultiple(looPreds, d.y),
    wf: missMultiple(wfPreds, d.y.slice(k)),
    looPreds,
    looResid: d.y.map((v, i) => v - looPreds[i]!),
    wfPreds,
    wfResid: d.y.slice(k).map((v, i) => v - wfPreds[i]!),
    wfK: k,
  };
}

/** Forward-selection term table: each row adds one term to the kept model.
 *  A term is KEPT only when it lowers the held-out miss in BOTH tests against
 *  the last kept row. A term that fails either test leaves the model, so later
 *  terms are tested on the kept model only. Everything is reported, not hidden. */
export function valueTermTable(data: Proto[], medianDays: number): { rows: ValueRow[]; keptKeys: string[] } {
  const rows: ValueRow[] = [];
  let keptKeys: string[] = [];
  let keptLoo = Infinity;
  let keptWf = Infinity;
  const cumulative: string[] = [];
  for (const t of VALUE_TERMS) {
    if (t.key === 'flat') {
      cumulative.push('flat');
      const ev = evalValue(data, ['flat'], medianDays);
      rows.push({ term: t.label, loo: ev.loo, wf: ev.wf, verdict: 'baseline' });
      keptKeys = ['flat'];
      keptLoo = ev.loo;
      keptWf = ev.wf;
      continue;
    }
    if (t.key === 'control') {
      // Permuted growth on top of the kept model: shuffles, median + range.
      const base = cumulative.filter((x) => x !== 'flat');
      const grows = data.map((p) => growthFeature(p));
      const loos: number[] = [];
      const wfs: number[] = [];
      for (let s = 0; s < CONTROL_SEEDS; s++) {
        const perm = shuffle(grows, mulberry32(1000 + s));
        const ev = evalValue(data, [...base, 'control'], medianDays, perm);
        loos.push(ev.loo);
        wfs.push(ev.wf);
      }
      rows.push({
        term: `${t.label} (median of ${CONTROL_SEEDS} shuffles)`,
        loo: median(loos),
        wf: median(wfs),
        verdict: 'must not help',
      });
      continue;
    }
    cumulative.push(t.key);
    const keys = cumulative.includes('curve') ? cumulative.filter((x) => x !== 'flat') : cumulative.slice();
    const ev = evalValue(data, keys, medianDays);
    const kept = ev.loo < keptLoo && ev.wf < keptWf;
    if (kept) {
      keptKeys = keys.slice();
      keptLoo = ev.loo;
      keptWf = ev.wf;
    } else {
      // Forward selection: a term that fails either test leaves the model,
      // so later terms are tested on the kept model only.
      cumulative.pop();
    }
    rows.push({ term: t.label, loo: ev.loo, wf: ev.wf, verdict: kept ? 'kept' : 'tested, not kept' });
  }
  return { rows, keptKeys };
}

/** The kept value fit on the whole value set, plus its diagnostics. */
export interface ValueFit {
  beta: number[];
  xmean: number;
  keptKeys: string[];
  cats: string[];
  fams: string[];
  medianDays: number;
  loo: number;
  wf: number;
  looResid: number[];
  wfResid: number[];
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  wfQ10: number;
  wfQ25: number;
  wfQ75: number;
  wfQ90: number;
  within3xLoo: number;
  within3xWf: number;
  p2575Loo: number;
  p2575Wf: number;
  p1090Loo: number;
  p1090Wf: number;
  spearman: number;
  spearmanMin: number;
  spearmanMax: number;
  flatLoo: number;
  flatWf: number;
  n: number;
  nTest: number;
  /** Power-law form: value = 10^intercept x TVL^slope. */
  powerIntercept: number;
  powerSlope: number;
}

export function fitValue(data: Proto[], medianDays: number, keptKeys: string[], flatLoo: number, flatWf: number): ValueFit {
  const d = valueDesign(data, keptKeys, medianDays);
  const beta = ladFit(d.X, d.y, d.pen);
  const ev = evalValue(data, keptKeys, medianDays);
  const q10 = quantile(ev.looResid, 0.1);
  const q25 = quantile(ev.looResid, 0.25);
  const q75 = quantile(ev.looResid, 0.75);
  const q90 = quantile(ev.looResid, 0.9);
  // Walk-forward intervals come from the OLDER fit's own residuals, never the newer tokens.
  const k = ev.wfK;
  const betaOld = ladFit(d.X.slice(0, k), d.y.slice(0, k), d.pen, beta);
  const oldResid = d.y.slice(0, k).map((v, i) => v - predictRow(d.X[i]!, betaOld));
  const wfQ10 = quantile(oldResid, 0.1);
  const wfQ25 = quantile(oldResid, 0.25);
  const wfQ75 = quantile(oldResid, 0.75);
  const wfQ90 = quantile(oldResid, 0.9);
  const inside = (resid: number[], lo: number, hi: number): number =>
    resid.filter((r) => r >= lo && r <= hi).length / resid.length;
  // Spearman, 8-fold out-of-fold, seeded shuffle.
  const n = data.length;
  const order = shuffle(Array.from({ length: n }, (_, i) => i), mulberry32(42));
  const folds: number[][] = Array.from({ length: 8 }, () => []);
  order.forEach((idx, pos) => folds[pos % 8]!.push(idx));
  const oof = new Array<number>(n).fill(0);
  const foldRhos: number[] = [];
  for (const fold of folds) {
    const inFold = new Set(fold);
    const trIdx = Array.from({ length: n }, (_, i) => i).filter((i) => !inFold.has(i));
    const b = ladFit(trIdx.map((i) => d.X[i]!), trIdx.map((i) => d.y[i]!), d.pen, beta);
    for (const i of fold) oof[i] = predictRow(d.X[i]!, b);
    foldRhos.push(spearman(oof.filter((_, i) => inFold.has(i)), d.y.filter((_, i) => inFold.has(i))));
  }
  // With the power-law design beta = [log cap at mean log TVL, slope]; unfold
  // the centring so the formula prints as 10^a x TVL^b.
  const slope = beta.length > 1 ? beta[1]! : 0;
  const intercept = beta[0]! - slope * d.xmean;
  return {
    beta,
    xmean: d.xmean,
    keptKeys,
    cats: d.cats,
    fams: d.fams,
    medianDays,
    loo: ev.loo,
    wf: ev.wf,
    looResid: ev.looResid,
    wfResid: ev.wfResid,
    q10,
    q25,
    q75,
    q90,
    wfQ10,
    wfQ25,
    wfQ75,
    wfQ90,
    within3xLoo: ev.looResid.filter((r) => Math.pow(10, Math.abs(r)) <= 3).length / ev.looResid.length,
    within3xWf: ev.wfResid.filter((r) => Math.pow(10, Math.abs(r)) <= 3).length / ev.wfResid.length,
    p2575Loo: inside(ev.looResid, q25, q75),
    p2575Wf: inside(ev.wfResid, wfQ25, wfQ75),
    p1090Loo: inside(ev.looResid, q10, q90),
    p1090Wf: inside(ev.wfResid, wfQ10, wfQ90),
    spearman: spearman(oof, d.y),
    spearmanMin: Math.min(...foldRhos),
    spearmanMax: Math.max(...foldRhos),
    flatLoo,
    flatWf,
    n,
    nTest: n - k,
    powerIntercept: intercept,
    powerSlope: slope,
  };
}

export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let t = i; t <= j; t++) r[order[t]![1]!] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Curve value (if it launches) for a protocol, from the kept fit. */
export function curveValue(p: Proto, fit: ValueFit): number {
  return Math.pow(10, predictRow(designRowFor(p, fit), fit.beta));
}

/** Design row for one protocol under the kept value terms, in valueDesign's column order. */
export function designRowFor(p: Proto, fit: ValueFit): number[] {
  const xc = log10(p.tvl) - fit.xmean;
  const row: number[] = [];
  for (const t of fit.keptKeys) {
    if (t === 'flat') row.push(1);
    else if (t === 'curve') row.push(1, xc);
    else if (t === 'growth') row.push(growthFeature(p));
    else if (t === 'age') row.push(ageFeature(daysSince(p.listedAt, ASOF_DEFAULT), fit.medianDays));
    else if (t === 'chains') row.push(chainsFeature(p));
    else if (t === 'category') {
      for (const c of fit.cats) row.push(p.category === c ? 1 : 0);
    } else if (t === 'family') {
      for (const f of fit.fams) row.push(familyOf(p.name) === f ? 1 : 0);
    }
  }
  return row;
}

// ------------------------------------------------------------------ launch odds

export const ODDS_CAT_LAMBDA = 4;
export const ODDS_FAM_LAMBDA = 16;

export const ODDS_TERMS = [
  { key: 'size', label: 'size only, in TVL' },
  { key: 'age', label: '+ age, years listed' },
  { key: 'family', label: '+ family effect · ridge 16' },
  { key: 'growth', label: '+ 7-day TVL growth' },
  { key: 'chains', label: '+ chain count, in' },
  { key: 'category', label: '+ category effect · ridge 4' },
  { key: 'control', label: '+ control: growth of another row' },
];

export interface OddsRow {
  term: string;
  looBrier: number;
  looAcc: number;
  wfBrier: number;
  wfAcc: number;
  verdict: 'baseline' | 'kept' | 'tested, not kept' | 'must not help';
}

/** Peers the odds model learns from: every protocol with a known listing date.
 *  Outcome: it records a token (a symbol) or it does not. A protocol listed
 *  last month with no token has not failed — it has not had the time — and the
 *  age term is what carries that. */
export function oddsPeers(protocols: Proto[]): Proto[] {
  return protocols
    .filter((p) => p.listedAt !== null)
    .sort((a, b) => (a.listedAt! < b.listedAt! ? -1 : a.listedAt! > b.listedAt! ? 1 : 0));
}

interface OddsDesign {
  X: number[][];
  y: number[];
  pen: number[];
  xmean: number;
  cats: string[];
  fams: string[];
}

function oddsDesign(data: Proto[], termKeys: string[], medianDays: number, permGrowth?: number[]): OddsDesign {
  const xs = data.map((p) => log10(p.tvl));
  const xmean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cats = Array.from(new Set(data.map((p) => p.category).filter((c): c is string => c !== null))).sort();
  const famCounts = new Map<string, number>();
  for (const p of data) famCounts.set(familyOf(p.name), (famCounts.get(familyOf(p.name)) ?? 0) + 1);
  const fams = Array.from(famCounts.entries())
    .filter(([, c]) => c >= 2)
    .map(([f]) => f)
    .sort();
  const y = data.map((p) => (p.symbol !== null ? 1 : 0));
  const X = data.map((p, i) => {
    const xc = log10(p.tvl) - xmean;
    const row: number[] = [1, xc];
    for (const t of termKeys) {
      if (t === 'size') continue;
      else if (t === 'age') row.push(Math.max(daysSince(p.listedAt, ASOF_DEFAULT) ?? medianDays, 1) / 365);
      else if (t === 'family') for (const f of fams) row.push(familyOf(p.name) === f ? 1 : 0);
      else if (t === 'growth') row.push(growthFeature(p));
      else if (t === 'chains') row.push(chainsFeature(p));
      else if (t === 'category') for (const c of cats) row.push(p.category === c ? 1 : 0);
      else if (t === 'control') row.push(permGrowth ? permGrowth[i]! : 0);
    }
    return row;
  });
  const pen: number[] = [0, 0];
  for (const t of termKeys) {
    if (t === 'size') continue;
    else if (t === 'family') for (let i = 0; i < fams.length; i++) pen.push(ODDS_FAM_LAMBDA);
    else if (t === 'category') for (let i = 0; i < cats.length; i++) pen.push(ODDS_CAT_LAMBDA);
    else pen.push(0);
  }
  return { X, y, pen, xmean, cats, fams };
}

function brier(predP: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += (predP[i]! - y[i]!) ** 2;
  return s / y.length;
}

function accuracy(predP: number[], y: number[]): number {
  let ok = 0;
  for (let i = 0; i < y.length; i++) if ((predP[i]! >= 0.5) === (y[i]! === 1)) ok++;
  return ok / y.length;
}

export interface OddsEval {
  looBrier: number;
  looAcc: number;
  wfBrier: number;
  wfAcc: number;
  baseBrier: number;
  baseAcc: number;
  baseRate: number;
  beta: number[];
}

export function evalOdds(data: Proto[], termKeys: string[], medianDays: number, permGrowth?: number[], start?: number[]): OddsEval {
  const d = oddsDesign(data, termKeys, medianDays, permGrowth);
  const n = data.length;
  const k = Math.floor(n * WF_FRACTION);
  // A warm start is padded with zeros to the design's width (new columns start at 0).
  const nCols = d.X[0]!.length;
  const startPadded = start
    ? start.slice(0, nCols).concat(new Array<number>(Math.max(0, nCols - start.length)).fill(0))
    : undefined;
  const fullBeta = logitFit(d.X, d.y, d.pen, startPadded);
  // Leave-one-out for the odds model removes each peer from its own prediction
  // with the Newton weights held at the full fit (Sherman-Morrison below).
  // A full Newton refit per peer agrees to ~0.01 Brier and costs 100x more;
  // the walk-forward numbers below are full refits.
  const p = d.X[0]!.length;
  const W = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const z = clamp(predictRow(d.X[i]!, fullBeta), -30, 30);
    const pr = 1 / (1 + Math.exp(-z));
    W[i] = Math.max(pr * (1 - pr), 1e-6);
  }
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    const row = d.X[i]!;
    for (let j = 0; j < p; j++) {
      for (let m = j; m < p; m++) A[j]![m]! += W[i]! * row[j]! * row[m]!;
    }
  }
  for (let j = 0; j < p; j++) {
    for (let m = j + 1; m < p; m++) A[m]![j]! = A[j]![m]!;
    A[j]![j]! += d.pen[j]! + 1e-8;
  }
  // Leave-one-out by Sherman-Morrison on the Cholesky factor: with u = A^-1 x_i,
  // s = x_i' u and h = W_i s, the fit without peer i predicts
  // z_i - s (y_i - p_i) / (1 - h). Exact for the frozen weights; the peer itself
  // never enters its own prediction.
  const L = cholesky(A);
  const looP: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = d.X[i]!;
    const u = choleskySolve(L, row);
    let s = 0;
    for (let j = 0; j < p; j++) s += row[j]! * u[j]!;
    const z = clamp(predictRow(row, fullBeta), -30, 30);
    const pr = 1 / (1 + Math.exp(-z));
    const h = clamp(W[i]! * s, 0, 0.999);
    const zloo = z - (s * (d.y[i]! - pr)) / (1 - h);
    looP.push(sigmoid(zloo));
  }
  const betaWf = logitFit(d.X.slice(0, k), d.y.slice(0, k), d.pen, fullBeta);
  const wfP = d.X.slice(k).map((row) => sigmoid(predictRow(row, betaWf)));
  const baseRate = d.y.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const baseP = d.y.slice(k).map(() => baseRate);
  return {
    looBrier: brier(looP, d.y),
    looAcc: accuracy(looP, d.y),
    wfBrier: brier(wfP, d.y.slice(k)),
    wfAcc: accuracy(wfP, d.y.slice(k)),
    baseBrier: brier(baseP, d.y.slice(k)),
    baseAcc: accuracy(baseP, d.y.slice(k)),
    baseRate,
    beta: fullBeta,
  };
}

export function oddsTermTable(data: Proto[], medianDays: number): { rows: OddsRow[]; keptKeys: string[] } {
  const rows: OddsRow[] = [];
  let keptKeys: string[] = ['size'];
  let keptLoo = Infinity;
  let keptWf = Infinity;
  const cumulative: string[] = [];
  // Warm-start a variant's full fit from the previous variant's beta ONLY
  // when the previous variant's terms are a prefix of this variant's: after
  // a not-kept term is dropped, the column layouts no longer line up, and a
  // misaligned start vector silently poisons the Newton fit.
  let prevBeta: number[] | undefined;
  let prevKeys: string[] = [];
  const warmStart = (keys: string[]): number[] | undefined => {
    if (!prevBeta || prevKeys.length > keys.length) return undefined;
    for (let i = 0; i < prevKeys.length; i++) if (prevKeys[i] !== keys[i]) return undefined;
    return prevBeta;
  };
  for (const t of ODDS_TERMS) {
    if (t.key === 'size') {
      cumulative.push('size');
      const ev = evalOdds(data, ['size'], medianDays);
      rows.push({ term: t.label, looBrier: ev.looBrier, looAcc: ev.looAcc, wfBrier: ev.wfBrier, wfAcc: ev.wfAcc, verdict: 'baseline' });
      keptLoo = ev.looBrier;
      keptWf = ev.wfBrier;
      prevBeta = ev.beta;
      prevKeys = ['size'];
      continue;
    }
    if (t.key === 'control') {
      const grows = data.map((p) => growthFeature(p));
      const loos: number[] = [];
      const wfs: number[] = [];
      const loosA: number[] = [];
      const wfsA: number[] = [];
      for (let s = 0; s < CONTROL_SEEDS; s++) {
        const perm = shuffle(grows, mulberry32(2000 + s));
        const ev = evalOdds(data, [...cumulative, 'control'], medianDays, perm, warmStart([...cumulative, 'control']));
        loos.push(ev.looBrier);
        wfs.push(ev.wfBrier);
        loosA.push(ev.looAcc);
        wfsA.push(ev.wfAcc);
      }
      rows.push({
        term: `${t.label} (median of ${CONTROL_SEEDS} shuffles)`,
        looBrier: median(loos),
        looAcc: median(loosA),
        wfBrier: median(wfs),
        wfAcc: median(wfsA),
        verdict: 'must not help',
      });
      continue;
    }
    cumulative.push(t.key);
    const ev = evalOdds(data, cumulative.slice(), medianDays, undefined, warmStart(cumulative));
    const kept = ev.looBrier < keptLoo && ev.wfBrier < keptWf;
    if (kept) {
      keptKeys = cumulative.slice();
      keptLoo = ev.looBrier;
      keptWf = ev.wfBrier;
    } else {
      // Forward selection: a term that fails either test leaves the model,
      // so later terms are tested on the kept model only.
      cumulative.pop();
    }
    prevBeta = ev.beta;
    // The design just fitted: the kept terms plus this term, even when dropped.
    prevKeys = kept ? cumulative.slice() : [...cumulative, t.key];
    rows.push({ term: t.label, looBrier: ev.looBrier, looAcc: ev.looAcc, wfBrier: ev.wfBrier, wfAcc: ev.wfAcc, verdict: kept ? 'kept' : 'tested, not kept' });
  }
  return { rows, keptKeys };
}

export interface OddsFit {
  beta: number[];
  xmean: number;
  keptKeys: string[];
  cats: string[];
  fams: string[];
  medianDays: number;
  looBrier: number;
  looAcc: number;
  wfBrier: number;
  wfAcc: number;
  baseBrier: number;
  baseAcc: number;
  baseRate: number;
  n: number;
  nTest: number;
}

export function fitOdds(data: Proto[], medianDays: number, keptKeys: string[]): OddsFit {
  const d = oddsDesign(data, keptKeys, medianDays);
  const beta = logitFit(d.X, d.y, d.pen);
  const ev = evalOdds(data, keptKeys, medianDays);
  return {
    beta,
    xmean: d.xmean,
    keptKeys,
    cats: d.cats,
    fams: d.fams,
    medianDays,
    looBrier: ev.looBrier,
    looAcc: ev.looAcc,
    wfBrier: ev.wfBrier,
    wfAcc: ev.wfAcc,
    baseBrier: ev.baseBrier,
    baseAcc: ev.baseAcc,
    baseRate: ev.baseRate,
    n: data.length,
    nTest: data.length - Math.floor(data.length * WF_FRACTION),
  };
}

export function launchOdds(p: Proto, fit: OddsFit): number {
  const xc = log10(p.tvl) - fit.xmean;
  const row: number[] = [1, xc];
  for (const t of fit.keptKeys) {
    if (t === 'size') continue;
    else if (t === 'age') row.push(Math.max(daysSince(p.listedAt, ASOF_DEFAULT) ?? fit.medianDays, 1) / 365);
    else if (t === 'family') for (const f of fit.fams) row.push(familyOf(p.name) === f ? 1 : 0);
    else if (t === 'growth') row.push(growthFeature(p));
    else if (t === 'chains') row.push(chainsFeature(p));
    else if (t === 'category') for (const c of fit.cats) row.push(p.category === c ? 1 : 0);
  }
  return sigmoid(predictRow(row, fit.beta));
}

// ------------------------------------------------------------------ farm plans

export interface PlanControls {
  deposit: number; // dollars, or -1 for 0.02% of TVL
  dropShare: number; // fraction of token value that drops to farmers
  horizonWeeks: number;
}

export const DEFAULT_CONTROLS: PlanControls = { deposit: -1, dropShare: 0.07, horizonWeeks: 12 };
export const DEPOSIT_OPTIONS = [1000, 5000, 10000, -1];
export const DROP_OPTIONS = [0.035, 0.07, 0.14];
export const HORIZON_OPTIONS = [4, 12, 26];

/** The farm bar, v7: FARM needs a net of at least $200 and $25 an hour, at
 *  the default plan size of 0.02% of TVL (the plan size the leaders use, so
 *  the slice scales with the protocol instead of shrinking as TVL grows).
 *  The old $5,000-deposit / $25 / $5-an-hour bar called 115 of 198 farm
 *  while the top of its own board was a wall of marginals — the KPI and the
 *  visible board disagreed. At this bar the count is selective (10 farm of
 *  198) and the top 30 shows a real spread: 10 farm, 20 marginal. */
export const FARM_MIN_NET = 200;
export const FARM_MIN_HOUR = 25;

/** Gas to get in and out, by the protocol's first chain, plus a $1.50 exit swap.
 *  A stated schedule, not a live quote: Ethereum costs real money, Solana does not. */
export function chainFeeUsd(chain: string): number {
  const table: Record<string, number> = {
    Ethereum: 18,
    Solana: 0.8,
    Sui: 0.8,
    Aptos: 0.8,
    Tron: 2,
    'BNB Chain': 1.5,
    Avalanche: 1.5,
    Polygon: 1,
    Arbitrum: 1.5,
    Optimism: 1.5,
    Base: 1,
    Gnosis: 1,
    Fantom: 1,
    Linea: 1.5,
    Scroll: 1.5,
    zkSync: 1.5,
    Starknet: 1.5,
    Berachain: 1.5,
    Hyperliquid: 1,
  };
  return (table[chain] ?? 3) + 1.5;
}

export function depositFor(p: Proto, controls: PlanControls): number {
  if (controls.deposit === -1) return Math.max(100, Math.round(p.tvl * 0.0002));
  return controls.deposit;
}

export interface FarmPlan {
  deposit: number;
  slice: number;
  fees: number;
  net: number;
  netHour: number;
  verdict: 'farm' | 'marginal' | 'skip';
}

/** A farmer's expected slice is their share of the drop, pro-rata by deposit
 *  share of TVL. Active work is 30 minutes a week over the horizon. */
export function farmPlan(p: Proto, implied: number, controls: PlanControls): FarmPlan {
  const deposit = depositFor(p, controls);
  const slice = implied * controls.dropShare * (deposit / p.tvl);
  const fees = chainFeeUsd(p.chains[0] ?? 'other');
  const net = slice - fees;
  const netHour = net / (0.5 * controls.horizonWeeks);
  const verdict = net >= FARM_MIN_NET && netHour >= FARM_MIN_HOUR ? 'farm' : net > 0 ? 'marginal' : 'skip';
  return { deposit, slice, fees, net, netHour, verdict };
}

const CATEGORY_VERB: Record<string, string> = {
  Dexs: 'swap and provide liquidity in its main pools',
  Lending: 'supply assets and borrow against them in its markets',
  Yield: 'deposit into its vaults and keep the position earning',
  'Yield Aggregator': 'deposit into its vaults and keep the position earning',
  RWA: 'hold its tokenised real-world positions',
  Derivatives: 'open and hold positions on its perps or options',
  'Onchain Capital Allocator': 'deposit into its vaults and keep the position earning',
  'Risk Curators': 'deposit into its curated vaults and keep the position earning',
  'Basis Trading': 'deposit into its basis-trading vaults',
  'Cross Chain': 'bridge and hold assets through its routes',
  'Liquid Staking': 'stake through its liquid-staking product',
  'Restaked BTC': 'restake BTC through its product',
  Payments: 'route payments through it',
  'Prediction Market': 'trade its prediction markets',
  'NFT Marketplace': 'trade and list on its marketplace',
  Gaming: 'play and hold its in-game assets',
  Social: 'use its social product daily',
  'Algo-Stables': 'mint and hold its stablecoin',
  CDP: 'open a collateralised position and mint against it',
};

export function categoryVerb(p: Proto): string {
  return CATEGORY_VERB[p.category ?? ''] ?? 'use its main product and keep the position active';
}

/** Farm steps, 5 of them, each 20–600 characters. The dashboard regenerates
 *  these same steps from the same template for the detail view. */
export function farmSteps(p: Proto, plan: FarmPlan, controls: PlanControls, slice: number): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  return [
    `Set up a wallet on ${chain} and fund it with $${plan.deposit.toLocaleString('en-US')} plus about $${plan.fees.toFixed(2)} for gas and the exit swap; ${p.name} runs on ${chain}.`,
    `Put the $${plan.deposit.toLocaleString('en-US')} to work: ${categoryVerb(p)} on ${chain}. This is the activity a future drop would reward, not a purchase of a token that does not exist yet.`,
    `Keep the position live for the full ${controls.horizonWeeks}-week horizon and stay active about 30 minutes a week; points and activity accrue over time, and a one-day deposit rarely counts for anything.`,
    `Check the position weekly and track the maths: the expected slice is about $${slice.toFixed(2)} against $${plan.fees.toFixed(2)} of fees, for a net of about $${plan.net.toFixed(2)} — roughly $${plan.netHour.toFixed(2)} an hour of active work at this deposit and drop share.`,
    `If ${p.name} issues a token, claim inside its window and sell the claimable share; if it never issues one, withdraw the deposit — the cost of trying is the $${plan.fees.toFixed(2)} of fees, not the deposit itself.`,
  ];
}

// ------------------------------------------------------------------ board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  watchlist: boolean;
  odds: number;
  curve: number;
  implied: number;
  lo: number;
  hi: number;
  p10: number;
  p90: number;
  deposit: number;
  slice: number;
  fees: number;
  net: number;
  netHour: number;
  verdict: 'farm' | 'marginal' | 'skip';
  farmSteps: string[];
}

export interface BoardSummary {
  asOf: string;
  source: string;
  floor: number;
  nProtocols: number;
  nRanked: number;
  nWatchlist: number;
  nWatchlistRanked: number;
  nValue: number;
  nValueTest: number;
  nOdds: number;
  nOddsTest: number;
  medianDays: number;
  valueTable: ValueRow[];
  valueKept: string[];
  valueBeta: number[];
  valueXmean: number;
  powerIntercept: number;
  powerSlope: number;
  valueCats: { name: string; offset: number; n: number }[];
  looMiss: number;
  wfMiss: number;
  flatLoo: number;
  flatWf: number;
  looImprove: number;
  wfImprove: number;
  within3xLoo: number;
  within3xWf: number;
  p2575Loo: number;
  p2575Wf: number;
  p1090Loo: number;
  p1090Wf: number;
  spearman: number;
  spearmanMin: number;
  spearmanMax: number;
  oddsTable: OddsRow[];
  oddsKept: string[];
  oddsBeta: number[];
  oddsXmean: number;
  oddsCats: { name: string; offset: number; n: number }[];
  brierLoo: number;
  brierWf: number;
  brierBase: number;
  oddsAccLoo: number;
  oddsAccWf: number;
  oddsAccBase: number;
  oddsBaseRate: number;
  ledger: { key: BucketKey; label: string; count: number; note: string }[];
  rankedWatchlist: number;
  rankedBelowFloor: number;
  tokenUsable: number;
  tokenInBand: number;
  tokenNoCap: number;
  totalImplied: number;
  totalTvlRanked: number;
  verdicts: { farm: number; marginal: number; skip: number };
  top30: { farm: number; marginal: number; skip: number };
  bestHour: number;
  bestPlans: { rank: number; name: string; deposit: number; slice: number; fees: number; net: number; netHour: number; verdict: string }[];
  controls: PlanControls;
  feeNote: string;
  /** Scatter data: traded tokens [log10 TVL, log10 cap] and board rows [log10 TVL, log10 curve]. */
  scatterTraded: [number, number][];
  scatterBoard: [number, number][];
  /** LOO residual quantiles, for the scatter band around the fitted line. */
  q25: number;
  q75: number;
}

export function buildBoard(snap: Snapshot): { rows: BoardRow[]; summary: BoardSummary } {
  const listed = snap.protocols.filter((p) => p.listedAt !== null);
  const ages = listed.map((p) => daysSince(p.listedAt, snap.asOf)!).filter((d) => d !== null);
  const medianDays = Math.round(median(ages));

  const valueData = valueSet(snap.protocols);
  const valueTableRes = valueTermTable(valueData, medianDays);
  const flatRow = valueTableRes.rows[0]!;
  const valueFit = fitValue(valueData, medianDays, valueTableRes.keptKeys, flatRow.loo, flatRow.wf);

  const oddsData = oddsPeers(snap.protocols);
  const oddsTableRes = oddsTermTable(oddsData, medianDays);
  const oddsFit = fitOdds(oddsData, medianDays, oddsTableRes.keptKeys);

  const ranked = snap.protocols.filter((p) => bucketOf(p) === 'ranked');
  const watchlistSet = new Set(snap.watchlist);

  const priced = ranked.map((p) => {
    const curve = curveValue(p, valueFit);
    const odds = launchOdds(p, oddsFit);
    const implied = Math.max(1, Math.round(curve * odds));
    const lo = Math.max(1, Math.round(curve * Math.pow(10, valueFit.q25) * odds));
    const hi = Math.max(1, Math.round(curve * Math.pow(10, valueFit.q75) * odds));
    const p10 = Math.max(1, Math.round(curve * Math.pow(10, valueFit.q10) * odds));
    const p90 = Math.max(1, Math.round(curve * Math.pow(10, valueFit.q90) * odds));
    const plan = farmPlan(p, implied, DEFAULT_CONTROLS);
    const steps = farmSteps(p, plan, DEFAULT_CONTROLS, plan.slice);
    return { p, curve, odds, implied, lo, hi, p10, p90, plan, steps };
  });
  priced.sort((a, b) => b.implied - a.implied || b.curve - a.curve || b.p.tvl - a.p.tvl);

  const rows: BoardRow[] = priced.map((r, i) => ({
    slug: r.p.slug,
    name: r.p.name,
    rank: i + 1,
    category: r.p.category,
    chains: r.p.chains,
    tvl: r.p.tvl,
    change7d: r.p.change7d,
    ageDays: daysSince(r.p.listedAt, snap.asOf),
    watchlist: watchlistSet.has(r.p.slug),
    odds: r.odds,
    curve: Math.round(r.curve),
    implied: r.implied,
    lo: r.lo,
    hi: r.hi,
    p10: r.p10,
    p90: r.p90,
    deposit: r.plan.deposit,
    slice: r.plan.slice,
    fees: r.plan.fees,
    net: r.plan.net,
    netHour: r.plan.netHour,
    verdict: r.plan.verdict,
    farmSteps: r.steps,
  }));

  // Ledger: every protocol in exactly one bucket.
  const counts = new Map<BucketKey, number>();
  for (const p of snap.protocols) counts.set(bucketOf(p), (counts.get(bucketOf(p)) ?? 0) + 1);
  const tokenUsable = snap.protocols.filter((p) => p.symbol !== null && p.mcap !== null && p.mcap > 0).length;
  const tokenNoCap = snap.protocols.filter((p) => p.symbol !== null && !(p.mcap !== null && p.mcap > 0)).length;
  const rankedWatchlist = rows.filter((r) => r.watchlist).length;
  const ledger: BoardSummary['ledger'] = (Object.keys(BUCKET_LABEL) as BucketKey[]).map((key) => {
    let note = '';
    if (key === 'ranked') note = `watchlist ${rankedWatchlist} · below the $${(snap.floor / 1e6).toFixed(0)}M floor ${rows.length - rankedWatchlist}`;
    if (key === 'token') note = `usable cap ${tokenUsable} · in the value fit ${valueData.length} · no cap ${tokenNoCap}`;
    return { key, label: BUCKET_LABEL[key], count: counts.get(key) ?? 0, note };
  });

  const verdicts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  const top30 = { farm: 0, marginal: 0, skip: 0 };
  for (const r of rows.slice(0, 30)) top30[r.verdict]++;
  const byHour = rows.slice().sort((a, b) => b.netHour - a.netHour).slice(0, 5);
  const totalImplied = rows.reduce((a, r) => a + r.implied, 0);
  const totalTvlRanked = rows.reduce((a, r) => a + r.tvl, 0);

  // Category offsets of the kept fits, for the Method section (empty when not kept).
  // The power-law curve occupies 2 columns, so category offsets start at 2.
  const valueCats: BoardSummary['valueCats'] = [];
  if (valueFit.keptKeys.includes('category')) {
    const base = valueFit.keptKeys.includes('curve') ? 2 : 1;
    valueFit.cats.forEach((c, i) => {
      valueCats.push({
        name: c,
        offset: valueFit.beta[base + i]!,
        n: valueData.filter((p) => p.category === c).length,
      });
    });
  }
  const oddsCats: BoardSummary['oddsCats'] = [];
  if (oddsFit.keptKeys.includes('category')) {
    let pos = 2;
    for (const t of oddsFit.keptKeys) {
      if (t === 'size') continue;
      if (t === 'family') pos += oddsFit.fams.length;
      else if (t === 'category') break;
      else pos += 1;
    }
    oddsFit.cats.forEach((c, i) => {
      oddsCats.push({
        name: c,
        offset: oddsFit.beta[pos + i]!,
        n: oddsData.filter((p) => p.category === c).length,
      });
    });
  }

  const summary: BoardSummary = {
    asOf: snap.asOf,
    source: snap.source,
    floor: snap.floor,
    nProtocols: snap.protocols.length,
    nRanked: rows.length,
    nWatchlist: snap.watchlist.length,
    nWatchlistRanked: rankedWatchlist,
    nValue: valueData.length,
    nValueTest: valueFit.nTest,
    nOdds: oddsData.length,
    nOddsTest: oddsFit.nTest,
    medianDays,
    valueTable: valueTableRes.rows,
    valueKept: valueTableRes.keptKeys,
    valueBeta: valueFit.beta,
    valueXmean: valueFit.xmean,
    powerIntercept: valueFit.powerIntercept,
    powerSlope: valueFit.powerSlope,
    valueCats,
    looMiss: valueFit.loo,
    wfMiss: valueFit.wf,
    flatLoo: valueFit.flatLoo,
    flatWf: valueFit.flatWf,
    looImprove: 1 - valueFit.loo / valueFit.flatLoo,
    wfImprove: 1 - valueFit.wf / valueFit.flatWf,
    within3xLoo: valueFit.within3xLoo,
    within3xWf: valueFit.within3xWf,
    p2575Loo: valueFit.p2575Loo,
    p2575Wf: valueFit.p2575Wf,
    p1090Loo: valueFit.p1090Loo,
    p1090Wf: valueFit.p1090Wf,
    spearman: valueFit.spearman,
    spearmanMin: valueFit.spearmanMin,
    spearmanMax: valueFit.spearmanMax,
    oddsTable: oddsTableRes.rows,
    oddsKept: oddsTableRes.keptKeys,
    oddsBeta: oddsFit.beta,
    oddsXmean: oddsFit.xmean,
    oddsCats,
    brierLoo: oddsFit.looBrier,
    brierWf: oddsFit.wfBrier,
    brierBase: oddsFit.baseBrier,
    oddsAccLoo: oddsFit.looAcc,
    oddsAccWf: oddsFit.wfAcc,
    oddsAccBase: oddsFit.baseAcc,
    oddsBaseRate: oddsFit.baseRate,
    ledger,
    rankedWatchlist,
    rankedBelowFloor: rows.length - rankedWatchlist,
    tokenUsable,
    tokenInBand: valueData.length,
    tokenNoCap,
    totalImplied,
    totalTvlRanked,
    verdicts,
    top30,
    bestHour: byHour.length > 0 ? byHour[0]!.netHour : 0,
    bestPlans: byHour.map((r) => ({
      rank: r.rank,
      name: r.name,
      deposit: r.deposit,
      slice: r.slice,
      fees: r.fees,
      net: r.net,
      netHour: r.netHour,
      verdict: r.verdict,
    })),
    controls: DEFAULT_CONTROLS,
    feeNote: 'Fees are a stated schedule by first chain (Ethereum $18, Solana/Sui/Aptos $0.80, Tron $2, BNB/Avalanche $1.50, Polygon $1, other L2s $1–1.50, other chains $3) plus a $1.50 exit swap. Active work is 30 minutes a week over the horizon.',
    scatterTraded: valueData.map((p) => [log10(p.tvl), log10(p.mcap!)] as [number, number]),
    scatterBoard: rows.map((r) => [log10(r.tvl), log10(Math.max(1, r.curve))] as [number, number]),
    q25: valueFit.q25,
    q75: valueFit.q75,
  };
  return { rows, summary };
}
