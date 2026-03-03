export type AlertType = "burst" | "score_threshold" | "reactivation";

export interface AlertRule {
  id: string;
  type: AlertType;
  name: string;
  enabled: boolean;
  walletAddress?: string;
  config: {
    txCount?: number;       // for burst: min TX count
    timeWindowMin?: number; // for burst: time window in minutes
    scoreThreshold?: number; // for score_threshold
    silenceHours?: number;  // for reactivation: hours of inactivity
  };
  createdAt: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  type: AlertType;
  message: string;
  timestamp: number;
  read: boolean;
}

const RULES_KEY = "smr_alert_rules";
const EVENTS_KEY = "smr_alert_events";

export function loadAlertRules(): AlertRule[] {
  try {
    return JSON.parse(localStorage.getItem(RULES_KEY) || "[]");
  } catch { return []; }
}

export function saveAlertRules(rules: AlertRule[]) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function loadAlertEvents(): AlertEvent[] {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
  } catch { return []; }
}

export function saveAlertEvents(events: AlertEvent[]) {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}
