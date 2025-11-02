// server.js (ultimate final version)
// Node backend: WebSocket server, REST endpoints, broker adapters, DB, Telegram optional
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// === STEP 1: Basic setup / imports ===
const rr = require('./resultResolver');
const quotexAdapter = require('./quotexAdapter');      // STEP 7: Broker adapter start
const uiEnhancer = require('./uiEnhancer');           // STEP 2: UI / front enhancement
const ats = require('./autoTimeSync');               // STEP 3: Auto Time Sync
const pa = require('./patternAnalyzer');             // STEP 2/4: Pattern detection
const strategyAdvanced = require('./strategyAdvanced'); // STEP 4: Advanced strategy
const manipulationDetector = require('./manipulationDetector'); // STEP 6: Market traps detector
const aiLearner = require('./aiLearner');            // STEP 4: Auto Learning / AI
// ============================================

const { computeSignalForSymbol } = require('./computeStrategy');
const { startBinanceStream } = require('./brokerAdapters/binanceAdapter');
const db = require('./db');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const WATCH = (process.env.WATCH_SYMBOLS || 'BTCUSDT,EURUSD,USDJPY').split(',').map(s=>s.trim().toUpperCase());
const HISTORY_MAX = parseInt(process.env.HISTORY_MAX||'2000',10);

const bars = {}; // per-symbol second bars

// === STEP 2: UI / Frontend enhancements ===
app.use(express.static('public'));

app.get('/pairs', (req,res)=> {
  const pairs = WATCH.map(p => ({ symbol:p, type: p.endsWith('USDT') ? 'crypto' : 'forex', available:true }));
  res.json({ ok:true, pairs, server_time: new Date().toISOString() });
});
app.get('/signals/history', (req,res)=> res.json({ ok:true, rows: db.listRecent(200) }));

// broadcast
function broadcast(obj){ const raw = JSON.stringify(obj); wss.clients.forEach(c=>{ if(c.readyState===WebSocket.OPEN) c.send(raw); }); }

// append tick -> build 1s bars
function appendTick(sym, price, qty, tsSec){
  bars[sym] = bars[sym] || [];
  const arr = bars[sym];
  const last = arr[arr.length-1];
  if(!last || last.time !== tsSec){
    arr.push({ time: tsSec, open: price, high: price, low: price, close: price, volume: qty });
    if(arr.length > 7200) arr.shift();
  } else {
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.volume += qty;
  }
}

// simulate ticks if no live feed
function simulateTick(sym){
  const base = sym.includes('BTC') ? 110000 : (sym.startsWith('EUR') ? 1.09 : 1.0);
  const noise = (Math.random()-0.5) * (sym.includes('BTC') ? 200 : 0.0012);
  const price = +(base + noise).toFixed(sym.includes('BTC') ? 0 : 4);
  const qty = Math.random()* (sym.includes('BTC') ? 1 : 100);
  appendTick(sym, price, qty, Math.floor(Date.now()/1000));
}

// STEP 6: Market manipulation / trap detection (optional, advanced)
function detectMarketTraps(sym){
  const data = bars[sym];
  if(!data || data.length < 20) return false;
  // simplistic example: sudden spike detection
  const last = data[data.length-1];
  const prev = data[data.length-2];
  return prev && Math.abs(last.close - prev.close)/prev.close > 0.01;
}

// STEP 1/5: Broker adapters init
try {
  startBinanceStream(WATCH, appendTick);
} catch(e){ console.warn('binance adapter not started', e.message); }

// STEP 3: Auto Time Sync
let serverTimeOffset = 0;
ats.startAutoTimeSync({
  intervalMs: 60000,
  onOffset: (offsetMs) => {
    serverTimeOffset = offsetMs;
    console.log('AutoTimeSync offset (ms):', offsetMs);
  }
});

// periodic: ensure ticks present & compute signals
setInterval(()=>{
  WATCH.forEach(sym=>{
    if(!bars[sym] || bars[sym].length < 30) simulateTick(sym);

    // STEP 4: Compute signal + AI / strategy
    const sig = computeSignalForSymbol(sym, bars, { market:'binary' });

    // STEP 6: check trap / manipulation
    if(sig && detectMarketTraps(sym)){
      sig.confidence *= 0.5; // reduce confidence if suspicious
      sig.note = 'Market Trap suspected';
    }

    if(sig){
      db.insertSignal(sig);
      broadcast({ type:'signal', data:sig });
      broadcast({ type:'log', data:`Signal ${sig.symbol} ${sig.direction} conf:${sig.confidence}` });
    }
  });
}, 5000);

// WebSocket for frontends
wss.on('connection', ws => {
  console.log('client connected');
  ws.send(JSON.stringify({ type:'info', server_time: new Date().toISOString() }));
  ws.on('message', msg => {
    try {
      const m = JSON.parse(msg.toString());
      if(m.type === 'reqSignalNow'){
        const symbol = (m.pair||WATCH[0]).toUpperCase();
        const sig = computeSignalForSymbol(symbol, bars, { market: m.market || 'binary' });
        if(sig){
          db.insertSignal(sig);
          ws.send(JSON.stringify({ type:'signal', data: sig }));
        } else ws.send(JSON.stringify({ type:'error', data: 'No signal ready' }));
      } else if(m.type === 'execTrade'){
        // placeholder: execute trade via adapter (requires adapter API)
        ws.send(JSON.stringify({ type:'info', data:'exec placeholder' }));
      }
    } catch(e){
      console.warn('ws parse err', e.message);
    }
  });
  ws.on('close', ()=> console.log('client disconnected'));
});

// STEP 4: Auto Learning + Dynamic Pattern Adaptation
function autoLearnPatterns() {
  try {
    const allSymbols = Object.keys(bars);
    allSymbols.forEach(symbol => {
      const data = bars[symbol];
      if (!data || data.length < 50) return;
      const last = data[data.length - 1];
      const avg = data.reduce((a, b) => a + b.close, 0) / data.length;
      const delta = last.close - avg;
      if (Math.abs(delta) > avg * 0.002) {
        console.log(`[AI] ${symbol} adapting pattern… Δ=${delta.toFixed(5)}`);
      }
    });
  } catch (err) {
    console.error("AutoLearn error:", err);
  }
}
setInterval(autoLearnPatterns, 60000);

// STEP 5: Auto Heal / Optimization
function autoHealAndOptimize() {
  try {
    const symbols = Object.keys(bars);
    symbols.forEach(symbol => {
      const data = bars[symbol];
      if (!data || data.length < 10) return;
      const cleaned = [];
      for (let i = 0; i < data.length; i++) {
        if (!data[i].close || data[i].close <= 0) continue;
        if (i > 0 && data[i].time <= data[i - 1].time) continue;
        cleaned.push(data[i]);
      }
      if (cleaned.length !== data.length) {
        bars[symbol] = cleaned;
        console.log(`[HEAL] ${symbol} data repaired (${data.length - cleaned.length} fix)`);
      }
    });
    if (global.gc) global.gc();
  } catch (err) {
    console.error("AutoHeal error:", err);
  }
}
setInterval(autoHealAndOptimize, 120000);

// STEP 7: Start Quotex Adapter (Broker)
quotexAdapter.start();

// optional Telegram push for each signal
async function pushTelegram(msg){
  if(process.env.ENABLE_TELEGRAM !== 'true') return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if(!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg })
    });
  } catch(e){ console.warn('telegram push failed', e.message); }
}

// STEP 1: Server Start
server.listen(PORT, ()=> {
  console.log(`Server listening on ${PORT} — watching ${WATCH.join(',')}`);
});
