"use client";

import { useSession } from 'next-auth/react';

export default function PlayerName({ playerId, children }: { playerId: number; children: React.ReactNode }) {
  const { data: session } = useSession();
  const isMe = session?.user?.playerId != null && session.user.playerId === playerId;

  return (
    <span className={isMe ? "font-bold text-black" : "text-gray-700"}>
      {children}
    </span>
  );
}
