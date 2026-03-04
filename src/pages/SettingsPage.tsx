import { useState, useEffect } from "react";
import { Key, Check, Globe, RefreshCw, Wallet, Plus, Trash2, Loader2 } from "lucide-react";
import { getHeliusApiKey, setHeliusApiKey, validateHeliusKey } from "@/services/helius";
import { toast } from "sonner";

const SettingsPage = () => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [network, setNetwork] = useState(() => localStorage.getItem("solana_network") || "mainnet");
  const [wallets, setWallets] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("tracked_wallets") || "[]"); } catch { return []; }
  });
  const [newWallet, setNewWallet] = useState("");

  useEffect(() => {
    const existing = getHeliusApiKey();
    if (existing) setApiKey(existing);
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      toast.error("Klucz API nie może być pusty");
      return;
    }
    setValidating(true);
    // Extract clean key
    let clean = apiKey.trim();
    const match = clean.match(/api-key=([a-f0-9-]+)/i);
    if (match) clean = match[1];
    clean = clean.replace(/[^a-f0-9-]/gi, "");

    const valid = await validateHeliusKey(clean);
    setValidating(false);

    if (!valid) {
      toast.error("Klucz API jest nieprawidłowy — sprawdź go na helius.dev");
      return;
    }

    setHeliusApiKey(clean);
    setApiKey(clean);
    setSaved(true);
    toast.success("Klucz Helius API zweryfikowany i zapisany!");
    setTimeout(() => setSaved(false), 2000);
  };

  const handleNetworkChange = (net: string) => {
    setNetwork(net);
    localStorage.setItem("solana_network", net);
    toast.success(`Sieć zmieniona na ${net}`);
  };

  const addWallet = () => {
    const addr = newWallet.trim();
    if (!addr) return;
    if (addr.length < 32 || addr.length > 44) {
      toast.error("Nieprawidłowy adres portfela Solana");
      return;
    }
    if (wallets.includes(addr)) {
      toast.error("Ten portfel już jest na liście");
      return;
    }
    const updated = [...wallets, addr];
    setWallets(updated);
    localStorage.setItem("tracked_wallets", JSON.stringify(updated));
    setNewWallet("");
    toast.success("Portfel dodany do śledzenia");
  };

  const removeWallet = (addr: string) => {
    const updated = wallets.filter(w => w !== addr);
    setWallets(updated);
    localStorage.setItem("tracked_wallets", JSON.stringify(updated));
    toast.success("Portfel usunięty");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold mb-1">Ustawienia</h1>
        <p className="text-sm text-muted-foreground">Konfiguracja połączenia z blockchain Solana</p>
      </div>

      {/* Helius API Key */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Helius API Key</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Darmowy klucz API z{" "}
          <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            helius.dev
          </a>
          {" "}— umożliwia pobieranie danych z blockchainu Solana (1000 zapytań/dzień na darmowym planie).
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Wklej klucz API Helius..."
            className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={handleSaveKey}
            disabled={validating}
            className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
          >
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Key className="h-4 w-4" />}
            {validating ? "Weryfikacja..." : saved ? "Zapisano" : "Zapisz"}
          </button>
        </div>
      </div>

      {/* Tracked Wallets */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="h-5 w-5 text-secondary" />
          <h2 className="font-semibold text-foreground">Śledzone Portfele</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Dodaj adresy portfeli Solana, które chcesz śledzić i analizować.
        </p>
        <div className="flex gap-2">
          <input
            value={newWallet}
            onChange={(e) => setNewWallet(e.target.value)}
            placeholder="Wklej adres portfela Solana..."
            className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            onKeyDown={(e) => e.key === "Enter" && addWallet()}
          />
          <button
            onClick={addWallet}
            className="px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Dodaj
          </button>
        </div>
        {wallets.length > 0 ? (
          <div className="space-y-2">
            {wallets.map((w) => (
              <div key={w} className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 group">
                <span className="flex-1 text-xs font-mono text-foreground truncate">{w}</span>
                <button
                  onClick={() => removeWallet(w)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Brak śledzonych portfeli</p>
        )}
      </div>

      {/* Network */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="h-5 w-5 text-secondary" />
          <h2 className="font-semibold text-foreground">Sieć Solana</h2>
        </div>
        <div className="flex gap-3">
          {[
            { id: "mainnet", label: "Mainnet", desc: "Produkcyjna sieć Solana" },
            { id: "devnet", label: "Devnet", desc: "Sieć testowa" },
          ].map((net) => (
            <button
              key={net.id}
              onClick={() => handleNetworkChange(net.id)}
              className={`flex-1 p-4 rounded-lg border transition-all ${
                network === net.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${network === net.id ? "bg-primary pulse-neon" : "bg-muted-foreground"}`} />
                <span className="font-semibold text-sm">{net.label}</span>
              </div>
              <span className="text-[11px]">{net.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="neon-card rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-5 w-5 text-neon-amber" />
          <h2 className="font-semibold text-foreground">Jak to działa</h2>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>1. Utwórz darmowe konto na <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">helius.dev</a></p>
          <p>2. Skopiuj klucz API z dashboardu Helius</p>
          <p>3. Wklej go powyżej i zapisz — klucz zostanie automatycznie zweryfikowany</p>
          <p>4. Gotowe! Aplikacja będzie pobierać prawdziwe dane z Solana blockchain</p>
          <div className="mt-3 p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20">
            <p className="text-neon-amber text-[11px]">
              ⚠️ Klucz API jest przechowywany lokalnie w przeglądarce (localStorage). Nie jest wysyłany na żadne serwery.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
