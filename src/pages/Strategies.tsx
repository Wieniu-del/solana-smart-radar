import { Brain } from "lucide-react";
import TechnicalStrategiesPanel from "@/components/TechnicalStrategiesPanel";

export default function Strategies() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Brain className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Strategie Techniczne</h1>
          <p className="text-sm text-muted-foreground">Konfiguracja strategii TA i reguł handlowych</p>
        </div>
      </div>
      <TechnicalStrategiesPanel />
    </div>
  );
}
