'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads the server data of the current page every `seconds` so new requests and status changes show up
 * without a manual reload. Paused while the tab is hidden; refreshes once when the tab becomes visible again.
 * Renders nothing. Client state (open dialogs, typed text) is kept by router.refresh().
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      stop();
      timer = setInterval(() => router.refresh(), seconds * 1000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, seconds]);
  return null;
}
