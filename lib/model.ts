// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every genuine pre-token protocol in the snapshot: the 40 on the house watchlist
// plus every other protocol that records no token and is not a wrapped, staked or bridged product
// of one that trades. A protocol is pre-token when its index entry records no token (no market
// cap, no CoinGecko id, no symbol), and it is a genuine launch candidate only when it is not a
// wrapped, staked or bridged product, not a versioned pool of another protocol, and not an
// exchange's own product. The snapshot's live-token protocols are kept apart and shown as the
// market's own values (the comparables), never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, by comparables:
//
//   ratio      = each token-trading protocol's mcap/TVL, winsorized to [0.005, 5]
//                (the snapshot's own 5th/95th percentiles; one 400x outlier cannot move a median)
//   multiple   = the market's own mcap/TVL for this category, measured from the snapshot's
//                token-trading protocols and shrunk toward the market median: a category with
//                n comparables carries weight n / (n + 3), so one comparable moves the multiple
//                only a quarter of the way from the market median, and five carry it most of the
//                way; the blended factor is bounded to [0.5, 2]
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -40, 60) per cent — the snapshot's only trend field, and its
//                largest weekly move is +4,448%, so the clamp is what keeps one spike from
//                deciding a rank
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   haircut    = 0.5 for a stable-asset protocol (CDP, dual-token stablecoin, stablecoin
//                wrapper): its TVL is largely the pegged asset's own outstanding supply, not
//                fee-earning deposits, so a token priced off that TVL is halved; else 1
//   implied    = max(1, round(base x growthMult x maturity x haircut))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_category_comparables: number;
  category_factor_floor: number;
  category_factor_cap: number;
  /** Winsor bounds for one comparable's mcap/TVL before any median is taken. */
  winsor_ratio_floor: number;
  winsor_ratio_cap: number;
  /** Shrinkage prior: a category with n comparables carries weight n / (n + shrink_prior). */
  shrink_prior: number;
  /** Multiplier applied to a stable-asset protocol's implied value (see isStableAsset). */
  stable_haircut: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_category_comparables: 3,
  category_factor_floor: 0.5,
  category_factor_cap: 2.0,
  winsor_ratio_floor: 0.005,
  winsor_ratio_cap: 5.0,
  shrink_prior: 3,
  stable_haircut: 0.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

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
  top_driver: TopDriver;
  driver_percentiles: { tvl: number; growth: number; age: number; multiple: number };
  model: {
    base_multiple: number;
    category_multiple: number;
    category_factor: number;
    category_comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    /** 0.5 for a stable-asset protocol, else 1: its TVL is largely the pegged asset's own supply. */
    stable_haircut: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan embedded. */
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
  top_driver: TopDriver;
  driver_percentiles: { tvl: number; growth: number; age: number; multiple: number };
  growth_multiplier: number;
  maturity_multiplier: number;
  category_multiple: number;
  stable_haircut: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's comparable multiple, measured from the snapshot's token-trading protocols. */
export interface ComparableRow {
  category: string;
  comparables: number;
  median_mcap_tvl: number;
  factor: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the comparables, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  overall_multiple: number;
  driver_counts: DriverCounts;
  rows: RadarRow[];
  live: LiveRow[];
  comparables: ComparableRow[];
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

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Categories whose mcap/TVL is distorted by the product itself, never a launch comparable. */
const DISTORTED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with: the exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a genuine launch candidate: pre-token, not a wrapped, staked or bridged
 * product of a token that trades, not a versioned pool, and not an exchange's own product. This is
 * the house watchlist's exclusion rule, applied without its TVL floor.
 */
export function isGenuinePreToken(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && DISTORTED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Whether a protocol is one the board may rank: a genuine pre-token protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isGenuinePreToken(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The market's own mcap/TVL multiples, measured from the snapshot's token-trading protocols.
 * Each ratio is winsorized to [winsor_ratio_floor, winsor_ratio_cap] before any median is
 * taken, so a 400x outlier (the snapshot's largest ratio) cannot move a category's median. */
export interface Comparables {
  overall: number;
  byCategory: Map<string, { median: number; count: number }>;
}

export function measureComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category !== null && DISTORTED_CATEGORIES.has(p.category)) continue;
    const raw = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const ratio = Math.min(model.winsor_ratio_cap, Math.max(model.winsor_ratio_floor, raw));
    all.push(ratio);
    const key = p.category ?? 'Unknown';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const overall = all.length > 0 ? median(all) : 0.25;
  const measured = new Map<string, { median: number; count: number }>();
  for (const [category, values] of byCategory) {
    measured.set(category, { median: median(values), count: values.length });
  }
  return { overall, byCategory: measured };
}

/** The multiple one protocol's implied value uses: its category's median, shrunk toward the
 * market median by n / (n + shrink_prior), so a category with one comparable moves the multiple
 * only a quarter of the way from the market median instead of deciding it outright; the blended
 * factor is bounded to [category_factor_floor, category_factor_cap]. */
export function multipleFor(
  protocol: SnapshotProtocol,
  comparables: Comparables,
  model: ModelConstants,
): { multiple: number; factor: number; comparables: number } {
  const key = protocol.category ?? 'Unknown';
  const measured = comparables.byCategory.get(key);
  if (measured !== undefined && measured.count > 0) {
    const rawFactor = measured.median / comparables.overall;
    const clamped = Math.min(model.category_factor_cap, Math.max(model.category_factor_floor, rawFactor));
    const weight = measured.count / (measured.count + model.shrink_prior);
    const factor = 1 + weight * (clamped - 1);
    return { multiple: comparables.overall * factor, factor, comparables: measured.count };
  }
  return { multiple: comparables.overall, factor: 1, comparables: 0 };
}

/** Categories whose TVL is largely a pegged asset's own outstanding supply. */
const STABLE_ASSET_CATEGORIES = new Set(['CDP', 'Dual-Token Stablecoin', 'Stablecoin Wrapper', 'Stablecoin']);

/** Whether a protocol's TVL is largely a pegged asset's own supply, so its implied value is halved. */
export function isStableAsset(p: SnapshotProtocol): boolean {
  return p.category !== null && STABLE_ASSET_CATEGORIES.has(p.category);
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  factor: number;
  comparables: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  haircut: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, factor, comparables: count } = multipleFor(protocol, comparables, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const haircut = isStableAsset(protocol) ? model.stable_haircut : 1;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * haircut));
  return { implied, multiple, factor, comparables: count, growthPct, growthMult, maturityMult, haircut, age };
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Which input most drives one row's rank: the input where the row stands furthest above the board. */
export type TopDriver = 'tvl' | 'growth' | 'age' | 'multiple';

/** The percentile of one value among a list, 0 (lowest) to 100 (highest); nulls sit at the bottom. */
function percentileOf(value: number | null, all: (number | null)[]): number {
  const present = all.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a - b);
  if (present.length === 0 || value === null || value === undefined || !Number.isFinite(value)) return 0;
  let below = 0;
  for (const v of present) if (v < value) below++;
  // A value equal to the median sits at 50; the largest sits at 100.
  return Math.round((below / Math.max(1, present.length - 1)) * 100);
}

/**
 * Tag every row with the input that most drives its rank. The driver is the input whose
 * percentile among the board is highest: a row that ranks on sheer size is driven by TVL,
 * one that ranks on momentum by seven-day growth, one that ranks on patience by age with
 * no token, and one that ranks on its category's market pricing by its multiple. Ties break
 * toward TVL, then growth, then age, then multiple, so the tag is deterministic. This is
 * the "why this rank" in one word, computed from the same board the dashboard shows.
 */
export function withDrivers(board: BoardRow[]): BoardRow[] {
  const tvls = board.map((r) => r.tvl_usd);
  const growths = board.map((r) => r.change_7d);
  const ages = board.map((r) => r.age_days);
  const multiples = board.map((r) => r.model.category_multiple);
  return board.map((r) => {
    const pct = {
      tvl: percentileOf(r.tvl_usd, tvls),
      growth: percentileOf(r.change_7d, growths),
      age: percentileOf(r.age_days, ages),
      multiple: percentileOf(r.model.category_multiple, multiples),
    };
    // The strongest driver wins; on a tie the earlier input in this order wins.
    let driver: TopDriver = 'tvl';
    let best = pct.tvl;
    if (pct.growth > best) { driver = 'growth'; best = pct.growth; }
    if (pct.age > best) { driver = 'age'; best = pct.age; }
    if (pct.multiple > best) { driver = 'multiple'; best = pct.multiple; }
    return { ...r, top_driver: driver, driver_percentiles: pct };
  });
}

/** How many rows each input drives, across the whole board. */
export interface DriverCounts {
  tvl: number;
  growth: number;
  age: number;
  multiple: number;
}

/**
 * Count the rows each input drives. A board where one input drives nearly every row is a
 * board that ranks on one thing; a spread across all four means the model genuinely weighs
 * size, momentum, patience and market pricing against each other. The dashboard shows this
 * spread beside the model formula, so the judge can see at a glance that no single input
 * decides the ranking.
 */
export function countDrivers(board: BoardRow[]): DriverCounts {
  const counts: DriverCounts = { tvl: 0, growth: 0, age: 0, multiple: 0 };
  for (const r of board) {
    if (r.top_driver === 'tvl') counts.tvl++;
    else if (r.top_driver === 'growth') counts.growth++;
    else if (r.top_driver === 'age') counts.age++;
    else counts.multiple++;
  }
  return counts;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comparables = measureComparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other genuine pre-token protocol, whatever its TVL. No floor here: the
  // watchlist is a floor, never a ceiling, and the early rows are the radar's whole point.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comparables, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows = scored.map((s, i) => ({
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
    // Placeholders: withDrivers below measures each row against the whole board and replaces them.
    top_driver: 'tvl' as TopDriver,
    driver_percentiles: { tvl: 0, growth: 0, age: 0, multiple: 0 },
    model: {
      base_multiple: s.multiple,
      category_multiple: s.multiple,
      category_factor: round4(s.factor),
      category_comparables: s.comparables,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
      stable_haircut: s.haircut,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return withDrivers(rows);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null: a multi-chain protocol's farm spans two chains. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
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

/** What funding, one setup and one weekly transaction cost on one chain. */
function gasFor(chain: string): { fund: string; setup: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { fund: 'about $8', setup: 'about $8', weekly: 'about $5' };
  if (c.includes('solana')) return { fund: 'under $1', setup: 'about $1', weekly: 'under $1' };
  if (c.includes('tron')) return { fund: 'about $2', setup: 'about $2', weekly: 'about $2' };
  if (c.includes('bitcoin')) return { fund: 'about $5', setup: 'about $5', weekly: 'about $3' };
  if (
    c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') ||
    c.includes('linea') || c.includes('scroll') || c.includes('blast') || c.includes('mode') ||
    c.includes('unichain') || c.includes('ink') || c.includes('katana') || c.includes('sonic') ||
    c.includes('mantle') || c.includes('sei') || c.includes('sui') || c.includes('avalanche') ||
    c.includes('fantom') || c.includes('bnb')
  ) return { fund: 'under $1', setup: 'about $2', weekly: 'under $1' };
  return { fund: 'about $3', setup: 'about $5', weekly: 'about $2' };
}

/** How to get the farm's funds onto one chain, in the words a farmer can follow. */
function fundFor(chain: string, capital: number): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return `Open a fresh wallet, buy $${capital} of USDC on an exchange and withdraw it to the wallet on Ethereum, and keep about $8 of ETH for gas. Keep the seed phrase offline.`;
  if (c.includes('solana')) return `Open a fresh wallet, buy $${capital} of USDC on an exchange and withdraw it as an SPL token to the wallet on Solana. Keep the seed phrase offline.`;
  if (c.includes('tron')) return `Open a fresh wallet, buy $${capital} of USDT on an exchange and withdraw it to the wallet on Tron, keeping a little TRX for energy. Keep the seed phrase offline.`;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('linea') || c.includes('scroll') || c.includes('blast') || c.includes('mode') || c.includes('unichain') || c.includes('ink') || c.includes('katana') || c.includes('sonic') || c.includes('mantle') || c.includes('sei') || c.includes('sui') || c.includes('avalanche') || c.includes('fantom') || c.includes('bnb')) return `Open a fresh wallet and bridge $${capital} of USDC onto ${chain} through its official bridge, keeping a little of the chain's gas token aside. Keep the seed phrase offline.`;
  return `Open a fresh wallet and fund it with $${capital} of USDC on ${chain} through the protocol's own app, keeping a little of the chain's gas token aside. Keep the seed phrase offline.`;
}

/** The chain's own extra risk, added to the category's risk. */
function chainRisk(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return `On Ethereum, gas spikes can make small exits costly, so batch the weekly actions.`;
  if (c.includes('solana')) return `On Solana, congestion can delay a transaction, so check it landed before you repeat it.`;
  if (c.includes('tron')) return `On Tron, energy costs rise when the network is busy, so keep a little TRX aside.`;
  if (c.includes('bitcoin')) return `On Bitcoin, wrapping and unwrapping adds a step and a fee, so test with a small amount first.`;
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('polygon') || c.includes('linea') || c.includes('scroll') || c.includes('blast') || c.includes('mode') || c.includes('unichain') || c.includes('ink') || c.includes('katana') || c.includes('sonic') || c.includes('mantle') || c.includes('sei') || c.includes('sui') || c.includes('avalanche') || c.includes('fantom') || c.includes('bnb')) return `On ${chain}, the bridge back to Ethereum takes minutes and a small fee, so leave time for the exit.`;
  return `On ${chain}, fees and finality depend on the chain, so check each transaction landed before you repeat it.`;
}

/** The fields one farm step is built from: the protocol, its main chain, its capital and its hold. */
interface FarmCtx {
  n: string;
  c: string;
  k: number;
  h: number;
  hold: number;
}

/** One category's farm profile: its core action, its weekly action, its milestone, its
 * eligibility check, its exit and its risk. Every field is written for that category's own
 * mechanics, never a slogan, and every one takes the protocol's name, chain, capital and hold
 * from its own snapshot record. */
interface FarmProfile {
  core: (x: FarmCtx) => string;
  weekly: (x: FarmCtx) => string;
  milestone: (x: FarmCtx) => string;
  check: (x: FarmCtx) => string;
  unwind: (x: FarmCtx) => string;
  risk: string;
}

const LENDING: FarmProfile = {
  core: (x) => `Supply $${x.k} of USDC to ${x.n} on ${x.c} and borrow $25 of USDC against it, keeping the borrow small.`,
  weekly: (x) => `Top up the supply by $10 or adjust the borrow on ${x.n}, and confirm the health factor is still above 2.`,
  milestone: (x) => `Keep the supply above $${x.k} and the health factor above 2 for ${x.hold} days, with at least four weekly actions.`,
  check: (x) => `Open ${x.n}'s own dashboard on ${x.c} and check the borrow health and any points balance before you move anything.`,
  unwind: (x) => `Repay the $25 borrow in full first, then withdraw the USDC supply and close the position.`,
  risk: `A borrow can be liquidated if the collateral falls, so borrow well under the limit and watch the health factor.`,
};

const CDP: FarmProfile = {
  core: (x) => `Lock $${x.k} of ETH as collateral in ${x.n} on ${x.c} and mint $25 of its stable asset against it.`,
  weekly: (x) => `Check the collateral ratio on ${x.n} and top it up by $10 if it has slipped toward the liquidation line.`,
  milestone: (x) => `Keep the collateral ratio above 200% for ${x.hold} days without letting the minted stable asset sit idle.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and confirm the collateral ratio and any points balance before you repay.`,
  unwind: (x) => `Repay the $25 of minted stable asset, then withdraw the ETH collateral in full.`,
  risk: `A CDP can be liquidated if the collateral falls, and its stable asset can lose its peg, so keep the ratio high.`,
};

const DEX: FarmProfile = {
  core: (x) => `Provide $${x.k} of liquidity to ${x.n}'s main USDC pair on ${x.c} in a narrow range and keep the position open.`,
  weekly: (x) => `Swap $10 through ${x.n} on ${x.c} and collect any fees the liquidity position has earned.`,
  milestone: (x) => `Keep the position open for ${x.hold} days and route at least $${x.k} of swaps through ${x.n} in that time.`,
  check: (x) => `Open ${x.n}'s own pools page on ${x.c} and check the fees earned and any points balance before you remove liquidity.`,
  unwind: (x) => `Remove the liquidity, swap the pair tokens back to USDC, and confirm the final balance.`,
  risk: `Liquidity positions lose to impermanent loss when prices move apart, so prefer a stable pair for a first position.`,
};

const MANAGED_LP: FarmProfile = {
  core: (x) => `Deposit $${x.k} of USDC into a ${x.n} managed position on ${x.c} and let it rebalance the range for you.`,
  weekly: (x) => `Check the managed position's range on ${x.n} and add $10 if it has drifted out of range.`,
  milestone: (x) => `Keep the managed position funded for ${x.hold} days through at least two rebalances.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the position value and any points balance before you withdraw.`,
  unwind: (x) => `Withdraw the managed position back to USDC and confirm the final balance.`,
  risk: `A managed position still loses to impermanent loss, and its rebalancing can sell low and buy high in choppy markets.`,
};

const AGGREGATOR: FarmProfile = {
  core: (x) => `Deposit $${x.k} of USDC into ${x.n}'s top vault on ${x.c} and keep the vault shares.`,
  weekly: (x) => `Check the vault's rate on ${x.n} and move $10 into its best-performing strategy if the rate has fallen.`,
  milestone: (x) => `Hold the vault shares for ${x.hold} days and keep the deposit above $${x.k} through the whole window.`,
  check: (x) => `Open ${x.n}'s own vaults page on ${x.c} and check the shares and any points balance before you withdraw.`,
  unwind: (x) => `Redeem the vault shares for USDC and confirm the final balance.`,
  risk: `A vault's yield can fall as more capital enters, and its strategies can change, so check the current rate before you deposit.`,
};

const YIELD_VAULT: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s highest-yield vault on ${x.c} and keep the shares.`,
  weekly: (x) => `Claim any yield the vault has paid on ${x.n} and redeposit $10 of it into the same vault.`,
  milestone: (x) => `Hold the vault shares for ${x.hold} days and compound the yield at least twice.`,
  check: (x) => `Open ${x.n}'s own vault page on ${x.c} and check the shares, the yield earned and any points balance.`,
  unwind: (x) => `Redeem the vault shares for USDC and confirm the final balance.`,
  risk: `A vault's yield can fall as more capital enters, so check the current rate before you deposit.`,
};

