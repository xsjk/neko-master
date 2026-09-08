"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Activity, ArrowDown, ArrowUp, Database, Moon, Sun, Search, RefreshCw, Network, Download } from "lucide-react";
import { TrafficTrend, displayTime } from "@/components/features/singbox/traffic-trend";
import type { NativeStats, NativeStatus } from "@neko-master/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NodeGroups } from "@/components/features/singbox/node-groups";
import { getNativeQueryKey } from "@/lib/stats-query-keys";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/singbox/${path}`, { ...init, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
}
function bytes(value: string | number | undefined): string {
  const n = BigInt(value || 0);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let divisor = BigInt(1); let i = 0;
  while (n >= divisor * BigInt(1024) && i < units.length - 1) { divisor *= BigInt(1024); i++; }
  return `${Number(n * BigInt(100) / divisor) / 100} ${units[i]}`;
}
const time = (n?: number | string | null) => n ? new Date(Number(n)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const dimensions = ['source', 'domain', 'rootDomain', 'destination', 'inbound', 'outbound', 'rule'] as const;
type Detail = Record<string, string>;
type Period = { preset: string } | { from: number; to: number };
const inputTime = (value: number) => new Date(value + 28800000).toISOString().slice(0, 16);
function normalizePeriod(from: number, to: number, now: number) {
  const daily = from < now - 90 * 86400000 || to - from > 7 * 86400000;
  const unit = daily ? 86400000 : 60000, offset = daily ? 28800000 : 0;
  return { from: Math.floor((from + offset) / unit) * unit - offset, to: Math.ceil((to + offset) / unit) * unit - offset };
}

export default function SingboxPage() {
  const t = useTranslations('singbox');
  const { resolvedTheme, setTheme } = useTheme();
  const client = useQueryClient();
  const [range, setRange] = useState('24');
  const [period, setPeriod] = useState<Period>({ preset: '24' });
  const [history, setHistory] = useState<Period[]>([]);
  const [timeError, setTimeError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const [dimension, setDimension] = useState('domain');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [live, setLive] = useState('all');
  const [page, setPage] = useState(0);
  const status = useQuery({ queryKey: getNativeQueryKey('status'), queryFn: () => request<NativeStatus>('status'), refetchInterval: 3000 });
  function applyPeriod(next: Period) {
    setPeriod(next); setPage(0); setTimeError('');
    setRange('preset' in next ? next.preset : 'custom');
    if ('from' in next) { setCustomFrom(inputTime(next.from)); setCustomTo(inputTime(next.to)); }
  }
  function selectTime(from: number, to: number) {
    setHistory(old => [...old, period]);
    applyPeriod(normalizePeriod(from, to, clock));
  }
  function applyCustom() {
    const from = Date.parse(customFrom + '+08:00'), to = Date.parse(customTo + '+08:00');
    if (!customFrom || !customTo || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) { setTimeError(t('invalidTime')); return; }
    setHistory([]); applyPeriod(normalizePeriod(from, to, clock));
  }
  function parameters() {
    const p = new URLSearchParams(filters);
    const now = Math.floor(clock / 60000) * 60000;
    const interval = 'from' in period ? period : period.preset === 'all' ? null : normalizePeriod(now - Number(period.preset) * 3600000, now + 60000, clock);
    if (interval) { p.set('from', new Date(interval.from).toISOString()); p.set('to', new Date(interval.to).toISOString()); }
    return p;
  }
  const params = parameters(); params.set('dimension', dimension);
  const paramString = params.toString();
  const stats = useQuery({ queryKey: getNativeQueryKey('stats', paramString), queryFn: () => request<NativeStats>('stats?' + paramString), refetchInterval: 5000 });
  const lifetime = useQuery({ queryKey: getNativeQueryKey('lifetime'), queryFn: () => request<NativeStats>('stats'), refetchInterval: 5000 });
  const detailParams = parameters(); detailParams.set('page', String(page));
  if (live !== 'all') detailParams.set('live', live);
  const detailString = detailParams.toString();
  const details = useQuery({ queryKey: getNativeQueryKey('connections', detailString), queryFn: () => request<Detail[]>('connections?' + detailString), refetchInterval: 5000 });
  const selectClass = 'h-10 rounded-lg border border-input bg-background px-3 text-sm';
  const metric = (label: string, value: string, icon: React.ReactNode, sub: string) => <Card><CardContent className="space-y-3"><div className="flex justify-between text-sm text-muted-foreground">{label}{icon}</div><div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div><p className="text-xs text-muted-foreground">{sub}</p></CardContent></Card>;
  function drill(label: string) {
    const next = { ...filters, [dimension]: label }; setFilters(next); setDraft(next); setPage(0);
    if (dimension === 'source') setDimension('domain'); else if (dimension === 'domain' || dimension === 'rootDomain') setDimension('source');
  }
  function errorBox(error: Error | null, retry: () => void) { return error && <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive p-4 text-sm text-destructive">{error.message}<Button variant="outline" onClick={retry}>{t('retry')}</Button></div>; }
  return <main className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><div className="rounded-2xl bg-primary p-3 text-primary-foreground"><Activity /></div><div><h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1><p className="text-sm text-muted-foreground">{t('subtitle')}</p></div></div>
      <div className="flex items-center gap-3"><span className="rounded-full border px-3 py-1 text-sm">{status.data?.connected ? t('online') : t('offline')}</span><Button variant="outline" size="icon" aria-label={t('refresh')} onClick={() => client.invalidateQueries({ queryKey: ['singbox'] })}><RefreshCw className="size-4" /></Button><Button variant="outline" size="icon" aria-label={t('theme')} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>{resolvedTheme === 'dark' ? <Sun /> : <Moon />}</Button></div>
    </header>
    {errorBox(status.error, () => status.refetch())}
    {!status.data?.connected && <div className="rounded-xl border bg-muted/40 p-4 text-sm">{t('offlineHelp')} {status.data?.error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metric(t('lifetimeDown'), bytes(BigInt(lifetime.data?.total.download || 0).toString()), <ArrowDown className="size-4" />, t('since') + ' ' + time(status.data?.meta?.since))}
      {metric(t('lifetimeUp'), bytes(lifetime.data?.total.upload), <ArrowUp className="size-4" />, t('retention'))}
      {metric(t('periodTraffic'), bytes((BigInt(stats.data?.total.upload || 0) + BigInt(stats.data?.total.download || 0)).toString()), <Network className="size-4" />, t('connections') + ': ' + (stats.data?.total.connections || '0'))}
      {metric(t('storage'), bytes(status.data?.databaseBytes), <Database className="size-4" />, t('lastCommit') + ' ' + time(status.data?.meta?.last_commit))}
    </div>
    {errorBox(lifetime.error, () => lifetime.refetch())}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Search className="size-4" />{t('explore')}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-3"><select className={selectClass} aria-label={t('range')} value={range} onChange={e => { const value = e.target.value; setRange(value); setTimeError(''); if (value !== 'custom') { setHistory([]); applyPeriod({ preset: value }); } else { setCustomFrom(inputTime(stats.data?.from || clock - 86400000)); setCustomTo(inputTime(stats.data?.to || clock)); } }}><option value="1">{t('hour')}</option><option value="24">{t('day')}</option><option value="168">{t('week')}</option><option value="720">{t('month')}</option><option value="all">{t('all')}</option><option value="custom">{t('custom')}</option></select>
        {range === 'custom' && <><Input className="w-auto" aria-label={t('from')} type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /><Input className="w-auto" aria-label={t('to')} type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} /><Button onClick={applyCustom}>{t("applyTime")}</Button></>}
        <select className={selectClass} aria-label={t('dimension')} value={dimension} onChange={e => setDimension(e.target.value)}>{dimensions.map(d => <option key={d} value={d}>{t(d)}</option>)}</select>
        <span className="self-center text-xs text-muted-foreground">{t('timezone')} · {stats.data?.granularity === 'day' ? t('dailyBoundary') : t('minute')}</span>
      </div>
      {timeError && <p role="alert" className="text-sm text-destructive">{timeError}</p>}
      {stats.data && !('preset' in period && period.preset === 'all') && <p className="text-xs text-muted-foreground" data-testid="effective-time">{t('effectiveTime')}: {displayTime(stats.data.from)} → {displayTime(stats.data.to)} · {t('exclusiveEnd')}</p>}
      <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); setFilters(draft); setPage(0); }}>{dimensions.filter(d => d !== 'rootDomain').map(d => <Input key={d} aria-label={t(d)} placeholder={t(d)} value={draft[d] || ''} onChange={e => setDraft({ ...draft, [d]: e.target.value })} />)}<Button type="submit">{t('apply')}</Button><Button variant="outline" type="button" onClick={() => { setDraft({}); setFilters({}); setPage(0); }}>{t('clear')}</Button></form>
      {Object.entries(filters).filter(([,v]) => v).map(([k,v]) => <Button className="mr-2" variant="secondary" key={k} onClick={() => { const next = { ...filters }; delete next[k]; setFilters(next); setDraft(next); }}>{t(k)}: {v} ×</Button>)}
    </CardContent></Card>
    {errorBox(stats.error, () => stats.refetch())}
    <div className="grid gap-6 lg:grid-cols-2">
      <TrafficTrend stats={stats.data} all={'preset' in period && period.preset === 'all'} loading={stats.isLoading} canBack={history.length > 0} bytes={bytes} onSelect={selectTime} onBack={() => { const previous = history[history.length - 1]; if (previous) { setHistory(old => old.slice(0, -1)); applyPeriod(previous); } }} onReset={() => { setHistory([]); applyPeriod({ preset: '24' }); }} />
      <Card><CardHeader><CardTitle>{t('ranking')} · {t(dimension)}</CardTitle><p className="text-xs text-muted-foreground">{t('drill')}</p></CardHeader><CardContent><div className="max-h-72 overflow-auto"><Table><TableHeader><TableRow><TableHead>{t(dimension)}</TableHead><TableHead>{t('download')}</TableHead><TableHead>{t('upload')}</TableHead></TableRow></TableHeader><TableBody>{stats.data?.rows.map(row => <TableRow key={row.label}><TableCell><button className="max-w-64 truncate text-left hover:underline" onClick={() => drill(row.label)} title={row.label}>{row.label || t('unknown')}</button></TableCell><TableCell className="tabular-nums">{bytes(row.download)}</TableCell><TableCell className="tabular-nums">{bytes(row.upload)}</TableCell></TableRow>)}</TableBody></Table>{!stats.data?.rows.length && <p className="p-3 text-muted-foreground">{stats.isLoading ? t('loading') : t('empty')}</p>}</div></CardContent></Card>
    </div>
    <NodeGroups groups={status.data?.groups || []} connected={!!status.data?.connected} loading={status.isLoading} />
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t('connections')}</CardTitle><div className="flex flex-wrap gap-2"><select className={selectClass} value={live} aria-label={t('connectionState')} onChange={e => { setLive(e.target.value); setPage(0); }}><option value="all">{t('allConnections')}</option><option value="true">{t('active')}</option><option value="false">{t('closed')}</option></select>{['jsonl','csv'].map(format => <Button key={format} variant="outline" asChild><a href={`/api/singbox/export?${detailString}&format=${format}`}><Download className="size-4" />{format.toUpperCase()}</a></Button>)}</div></div></CardHeader><CardContent>{errorBox(details.error, () => details.refetch())}<p className="mb-3 text-xs text-muted-foreground">{t('detailHelp')}</p><Table><TableHeader><TableRow>{['source','domain','destination','inbound','outbound','download','upload','created','state'].map(k => <TableHead key={k}>{t(k)}</TableHead>)}</TableRow></TableHeader><TableBody>{details.data?.map(row => <TableRow key={row.run + row.id}>{['source','domain','destination','inbound','outbound'].map(k => <TableCell key={k} className="max-w-52 truncate" title={row[k]}>{row[k] || '—'}</TableCell>)}<TableCell>{bytes(row.recorded_download)}</TableCell><TableCell>{bytes(row.recorded_upload)}</TableCell><TableCell className="whitespace-nowrap text-xs">{time(row.created)}</TableCell><TableCell>{row.interrupted === '1' ? t('interrupted') : row.closed !== '0' ? t('closed') : t('active')}</TableCell></TableRow>)}</TableBody></Table>{!details.data?.length && <p className="p-4 text-muted-foreground">{details.isLoading ? t('loading') : t('empty')}</p>}<div className="mt-4 flex items-center justify-end gap-3"><Button variant="outline" disabled={!page} onClick={() => setPage(page-1)}>{t('previous')}</Button><span className="text-sm">{page+1}</span><Button variant="outline" disabled={(details.data?.length || 0) < 100} onClick={() => setPage(page+1)}>{t('next')}</Button></div></CardContent></Card>
    <Card><CardHeader><CardTitle>{t('coverage')}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{t('runTotal')}: ↓ {bytes(status.data?.totals.downlinkTotal)} · ↑ {bytes(status.data?.totals.uplinkTotal)}</p><p>{t('recovered')}: ↓ {bytes(stats.data?.recovered.download)} · ↑ {bytes(stats.data?.recovered.upload)}</p><p className="text-muted-foreground">{t('coverageHelp')}</p><div className="max-h-40 overflow-auto">{status.data?.gaps.map(gap => <p key={gap.id} className="border-t py-2 text-xs">{time(gap.start)} → {gap.end ? time(gap.end) : t('ongoing')} · {gap.reason}</p>)}</div></CardContent></Card>
    <footer className="pb-6 text-center text-xs text-muted-foreground">{t('footer')}</footer>
  </main>;
}
