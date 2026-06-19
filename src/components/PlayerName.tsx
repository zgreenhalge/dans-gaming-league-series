export function PlayerName({ name, isMe }: { name: string; isMe: boolean }) {
  if (!isMe) return <>{name}</>;
  return (
    <span className="player-name-me">{name}</span>
  );
}
