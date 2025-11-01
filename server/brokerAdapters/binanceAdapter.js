// binanceAdapter.js
// Connects to Binance trade streams for symbol list and feeds ticks via callback appendTick(sym, price, qty, ts)
const WebSocket = require('ws');

function startBinanceStream(symbols, appendTick) {
  // open one websocket per symbol (simple and stable)
  const sockets = {};
  symbols.forEach(sym => {
    if(!sym.endsWith('USDT')) return; // only USDT pairs for example
    const stream = sym.toLowerCase() + '@trade';
    const url = `wss://stream.binance.com:9443/ws/${stream}`;
    const ws = new WebSocket(url);
    ws.on('open', ()=> console.log('Binance ws open', sym));
    ws.on('message', data => {
      try {
        const d = JSON.parse(data);
        const price = parseFloat(d.p);
        const qty = parseFloat(d.q);
        const ts = Math.floor(d.T / 1000);
        appendTick(sym, price, qty, ts);
      } catch(e){ console.warn('binance msg parse', e.message); }
    });
    ws.on('close', ()=> setTimeout(()=> startBinanceStream([sym], appendTick), 3000));
    ws.on('error', ()=> { try{ ws.terminate(); }catch(_){} });
    sockets[sym] = ws;
  });
  return sockets;
}

module.exports = { startBinanceStream };
