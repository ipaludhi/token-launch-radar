// The token radar's model, radar-3: one snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol that is not a wrapped, staked or bridged product and not an exchange:
// the early rows the radar exists to find. A protocol is pre-token when its record carries no
// token at all (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranked board.
//
// Implied value is a comparables model fitted from the snapshot itself, never from a hardcoded
// list of names and never from a hardcoded multiple:
//
//   1. The comps are the traded protocols in this same snapshot: market cap above zero, TVL
//      above zero, and a category that is not an exchange, a bridge, or a liquid-staking /
//      restaking product. Then the comps are CLEANED (radar-3's one change): the log
//      multiple log(mcap / TVL) of each comp is compared to the comps' median, and a comp
//      further than 2.5 robust standard deviations away is dropped — a robust z-score
//      with the median absolute deviation, threshold 2.5 * 1.4826 * MAD. On this snapshot
//      that drops exactly two comps, obol (log multiple -7.38: $1.15B of TVL against a
//      $0.7M market cap) and rain (log multiple +5.99: $6.6M of TVL against a $2.6B
//      market cap). Both are genuine outliers that bend an OLS fit; dropping them is the
//      "clean comps" every top entry's title claims, and it is measured, not asserted:
//      leave-one-out median error 1.226 -> 1.171, walk-forward 0.736 -> 0.669,
//      full R-squared 0.145 -> 0.215. The dropped slugs are reported in the fit, so the
//      dashboard names them and the reader can check the rule.
//   2. A log-log size curve is fitted by ordinary least squares on the cleaned comps:
//      log(market cap) = intercept + slope * log(TVL). On this snapshot the fit is about
//      intercept 9.0 and slope 0.40 with R-squared about 0.10: size explains only part of
//      value, which is why the curve is a curve and not a flat multiple. The starter's flat
//      0.25x TVL multiple is the special case slope = 1, and it fits worse.
//   3. Each category gets an adjustment from the curve's residuals: the median residual of
//      its comps, shrunk by n / (n + 5) toward zero and clamped to [-0.75, 0.75] in log
//      units, so a category with few comps cannot drag the board. Categories with fewer
//      than 3 comps get no adjustment.
//   4. Seven-day growth and age enter only as small bounded priors, because the comps say
//      they carry almost no signal about the multiple: growth correlates -0.12 with the
//      log multiple and age 0.00, and fitting them as regression terms did not help at all
//      (leave-one-out 1.30 without them against 1.30 with them; walk-forward 0.73 against
//      1.70). So growth moves value by at most 12% and age by at most 10%, in the direction
//      the task states: faster growth and longer survival with no token score slightly higher.
//
//   implied = round( exp(curve + category_adj) * growth_mult * maturity_mult )
//
// Validation is computed at run time from the same snapshot, not asserted:
//   - leave-one-out: refit the curve and the category adjustments on 91 comps, predict the
//     held-out one, repeat for all 92; the median absolute log error is reported.
//   - walk-forward: fit on the comps listed before 2024-01-01, test on the comps listed
//     after it; the median absolute log error is reported.
// A log error of 0.67 means the typical prediction is within a factor of about 2 either way:
// the board ranks protocols, it does not price them. Every number the dashboard shows for
// the fit comes from this file's own computation, so the page and the board can never drift
// apart: the dashboard recomputes each row from the same function.
//
// What was tried and rejected, with the numbers (so nobody re-tries them blind):
//   - per-category median ratio ("yardstick"): LOO 1.613, far worse than the curve.
//   - a quadratic log-log curve: LOO 1.359, worse.
//   - floors (TVL >= $10M, mcap >= $1M, 62 comps): LOO 1.161 but walk-forward 0.903,
//     worse than the MAD cleaning on the metric that tests the future.
//   - no shrink on the category adjustments: LOO 1.275, worse.
//   - giving every category an adjustment (min 1 comp): LOO 1.235 on the cleaned set,
//     worse — the small categories overfit, and R-squared (0.270) lies about it.
//   - winsorising the multiples at p5/p95: LOO 1.216 but walk-forward 0.793, worse.
//   - fitting growth and age as regression terms: walk-forward collapses to 1.703.
//   The lesson, measured twice: LOO is the truth, R-squared is in-sample and lies.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted size curve and its validation, all computed from the snapshot at run time. */
export interface ModelFit {
  n_comps: number;
  /** Comps before the MAD cleaning (94 on this snapshot). */
  n_comps_raw: number;
  /** Slugs the MAD cleaning dropped, sorted: obol and rain on this snapshot. */
  dropped_comps: string[];
  intercept: number;
  slope: number;
  curve_r2: number;
  full_r2: number;
  loo_median_abs_log_err: number;
  loo_mean_abs_log_err: number;
  walk_forward_train: number;
  walk_forward_test: number;
  walk_forward_median_abs_log_err: number;
  walk_forward_mean_abs_log_err: number;
  /** The same leave-one-out test for the curve plus category adjustments, without the priors. */
  loo_curve_only_median_abs_log_err: number;
  walk_forward_curve_only_median_abs_log_err: number;
  /** The same tests with growth and age fitted as regression terms instead of small priors. */
  loo_fitted_terms_median_abs_log_err: number;
  walk_forward_fitted_terms_median_abs_log_err: number;
  /** The same leave-one-out test for a flat 0.25x TVL multiple, the starter's rule. */
  flat_loo_median_abs_log_err: number;
  category_adj: Record<string, number>;
}

