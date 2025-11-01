// strategyAdvanced.js
// Advanced ICT/SMC helpers: BOS, CHoCH, liquidity sweep, refined OB & FVG detection.
// Exported helpers are pure functions that take aggregated bars (M1, M5 ...) and return flags / scores.

const MIN_BIG_CANDLE_MULT = 1.5;

/**
 * isBreakOfStructure - Detect simple Break Of Structure (BOS)
 * returns { type: 'bull' | 'bear' | null, strength: number }
 */
function isBreakOfStructure(mtfBars /* array of bars newest last */, lookback = 6) {
  if (!mtfBars || mtfBars.length < lookback + 2) return { type: null, strength
