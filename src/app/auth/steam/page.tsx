"use client";

import { useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";

export default function SteamAuthPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      router.replace("/");
      return;
    }
    signIn("steam-credentials", { token, callbackUrl: "/" });
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-mono text-[13px] text-[var(--color-text-secondary)]">
        Completing sign in…
      </p>
    </div>
  );
}
