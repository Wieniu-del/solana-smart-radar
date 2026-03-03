import { Activity } from "lucide-react";

const Activity24h = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
    <Activity className="h-16 w-16 text-secondary/30 mb-4" />
    <h1 className="text-xl font-bold mb-2">Aktywność 24h</h1>
    <p className="text-muted-foreground text-sm max-w-md">
      Globalna mapa aktywności on-chain z ostatnich 24 godzin. Dostępne w Fazie 2.
    </p>
    <div className="mt-6 px-4 py-2 rounded-full border border-secondary/30 bg-secondary/5 text-secondary text-xs font-mono">
      🚧 Coming Soon — Faza 2
    </div>
  </div>
);

export default Activity24h;
