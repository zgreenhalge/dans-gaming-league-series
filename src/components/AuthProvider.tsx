'use client';

import { SessionProvider } from "next-auth/react";
import RegisterModal from "./RegisterModal";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <RegisterModal />
    </SessionProvider>
  );
}