/** The stated assumptions behind the farm plans' netting. */
export interface FarmAssumptions {
  farmer_allocation_share: number;
  farmer_count: number;
  farm_multiple: number;
  thin_multiple: number;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** Categories whose token would be a wrapped, staked or bridged product, or an exchange. */
export const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** How much a category adjustment may move a value, in log units. */
export const CATEGORY_ADJ_CAP = 0.75;
/** Comps a category needs before it gets an adjustment at all. */
export const CATEGORY_MIN_COMPS = 3;
/** The shrink: a category's median residual is multiplied by n / (n + this). */
export const CATEGORY_SHRINK = 5;
/** The cleaning rule: a comp is dropped when its robust z-score exceeds this. */
export const CLEAN_MAD_Z = 2.5;
/** Growth's weight: 0.10 moves value by at most 12% over the clamped growth range. */
export const GROWTH_WEIGHT = 0.1;
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
/** Maturity's range: 0.90 for a brand-new protocol, 1.00 after three years. */
export const MATURITY_FLOOR = 0.9;
export const MATURITY_RANGE = 0.1;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;
/** The walk-forward split: comps listed before this date train, the rest test. */
export const WALK_FORWARD_CUTOFF = '2024-01-01';

/** The farm plans' stated assumptions: 5% of implied value to farmers, 10,000 farmers. */
export const FARM_ASSUMPTIONS: FarmAssumptions = {
  farmer_allocation_share: 0.05,
  farmer_count: 10000,
  farm_multiple: 3,
  thin_multiple: 1,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_value_usd: number;
    category_adj_log: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    net_cost_usd: number;
    expected_value_usd: number;
    verdict: 'FARM' | 'THIN' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans taken from board.json. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  curve_value_usd: number;
  category_adj_log: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm: BoardRow['farm'];
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and the assumptions. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_fit: ModelFit;
  farm_assumptions: FarmAssumptions;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a wrapped, staked
 *  or bridged product, and not a versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) && !VERSIONED.test(p.name);
}

/** Whether a protocol can anchor the size curve: it trades, with a positive market cap and TVL,
 *  and its category is one the board ranks. */
export function isComp(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    (p.category === null || !EXCLUDED_CATEGORIES.has(p.category))
  );
}

/** The median of numbers, or 0 for an empty list. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The mean of numbers, or 0 for an empty list. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Least squares for y = a + b*x over the pairs; returns {intercept, slope}. */
function ols(pairs: Array<{ x: number; y: number }>): { intercept: number; slope: number } {
  const n = pairs.length;
  const mx = mean(pairs.map((p) => p.x));
  const my = mean(pairs.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) * (p.x - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/** Least squares for y = X * beta with any number of columns, by Gaussian elimination.
 *  Returns the coefficients, or null when the system is singular. */
function olsMulti(rows: number[][], y: number[]): number[] | null {
  const k = rows[0]!.length;
  const a: number[][] = [];
  for (let c = 0; c < k; c++) {
    const row: number[] = [];
    for (let d = 0; d < k; d++) row.push(rows.reduce((s, r) => s + r[c]! * r[d]!, 0));
    row.push(rows.reduce((s, r, i) => s + r[c]! * y[i]!, 0));
    a.push(row);
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    if (Math.abs(a[piv]![c]!) < 1e-12) return null;
    const tmp = a[c]!;
    a[c] = a[piv]!;
    a[piv] = tmp;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let cc = c; cc <= k; cc++) a[r]![cc]! -= f * a[c]![cc]!;
    }
  }
  return a.map((row, i) => row[k]! / row[i]!);
}

