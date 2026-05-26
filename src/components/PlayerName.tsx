"use client";

import { useSession } from 'next-auth/react';

export default function PlayerName({ steamId, children }) {
  const { activePlayer } = useSession();

  // Check if the rendered player's ID matches the logged-in ID
  const isMe = activePlayer && activePlayer.steamId === steamId;

  // Apply bolding if it's the active player
  return (
    <span className={isMe ? "font-bold text-black" : "text-gray-700"}>
      {children}
    </span>
  );
}