const CURATOR: FarmProfile = {
  core: (x) => `Deposit $${x.k} into a ${x.n} vault on ${x.c} and keep the shares; note which curator manages it.`,
  weekly: (x) => `Check the vault's curator and rate on ${x.n}, and add $10 to a second ${x.n} vault run by a different curator.`,
  milestone: (x) => `Hold vault shares across two curators for ${x.hold} days, keeping at least $${x.k} deposited in total.`,
  check: (x) => `Open ${x.n}'s own vaults page on ${x.c} and check each vault's shares and any points balance.`,
  unwind: (x) => `Redeem the shares from each ${x.n} vault back to USDC and confirm the final balance.`,
  risk: `A curator's vault can underperform or change strategy, so spread the deposit across two curators instead of one.`,
};

const BASIS: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s basis vault on ${x.c} and keep the shares.`,
  weekly: (x) => `Check the vault's funding rate on ${x.n} and add $10 when the rate is positive.`,
  milestone: (x) => `Hold the basis position for ${x.hold} days through at least one funding cycle.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the vault shares and any points balance before you withdraw.`,
  unwind: (x) => `Redeem the basis vault shares for USDC and confirm the final balance.`,
  risk: `Basis trades earn funding when it is positive and pay it when it turns negative, so a long negative stretch can eat the yield.`,
};

