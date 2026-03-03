import { useState, useCallback } from "react";

export interface SearchHistoryEntry {
  address: string;
  smartScore: number;
  status: string;
  timestamp: number;
}

const STORAGE_KEY = "smr_search_history";
const MAX_ENTRIES = 20;

function loadHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(loadHistory);

  const addEntry = useCallback((entry: Omit<SearchHistoryEntry, "timestamp">) => {
    setHistory((prev) => {
      const filtered = prev.filter((e) => e.address !== entry.address);
      const next = [{ ...entry, timestamp: Date.now() }, ...filtered].slice(0, MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeEntry = useCallback((address: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.address !== address);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  }, []);

  return { history, addEntry, removeEntry, clearHistory };
}
