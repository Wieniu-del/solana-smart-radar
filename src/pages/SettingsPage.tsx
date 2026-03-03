import { Settings } from "lucide-react";

const SettingsPage = () => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
    <Settings className="h-16 w-16 text-muted-foreground/30 mb-4" />
    <h1 className="text-xl font-bold mb-2">Ustawienia</h1>
    <p className="text-muted-foreground text-sm max-w-md">
      Konfiguracja sieci (Mainnet/Devnet), klucze API, preferencje dashboardu.
    </p>
    <div className="mt-6 px-4 py-2 rounded-full border border-border bg-muted/30 text-muted-foreground text-xs font-mono">
      🚧 Coming Soon
    </div>
  </div>
);

export default SettingsPage;