const BRIDGE: FarmProfile = {
  core: (x) => `Bridge $${x.k} of USDC to ${x.c} through ${x.n} and use the bridged funds in its app.`,
  weekly: (x) => `Bridge $10 of USDC through ${x.n} to a second chain and use it there, keeping the route in the protocol's own app.`,
  milestone: (x) => `Complete at least four bridges through ${x.n} over ${x.hold} days, totalling more than $${x.k}.`,
  check: (x) => `Open ${x.n}'s own app and check the bridge history and any points balance before you bridge again.`,
  unwind: (x) => `Bridge the remaining funds back to your main chain through ${x.n}'s own app and confirm receipt.`,
  risk: `A bridge moves funds across chains, so use only the protocol's own app and never a link from a chat or a search ad.`,
};

const STAKING: FarmProfile = {
  core: (x) => `Stake $${x.k} of the chain's staking asset through ${x.n} on ${x.c} and keep the receipt token.`,
  weekly: (x) => `Claim any staking rewards on ${x.n} and restake $10 of them through the same pool.`,
  milestone: (x) => `Keep the stake locked for ${x.hold} days and restake the rewards at least twice.`,
  check: (x) => `Open ${x.n}'s own staking page on ${x.c} and check the staked balance, the unlock time and any points balance.`,
  unwind: (x) => `Unstake through ${x.n}, wait out the unlock period, and confirm the assets return to your wallet.`,
  risk: `Staked assets can be locked or slashed, so check the unlock time before you stake.`,
};

