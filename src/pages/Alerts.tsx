import { useState, useCallback } from "react";
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, Zap, TrendingUp, Clock } from "lucide-react";
import { AlertRule, AlertType, loadAlertRules, saveAlertRules } from "@/types/alerts";

const alertTypeConfig: Record<AlertType, { icon: React.ElementType; label: string; color: string }> = {
  burst: { icon: Zap, label: "Burst Activity", color: "text-neon-amber" },
  score_threshold: { icon: TrendingUp, label: "Smart Score", color: "text-primary" },
  reactivation: { icon: Clock, label: "Reaktywacja", color: "text-secondary" },
};

const Alerts = () => {
  const [rules, setRules] = useState<AlertRule[]>(loadAlertRules);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<AlertType>("burst");
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formTxCount, setFormTxCount] = useState("5");
  const [formTimeWindow, setFormTimeWindow] = useState("10");
  const [formScoreThreshold, setFormScoreThreshold] = useState("70");
  const [formSilenceHours, setFormSilenceHours] = useState("24");

  const updateRules = useCallback((newRules: AlertRule[]) => {
    setRules(newRules);
    saveAlertRules(newRules);
  }, []);

  const addRule = () => {
    if (!formName.trim()) return;
    const rule: AlertRule = {
      id: crypto.randomUUID(),
      type: formType,
      name: formName.trim(),
      enabled: true,
      walletAddress: formAddress.trim() || undefined,
      config: {
        ...(formType === "burst" && { txCount: parseInt(formTxCount), timeWindowMin: parseInt(formTimeWindow) }),
        ...(formType === "score_threshold" && { scoreThreshold: parseInt(formScoreThreshold) }),
        ...(formType === "reactivation" && { silenceHours: parseInt(formSilenceHours) }),
      },
      createdAt: Date.now(),
    };
    updateRules([rule, ...rules]);
    setShowForm(false);
    setFormName("");
    setFormAddress("");
  };

  const toggleRule = (id: string) => {
    updateRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const deleteRule = (id: string) => {
    updateRules(rules.filter(r => r.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold mb-1">Alerty</h1>
          <p className="text-sm text-muted-foreground">Ustaw powiadomienia o ważnych zdarzeniach on-chain</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nowy alert
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="neon-card rounded-xl p-6 space-y-4" style={{ animation: "fade-in-up 0.3s ease-out" }}>
          <h3 className="text-sm font-semibold text-foreground">Nowa reguła alertu</h3>

          {/* Type selector */}
          <div className="flex gap-2">
            {(Object.keys(alertTypeConfig) as AlertType[]).map((type) => {
              const cfg = alertTypeConfig[type];
              const Icon = cfg.icon;
              return (
                <button
                  key={type}
                  onClick={() => setFormType(type)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    formType === type
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {/* Name */}
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Nazwa alertu..."
            className="w-full bg-muted rounded-lg border border-border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:neon-border"
          />

          {/* Optional address */}
          <input
            type="text"
            value={formAddress}
            onChange={(e) => setFormAddress(e.target.value)}
            placeholder="Adres portfela (opcjonalnie)..."
            className="w-full bg-muted rounded-lg border border-border px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:neon-border"
          />

          {/* Type-specific config */}
          {formType === "burst" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Min. TX</label>
                <input type="number" value={formTxCount} onChange={(e) => setFormTxCount(e.target.value)}
                  className="w-full bg-muted rounded-lg border border-border px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:neon-border" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Okno (min)</label>
                <input type="number" value={formTimeWindow} onChange={(e) => setFormTimeWindow(e.target.value)}
                  className="w-full bg-muted rounded-lg border border-border px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:neon-border" />
              </div>
            </div>
          )}

          {formType === "score_threshold" && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Smart Score ≥</label>
              <input type="number" value={formScoreThreshold} onChange={(e) => setFormScoreThreshold(e.target.value)}
                className="w-full bg-muted rounded-lg border border-border px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:neon-border" />
            </div>
          )}

          {formType === "reactivation" && (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Cisza (godziny)</label>
              <input type="number" value={formSilenceHours} onChange={(e) => setFormSilenceHours(e.target.value)}
                className="w-full bg-muted rounded-lg border border-border px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:neon-border" />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={addRule}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors">
              Zapisz
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-6 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors">
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Rules List */}
      {rules.length === 0 && !showForm ? (
        <div className="text-center py-20">
          <Bell className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
          <p className="text-muted-foreground text-sm mb-2">Brak skonfigurowanych alertów</p>
          <p className="text-muted-foreground/60 text-xs">Kliknij „Nowy alert" aby dodać pierwszą regułę</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => {
            const cfg = alertTypeConfig[rule.type];
            const Icon = cfg.icon;
            return (
              <div
                key={rule.id}
                className={`neon-card rounded-xl p-4 flex items-center gap-4 transition-opacity ${!rule.enabled ? "opacity-50" : ""}`}
              >
                <Icon className={`h-5 w-5 ${cfg.color} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{rule.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {rule.type === "burst" && `${rule.config.txCount} TX w ${rule.config.timeWindowMin} min`}
                    {rule.type === "score_threshold" && `Smart Score ≥ ${rule.config.scoreThreshold}`}
                    {rule.type === "reactivation" && `Po ${rule.config.silenceHours}h ciszy`}
                    {rule.walletAddress && ` · ${rule.walletAddress.slice(0, 6)}...${rule.walletAddress.slice(-4)}`}
                  </div>
                </div>
                <button onClick={() => toggleRule(rule.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                  {rule.enabled
                    ? <ToggleRight className="h-6 w-6 text-primary" />
                    : <ToggleLeft className="h-6 w-6" />}
                </button>
                <button onClick={() => deleteRule(rule.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Alerts;