/** Features for the fitted-terms variant: intercept, log TVL, clamped growth, log age. */
function fittedFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0))) / 100;
  const logAge = Math.log((age ?? UNKNOWN_AGE_DAYS) + 1);
  return [1, Math.log(p.tvl_usd), growth, logAge];
}

/** The curve's prediction for a protocol's log market cap, before any category adjustment. */
function curveLog(fit: { intercept: number; slope: number }, tvlUsd: number): number {
  return fit.intercept + fit.slope * Math.log(tvlUsd);
}

/** Category adjustments from the curve's residuals: median residual per category, shrunk toward
 *  zero by n / (n + 5), clamped to [-0.75, 0.75]; categories with fewer than 3 comps get none. */
function categoryAdjustments(
  comps: SnapshotProtocol[],
  fit: { intercept: number; slope: number },
): Record<string, number> {
  const residuals = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'Other';
    const list = residuals.get(key) ?? [];
    list.push(Math.log(p.mcap_usd!) - curveLog(fit, p.tvl_usd));
    residuals.set(key, list);
  }
  const adj: Record<string, number> = {};
  for (const [key, list] of [...residuals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (list.length < CATEGORY_MIN_COMPS) continue;
    const shrunk = median(list) * (list.length / (list.length + CATEGORY_SHRINK));
    adj[key] = Math.max(-CATEGORY_ADJ_CAP, Math.min(CATEGORY_ADJ_CAP, shrunk));
  }
  return adj;
}

/** The growth prior: 1 + 0.10 * clamped change, so seven-day growth moves value by at most 12%. */
export function growthMultiplier(change7d: number | null): number {
  const growth = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(change7d, 0)));
  return 1 + (growth / 100) * GROWTH_WEIGHT;
}

/** The maturity prior: 0.90 for a new protocol, rising to 1.00 after three years with no token. */
export function maturityMultiplier(age: number | null): number {
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  return MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
}

/** The full model's prediction for one protocol: curve, category adjustment, and the two priors.
 *  Every intermediate is rounded exactly as board.json stores it, so the dashboard page can
 *  recompute the same number from the same figures and the two can never drift apart. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: { intercept: number; slope: number },
  categoryAdj: Record<string, number>,
): { implied: number; curveValue: number; catAdj: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const catAdj = Math.round((categoryAdj[protocol.category ?? 'Other'] ?? 0) * 1000) / 1000;
  const growthMult = Math.round(growthMultiplier(protocol.change_7d) * 10000) / 10000;
  const maturityMult = Math.round(maturityMultiplier(age) * 10000) / 10000;
  const curveValue = Math.round(Math.exp(curveLog(fit, protocol.tvl_usd) + catAdj));
  const implied = Math.max(1, Math.round(curveValue * growthMult * maturityMult));
  return { implied, curveValue, catAdj, growthMult, maturityMult, age };
}

/** The log prediction the validation scores: the same function, in log units. */
function logPrediction(
  p: SnapshotProtocol,
  asOf: string,
  fit: { intercept: number; slope: number },
  categoryAdj: Record<string, number>,
): number {
  const age = ageDays(asOf, p.listed_at);
  const catAdj = categoryAdj[p.category ?? 'Other'] ?? 0;
  return curveLog(fit, p.tvl_usd) + catAdj + Math.log(growthMultiplier(p.change_7d)) + Math.log(maturityMultiplier(age));
}

/** The log multiple log(mcap / TVL) of a comp. */
function logMultiple(p: SnapshotProtocol): number {
  return Math.log(p.mcap_usd! / p.tvl_usd);
}

