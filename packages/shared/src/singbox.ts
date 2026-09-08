/** Native sing-box ledger contracts. Byte quantities are lossless decimal strings. */
export interface NativeConnection {
  id: string; source: string; destination: string; domain: string;
  inbound: string; outbound: string; rule: string; network: string; user: string;
  chainList: string[]; createdAt: string; closedAt: string;
  uplinkTotal: string; downlinkTotal: string;
}
export interface NativeEvent {
  type: 'CONNECTION_EVENT_NEW' | 'CONNECTION_EVENT_UPDATE' | 'CONNECTION_EVENT_CLOSED';
  id: string; connection?: NativeConnection; uplinkDelta: string; downlinkDelta: string; closedAt: string;
}
export interface NativeBatch { events: NativeEvent[]; reset: boolean }
export interface NativeFilters {
  from?: string; to?: string; source?: string; domain?: string; rootDomain?: string;
  destination?: string; inbound?: string; outbound?: string; rule?: string;
  dimension?: string; page?: string; live?: string; filter?: string;
}
export interface NativeGroup {
  tag: string; type: string; selectable: boolean; selected: string;
  items: { tag: string; type: string; urlTestDelay: number; urlTestTime?: string }[];
}
export interface NativeStats {
  rows: { label: string; upload: string; download: string; connections: string }[];
  trend: { bucket: string; upload: string; download: string }[];
  total: { upload: string; download: string; connections: string };
  recovered: { upload: string; download: string };
  granularity: 'minute' | 'day';
  /** Effective half-open query interval and chart bucket width, in milliseconds. */
  from: number; to: number; stepMs: number;
}
export interface NativeStatus {
  connected: boolean; error: string; backend: number; run: string;
  meta: { since: number; last_commit: number } | null;
  gaps: { id: number; start: number; end: number | null; reason: string }[];
  totals: { uplinkTotal: string; downlinkTotal: string };
  databaseBytes: number; groups: NativeGroup[];
}

export interface NativeLatencyResult {
  tag: string;
  status: 'success' | 'failed' | 'timeout';
  delay?: number;
  testedAt: string;
}

export const nativeFilterFields = ['source', 'domain', 'rootDomain', 'destination', 'inbound', 'outbound', 'rule'] as const;
export const nativeFilterOperators = ['in', 'notIn', 'contains', 'notContains', 'regex', 'notRegex'] as const;
export interface NativeFilterRule {
  field: typeof nativeFilterFields[number];
  op: typeof nativeFilterOperators[number];
  values: string[];
  ignoreCase?: boolean;
}
export interface NativeFilterExpression { match: 'all' | 'any'; rules: NativeFilterRule[] }
