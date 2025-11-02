import React, { useEffect, useState } from 'react';

export default function Countdown({ expiry }) {
  const [timeLeft, setTimeLeft] = useState(Math.max(0, Math.floor((expiry*1000 - Date.now())/1000)));

  useEffect(() => {
    const interval = setInterval(()=> setTimeLeft(Math.max(0, Math.floor((expiry*1000 - Date.now())/1000))), 500);
    return ()=> clearInterval(interval);
  }, [expiry]);

  return <div>⏱ {timeLeft}s</div>;
}
