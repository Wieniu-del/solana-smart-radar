import { useState } from "react";
import { Search, Loader2, ShieldAlert } from "lucide-react";
import { sanitizeSolanaAddress } from "@/lib/sanitize";
import { toast } from "sonner";

interface WalletSearchProps {
  onSearch: (address: string) => void;
  isLoading: boolean;
}

const WalletSearch = ({ onSearch, isLoading }: WalletSearchProps) => {
  const [address, setAddress] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeSolanaAddress(address);
    if (!clean) {
      toast.error("Nieprawidłowy adres Solana — wklej pełny adres Base58 (32-44 znaki)");
      return;
    }
    onSearch(clean);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-neon-green/30 to-neon-cyan/30 rounded-lg blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
        <div className="relative flex items-center bg-muted rounded-lg border border-border focus-within:neon-border transition-all">
          <Search className="ml-4 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Wklej adres portfela Solana (np. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU)"
            className="flex-1 bg-transparent px-4 py-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !address.trim()}
            className="mr-2 px-6 py-2 bg-primary text-primary-foreground font-semibold rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "SCAN"
            )}
          </button>
        </div>
      </div>
    </form>
  );
};

export default WalletSearch;
