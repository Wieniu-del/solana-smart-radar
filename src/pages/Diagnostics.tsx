import { Stethoscope } from "lucide-react";
import BotDiagnosticsPanel from "@/components/BotDiagnosticsPanel";
import SystemStatusPanel from "@/components/SystemStatusPanel";
import SignalDiagnostics from "@/components/SignalDiagnostics";
import BotHealthMonitor from "@/components/BotHealthMonitor";
import PnLDashboard from "@/components/PnLDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Diagnostics() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Stethoscope className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Diagnostyka Systemu</h1>
          <p className="text-sm text-muted-foreground">Pełny podgląd infrastruktury, statusów i wydajności</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview" className="text-xs">Przegląd</TabsTrigger>
          <TabsTrigger value="signals" className="text-xs">Sygnały</TabsTrigger>
          <TabsTrigger value="pnl" className="text-xs">PnL</TabsTrigger>
          <TabsTrigger value="health" className="text-xs">Health Check</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <BotDiagnosticsPanel />
          <SystemStatusPanel />
        </TabsContent>

        <TabsContent value="signals">
          <SignalDiagnostics />
        </TabsContent>

        <TabsContent value="pnl">
          <PnLDashboard />
        </TabsContent>

        <TabsContent value="health">
          <BotHealthMonitor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