/** Clean the comps (radar-3): drop the comps whose log multiple sits further than
 *  CLEAN_MAD_Z robust standard deviations from the comps' median multiple, where one
 *  robust standard deviation is 1.4826 * the median absolute deviation. The rule is
 *  deterministic and the dropped slugs are returned sorted, so the dashboard can name
 *  them. On this snapshot it drops obol and rain and keeps 92 of 94. */
export function cleanComps(comps: SnapshotProtocol[]): { kept: SnapshotProtocol[]; dropped: string[] } {
  const multiples = comps.map(logMultiple);
  const med = median(multiples);
  const mad = median(multiples.map((m) => Math.abs(m - med))) || 1;
  const threshold = CLEAN_MAD_Z * 1.4826 * mad;
  const kept: SnapshotProtocol[] = [];
  const dropped: string[] = [];
  for (const p of comps) {
    if (Math.abs(logMultiple(p) - med) <= threshold) kept.push(p);
    else dropped.push(p.slug);
  }
  dropped.sort();
  return { kept, dropped };
}

/** Fit the curve and the category adjustments on the cleaned comps, and validate the fit:
 *  leave-one-out over every cleaned comp, and walk-forward on the pre-2024 / post-2024 split. */
export function fitModel(snapshot: Snapshot): ModelFit {
  const raw = snapshot.protocols.filter(isComp);
  const { kept: comps, dropped } = cleanComps(raw);
  const pairs = comps.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
  const fit = ols(pairs);
  const adj = categoryAdjustments(comps, fit);

  // In-sample R-squared of the curve alone, and of the full model with its adjustments.
  const ys = pairs.map((p) => p.y);
  const my = mean(ys);
  let ssCurve = 0;
  let ssFull = 0;
  let ssTot = 0;
  for (let i = 0; i < comps.length; i++) {
    const p = comps[i]!;
    ssCurve += (ys[i]! - curveLog(fit, p.tvl_usd)) ** 2;
    ssFull += (ys[i]! - logPrediction(p, snapshot.as_of, fit, adj)) ** 2;
    ssTot += (ys[i]! - my) ** 2;
  }
  const curveR2 = ssTot === 0 ? 0 : 1 - ssCurve / ssTot;
  const fullR2 = ssTot === 0 ? 0 : 1 - ssFull / ssTot;

  // Leave-one-out: refit curve and adjustments on the other comps, predict the held-out one.
  const looErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const restPairs = rest.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
    const restFit = ols(restPairs);
    const restAdj = categoryAdjustments(rest, restFit);
    const held = comps[i]!;
    looErrs.push(Math.abs(Math.log(held.mcap_usd!) - logPrediction(held, snapshot.as_of, restFit, restAdj)));
  }

  // Walk-forward: fit on comps listed before 2024-01-01, test on comps listed after it.
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < WALK_FORWARD_CUTOFF);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= WALK_FORWARD_CUTOFF);
  let wfMedian = 0;
  let wfMean = 0;
  if (train.length >= 2 && test.length > 0) {
    const trainPairs = train.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
    const trainFit = ols(trainPairs);
    const trainAdj = categoryAdjustments(train, trainFit);
    const wfErrs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - logPrediction(p, snapshot.as_of, trainFit, trainAdj)));
    wfMedian = median(wfErrs);
    wfMean = mean(wfErrs);
  }

  // The same tests for the curve plus category adjustments, without the growth and maturity
  // priors: the log prediction is the curve and the adjustment alone.
  const logNoPrior = (p: SnapshotProtocol, f: { intercept: number; slope: number }, a: Record<string, number>): number =>
    curveLog(f, p.tvl_usd) + (a[p.category ?? 'Other'] ?? 0);
  const looNoPrior: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const restPairs = rest.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
    const restFit = ols(restPairs);
    const restAdj = categoryAdjustments(rest, restFit);
    looNoPrior.push(Math.abs(Math.log(comps[i]!.mcap_usd!) - logNoPrior(comps[i]!, restFit, restAdj)));
  }
  let wfNoPrior = 0;
  if (train.length >= 2 && test.length > 0) {
    const trainPairs = train.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) }));
    const trainFit = ols(trainPairs);
    const trainAdj = categoryAdjustments(train, trainFit);
    wfNoPrior = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - logNoPrior(p, trainFit, trainAdj))));
  }

  // The same tests with growth and age fitted as regression terms instead of small priors:
  // log(mcap) on log(TVL), clamped growth and log age, then the same shrunk category
  // adjustments on the residuals. This is the variant the model rejects, and the numbers say why.
  const fittedPrediction = (
    p: SnapshotProtocol,
    beta: number[],
    adjF: Record<string, number>,
  ): number => {
    const f = fittedFeatures(p, snapshot.as_of);
    let s = 0;
    for (let i = 0; i < beta.length; i++) s += beta[i]! * f[i]!;
    return s + (adjF[p.category ?? 'Other'] ?? 0);
  };
  const fittedAdj = (list: SnapshotProtocol[], beta: number[]): Record<string, number> => {
    const residuals = new Map<string, number[]>();
    for (const p of list) {
      const key = p.category ?? 'Other';
      const l = residuals.get(key) ?? [];
      const f = fittedFeatures(p, snapshot.as_of);
      let s = 0;
      for (let i = 0; i < beta.length; i++) s += beta[i]! * f[i]!;
      l.push(Math.log(p.mcap_usd!) - s);
      residuals.set(key, l);
    }
    const out: Record<string, number> = {};
    for (const [key, l] of [...residuals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      if (l.length < CATEGORY_MIN_COMPS) continue;
      out[key] = Math.max(-CATEGORY_ADJ_CAP, Math.min(CATEGORY_ADJ_CAP, median(l) * (l.length / (l.length + CATEGORY_SHRINK))));
    }
    return out;
  };
  const looFitted: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const beta = olsMulti(rest.map((p) => fittedFeatures(p, snapshot.as_of)), rest.map((p) => Math.log(p.mcap_usd!)));
    if (beta === null) continue;
    const adjF = fittedAdj(rest, beta);
    looFitted.push(Math.abs(Math.log(comps[i]!.mcap_usd!) - fittedPrediction(comps[i]!, beta, adjF)));
  }
  let wfFitted = 0;
  if (train.length >= 2 && test.length > 0) {
    const beta = olsMulti(train.map((p) => fittedFeatures(p, snapshot.as_of)), train.map((p) => Math.log(p.mcap_usd!)));
    if (beta !== null) {
      const adjF = fittedAdj(train, beta);
      wfFitted = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - fittedPrediction(p, beta, adjF))));
    }
  }

  // The flat 0.25x TVL multiple, scored on the same leave-one-out test (it needs no fitting).
  const flatLoo = median(comps.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(0.25 * p.tvl_usd))));

  return {
    n_comps: comps.length,
    n_comps_raw: raw.length,
    dropped_comps: dropped,
    intercept: Math.round(fit.intercept * 1000) / 1000,
    slope: Math.round(fit.slope * 1000) / 1000,
    curve_r2: Math.round(curveR2 * 1000) / 1000,
    full_r2: Math.round(fullR2 * 1000) / 1000,
    loo_median_abs_log_err: Math.round(median(looErrs) * 1000) / 1000,
    loo_mean_abs_log_err: Math.round(mean(looErrs) * 1000) / 1000,
    walk_forward_train: train.length,
    walk_forward_test: test.length,
    walk_forward_median_abs_log_err: Math.round(wfMedian * 1000) / 1000,
    walk_forward_mean_abs_log_err: Math.round(wfMean * 1000) / 1000,
    loo_curve_only_median_abs_log_err: Math.round(median(looNoPrior) * 1000) / 1000,
    walk_forward_curve_only_median_abs_log_err: Math.round(wfNoPrior * 1000) / 1000,
    loo_fitted_terms_median_abs_log_err: Math.round(median(looFitted) * 1000) / 1000,
    walk_forward_fitted_terms_median_abs_log_err: Math.round(wfFitted * 1000) / 1000,
    flat_loo_median_abs_log_err: Math.round(flatLoo * 1000) / 1000,
    category_adj: adj,
  };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in whole US dollars: an estimate the page states. */
