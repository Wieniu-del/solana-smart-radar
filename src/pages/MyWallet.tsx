import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Wallet, DollarSign, Coins, ArrowUpDown, RefreshCw, Loader2,
  TrendingUp, TrendingDown, ExternalLink, Copy, Image, AlertTriangle
} from "lucide-react";
import {
  getHeliusApiKey, getTokenBalances, getTransactionHistory, parseTradesFromHistory,
  type HeliusTokenBalance, type HeliusTransaction, type ParsedTrade
} from "@/services/helius";
import { analyzeTokenSecurity, getRiskColor, getRiskLabel, type TokenSecurityReport } from "@/services/tokenSecurity";

export default function MyWallet() {
  const [walletAddress, setWalletAddress] = useState<string | null>(() => localStorage.getItem("connected_wallet"));
  const [manualAddress, setManualAddress] = useState("");
  const [tokens, setTokens] = useState<HeliusTokenBalance[]>([]);
  const [transactions, setTransactions] = useState<HeliusTransaction[]>([]);
  const [trades, setTrades] = useState<ParsedTrade[]>([]);
  const [securityReports, setSecurityReports] = useState<Map<string, TokenSecurityReport>>(new Map());
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const activeAddress = walletAddress || manualAddress.trim();

  useEffect(() => {
    if (walletAddress) loadWalletData(walletAddress);
  }, [walletAddress]);

  async function loadWalletData(address: string) {
    if (!getHeliusApiKey()) {
      toast.error("Dodaj klucz Helius API w Ustawieniach");
      return;
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      toast.error("Nieprawidłowy adres portfela");
      return;
    }

    setLoading(true);
    try {
      const [tokenData, txData] = await Promise.all([
        getTokenBalances(address),
        getTransactionHistory(address, 100),
      ]);

      setTokens(tokenData);
      setTransactions(txData);
      setTrades(parseTradesFromHistory(txData, address));

      // Security analysis
      const reports = new Map<string, TokenSecurityReport>();
      for (const token of tokenData) {
        reports.set(token.mint, analyzeTokenSecurity(token));
      }
      setSecurityReports(reports);

      setLastRefresh(new Date());
      toast.success(`Załadowano dane portfela: ${tokenData.length} tokenów, ${txData.length} transakcji`);
    } catch (e: any) {
      toast.error(`Błąd: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const totalValueUsd = tokens.reduce((sum, t) => sum + (t.valueUsd || 0), 0);
  const solToken = tokens.find(t => t.symbol === "SOL");
  const otherTokens = tokens.filter(t => t.symbol !== "SOL");
  const riskyTokens = tokens.filter(t => {
    const report = securityReports.get(t.mint);
    return report && report.riskScore >= 40;
  });

  const copyAddress = () => {
    if (activeAddress) {
      navigator.clipboard.writeText(activeAddress);
      toast.success("Adres skopiowany");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Mój Portfel</h1>
            <p className="text-sm text-muted-foreground">Saldo, tokeny, transakcje i analiza bezpieczeństwa</p>
          </div>
        </div>
        {activeAddress && (
          <Button
            onClick={() => loadWalletData(activeAddress)}
            disabled={loading}
            size="sm"
            variant="outline"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Odśwież</span>
          </Button>
        )}
      </div>

      {/* Wallet Address */}
      {!walletAddress ? (
        <Card className="border-border bg-card">
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Podłącz portfel Phantom w Ustawieniach lub wpisz adres poniżej:
            </p>
            <div className="flex gap-2">
              <input
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="Wklej adres portfela Solana..."
                className="flex-1 bg-muted border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                onKeyDown={(e) => e.key === "Enter" && manualAddress.trim() && loadWalletData(manualAddress.trim())}
              />
              <Button onClick={() => manualAddress.trim() && loadWalletData(manualAddress.trim())} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Załaduj"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-primary pulse-neon shrink-0" />
            <span className="text-xs font-mono text-foreground break-all flex-1">{walletAddress}</span>
            <button onClick={copyAddress} className="text-muted-foreground hover:text-primary transition-colors shrink-0">
              <Copy className="h-4 w-4" />
            </button>
            <a
              href={`https://solscan.io/account/${walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors shrink-0"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </CardContent>
        </Card>
      )}

      {/* Stats Overview */}
      {tokens.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={DollarSign}
              label="Łączna wartość"
              value={`$${totalValueUsd.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="text-primary"
            />
            <StatCard
              icon={Coins}
              label="Saldo SOL"
              value={`${(solToken?.amount || 0).toFixed(4)} SOL`}
              sub={solToken?.valueUsd ? `$${solToken.valueUsd.toFixed(2)}` : ""}
              color="text-secondary"
            />
            <StatCard
              icon={Coins}
              label="Tokeny"
              value={tokens.length.toString()}
              sub={`${otherTokens.length} SPL + SOL`}
              color="text-foreground"
            />
            <StatCard
              icon={AlertTriangle}
              label="Ryzykowne tokeny"
              value={riskyTokens.length.toString()}
              sub="Risk Score ≥ 40"
              color="text-neon-amber"
            />
          </div>

          <Tabs defaultValue="tokens" className="space-y-4">
            <TabsList className="bg-muted">
              <TabsTrigger value="tokens">
                Tokeny ({tokens.length})
              </TabsTrigger>
              <TabsTrigger value="trades">
                Handel ({trades.length})
              </TabsTrigger>
              <TabsTrigger value="transactions">
                Transakcje ({transactions.length})
              </TabsTrigger>
              <TabsTrigger value="security">
                Bezpieczeństwo
                {riskyTokens.length > 0 && (
                  <span className="ml-1.5 bg-neon-amber/20 text-neon-amber text-[10px] px-1.5 py-0.5 rounded-full">
                    {riskyTokens.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Tokens Tab */}
            <TabsContent value="tokens" className="space-y-2">
              {tokens.map((token) => (
                <TokenRow key={token.mint} token={token} report={securityReports.get(token.mint)} />
              ))}
            </TabsContent>

            {/* Trades Tab */}
            <TabsContent value="trades" className="space-y-2">
              {trades.length === 0 ? (
                <EmptyState text="Brak historii handlu" />
              ) : (
                trades.map((trade) => (
                  <TradeRow key={trade.signature} trade={trade} />
                ))
              )}
            </TabsContent>

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="space-y-2">
              {transactions.length === 0 ? (
                <EmptyState text="Brak transakcji" />
              ) : (
                transactions.map((tx) => (
                  <TxRow key={tx.signature} tx={tx} />
                ))
              )}
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security" className="space-y-2">
              {tokens.map((token) => {
                const report = securityReports.get(token.mint);
                if (!report) return null;
                return <SecurityRow key={token.mint} token={token} report={report} />;
              })}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Loading State */}
      {loading && tokens.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
            <p className="text-sm text-muted-foreground">Ładowanie danych z blockchain...</p>
          </CardContent>
        </Card>
      )}

      {/* Last Refresh */}
      {lastRefresh && (
        <p className="text-[10px] text-muted-foreground text-right">
          Ostatnie odświeżenie: {lastRefresh.toLocaleString("pl-PL")}
        </p>
      )}
    </div>
  );
}

// ─── Sub-Components ───

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-lg font-bold font-mono text-foreground">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function TokenRow({ token, report }: { token: HeliusTokenBalance; report?: TokenSecurityReport }) {
  return (
    <Card className="border-border bg-card hover:bg-muted/20 transition-colors">
      <CardContent className="p-3 flex items-center gap-3">
        {token.logoURI ? (
          <img src={token.logoURI} alt={token.symbol} className="w-8 h-8 rounded-full bg-muted shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Coins className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{token.symbol || "???"}</span>
            <span className="text-xs text-muted-foreground truncate">{token.name}</span>
            {report && report.riskScore >= 40 && (
              <Badge variant="outline" className="text-[9px] border-neon-amber/30 text-neon-amber">
                ⚠ {getRiskLabel(report.riskLevel)}
              </Badge>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground truncate">{token.mint}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-semibold text-foreground">
            {token.amount < 0.0001 ? token.amount.toExponential(2) : token.amount.toLocaleString("pl-PL", { maximumFractionDigits: 4 })}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {(token.valueUsd || 0) > 0.01
              ? `$${(token.valueUsd || 0).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : token.priceUsd && token.priceUsd > 0
              ? `$${token.priceUsd.toExponential(2)}/szt`
              : "brak wyceny"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TradeRow({ trade }: { trade: ParsedTrade }) {
  const typeColors: Record<string, string> = {
    BUY: "text-primary bg-primary/10",
    SELL: "text-destructive bg-destructive/10",
    SWAP: "text-secondary bg-secondary/10",
    TRANSFER: "text-muted-foreground bg-muted",
  };
  const date = new Date(trade.timestamp * 1000);

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`p-1.5 rounded-lg ${typeColors[trade.type] || "bg-muted"}`}>
          {trade.type === "BUY" ? <TrendingUp className="h-4 w-4" /> :
           trade.type === "SELL" ? <TrendingDown className="h-4 w-4" /> :
           <ArrowUpDown className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{trade.type}</Badge>
            {trade.tokenIn && (
              <span className="text-xs text-muted-foreground">
                {trade.tokenIn.amount.toFixed(4)} {trade.tokenIn.symbol}
              </span>
            )}
            {trade.tokenIn && trade.tokenOut && <span className="text-xs text-muted-foreground">→</span>}
            {trade.tokenOut && (
              <span className="text-xs text-foreground font-semibold">
                {trade.tokenOut.amount.toFixed(4)} {trade.tokenOut.symbol}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{trade.source}</span>
            <a
              href={`https://solscan.io/tx/${trade.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline font-mono"
            >
              {trade.signature.slice(0, 8)}...
            </a>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground">{date.toLocaleDateString("pl-PL")}</p>
          <p className="text-[10px] text-muted-foreground">{date.toLocaleTimeString("pl-PL")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TxRow({ tx }: { tx: HeliusTransaction }) {
  const date = new Date(tx.timestamp * 1000);

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-muted">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{tx.type}</Badge>
            <span className="text-xs text-muted-foreground truncate">{tx.description || "—"}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">Fee: {(tx.fee / 1e9).toFixed(6)} SOL</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{tx.source}</span>
            <a
              href={`https://solscan.io/tx/${tx.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline font-mono"
            >
              {tx.signature.slice(0, 8)}...
            </a>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground">{date.toLocaleDateString("pl-PL")}</p>
          <p className="text-[10px] text-muted-foreground">{date.toLocaleTimeString("pl-PL")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityRow({ token, report }: { token: HeliusTokenBalance; report: TokenSecurityReport }) {
  const riskColor = getRiskColor(report.riskLevel);

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3">
        <div className="flex items-center gap-3 mb-2">
          {token.logoURI ? (
            <img src={token.logoURI} alt={token.symbol} className="w-6 h-6 rounded-full bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
              <Coins className="h-3 w-3 text-muted-foreground" />
            </div>
          )}
          <span className="font-semibold text-sm text-foreground">{report.symbol}</span>
          <Badge variant="outline" className={`text-[10px] ${riskColor}`}>
            {getRiskLabel(report.riskLevel)} ({report.riskScore})
          </Badge>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            ${(token.valueUsd || 0).toFixed(2)}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">{report.details}</p>
        {report.flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {report.flags.map((flag, i) => (
              <span
                key={i}
                className={`text-[9px] px-2 py-0.5 rounded-full ${
                  flag.type === "danger" ? "bg-destructive/10 text-destructive" :
                  flag.type === "warning" ? "bg-neon-amber/10 text-neon-amber" :
                  "bg-muted text-muted-foreground"
                }`}
                title={flag.description}
              >
                {flag.label}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-8 text-center text-muted-foreground">
        <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p>{text}</p>
      </CardContent>
    </Card>
  );
}
