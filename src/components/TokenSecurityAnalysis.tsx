import { useState } from "react";
import { HeliusTokenBalance } from "@/services/helius";
import { analyzeAllTokens, TokenSecurityReport, getRiskColor, getRiskBgColor, getRiskLabel } from "@/services/tokenSecurity";
import { Shield, ShieldAlert, ShieldCheck, ShieldX, ChevronDown, ChevronUp, ExternalLink, AlertTriangle } from "lucide-react";

interface TokenSecurityAnalysisProps {
  tokens: HeliusTokenBalance[];
}

const TokenSecurityAnalysis = ({ tokens }: TokenSecurityAnalysisProps) => {
  const [expandedMint, setExpandedMint] = useState<string | null>(null);
  const reports = analyzeAllTokens(tokens);

  const criticalCount = reports.filter(r => r.riskLevel === "critical" || r.riskLevel === "high").length;
  const safeCount = reports.filter(r => r.riskLevel === "safe" || r.riskLevel === "low").length;

  const getRiskIcon = (level: TokenSecurityReport["riskLevel"]) => {
    switch (level) {
      case "safe": return <ShieldCheck className="h-4 w-4 text-primary" />;
      case "low": return <Shield className="h-4 w-4 text-primary" />;
      case "medium": return <ShieldAlert className="h-4 w-4 text-neon-amber" />;
      case "high": return <ShieldX className="h-4 w-4 text-neon-red" />;
      case "critical": return <ShieldX className="h-4 w-4 text-destructive" />;
    }
  };

  return (
    <div className="neon-card rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Analiza bezpieczeństwa tokenów
        </h3>
        <div className="flex items-center gap-3">
          {criticalCount > 0 && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
              {criticalCount} ryzykowne
            </span>
          )}
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
            {safeCount} bezpieczne
          </span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex h-2 rounded-full overflow-hidden mb-4 bg-muted">
        {reports.length > 0 && (
          <>
            <div
              className="bg-primary transition-all"
              style={{ width: `${(reports.filter(r => r.riskLevel === "safe").length / reports.length) * 100}%` }}
            />
            <div
              className="bg-primary/60 transition-all"
              style={{ width: `${(reports.filter(r => r.riskLevel === "low").length / reports.length) * 100}%` }}
            />
            <div
              className="bg-neon-amber transition-all"
              style={{ width: `${(reports.filter(r => r.riskLevel === "medium").length / reports.length) * 100}%` }}
            />
            <div
              className="bg-neon-red transition-all"
              style={{ width: `${(reports.filter(r => r.riskLevel === "high").length / reports.length) * 100}%` }}
            />
            <div
              className="bg-destructive transition-all"
              style={{ width: `${(reports.filter(r => r.riskLevel === "critical").length / reports.length) * 100}%` }}
            />
          </>
        )}
      </div>

      {/* Token list */}
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {reports.map((report) => {
          const isExpanded = expandedMint === report.mint;
          return (
            <div key={report.mint} className={`rounded-lg border transition-all ${getRiskBgColor(report.riskLevel)}`}>
              <button
                onClick={() => setExpandedMint(isExpanded ? null : report.mint)}
                className="w-full flex items-center gap-3 p-3 text-left"
              >
                {getRiskIcon(report.riskLevel)}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-foreground">{report.symbol}</span>
                  <span className="text-xs text-muted-foreground ml-2">{report.name}</span>
                </div>
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${getRiskColor(report.riskLevel)}`}>
                  {getRiskLabel(report.riskLevel)}
                </span>
                <span className="text-xs font-mono text-muted-foreground w-8 text-right">
                  {report.riskScore}
                </span>
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-xs text-muted-foreground">{report.details}</p>
                  {report.flags.map((flag, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className={`h-3 w-3 mt-0.5 flex-shrink-0 ${
                        flag.type === "danger" ? "text-destructive" :
                        flag.type === "warning" ? "text-neon-amber" :
                        "text-muted-foreground"
                      }`} />
                      <div>
                        <span className="font-semibold text-foreground">{flag.label}:</span>{" "}
                        <span className="text-muted-foreground">{flag.description}</span>
                      </div>
                    </div>
                  ))}
                  <a
                    href={`https://solscan.io/token/${report.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Sprawdź na Solscan
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TokenSecurityAnalysis;
