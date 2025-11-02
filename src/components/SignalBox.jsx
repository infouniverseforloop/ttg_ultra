import React from 'react';
import { motion } from 'framer-motion';
import Countdown from './Countdown';

export default function SignalBox({ signal }) {
  const color = signal.direction === 'call' ? 'green' : 'red';
  return (
    <motion.div
      className={`border p-2 rounded shadow-md signal-box border-${color}-500`}
      initial={{ opacity:0, scale:0.5 }}
      animate={{ opacity:1, scale:1 }}
      transition={{ duration:0.3 }}
    >
      <div className="font-bold">{signal.symbol} — {signal.direction.toUpperCase()}</div>
      <div>Confidence: {signal.confidence}%</div>
      <Countdown expiry={signal.expiry} />
    </motion.div>
  );
}
