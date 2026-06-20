'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface NavState {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  desktopOpen: boolean;
  toggleDesktop: () => void;
}

const NavContext = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('sidenav-desktop-open') : null;
    return stored === 'true' ? false : true;
  });

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
