/** Small pulsing dot indicating live data */
export default function LivePulse({ color = "bg-primary" }: { color?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}