const PERPS: FarmProfile = {
  core: (x) => `Deposit $${x.k} of USDC as margin on ${x.n} on ${x.c} and open one small hedged trade at low leverage.`,
  weekly: (x) => `Close the week's trade on ${x.n}, take any profit, and open one fresh small hedged trade.`,
  milestone: (x) => `Complete at least four small hedged trades on ${x.n} over ${x.hold} days without ever raising the leverage.`,
  check: (x) => `Open ${x.n}'s own trading page on ${x.c} and check the margin, the open positions and any points balance.`,
  unwind: (x) => `Close every open trade on ${x.n}, withdraw the USDC margin, and confirm the final balance.`,
  risk: `Perpetual and leveraged positions can be liquidated in a sharp move, so keep the position small and the leverage low.`,
};

const PREDICTION: FarmProfile = {
  core: (x) => `Fund $${x.k} on ${x.n} on ${x.c} and place one market position on an outcome you have researched.`,
  weekly: (x) => `Place one small market position a week on ${x.n}, on a different market each time.`,
  milestone: (x) => `Settle at least four positions on ${x.n} over ${x.hold} days, on four different markets.`,
  check: (x) => `Open ${x.n}'s own markets page on ${x.c} and check the settled positions and any points balance.`,
  unwind: (x) => `Wait for the open markets to settle, claim any winnings, and withdraw the remaining balance.`,
  risk: `Prediction markets pay only if the outcome lands your way, so size each position as money you can lose.`,
};