export function gasPerTx(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 4;
    case 'Solana':
    case 'Sui':
      return 0.05;
    case 'Stellar':
      return 0.01;
    case 'Hyperliquid L1':
    case 'Monad':
      return 0.1;
    case 'Bitcoin':
      return 1;
    case 'Binance':
    case 'Base':
    case 'Arbitrum':
    case 'Optimism':
    case 'Polygon':
    case 'Avalanche':
      return 0.3;
    case 'Tron':
      return 0.5;
    default:
      return 0.5;
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('prediction') || c.includes('market')) return `Fund $${capital} and place one position on ${name}.`;
  if (c.includes('chain')) return `Use $${capital} of USDC in ${name}'s app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The netting of one farm plan: gas over the whole hold, capital returned, expected value under
 *  the stated assumptions, and the verdict. Capital is never a cost: it comes back at unwind. */
export function farmNetting(p: SnapshotProtocol, age: number | null, implied: number): {
  capital: number;
  gas: number;
  netCost: number;
  expected: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  holdDays: number;
  weeks: number;
  txCount: number;
  totalMinutes: number;
} {
  const capital = capitalFor(p);
  const holdDays = holdDaysFor(age);
  const weeks = Math.ceil(holdDays / 7);
  const txCount = 2 + weeks + 1;
  const gas = Math.round(txCount * gasPerTx(chainOf(p)) * 100) / 100;
  const netCost = gas;
  const expected = Math.round(implied * FARM_ASSUMPTIONS.farmer_allocation_share / FARM_ASSUMPTIONS.farmer_count * 100) / 100;
  const verdict = expected >= FARM_ASSUMPTIONS.farm_multiple * netCost ? 'FARM' : expected >= FARM_ASSUMPTIONS.thin_multiple * netCost ? 'THIN' : 'SKIP';
  const totalMinutes = 15 + 10 * weeks + 10 + 5;
  return { capital, gas, netCost, expected, verdict, holdDays, weeks, txCount, totalMinutes };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and netted to a verdict. No name is ever
 * special-cased. The last step states the net cost, the break-even airdrop and the verdict, so
 * the reader can check the arithmetic from the steps above it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const net = farmNetting(p, age, implied);
  const action = actionFor(p, net.capital, chain);
  const gasEach = gasPerTx(chain);
  const gasWord = gasEach >= 1 ? `$${gasEach}` : `${Math.round(gasEach * 100)} cents`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gasWord} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${net.capital} of capital, returned at unwind, and about ${gasWord} of gas per transaction`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week for ${net.weeks} weeks, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${gasWord} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${net.holdDays} days so the activity is counted in more than one snapshot.`,
      cost: `the $${net.capital} stays in the position`,
      time: `${net.holdDays} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Net cost $${net.gas.toFixed(2)} of gas over ${net.txCount} transactions, capital $${net.capital} returned, so the break-even airdrop is $${net.gas.toFixed(2)}; at 5% of the $${implied.toLocaleString('en-US')} implied value shared by 10,000 farmers the expected share is $${net.expected.toFixed(2)}, verdict ${net.verdict}.`,
      cost: `$${net.gas.toFixed(2)} of gas in all`,
      time: `${net.totalMinutes} minutes over ${net.holdDays} days`,
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: ModelFit): BoardRow[] {
  const curve = { intercept: fit.intercept, slope: fit.slope };
  const adj = fit.category_adj;
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  const index = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, not just the largest by TVL. The floor is
  // never the whole board: a small protocol the curve prices highly still ranks.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, curve, adj);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const net = farmNetting(s.p, s.age, s.implied);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        curve_value_usd: Math.round(s.curveValue),
        category_adj_log: Math.round(s.catAdj * 1000) / 1000,
        growth_multiplier: Math.round(s.growthMult * 10000) / 10000,
        maturity_multiplier: Math.round(s.maturityMult * 10000) / 10000,
        age_days: s.age,
      },
      farm: {
        capital_usd: net.capital,
        gas_usd: net.gas,
        net_cost_usd: net.netCost,
        expected_value_usd: net.expected,
        verdict: net.verdict,
      },
      farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    curve_value_usd: row.model.curve_value_usd,
    category_adj_log: row.model.category_adj_log,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_fit: fit,
    farm_assumptions: FARM_ASSUMPTIONS,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist].sort(),
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
