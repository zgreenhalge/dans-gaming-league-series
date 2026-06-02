'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface NavState {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  desktopOpen: boolean;
  toggleDesktop: () => void;
}

const NavContext = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('sidenav-desktop-open');
    if (stored !== null) setDesktopOpen(stored === 'true');
  }, []);

  function toggleDesktop() {
    setDesktopOpen((v) => {
      const next = !v;
      localStorage.setItem('sidenav-desktop-open', String(next));
      return next;
    });
  }

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