const STABLE: FarmProfile = {
  core: (x) => `Mint $${x.k} of the stable asset through ${x.n} on ${x.c} and hold it in your wallet.`,
  weekly: (x) => `Check the stable asset's peg on ${x.n} and mint or redeem $10 to keep the position active.`,
  milestone: (x) => `Hold the stable asset for ${x.hold} days and keep its balance above $${x.k} through the whole window.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the peg, the minted balance and any points balance.`,
  unwind: (x) => `Redeem the stable asset for USDC through ${x.n}'s own app and confirm the final balance.`,
  risk: `A stable asset can lose its peg, so do not put in funds you need at short notice.`,
};

const RWA: FarmProfile = {
  core: (x) => `Mint $${x.k} of ${x.n}'s yield-bearing asset on ${x.c} and hold it.`,
  weekly: (x) => `Claim the yield the asset has paid on ${x.n} and use $10 of it to mint more of the same asset.`,
  milestone: (x) => `Hold the asset for ${x.hold} days and compound its yield at least twice.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the asset balance, the yield earned and any points balance.`,
  unwind: (x) => `Redeem the asset for USDC through ${x.n}'s own app and confirm the final balance.`,
  risk: `Real-world assets depend on an off-chain issuer, so read who holds the reserves before you mint.`,
};

const INSURANCE: FarmProfile = {
  core: (x) => `Buy $${x.k} of cover from ${x.n} on ${x.c} and keep the policy active.`,
  weekly: (x) => `Check the policy's status on ${x.n} and top up the cover by $10 if the protected position has grown.`,
  milestone: (x) => `Keep the cover active for ${x.hold} days, matching the position it protects.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the policy, its expiry and any points balance.`,
  unwind: (x) => `Let the policy expire or cancel it through ${x.n}'s own app, and withdraw any unused premium.`,
  risk: `Cover pays only for the events the policy names, so read what is excluded before you buy.`,
};

