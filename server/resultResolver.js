// server/resultResolver.js
// Usage: const rr = require('./resultResolver');
// rr.startResultResolver({ db, barsRef, checkIntervalMs:5000, aiLearner, broadcast })

const fs = require('fs');

function defaultComparator(signal, finalPrice) {
  // signal.direction: 'CALL' => price should be >= entry_mid (we approximate with entry range)
  // entry is string like "1.2345 – 1.2348"
  const entryStr = (signal.entry || '').split('–').map(s => s.trim());
  let entryMid = null;
  if (entryStr.length === 2) {
    const low = parseFloat(entryStr[0].replace(/,/g,''));
    const high = parseFloat(entryStr[1].replace(/,/g,''));
    if (!isNaN(low) && !isNaN(high)) entryMid = (low + high) / 2;
  }
  if (entryMid === null) {
    // fallback: use last known price if available in signal.notes (not ideal)
    return { result: 'UNKNOWN', won: false };
  }
  if (signal.direction === 'CALL') {
    return { result: (finalPrice >= entryMid) ? 'WIN' : 'LOSS', won: finalPrice >= entryMid };
  } else {
    return { result: (finalPrice <= entryMid) ? 'WIN' : 'LOSS', won: finalPrice <= entryMid };
  }
}

function safeNum(v){ return (typeof v === 'number' && isFinite(v)) ? v : null; }

/**
 * startResultResolver
 * opts = { db, barsRef, checkIntervalMs=5000, aiLearner (optional), broadcast (optional function to send ws msgs) }
 *
 * - db must implement insertSignal, listRecent, saveResult (see earlier db.js)
 * - barsRef is the in-memory bars object used by server: { SYMBOL: [ {time, open, high, low, close, volume}, ... ] }
 * - broadcast(msg) is optional: a function to broadcast websocket messages to clients
 */
function startResultResolver(opts = {}) {
  const db = opts.db;
  const barsRef = opts.barsRef;
  const intervalMs = opts.checkIntervalMs || 5000;
  const aiLearner = opts.aiLearner || null;
  const broadcast = typeof opts.broadcast === 'function' ? opts.broadcast : null;
  const HISTORY_KEY = 'resultResolver_lastChecked';
  let running = true;

  if (!db || !barsRef) {
    console.warn('resultResolver: db and barsRef required. Not started.');
    return { stop: ()=> { running=false; } };
  }

  // helper: parse ISO expiry to epoch ms
  function toMs(iso) { try { return new Date(iso).getTime(); } catch(e){ return null; } }

  // resolve results by checking last M1 bar at or after expiry
  async function checkLoop() {
    while(running) {
      try {
        // get recent signals (not resolved) - use db.listRecent to fetch recent and filter by result null
        const rows = db.listRecent(200); // returns most recent
        const unresolved = rows.filter(r => !r.result && r.expiry_iso);
        for (const sig of unresolved) {
          const expiryMs = toMs(sig.expiry_iso);
          if (!expiryMs) continue;
          const now = Date.now();
          if (now < expiryMs) continue; // not expired yet

          // determine the final price at expiry: use barsRef[symbol], find first bar with time >= expirySec
          const sym = sig.symbol;
          const bars = (barsRef[sym] || []);
          const expirySec = Math.floor(expiryMs / 1000);
          // find bar with time >= expirySec, or last bar before expiry
          let candidateBar = null;
          for (let i = 0; i < bars.length; i++) {
            if (bars[i].time >= expirySec) { candidateBar = bars[i]; break; }
          }
          if (!candidateBar) candidateBar = bars[bars.length - 1];

          const finalPrice = candidateBar ? safeNum(candidateBar.close) : null;
          if (finalPrice === null) {
            // can't resolve now; maybe wait for more ticks
            continue;
          }

          // compute outcome
          const outcome = defaultComparator(sig, finalPrice); // {result:'WIN'|'LOSS'|'UNKNOWN', won:bool}
          // update db.record result
          // We need to find signal id; db.insertSignal earlier does not return id in our db.js but we can match by time_iso
          // We'll try to update via saveResult if db supports it; else, skip
          try {
            // if db.saveResult exists, update by id (if id present) or try matching by time_iso
            if (typeof db.saveResult === 'function') {
              // if sig.id exists in row, use it, else try to query using time_iso - db has no helper -> assume saveResult(id,..)
              if (sig.id) {
                db.saveResult(sig.id, outcome.result);
              } else if (typeof db.updateResultByTime === 'function') {
                db.updateResultByTime(sig.time_iso, outcome.result);
              } else {
                // as fallback create a new column update by running raw SQL if available on db object
                // For safety we call saveResult with id if present only
              }
            }
          } catch(e){ console.warn('resultResolver: db.saveResult error', e.message); }

          // call aiLearner.recordOutcome if provided
          try {
            if (aiLearner && typeof aiLearner.recordOutcome === 'function') {
              // Build a small feature vector from sig.notes or default; best if server recorded featureVector at creation
              // For safety, we'll pass a minimal vector; user should modify to store exact vector in DB
              const fv = {
                bos: (sig.notes && sig.notes.includes('BOS')) ? 1 : 0,
                fvg: (sig.notes && sig.notes.includes('FVG')) ? 1 : 0,
                volumeSpike: 0,
                wick: 0,
                roundNumber: 0,
                manipulation: 0
              };
              aiLearner.recordOutcome(fv, outcome.won ? 1 : 0);
            }
          } catch(e){ console.warn('resultResolver: aiLearner error', e.message); }

          // broadcast result
          if (broadcast) {
            broadcast({ type:'signal_result', data: { symbol: sym, time_iso: sig.time_iso, result: outcome.result, finalPrice } });
          }
        }
      } catch (err) {
        console.warn('resultResolver checkLoop err', err && err.message ? err.message : err);
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  checkLoop();

  return {
    stop: () => { running = false; }
  };
}

module.exports = { startResultResolver };
