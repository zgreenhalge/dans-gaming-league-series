import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * True once the component has hydrated on the client. Use to gate rendering that
 * depends on browser-only state (localStorage, matchMedia, portals) so the server
 * and first client render match, then the real content appears post-hydration.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
