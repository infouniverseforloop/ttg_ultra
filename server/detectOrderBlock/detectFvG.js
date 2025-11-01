// near top of computeStrategy.js
const { isBreakOfStructure, scoreZoneConfluence, refineOrderBlock } = require('./strategyAdvanced');
const { analyzeTicks } = require('./manipulationDetector');
const aiLearner = require('./aiLearner');

// inside computeSignalForSymbol (after you prepared m1/m5 and base score):
// assemble barsObj
const barsObj = { m1, m5, m15: aggregate(barsAll[symbol] || [], 900) };

// advanced confluence boost
const advBoost = scoreZoneConfluence({ m1, m5 });
score += advBoost;

// manipulation check (if you have raw ticks array for symbol pass it, else empty)
const manip = analyzeTicks([], m1); // give ticks array if available
if (manip.score > 0) {
  // penalize score a bit
  score -= Math.round(manip.score / 4);
  // attach reason e.g. signal.notes += ' | manip:' + JSON.stringify(manip)
}

// AI learner predicted boost
const featureVector = {
  bos: (isBreakOfStructure(m5).type ? 1 : 0),
  fvg: detectFVG(m1) ? 1 : 0,
  volumeSpike: (lastVol > avgVol * 2.2) ? 1 : 0,
  wick: (wickDown > wickUp) ? 1 : 0,
  roundNumber: (roundDist < (p * 0.0005)) ? 1 : 0,
  manipulation: manip.score > 0 ? 1 : 0
};
const aiBoost = aiLearner.predictBoost(featureVector);
score += aiBoost; // aiBoost is small integer

// when you later get actual result for a signal (WIN/LOSS) record it:
// aiLearner.recordOutcome(featureVector, outcomeBoolean);
