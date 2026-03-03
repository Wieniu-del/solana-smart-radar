const RadarLogo = () => (
  <div className="flex items-center gap-3">
    <div className="relative w-10 h-10">
      {/* Radar circles */}
      <div className="absolute inset-0 rounded-full border border-primary/30" />
      <div className="absolute inset-1.5 rounded-full border border-primary/20" />
      <div className="absolute inset-3 rounded-full border border-primary/10" />
      {/* Sweep line */}
      <div className="absolute inset-0 radar-spin origin-center">
        <div className="absolute top-1/2 left-1/2 w-1/2 h-[2px] bg-gradient-to-r from-primary to-transparent origin-left" />
      </div>
      {/* Center dot */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary pulse-neon" />
    </div>
    <div>
      <h1 className="text-lg font-bold tracking-tight text-foreground">
        Smart Money <span className="text-primary neon-glow">Radar</span>
      </h1>
      <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">Solana Wallet Intelligence</p>
    </div>
  </div>
);

export default RadarLogo;
