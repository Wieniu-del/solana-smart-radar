import { useState, useEffect } from "react";
import { Key, Check, Globe, RefreshCw, Wallet, Plus, Trash2, Loader2, Link2, Zap, Shield } from "lucide-react";
import { getHeliusApiKey, setHeliusApiKey, validateHeliusKey } from "@/services/helius";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SettingsPage = () => {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [network, setNetwork] = useState(() => localStorage.getItem("solana_network") || "mainnet");
  const [wallets, setWallets] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("tracked_wallets") || "[]"); } catch { return []; }
  });
  const [newWallet, setNewWallet] = useState("");

  // Wallet connection state
  const [solanaWallet, setSolanaWallet] = useState<string | null>(() => localStorage.getItem("connected_wallet"));
  const [connecting, setConnecting] = useState(false);

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

    // Extract clean key - handle various formats
    let clean = apiKey.trim();

    // Handle URL with api-key param
    const urlMatch = clean.match(/api-key=([a-f0-9-]+)/i);
    if (urlMatch) {
      clean = urlMatch[1];
    } else {
      // Handle KEY=value formats
      const eqIndex = clean.lastIndexOf("=");
      if (eqIndex !== -1 && eqIndex < clean.length - 1) {
        clean = clean.substring(eqIndex + 1).trim();
      }
    }
    clean = clean.replace(/[^a-f0-9-]/gi, "");

    if (clean.length < 10) {
      setValidating(false);
      toast.error("Klucz API jest za krótki — wklej pełny klucz z helius.dev");
      return;
    }

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
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) {
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

  const connectPhantom = async () => {
    setConnecting(true);
    try {
      const provider = (window as any).solana;
      if (!provider?.isPhantom) {
        toast.error("Phantom Wallet nie jest zainstalowany. Zainstaluj rozszerzenie z phantom.app");
        window.open("https://phantom.app/", "_blank");
        setConnecting(false);
        return;
      }
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toString();
      setSolanaWallet(pubkey);
      localStorage.setItem("connected_wallet", pubkey);
      toast.success(`Portfel podłączony: ${pubkey.slice(0, 6)}...${pubkey.slice(-4)}`);
    } catch (err: any) {
      if (err.code === 4001) {
        toast.error("Połączenie odrzucone przez użytkownika");
      } else {
        toast.error("Błąd połączenia z portfelem");
      }
    }
    setConnecting(false);
  };

  const disconnectWallet = () => {
    try {
      const provider = (window as any).solana;
      if (provider?.isPhantom) provider.disconnect();
    } catch {}
    setSolanaWallet(null);
    localStorage.removeItem("connected_wallet");
    toast.success("Portfel odłączony");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold mb-1">Ustawienia</h1>
        <p className="text-sm text-muted-foreground">Konfiguracja połączenia z blockchain Solana</p>
      </div>

      {/* ─── Wallet Connection Section ─── */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Połączenie z Portfelem</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Podłącz swój portfel Solana (Phantom), aby móc handlować przez Jupiter DEX bezpośrednio z aplikacji.
        </p>

        {solanaWallet ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="w-3 h-3 rounded-full bg-primary pulse-neon" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Podłączony portfel</p>
                <p className="text-sm font-mono text-foreground truncate">{solanaWallet}</p>
              </div>
              <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">
                <Check className="h-3 w-3 mr-1" /> Aktywny
              </Badge>
            </div>
            <button
              onClick={disconnectWallet}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Odłącz portfel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={connectPhantom}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-[#ab9ff2] to-[#7c3aed] text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              {connecting ? "Łączenie..." : "Połącz Phantom Wallet"}
            </button>
            <p className="text-[10px] text-muted-foreground text-center">
              Obsługiwane portfele: Phantom · Nie masz? <a href="https://phantom.app/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Pobierz Phantom</a>
            </p>
          </div>
        )}
      </div>

      {/* ─── Jupiter DEX Connection ─── */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-5 w-5 text-secondary" />
          <h2 className="font-semibold text-foreground">Jupiter DEX</h2>
          <Badge variant="outline" className="text-[10px] border-secondary/30 text-secondary ml-auto">V6 API</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Jupiter to największy agregator DEX na Solanie. Zapewnia najlepszą cenę dzięki routowaniu przez Raydium, Orca, Meteora i inne.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-foreground">V6</p>
            <p className="text-[10px] text-muted-foreground">Wersja API</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-foreground">30+</p>
            <p className="text-[10px] text-muted-foreground">Źródła płynności</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-primary">Auto</p>
            <p className="text-[10px] text-muted-foreground">Routing</p>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-secondary/5 border border-secondary/20">
          <p className="text-[11px] text-secondary flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            Transakcje są podpisywane na backendzie za pomocą bezpiecznego klucza. Twoje środki są chronione.
          </p>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p><strong>Jak działa handel:</strong></p>
          <p>1. Bot/zlecenie ręczne generuje sygnał kupna/sprzedaży</p>
          <p>2. Jupiter API wyszukuje najlepszą trasę (Raydium → Orca → Meteora)</p>
          <p>3. Transakcja jest budowana i podpisywana na backendzie</p>
          <p>4. Transakcja jest wysyłana do blockchain Solana przez Helius RPC</p>
        </div>
      </div>

      {/* Helius API Key */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">Helius API Key</h2>
          {getHeliusApiKey() && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">
              <Check className="h-3 w-3 mr-1" /> Zapisany
            </Badge>
          )}
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
            onChange={(e) => setApiKey(e.target.value.slice(0, 128))}
            placeholder="Wklej klucz API Helius..."
            className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoComplete="off"
            spellCheck={false}
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
        <div className="p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20">
          <p className="text-neon-amber text-[11px]">
            💡 Możesz wkleić sam klucz, pełny URL z api-key= lub format KLUCZ=wartość — aplikacja sama wyciągnie prawidłowy klucz.
          </p>
        </div>
      </div>

      {/* Tracked Wallets */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="h-5 w-5 text-secondary" />
          <h2 className="font-semibold text-foreground">Śledzone Portfele</h2>
          <Badge variant="outline" className="text-[10px] ml-auto">{wallets.length} portfeli</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Dodaj adresy portfeli Solana, które chcesz śledzić. Bot tradingowy będzie analizować ich aktywność.
        </p>
        <div className="flex gap-2">
          <input
            value={newWallet}
            onChange={(e) => setNewWallet(e.target.value)}
            placeholder="Wklej pełny adres portfela Solana (np. 7xKXtg2CW87d97...)"
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
                <span className="flex-1 text-xs font-mono text-foreground break-all">{w}</span>
                <button
                  onClick={() => removeWallet(w)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Brak śledzonych portfeli — dodaj portfele smart money, aby bot mógł je analizować</p>
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
          <p>1. Utwórz darmowe konto na <a href="https://helius.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">helius.dev</a> i wklej klucz API</p>
          <p>2. Podłącz portfel Phantom, aby handlować przez Jupiter DEX</p>
          <p>3. Dodaj portfele smart money do śledzenia</p>
          <p>4. Bot automatycznie analizuje aktywność i generuje sygnały kupna/sprzedaży</p>
          <div className="mt-3 p-3 rounded-lg bg-neon-amber/5 border border-neon-amber/20">
            <p className="text-neon-amber text-[11px]">
              ⚠️ Klucze są przechowywane lokalnie w przeglądarce (localStorage). Klucz prywatny portfela do podpisywania transakcji jest bezpiecznie przechowywany na backendzie.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
