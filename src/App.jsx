import React, { useState, useEffect } from 'react';
import SignalBox from './components/SignalBox';
import Heatmap from './components/Heatmap';
import CandleChart from './components/CandleChart';

export default function App() {
  const [signals, setSignals] = useState([]);
  const [bars, setBars] = useState({});
  const [watchPairs, setWatchPairs] = useState([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000');
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if(data.type === 'signal'){
        setSignals(prev => [data.data, ...prev.slice(0,9)]);
      } else if(data.type === 'info'){
        console.log('Server Info:', data.data);
      }
    };
    fetch('/pairs').then(r=>r.json()).then(res=>setWatchPairs(res.pairs.map(p=>p.symbol)));
    return ()=> ws.close();
  }, []);

  return (
    <div className="bg-black text-white min-h-screen p-4 font-sans">
      <h1 className="text-3xl font-bold mb-4">Binary Sniper – Ultra Premium</h1>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          {watchPairs.map(pair=>(
            <CandleChart key={pair} pair={pair} bars={bars[pair]} latestSignal={signals[0]} />
          ))}
        </div>
        <div className="col-span-1 flex flex-col gap-2">
          {signals.map(sig=><SignalBox key={sig.symbol+sig.time} signal={sig} />)}
          <Heatmap pairs={watchPairs} signals={signals} />
        </div>
      </div>
    </div>
  );
      }
