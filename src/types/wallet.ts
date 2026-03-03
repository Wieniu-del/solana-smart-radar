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
