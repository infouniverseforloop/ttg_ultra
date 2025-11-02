import React from 'react';

export default function Heatmap({ pairs, signals }) {
  const getConfidence = pair => {
    const s = signals.find(sig=>sig.symbol===pair);
    return s ? s.confidence : 0;
  };
  const pairConfidenceClass = pair => {
    const conf = getConfidence(pair);
    if(conf > 85) return 'bg-yellow-500';
    if(conf > 70) return 'bg-green-500';
    if(conf > 50) return 'bg-blue-500';
    return 'bg-gray-700';
  };
  return (
    <div className="grid grid-cols-2 gap-1 mt-2">
      {pairs.map(pair=>(
        <div key={pair} className={`p-1 text-center rounded ${pairConfidenceClass(pair)}`}>
          {pair} {getConfidence(pair)}%
        </div>
      ))}
    </div>
  );
      }
