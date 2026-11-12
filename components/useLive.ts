'use client';

import { useEffect, useState } from 'react';
import { api } from './ui';

export type Load = 'loading' | 'ready' | 'gone' | 'failed';

/**
 * Reads `path` once, then follows `path/events` (server-sent events whose data carries the object under `key`).
 * If the stream fails, the same path is read every three seconds instead. `set` lets a page put in the answer of
 * its own call without waiting for the stream.
 */
export function useLive<T>(path: string, key: string): { data: T | null; load: Load; set: (value: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [load, setLoad] = useState<Load>('loading');

  useEffect(() => {
    let live = true;
    let stream: EventSource | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function read() {
      const r = await api(path);
      if (!live) return false;
      if (r.status === 200 && r.data) setData(r.data);
      // A treat that was on screen stays there through a dropped connection; only a 404 says it is gone.
      setLoad((was) => (r.status === 200 ? 'ready' : r.status === 404 ? 'gone' : was === 'ready' ? 'ready' : 'failed'));
      if (r.status === 404) stop();
      return r.status;
    }

    function stop() {
      stream?.close();
      stream = undefined;
      if (timer) clearInterval(timer);
      timer = undefined;
    }

    function poll() {
      stop();
      timer = setInterval(() => !document.hidden && void read(), 3000);
    }

    read().then((status) => {
      if (!live || status === 404) return;
      if (status !== 200 || typeof EventSource === 'undefined') return poll();
      stream = new EventSource(`${path}/events`);
      stream.onmessage = (m) => {
        try {
          const value = JSON.parse(m.data)?.[key];
          if (value) setData(value);
        } catch {
          /* a line that is not JSON is skipped */
        }
      };
      // Anything written between the first read and the stream opening is read once more here.
      stream.onopen = () => void read();
      stream.onerror = () => {
        if (live) poll();
      };
    });

    return () => {
      live = false;
      stop();
    };
  }, [path, key]);

  return { data, load, set: setData };
}
