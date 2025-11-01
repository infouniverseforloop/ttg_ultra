// server/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const { SMA, RSI } = require('technicalindicators');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const WATCH_SYMBOLS = (process.env.WATCH_SYMBOLS || 'BTCUSDT,EURUSD,USDJPY').split(',').map(s=>s.trim().toUpperCase());

// in-memory
const bars = {};
const history = [];

// static serve
app.use(express.static('public'));

// pairs endpoint
app.get('/pairs', (req,res) => {
  const pairs = WATCH_SYMBOLS.map(p => ({ symbol:p, available:true, type: p.endsWith('USDT') ? 'crypto' : 'forex' }));
  res.json({ ok:true, pairs, server_time: new Date().toISOString() });
});

// history endpoint
app.get('/signals/history', (req,res) => res.json({ ok:true, history }));

// broadcast helper
function broadcast(obj){
  const raw = JSON.stringify(obj);
  wss.clients.forEach(c => { if(c.readyState === WebSocket.OPEN) c.send(raw); });
}

// append tick -> per-second OHLC
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

// demo tick (only until you wire real broker)
function simulateTick(sym){
  bars[sym] = bars[sym] || [];
  const base = sym.includes('BTC') ? 110000 : (sym.startsWith('EUR') ? 1.09 : 1.0);
  const noise = (Math.random()-0.5) * (sym.includes('BTC') ? 200 : 0.0012);
  const price = +(base + noise).toFixed(sym.includes('BTC') ? 0 : 4);
  const qty = Math.random() * (sym.includes('BTC') ? 1 : 100);
  appendTick(sym, price, qty, Math.floor(Date.now()/1000));
}

// aggregate for timeframe (seconds)
function aggregateBars(sym, secondsPerBar){
  const arr = bars[sym] || [];
  if(!arr.length) return [];
  const out = [];
  let bucket = null;
  for(const b of arr){
    const t = Math.floor(b.time / secondsPerBar) * secondsPerBar;
    if(!bucket || bucket.time !== t){
      bucket = { time:t, open:b.open, high:b.high, low:b.low, close:b.close, volume:b.volume };
      out.push(bucket);
    } else {
      bucket.high = Math.max(bucket.high, b.high);
      bucket.low = Math.min(bucket.low, b.low);
      bucket.close = b.close;
      bucket.volume += b.volume;
    }
  }
  return out;
}

// placeholders for OB/FVG — replace with your exact algo when ready
function detectOrderBlock(sym){ return false; }
function detectFVG(sym){ return false; }

// compute signal with M1 + M5 checks
function computeSignal(sym, market='binary'){
  const s = (sym||WATCH_SYMBOLS[0]).toUpperCase();
  const sec = bars[s] || [];
  if(sec.length < 30) return null;
  const m1 = aggregateBars(s, 60);
  const m5 = aggregateBars(s, 300);
  if(m1.length < 6) return null;

  const closesM1 = m1.map(b => b.close).slice(-120);
  const closesM5 = m5.map(b => b.close).slice(-120);

  let sma5_m1, sma20_m1, rsi_m1, sma5_m5, sma20_m5;
  try {
    sma5_m1 = SMA.calculate({ period:5, values: closesM1 }).slice(-1)[0];
    sma20_m1 = SMA.calculate({ period:20, values: closesM1 }).slice(-1)[0];
    rsi_m1 = RSI.calculate({ period:14, values: closesM1 }).slice(-1)[0];
  } catch(e){}
  try {
    sma5_m5 = SMA.calculate({ period:5, values: closesM5 }).slice(-1)[0];
    sma20_m5 = SMA.calculate({ period:20, values: closesM5 }).slice(-1)[0];
  } catch(e){}

  const vols = sec.slice(-120).map(b=>b.volume);
  const avgVol = vols.slice(-60).reduce((a,b)=>a+b,0) / Math.max(1, Math.min(60, vols.slice(-60).length));
  const lastVol = vols[vols.length-1] || 0;
  const volSpike = lastVol > avgVol * 2.2;

  const lastM1 = m1[m1.length-1];
  const prevM1 = m1[m1.length-2] || lastM1;
  const wickUp = lastM1.high - Math.max(lastM1.open, lastM1.close);
  const wickDown = Math.min(lastM1.open, lastM1.close) - lastM1.low;

  let score = 50;
  if(sma5_m1 && sma20_m1) score += (sma5_m1 > sma20_m1 ? 8 : -8);
  if(sma5_m5 && sma20_m5) score += (sma5_m5 > sma20_m5 ? 6 : -6);
  if(typeof rsi_m1 === 'number'){
    if(rsi_m1 < 35) score += 10;
    if(rsi_m1 > 65) score -= 10;
  }
  if(volSpike) score += 8;
  if(wickDown > wickUp) score += 6;
  if(wickUp > wickDown) score -= 6;

  if(detectOrderBlock(s)) score += 10;
  if(detectFVG(s)) score += 8;

  // round number proximity
  const p = lastM1.close;
  const roundDist = Math.abs(Math.round(p) - p);
  if(roundDist < (p * 0.0005)) score += 4;

  score = Math.max(10, Math.min(99, Math.round(score)));
  const direction = (score >= 60) ? 'CALL' : (score <= 40 ? 'PUT' : (sma5_m1 > sma20_m1 ? 'CALL' : 'PUT'));

  const now = new Date();
  const expirySeconds = parseInt(process.env.BINARY_EXPIRY_SECONDS || '60', 10);
  const expiryAt = new Date(now.getTime() + expirySeconds * 1000);

  const signal = {
    market,
    symbol: s,
    direction,
    entry: `${(p*0.999).toFixed(s.includes('BTC')?0:4)} – ${(p*1.001).toFixed(s.includes('BTC')?0:4)}`,
    confidence: score,
    mtg: Math.random() > 0.2,
    notes: 'M1/M5 SMA+RSI+Vol+Wick (+OB/FVG placeholders)',
    time: now.toISOString(),
    expiry_at: expiryAt.toISOString()
  };

  history.unshift(signal);
  if(history.length > 1000) history.pop();

  return signal;
}

// On-demand compute for requested symbol by client
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type:'info', data:'welcome', server_time: new Date().toISOString() }));
  ws.on('message', m => {
    try {
      const msg = JSON.parse(m.toString());
      if(msg.type === 'reqSignalNow'){
        const symbol = (msg.pair || WATCH_SYMBOLS[0]).toUpperCase();
        const sig = computeSignal(symbol, msg.market || 'binary');
        if(sig) ws.send(JSON.stringify({ type:'signal', data:sig }));
        else ws.send(JSON.stringify({ type:'error', data:'No signal ready for ' + symbol }));
      }
    } catch(e){}
  });
});

// periodic loop
setInterval(() => {
  WATCH_SYMBOLS.forEach(sym => {
    if(!bars[sym] || bars[sym].length < 30) simulateTick(sym);
    const sig = computeSignal(sym, 'binary');
    if(sig){
      broadcast({ type:'signal', data: sig });
      broadcast({ type:'log', data: `Signal ${sig.symbol} ${sig.direction} conf:${sig.confidence}` });
      console.log('Emit', sig.symbol, sig.direction, sig.confidence);
    }
  });
}, 5000);

// start server
server.listen(PORT, () => console.log(`Server listening on ${PORT} — watching ${WATCH_SYMBOLS.join(',')}`));
