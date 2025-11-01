// strategyAdvanced.js
// Advanced ICT/SMC helpers: BOS, CHoCH, liquidity sweep, refined OB & FVG detection.
// Exported helpers are pure functions that take aggregated bars (M1, M5 ...) and return flags / scores.

const MIN_BIG_CANDLE_MULT = 1.5;

/**
 * isBreakOfStructure - Detect simple Break Of Structure (BOS)
 * returns { type: 'bull' | 'bear' | null, strength: number }
 */
function isBreakOfStructure(mtfBars /* array of bars newest last */, lookback = 6) {
  if (!mtfBars || mtfBars.length < lookback + 2) return { type: null, strength: 0 };
  const recent = mtfBars.slice(- (lookback + 2));
  // Use highs/lows to detect structure flip
  const highs = recent.map(b => b.high);
  const lows = recent.map(b => b.low);

  const prevHigh = Math.max(...highs.slice(0, -2));
  const prevLow  = Math.min(...lows.slice(0, -2));
  const lastHigh = highs[highs.length - 1];
  const lastLow  = lows[lows.length - 1];

  // bullish BOS: price makes higher high above previous swing high + confirmation
  if (lastHigh > prevHigh && recent[recent.length - 2].close > recent[recent.length - 3].close) {
    const strength = Math.min(50, Math.round(((lastHigh - prevHigh) / prevHigh) * 10000));
    return { type: 'bull', strength };
  }

  // bearish BOS
  if (lastLow < prevLow && recent[recent.length - 2].close < recent[recent.length - 3].close) {
    const strength = Math.min(50, Math.round(((prevLow - lastLow) / prevLow) * 10000));
    return { type: 'bear', strength };
  }
  return { type: null, strength: 0 };
}

/**
 * detectChoCH - change of character (simple)
 * returns boolean
 */
function detectChoCH(mtfBars) {
  if (!mtfBars || mtfBars.length < 6) return false;
  // CHoCH occurs when a break of structure is followed by quick reversal
  const last = mtfBars[mtfBars.length - 1];
  const prev = mtfBars[mtfBars.length - 2];
  const prev2 = mtfBars[mtfBars.length - 3];

  // quick reversal wick pattern
  const lastBody = Math.abs(last.close - last.open);
  const prevBody = Math.abs(prev.close - prev.open);
  if (lastBody > prevBody * 1.2 && ((last.close > last.open && prev.close < prev.open) || (last.close < last.open && prev.close > prev.open))) {
    return true;
  }
  // fallback: if last moved beyond prev structure in opposite way
  return false;
}

/**
 * detectLiquiditySweep - looks for big wick that sweeps obvious S/R (round numbers)
 * returns {sweep:true, direction:'bull'|'bear', magnitude}
 */
function detectLiquiditySweep(m1Bars) {
  if (!m1Bars || m1Bars.length < 6) return { sweep: false };
  const last = m1Bars[m1Bars.length - 1];
  const prev = m1Bars[m1Bars.length - 2] || last;
  const bodySize = Math.abs(prev.close - prev.open);
  const wickUp = last.high - Math.max(last.open, last.close);
  const wickDown = Math.min(last.open, last.close) - last.low;

  if (wickDown > bodySize * MIN_BIG_CANDLE_MULT) {
    // bearish sweep of liquidity below
    return { sweep: true, direction: 'bear', magnitude: wickDown };
  }
  if (wickUp > bodySize * MIN_BIG_CANDLE_MULT) {
    return { sweep: true, direction: 'bull', magnitude: wickUp };
  }
  return { sweep: false };
}

/**
 * refineOrderBlock - given M1 bars, attempt to refine an order block zone (returns zone {top,bottom})
 * Simple heuristic: find most recent large candle and return its body as zone
 */
function refineOrderBlock(m1Bars) {
  if (!m1Bars || m1Bars.length < 5) return null;
  const lastN = m1Bars.slice(-10);
  // find largest real body in lastN
  let biggest = null;
  for (const b of lastN) {
    const size = Math.abs(b.close - b.open);
    if (!biggest || size > biggest.size) biggest = { b, size };
  }
  if (!biggest) return null;
  const b = biggest.b;
  const top = Math.max(b.open, b.close);
  const bottom = Math.min(b.open, b.close);
  return { top, bottom, sourceTime: b.time };
}

/**
 * detectFVG - more precise: looks for imbalance between consecutive bars
 * returns boolean
 */
function detectFVG(m1Bars) {
  if (!m1Bars || m1Bars.length < 4) return false;
  // classic: check if middle bar's body leaves gap to previous/next (unfilled zone)
  for (let i = m1Bars.length - 4; i < m1Bars.length - 1; i++) {
    if (i < 0) continue;
    const a = m1Bars[i];
    const b = m1Bars[i + 1];
    const c = m1Bars[i + 2];
    // bullish FVG if a.high < b.low (gap)
    if (a.high < b.low) return true;
    // bearish FVG if a.low > b.high
    if (a.low > b.high) return true;
  }
  return false;
}

/**
 * scoreZoneConfluence - returns numeric boost based on confluence of advanced rules
 * inputs: bars object with m1,m5 arrays
 */
function scoreZoneConfluence(barsObj) {
  const m1 = barsObj.m1 || [];
  const m5 = barsObj.m5 || [];
  let boost = 0;

  const bosM5 = isBreakOfStructure(m5);
  if (bosM5.type) boost += bosM5.strength >= 10 ? 8 : 4;

  const choch = detectChoCH(m1);
  if (choch) boost += 6;

  const sweep = detectLiquiditySweep(m1);
  if (sweep.sweep) boost += sweep.magnitude > 0 ? 6 : 0;

  if (detectFVG(m1)) boost += 5;

  const ob = refineOrderBlock(m1);
  if (ob) boost += 4;

  return boost;
}

module.exports = {
  isBreakOfStructure,
  detectChoCH,
  detectLiquiditySweep,
  refineOrderBlock,
  detectFVG,
  scoreZoneConfluence
};
