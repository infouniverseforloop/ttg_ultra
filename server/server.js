// server.js (final)
// Full Node backend: WebSocket server, REST endpoints, broker adapters, DB, Telegram optional
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
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

// if no live feed, simulate ticks (useful for Forex/OTC until broker adapter provided)
function simulateTick(sym){
  const base = sym.includes('BTC') ? 110000 : (sym.startsWith('EUR') ? 1.09 : 1.0);
  const noise = (Math.random()-0.5) * (sym.includes('BTC') ? 200 : 0.0012);
  const price = +(base + noise).toFixed(sym.includes('BTC') ? 0 : 4);
  const qty = Math.random()* (sym.includes('BTC') ? 1 : 100);
  appendTick(sym, price, qty, Math.floor(Date.now()/1000));
}

// wire Binance adapter for USDT symbols (crypto)
try {
  startBinanceStream(WATCH, appendTick);
} catch(e){ console.warn('binance adapter not started', e.message); }

// periodic: ensure ticks present & compute signals
setInterval(()=>{
  WATCH.forEach(sym=>{
    if(!bars[sym] || bars[sym].length < 30) simulateTick(sym);
    const sig = computeSignalForSymbol(sym, bars, { market:'binary' });
    if(sig){
      // save to DB & broadcast
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
        // validate and then call adapter to place trade
        ws.send(JSON.stringify({ type:'info', data:'exec placeholder' }));
      }
    } catch(e){
      console.warn('ws parse err', e.message);
    }
  });
  ws.on('close', ()=> console.log('client disconnected'));
});

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

// server start
server.listen(PORT, ()=> {
  console.log(`Server listening on ${PORT} — watching ${WATCH.join(',')}`);
});