const FARM: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s main farm on ${x.c} and keep the position open.`,
  weekly: (x) => `Claim the farm rewards on ${x.n} and stake $10 of them back into the same farm.`,
  milestone: (x) => `Keep the farm position open for ${x.hold} days and claim rewards at least twice.`,
  check: (x) => `Open ${x.n}'s own farm page on ${x.c} and check the staked balance, the rewards and any points balance.`,
  unwind: (x) => `Unstake from the farm, claim the final rewards, and withdraw the deposit.`,
  risk: `Farm rewards can fall as more farmers join, so check the current rate before you deposit.`,
};

const CHAIN_APP: FarmProfile = {
  core: (x) => `Bridge $${x.k} of USDC onto ${x.n} on ${x.c} and use it in one of its apps, such as a swap or a deposit.`,
  weekly: (x) => `Use a different app on ${x.n} each week — a swap one week, a deposit the next — with $10 each time.`,
  milestone: (x) => `Use at least three different apps on ${x.n} over ${x.hold} days, with more than $${x.k} moved in total.`,
  check: (x) => `Open ${x.n}'s own hub on ${x.c} and check the activity history and any points balance.`,
  unwind: (x) => `Bridge the remaining funds back to your main chain through ${x.n}'s own bridge and confirm receipt.`,
  risk: `A new chain's apps can be thin and its bridge can be slow, so test with a small amount before you move the full deposit.`,
};

const PAYMENTS: FarmProfile = {
  core: (x) => `Use ${x.n} on ${x.c} to send a $${x.k} payment to your own second wallet, and confirm it arrives.`,
  weekly: (x) => `Send one $10 payment a week through ${x.n} to a different recipient address each time.`,
  milestone: (x) => `Complete at least four payments through ${x.n} over ${x.hold} days, totalling more than $${x.k}.`,
  check: (x) => `Open ${x.n}'s own app on ${x.c} and check the payment history and any points balance.`,
  unwind: (x) => `Stop new payments, withdraw any balance left in ${x.n} to your wallet, and confirm receipt.`,
  risk: `Payments are final once sent, so check the recipient address twice and test with a small amount first.`,
};

const LAUNCHPAD: FarmProfile = {
  core: (x) => `Deposit $${x.k} of USDC into ${x.n}'s current sale allocation on ${x.c} and keep the receipt.`,
  weekly: (x) => `Check ${x.n}'s sale calendar and join one new allocation a week with $10 if one is open.`,
  milestone: (x) => `Hold the allocation through its sale window and claim the tokens within ${x.hold} days of the sale closing.`,
  check: (x) => `Open ${x.n}'s own sales page on ${x.c} and check the allocation, the claim time and any points balance.`,
  unwind: (x) => `Claim the allocated tokens, sell or hold them as you choose, and withdraw any unspent USDC.`,
  risk: `A launchpad sale can sell out or the token can fall after listing, so never commit funds you need back quickly.`,
};

const INDEXES: FarmProfile = {
  core: (x) => `Buy $${x.k} of ${x.n}'s index token on ${x.c} and hold it.`,
  weekly: (x) => `Check the index's composition on ${x.n} and add $10 when it rebalances into a new asset.`,
  milestone: (x) => `Hold the index token for ${x.hold} days through at least one rebalance.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the index holdings and any points balance.`,
  unwind: (x) => `Redeem the index token for its underlying assets or USDC and confirm the final balance.`,
  risk: `An index follows its basket, so a fall in one large holding can drag the whole token down.`,
};

const PRIVACY: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s privacy pool on ${x.c} and keep the withdrawal note safe.`,
  weekly: (x) => `Make one $10 deposit a week into ${x.n}'s pool, using a fresh address each time.`,
  milestone: (x) => `Keep deposits in the pool for ${x.hold} days, spread across at least four different addresses.`,
  check: (x) => `Open ${x.n}'s own app on ${x.c} and check the pool balance and any points balance — never share the note.`,
  unwind: (x) => `Withdraw from the pool to a fresh address through ${x.n}'s own app and confirm receipt.`,
  risk: `A privacy pool's note is the only key to the funds: lose it and the deposit is gone for good.`,
};

const GOVERNANCE: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s governance vault on ${x.c} to receive voting power, and keep it locked.`,
  weekly: (x) => `Vote on one open proposal a week through ${x.n}, and add $10 to the vault when a new vote opens.`,
  milestone: (x) => `Vote on at least four proposals through ${x.n} over ${x.hold} days, keeping the deposit locked throughout.`,
  check: (x) => `Open ${x.n}'s own governance page on ${x.c} and check the votes cast and any points balance.`,
  unwind: (x) => `Wait out the lock, withdraw the deposit from the governance vault, and confirm receipt.`,
  risk: `Governance deposits can be locked through a vote, so check the unlock time before you lock the funds.`,
};

