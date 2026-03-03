export interface WalletData {
  address: string;
  smartScore: number;
  status: "High Activity" | "Active" | "Moderate" | "Dormant";
  transactionCount24h: number;
  totalTransactions: number;
  lastActivityAge: string;
  hourlyActivity: number[];
  recentTransactions: Transaction[];
}

export interface Transaction {
  signature: string;
  blockTime: number;
  status: string;
  fee: number;
}

// Generate random wallet data for mock purposes
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomStatus(score: number): WalletData["status"] {
  if (score > 70) return "High Activity";
  if (score > 40) return "Active";
  if (score > 20) return "Moderate";
  return "Dormant";
}

function randomHourlyActivity(): number[] {
  return Array.from({ length: 24 }, () => randomInt(0, 20));
}

function randomAddress(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return Array.from({ length: 44 }, () => chars[randomInt(0, chars.length - 1)]).join("");
}

function shortSig(): string {
  const chars = "0123456789abcdef";
  const a = Array.from({ length: 4 }, () => chars[randomInt(0, 15)]).join("");
  const b = Array.from({ length: 4 }, () => chars[randomInt(0, 15)]).join("");
  return `${a}...${b}`;
}

export function generateMockWallet(addressOverride?: string): WalletData {
  const score = randomInt(5, 95);
  const tx24h = score > 60 ? randomInt(15, 80) : randomInt(0, 15);
  return {
    address: addressOverride || randomAddress(),
    smartScore: score,
    status: randomStatus(score),
    transactionCount24h: tx24h,
    totalTransactions: randomInt(100, 5000),
    lastActivityAge: score > 50 ? `${randomInt(1, 59)} minutes ago` : `${randomInt(2, 48)} hours ago`,
    hourlyActivity: randomHourlyActivity(),
    recentTransactions: Array.from({ length: 5 }, (_, i) => ({
      signature: shortSig(),
      blockTime: Date.now() / 1000 - (i + 1) * randomInt(300, 3600),
      status: "finalized",
      fee: [5000, 10000, 15000][randomInt(0, 2)],
    })),
  };
}

// Mock data for development
export const mockWalletData: WalletData = {
  address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  smartScore: 78,
  status: "Active",
  transactionCount24h: 42,
  totalTransactions: 1847,
  lastActivityAge: "3 minutes ago",
  hourlyActivity: [2,5,3,8,12,6,4,9,15,7,3,1,0,2,6,11,8,4,7,13,9,5,3,6],
  recentTransactions: [
    { signature: "5UfD...k9Wr", blockTime: Date.now() / 1000 - 180, status: "finalized", fee: 5000 },
    { signature: "3xPq...mN2v", blockTime: Date.now() / 1000 - 900, status: "finalized", fee: 5000 },
    { signature: "8hTr...pL4w", blockTime: Date.now() / 1000 - 2400, status: "finalized", fee: 10000 },
    { signature: "1kMn...vR7x", blockTime: Date.now() / 1000 - 5200, status: "finalized", fee: 5000 },
    { signature: "9wQz...bY3s", blockTime: Date.now() / 1000 - 8100, status: "finalized", fee: 15000 },
  ],
};

// Generate mock top wallets for ranking/dashboard
export const mockTopWallets: WalletData[] = Array.from({ length: 20 }, () => generateMockWallet());
