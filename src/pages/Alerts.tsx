import { Bell } from "lucide-react";

const Alerts = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
    <Bell className="h-16 w-16 text-neon-cyan/30 mb-4" />
    <h1 className="text-xl font-bold mb-2">Alerty</h1>
    <p className="text-muted-foreground text-sm max-w-md">
      Ustaw powiadomienia gdy portfel wykona 5 TX w 10 min, Smart Score przekroczy 70, lub wznowi aktywność po 24h ciszy.
    </p>
    <div className="mt-6 px-4 py-2 rounded-full border border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan text-xs font-mono">
      🚧 Coming Soon — Faza 2
    </div>
  </div>
);

export default Alerts;
