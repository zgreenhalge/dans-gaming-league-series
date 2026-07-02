'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePersistedToggle } from './usePersistedToggle';

interface NavState {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  desktopOpen: boolean;
  toggleDesktop: () => void;
}

const NavContext = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, toggleDesktop] = usePersistedToggle('sidenav-desktop-open', true);

  return (
    <NavContext.Provider value={{ mobileOpen, setMobileOpen, desktopOpen, toggleDesktop }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used inside NavProvider');
  return ctx;
}
