import React from 'react';
import { motion } from 'framer-motion';
import Countdown from './Countdown';

export default function SignalBox({ signal }) {
  const color = signal.direction === 'call' ? 'green' : 'red';
  const glowColor = signal.confidence > 85 ? 'yellow' : color;
  
  return (
    <motion.div
      className={`border p-2 rounded shadow-md signal-box border-${color}-500`}
      initial={{ opacity:0, scale:0.5 }}
      animate={{ opacity:1, scale:[1,1.05,1] }}
      transition={{ duration:0.6, repeat:1 }}
      style={{
        boxShadow: `0 0 ${signal.confidence>85?20:10}px ${glowColor}`
      }}
    >
      <div className="font-bold">{signal.symbol} — {signal.direction.toUpperCase()}</div>
      <div>Confidence: {signal.confidence}%</div>
      <Countdown expiry={signal.expiry} />
      {/* Particle Effect */}
      {signal.confidence > 80 && (
        <motion.div
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          initial={{ opacity:0 }}
          animate={{ opacity:[0,0.7,0] }}
          transition={{ duration:0.8 }}
        >
          {/* particles can be implemented via canvas or lightweight divs */}
        </motion.div>
      )}
    </motion.div>
  );
      }