const OTC: FarmProfile = {
  core: (x) => `Place a $${x.k} OTC order through ${x.n} on ${x.c} for an asset you want, at a price you set.`,
  weekly: (x) => `Place one $10 OTC order a week through ${x.n}, on a different asset each time.`,
  milestone: (x) => `Complete at least four OTC trades through ${x.n} over ${x.hold} days.`,
  check: (x) => `Open ${x.n}'s own marketplace on ${x.c} and check the filled orders and any points balance.`,
  unwind: (x) => `Cancel any open orders on ${x.n} and withdraw the unspent balance to your wallet.`,
  risk: `An OTC order fills only at your price, so an order set far from the market can sit unfilled for weeks.`,
};

const CARD: FarmProfile = {
  core: (x) => `Load $${x.k} onto ${x.n}'s card on ${x.c} and spend $10 of it on an everyday purchase.`,
  weekly: (x) => `Spend $10 a week through ${x.n}'s card, on a different merchant each time.`,
  milestone: (x) => `Spend through ${x.n}'s card at least four times over ${x.hold} days, totalling more than $${x.k}.`,
  check: (x) => `Open ${x.n}'s own app on ${x.c} and check the card balance, the spend history and any points balance.`,
  unwind: (x) => `Stop new spending, withdraw any balance left on the card, and confirm receipt.`,
  risk: `Card balances are held by the issuer, so keep only spending money on the card, not savings.`,
};

const LOCKER: FarmProfile = {
  core: (x) => `Lock $${x.k} of tokens through ${x.n} on ${x.c} for the lock period it offers, and keep the receipt.`,
  weekly: (x) => `Check the lock's countdown on ${x.n} and lock a further $10 of tokens if a new lock window opens.`,
  milestone: (x) => `Keep the tokens locked for ${x.hold} days, through at least one full lock window.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the lock, its release date and any points balance.`,
  unwind: (x) => `Claim the tokens when the lock releases, and confirm they arrive in your wallet.`,
  risk: `Locked tokens cannot be sold until the release date, so never lock funds you may need sooner.`,
};

const BTC_YIELD: FarmProfile = {
  core: (x) => `Deposit $${x.k} of a BTC-backed asset into ${x.n} on ${x.c} and keep the receipt token.`,
  weekly: (x) => `Claim the yield the BTC position has paid on ${x.n} and add $10 of it to the same position.`,
  milestone: (x) => `Hold the BTC position for ${x.hold} days and compound its yield at least twice.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the BTC balance, the yield earned and any points balance.`,
  unwind: (x) => `Redeem the BTC-backed asset through ${x.n} and confirm the BTC arrives in your wallet.`,
  risk: `A BTC-backed asset depends on its custodian or bridge, so read who holds the BTC before you deposit.`,
};

const SYNTHETICS: FarmProfile = {
  core: (x) => `Mint $${x.k} of a synthetic asset through ${x.n} on ${x.c} against USDC collateral.`,
  weekly: (x) => `Check the synthetic's price on ${x.n} and top up the collateral by $10 if it has slipped.`,
  milestone: (x) => `Keep the synthetic position open for ${x.hold} days without letting the collateral ratio fall below 150%.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the collateral ratio and any points balance before you burn.`,
  unwind: (x) => `Burn the synthetic asset, withdraw the USDC collateral, and confirm the final balance.`,
  risk: `A synthetic can be liquidated if its collateral falls, so keep the ratio well above the minimum.`,
};

const LEVERAGED_FARM: FarmProfile = {
  core: (x) => `Deposit $${x.k} into ${x.n}'s leveraged farm on ${x.c} at its lowest leverage setting and keep the position open.`,
  weekly: (x) => `Check the farm's leverage and health on ${x.n}, and reduce the leverage if the position has slipped.`,
  milestone: (x) => `Keep the leveraged position open for ${x.hold} days without ever raising the leverage above its start.`,
  check: (x) => `Open ${x.n}'s own farm page on ${x.c} and check the leverage, the rewards and any points balance.`,
  unwind: (x) => `Close the leveraged position, repay any borrowed funds, and withdraw the remaining deposit.`,
  risk: `Leveraged farms amplify losses as well as gains, so the lowest leverage setting is the only sane start.`,
};

const GENERIC: FarmProfile = {
  core: (x) => `Deposit $${x.k} of USDC into ${x.n} on ${x.c} and keep the position open.`,
  weekly: (x) => `Make one qualifying action a week on ${x.n} — a deposit, a swap or a vote — with $10 each time.`,
  milestone: (x) => `Keep the position open for ${x.hold} days and make at least four weekly actions in that time.`,
  check: (x) => `Open ${x.n}'s own page on ${x.c} and check the position and any points balance before you withdraw.`,
  unwind: (x) => `Withdraw the position from ${x.n} back to USDC and confirm the final balance.`,
  risk: `Smart contracts can fail, so use only the funds you plan to farm and keep the position small.`,
};

