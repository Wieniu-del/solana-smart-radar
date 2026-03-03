import { Trophy } from "lucide-react";

const Ranking = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
    <Trophy className="h-16 w-16 text-neon-amber/30 mb-4" />
    <h1 className="text-xl font-bold mb-2">Ranking Smart Wallets</h1>
    <p className="text-muted-foreground text-sm max-w-md">
      Top 50 najbardziej aktywnych portfeli w ostatnich 24h. Dostępne w Fazie 2.
    </p>
    <div className="mt-6 px-4 py-2 rounded-full border border-neon-amber/30 bg-neon-amber/5 text-neon-amber text-xs font-mono">
      🚧 Coming Soon — Faza 2
    </div>
  </div>
);

export default Ranking;
