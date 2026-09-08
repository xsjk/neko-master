"use client";

import { useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ZIndexLayer, usePlotArea } from "recharts";
import type { NativeStats } from "@neko-master/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const displayTime = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
// Choose readable calendar-aligned ticks independently of the data bucket width.
function timeTicks(domain: [number, number], width: number, minimum: number) {
  const spacing = Math.max(minimum, (domain[1] - domain[0]) / Math.max(1, Math.floor(width / 85)));
  const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 20160, 43200].map(minutes => minutes * 60000);
  const interval = intervals.find(value => value >= spacing) || Math.ceil(spacing / 2592000000) * 2592000000;
  const ticks: number[] = [];
  const start = Math.ceil((domain[0] + 28800000) / interval) * interval - 28800000;
  for (let value = start; value <= domain[1]; value += interval) ticks.push(value);
  return { ticks, interval };
}
function Selection({ domain, unit, onStart, onEnd, onSelect }: {
  domain: [number, number]; unit: number; onStart: () => void; onEnd: () => void;
  onSelect: (from: number, to: number) => void;
}) {
  const t = useTranslations("singbox");
  const area = usePlotArea();
  const drag = useRef<{ id: number; start: number; current: number; left: number; width: number; domain: [number, number] } | null>(null);
  const [preview, setPreview] = useState<[number, number] | null>(null);
  if (!area) return null;
  const range = (start: number, end: number, bounds: [number, number]): [number, number] => {
    const offset = unit === 86400000 ? 28800000 : 0;
    const low = bounds[0] + Math.min(start, end) * (bounds[1] - bounds[0]);
    const high = bounds[0] + Math.max(start, end) * (bounds[1] - bounds[0]);
    return [Math.max(bounds[0], Math.floor((low + offset) / unit) * unit - offset), Math.min(bounds[1], Math.ceil((high + offset) / unit) * unit - offset)];
  };
  function cancel() { drag.current = null; setPreview(null); onEnd(); }
  function move(event: PointerEvent<SVGRectElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    current.current = Math.max(0, Math.min(1, (event.clientX - current.left) / current.width));
    setPreview([current.start, current.current]);
  }
  const selected = preview && range(preview[0], preview[1], domain);
  return <ZIndexLayer zIndex={3000}><g>
    {preview && <rect pointerEvents="none" x={area.x + Math.min(...preview) * area.width} y={area.y} width={Math.abs(preview[1] - preview[0]) * area.width} height={area.height} fill="var(--primary)" fillOpacity={0.18} />}
    <rect data-testid="time-selection" x={area.x} y={area.y} width={area.width} height={area.height} fill="transparent" style={{ cursor: "crosshair", touchAction: "pan-y" }} tabIndex={0} aria-label={t("dragTimeHint")}
      onKeyDown={event => { if (event.key === "Escape") cancel(); }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const start = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        drag.current = { id: event.pointerId, start, current: start, left: bounds.left, width: bounds.width, domain };
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        onStart(); setPreview([start, start]);
      }} onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
      onPointerUp={event => {
        move(event); const current = drag.current;
        if (!current || event.pointerId !== current.id) return;
        const [from, to] = range(current.start, current.current, current.domain);
        const changed = Math.abs(current.current - current.start) * current.width >= 6 && to > from;
        cancel();
        if (changed && (from !== current.domain[0] || to !== current.domain[1])) onSelect(from, to);
      }} />
    {selected && <text x={area.x + area.width / 2} y={area.y + 16} textAnchor="middle" fontSize={11} fill="currentColor" pointerEvents="none">{displayTime(selected[0])} — {displayTime(selected[1])}</text>}
  </g></ZIndexLayer>;
}

export function TrafficTrend({ stats, all, loading, canBack, onBack, onReset, onSelect, bytes }: {
  stats?: NativeStats; all: boolean; loading: boolean; canBack: boolean;
  onBack: () => void; onReset: () => void; onSelect: (from: number, to: number) => void;
  bytes: (value: number) => string;
}) {
  const t = useTranslations("singbox");
  const [plotWidth, setPlotWidth] = useState(480);
  const [frozen, setFrozen] = useState<NativeStats | null>(null);
  const data = frozen || stats;
  const rows = data?.trend || [];
  const step = data?.stepMs || 60000;
  const domain: [number, number] = all && rows.length
    ? [Number(rows[0].bucket), Number(rows[rows.length - 1].bucket) + step]
    : [data?.from || 0, data?.to || 1];
  const { ticks, interval } = timeTicks(domain, plotWidth, step);
  const duration = (value: number) => value >= 86400000 ? t("timeDays", { count: value / 86400000 }) : value >= 3600000 ? t("timeHours", { count: value / 3600000 }) : t("timeMinutes", { count: value / 60000 });
  const sameDay = Math.floor((domain[0] + 28800000) / 86400000) === Math.floor((domain[1] - 1 + 28800000) / 86400000);
  const chart: { bucket: number; upload: number | null; download: number | null }[] = [];
  rows.forEach((row, i) => {
    const bucket = Number(row.bucket);
    if (i && bucket - Number(rows[i - 1].bucket) > step) chart.push({ bucket: Number(rows[i - 1].bucket) + step, upload: null, download: null });
    chart.push({ bucket, upload: Number(row.upload), download: Number(row.download) });
  });
  return <Card className="min-w-0"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>{t("trend")}</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!canBack} onClick={onBack}>{t("timeBack")}</Button><Button size="sm" variant="outline" onClick={onReset}>{t("timeReset")}</Button></div></div><p className="text-xs text-muted-foreground">{t("dragTimeHint")}</p>{data && <p data-testid="time-scale" data-tick-ms={interval} data-bucket-ms={step} className="text-xs text-muted-foreground">{t("timeScale", { tick: duration(interval), bucket: duration(step) })}</p>}</CardHeader><CardContent><div className="h-72 select-none" style={{ touchAction: "pan-y" }}>
    {loading && !frozen ? <p>{t("loading")}</p> : chart.length ? <ResponsiveContainer width="100%" height="100%" onResize={width => setPlotWidth(Math.max(1, width - 101))}><AreaChart data={chart} margin={{ top: 5, right: 24, bottom: 5, left: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis type="number" scale="time" dataKey="bucket" domain={domain} ticks={ticks} interval={0} allowDataOverflow tickFormatter={value => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, ...(interval >= 86400000 ? { month: "numeric", day: "numeric" } : sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })} tick={{ fill: "currentColor", fontSize: 10 }} />
      <YAxis tickFormatter={value => bytes(Math.round(value))} tick={{ fill: "currentColor", fontSize: 10 }} width={72} />
      <Tooltip labelFormatter={value => displayTime(Number(value))} formatter={(value, name) => [bytes(Math.round(Number(value))), name === "download" ? t("download") : t("upload")]} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 12 }} />
      <Area isAnimationActive={false} connectNulls={false} type="monotone" dataKey="download" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.18} />
      <Area isAnimationActive={false} connectNulls={false} type="monotone" dataKey="upload" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.1} />
      <Selection domain={domain} unit={data?.granularity === "day" ? 86400000 : 60000} onStart={() => setFrozen(data || null)} onEnd={() => setFrozen(null)} onSelect={onSelect} />
    </AreaChart></ResponsiveContainer> : <p className="text-muted-foreground">{t("empty")}</p>}
  </div></CardContent></Card>;
}
