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
//   multiple   = the market's own mcap/TVL for this category, measured from the snapshot's
//                token-trading protocols (median, at least 3 comparables; otherwise the
//                whole-market median), bounded so one noisy category cannot dominate
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
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
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_category_comparables: 3,
  category_factor_floor: 0.5,
  category_factor_cap: 2.0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

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

/** The market's own mcap/TVL multiples, measured from the snapshot's token-trading protocols. */
export interface Comparables {
  overall: number;
  byCategory: Map<string, { median: number; count: number }>;
}

export function measureComparables(snapshot: Snapshot): Comparables {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.category !== null && DISTORTED_CATEGORIES.has(p.category)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
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

/** The multiple one protocol's implied value uses: its category's, bounded, or the market's. */
export function multipleFor(
  protocol: SnapshotProtocol,
  comparables: Comparables,
  model: ModelConstants,
): { multiple: number; factor: number; comparables: number } {
  const key = protocol.category ?? 'Unknown';
  const measured = comparables.byCategory.get(key);
  if (measured !== undefined && measured.count >= model.min_category_comparables) {
    const rawFactor = measured.median / comparables.overall;
    const factor = Math.min(model.category_factor_cap, Math.max(model.category_factor_floor, rawFactor));
    return { multiple: comparables.overall * factor, factor, comparables: measured.count };
  }
  return { multiple: comparables.overall, factor: 1, comparables: measured?.count ?? 0 };
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
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, factor, comparables: count } = multipleFor(protocol, comparables, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, factor, comparables: count, growthPct, growthMult, maturityMult, age };
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
  const comparables = measureComparables(snapshot);
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

/** Whether the protocol's first chain is a low-fee chain, which changes the gas wording. */
function isLowFeeChain(chain: string): boolean {
  const c = chain.toLowerCase();
  return c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('solana') || c.includes('polygon') || c.includes('bnb') || c.includes('blast') || c.includes('mode') || c.includes('scroll') || c.includes('linea');
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it, then repay the borrow.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') && !c.includes('aggregator')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the shares.`;
  if (c.includes('aggregator')) return `Deposit $${capital} into ${name}'s top vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and keep the position open.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${name} and use it in one of its apps.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the shares.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed position on ${chain} and keep it open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's one risk, in the words a farmer can weigh. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('leveraged')) return `Perpetual and leveraged positions can be liquidated in a sharp move, so keep the position small and the leverage low.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `A borrow can be liquidated if the collateral falls, so borrow well under the limit and watch the health factor.`;
  if (c.includes('bridge')) return `A bridge moves funds across chains, so use only the protocol's own app and never a link from a chat or a search ad.`;
  if (c.includes('staking') || c.includes('restak')) return `Staked assets can be locked or slashed, so check the unlock time before you stake.`;
  if (c.includes('dex')) return `Liquidity positions lose to impermanent loss when prices move apart, so prefer a stable pair for a first position.`;
  if (c.includes('rwa')) return `Real-world assets depend on an off-chain issuer, so read who holds the reserves before you mint.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `A vault's yield can fall as more capital enters, so check the current rate before you deposit.`;
  if (c.includes('stable')) return `A stable asset can lose its peg, so do not put in funds you need at short notice.`;
  if (c.includes('farm')) return `Farm rewards can fall as more farmers join, so check the current rate before you deposit.`;
  return `Smart contracts can fail, so use only the funds you plan to farm and keep the position small.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The last step is the category's own risk, so the plan says what can go wrong as well as
 * what to do.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = isLowFeeChain(chain) ? 'under $1' : 'about $5';
  const setupGas = isLowFeeChain(chain) ? 'about $2' : 'about $8';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${setupGas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
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
      text: riskFor(p),
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

/** One category's comparable multiple, for the dashboard's comparables table. */
export function comparableRows(snapshot: Snapshot, model: ModelConstants = MODEL): ComparableRow[] {
  const comparables = measureComparables(snapshot);
  const rows: ComparableRow[] = [];
  for (const [category, measured] of [...comparables.byCategory.entries()].sort((a, b) => b[1].count - a[1].count)) {
    if (measured.count < model.min_category_comparables) continue;
    const rawFactor = measured.median / comparables.overall;
    const factor = Math.min(model.category_factor_cap, Math.max(model.category_factor_floor, rawFactor));
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
