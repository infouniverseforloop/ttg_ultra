import React, { useEffect, useState } from 'react';

export default function Countdown({ expiry }) {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, Math.floor((expiry*1000 - Date.now())/1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(Math.max(0, Math.floor((expiry*1000 - Date.now())/1000)));
    }, 200);
    return ()=> clearInterval(interval);
  }, [expiry]);

  const progress = 100 - (timeLeft/60)*100; // 1-min expiry

  return (
    <div className="relative w-10 h-10">
      <svg className="w-10 h-10">
        <circle
          r="16"
          cx="20"
          cy="20"
          stroke="gray"
          strokeWidth="4"
          fill="transparent"
        />
        <circle
          r="16"
          cx="20"
          cy="20"
          stroke="lime"
          strokeWidth="4"
          fill="transparent"
          strokeDasharray="100"
          strokeDashoffset={100-progress}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm">{timeLeft}s</div>
    </div>
  );
}
