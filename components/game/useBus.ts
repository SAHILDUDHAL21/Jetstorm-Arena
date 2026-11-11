'use client';

/** React hook for subscribing to a GameBus channel. */
import { useEffect, useRef } from 'react';
import { bus, type BusEvents } from '@/game/GameBus';

export function useBus<K extends keyof BusEvents>(
  key: K,
  handler: (payload: BusEvents[K]) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => bus.on(key, (p) => ref.current(p)), [key]);
}