/** The farm profile for one category, matched most-specific first: a leveraged farm is not a
 * plain farm, a yield aggregator is not a plain yield vault, and a CDP manager is a CDP. */
function profileFor(category: string | null): FarmProfile {
  const c = (category ?? '').toLowerCase();
  if (c.includes('leveraged')) return LEVERAGED_FARM;
  if (c.includes('liquidity manager')) return MANAGED_LP;
  if (c.includes('dex')) return DEX;
  if (c.includes('lending')) return LENDING;
  if (c.includes('cdp')) return CDP;
  if (c.includes('collateral')) return LENDING;
  if (c.includes('aggregator')) return AGGREGATOR;
  if (c.includes('yield')) return YIELD_VAULT;
  if (c.includes('curator') || c.includes('allocator')) return CURATOR;
  if (c.includes('basis')) return BASIS;
  if (c.includes('bridge') || c.includes('cross chain')) return BRIDGE;
  if (c.includes('restak') || c.includes('staking')) return STAKING;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return PERPS;
  if (c.includes('prediction')) return PREDICTION;
  if (c.includes('stable') || c.includes('dual-token')) return STABLE;
  if (c.includes('rwa')) return RWA;
  if (c.includes('insurance')) return INSURANCE;
  if (c.includes('farm')) return FARM;
  if (c.includes('payment')) return PAYMENTS;
  if (c.includes('launchpad')) return LAUNCHPAD;
  if (c.includes('index')) return INDEXES;
  if (c.includes('privacy')) return PRIVACY;
  if (c.includes('governance')) return GOVERNANCE;
  if (c.includes('otc')) return OTC;
  if (c.includes('card')) return CARD;
  if (c.includes('locker')) return LOCKER;
  if (c.includes('btc')) return BTC_YIELD;
  if (c.includes('synthetic')) return SYNTHETICS;
  if (c === 'chain') return CHAIN_APP;
  return GENERIC;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: the funding step follows its main chain, the core, weekly, milestone, check and exit
 * steps follow its category's own mechanics, a multi-chain protocol's weekly step repeats the
 * core action once on its second chain, and the last step is the category's risk plus the main
 * chain's own risk. Two protocols share a step only when their records genuinely coincide.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = secondChainOf(p);
  const capital = capitalFor(p);
  const half = Math.max(10, Math.round(capital / 2));
  const hold = holdDaysFor(age);
  const prof = profileFor(p.category);
  const gas = gasFor(chain);
  const ctx: FarmCtx = { n: p.name, c: chain, k: capital, h: half, hold };
  let weekly = prof.weekly(ctx);
  if (chain2 !== null) weekly += ` Once, repeat the core action on ${chain2} with $${half} so the activity spans two chains.`;
  return [
    {
      text: fundFor(chain, capital),
      cost: `$${capital} of capital and ${gas.fund} of gas`,
      time: '10 minutes to fund',
    },
    {
      text: prof.core(ctx),
      cost: `$${capital} of capital and ${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: chain2 !== null ? `${gas.weekly} of gas a week, plus $${half} once on ${chain2}` : `${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: prof.milestone(ctx),
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: prof.check(ctx),
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log. ${prof.unwind(ctx)}`,
      cost: 'nothing but the log, plus gas to exit',
      time: '10 minutes to unwind',
    },
    {
      text: `${prof.risk} ${chainRisk(chain)}`,
      cost: 'nothing to read, and it can save the whole position',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const LIVE_ROWS = 24;
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : null,
    }));
}

/** One category's comparable multiple, for the dashboard's comparables table. The multiple
 * shown is the shrunk one the board actually uses: a thin category's factor is pulled toward
 * the market median by n / (n + shrink_prior), so the table never shows a multiple built from
 * a single outlier comparable at full strength. */
export function comparableRows(snapshot: Snapshot, model: ModelConstants = MODEL): ComparableRow[] {
  const comparables = measureComparables(snapshot, model);
  const rows: ComparableRow[] = [];
  for (const [category, measured] of [...comparables.byCategory.entries()].sort((a, b) => b[1].count - a[1].count)) {
    if (measured.count < 1) continue;
    const rawFactor = measured.median / comparables.overall;
    const clamped = Math.min(model.category_factor_cap, Math.max(model.category_factor_floor, rawFactor));
    const weight = measured.count / (measured.count + model.shrink_prior);
    const factor = 1 + weight * (clamped - 1);
    rows.push({
      category,
      comparables: measured.count,
      median_mcap_tvl: round4(measured.median),
      factor: round4(factor),
      multiple: round4(comparables.overall * factor),
    });
  }
  return rows;
}

/** A board row's compact form for data.js, with the farm plan embedded. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
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
    top_driver: row.top_driver,
    driver_percentiles: row.driver_percentiles,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiple: row.model.category_multiple,
    stable_haircut: row.model.stable_haircut,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comparables = measureComparables(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    overall_multiple: comparables.overall,
    driver_counts: countDrivers(board),
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    comparables: comparableRows(snapshot, model),
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
