"use client";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatBytes, formatNumber } from "@/lib/utils";
import { useIsWindows } from "@/lib/hooks/use-is-windows";
export interface RuleChartItem {
  name: string;
  rawName: string;
  value: number;
  download: number;
  upload: number;
  connections: number;
  finalProxy?: string;
  color: string;
  rank: number;
  hasTraffic: boolean;
}

export function RuleDistribution({ chartData, selectedRule, onSelect }: {
  chartData: RuleChartItem[]; selectedRule: string | null; onSelect: (rule: string) => void;
}) {
  const t = useTranslations("rules");
  const isWindows = useIsWindows();
  const totalTraffic = chartData.reduce((sum,item) => sum + item.value, 0);
  const maxTotal = Math.max(1, ...chartData.map(item => item.value));
  const topRules = [...chartData].sort((a,b) => b.value-a.value).slice(0,4);
  const handleRuleClick = onSelect;
  return <>
        {/* Left: Pie Chart */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("distribution")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 pb-4">
            <div className="h-[165px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    onClick={(_, index) => onSelect(chartData[index].rawName)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        return (
                          <div className="bg-background border border-border p-3 rounded-lg shadow-lg">
                            <p className="font-medium text-sm mb-1">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(item.value)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {topRules.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-center">
                  Top 4
                </p>
                <div className="mt-1 space-y-1.5">
                  {topRules.map((item, idx) => {
                    const rankBadgeClass = idx === 0
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      : idx === 1
                      ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      : idx === 2
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                      : "bg-muted text-muted-foreground";

                    return (
                    <div
                      key={item.rawName}
                      title={item.name}
                      className="flex items-center gap-1.5 min-w-0"
                    >
                      <span
                        className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          rankBadgeClass
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span
                        className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white/90 truncate min-w-0", isWindows && "emoji-flag-font")}
                        style={{ backgroundColor: item.color }}
                      >
                        {item.name}
                      </span>
                    </div>
                  );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle: Rule List */}
        <Card className="min-w-0 md:col-span-1 xl:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("ruleList")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <ScrollArea className="h-[280px] pr-3">
              <div className="space-y-2">
                {chartData.map((item) => {
                const percentage = totalTraffic > 0 ? (item.value / totalTraffic) * 100 : 0;
                const barPercent = maxTotal > 0 ? (item.value / maxTotal) * 100 : 0;
                const isSelected = selectedRule === item.rawName;
                const noTraffic = !item.hasTraffic;

                // Badge color based on rank
                const badgeColor = noTraffic
                  ? "bg-muted text-muted-foreground"
                  : item.rank === 0
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : item.rank === 1
                  ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  : item.rank === 2
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                  : "bg-muted text-muted-foreground";

                return (
                  <button
                    key={item.rawName}
                    onClick={() => !noTraffic && handleRuleClick(item.rawName)}
                    className={cn(
                      "w-full p-2.5 rounded-xl border text-left transition-all duration-200 overflow-hidden @container",
                      noTraffic
                        ? "border-border/30 bg-card/30 opacity-50 cursor-default"
                        : isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border/50 bg-card/50 hover:bg-card hover:border-primary/30"
                    )}>
                    {/* Layout for wide container (default) */}
                    <div className="hidden @min-[200px]:block">
                      {/* Row 1: Rank + Name + Total */}
                      <div className="flex items-center gap-2 mb-1.5 min-w-0">
                        <span className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          badgeColor
                        )}>
                          {noTraffic ? "–" : item.rank + 1}
                        </span>

                        <span 
                          className={cn("flex-1 text-sm font-medium truncate min-w-0", isWindows && "emoji-flag-font")} 
                          title={item.name}
                        >
                          {item.name}
                        </span>

                        <span className="text-sm font-bold tabular-nums shrink-0 whitespace-nowrap ml-auto">
                          {noTraffic ? (
                            <span className="text-xs font-normal text-muted-foreground">{t("noTrafficRecord")}</span>
                          ) : formatBytes(item.value)}
                        </span>
                      </div>

                      {/* Row 2: Progress bar + Stats (hidden for zero-traffic) */}
                      {!noTraffic && (
                      <div className="pl-7 space-y-1">
                        {/* Progress bar - dual color */}
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400"
                            style={{ width: `${item.value > 0 ? (item.download / item.value) * barPercent : 0}%` }}
                          />
                          <div
                            className="h-full bg-purple-500 dark:bg-purple-400"
                            style={{ width: `${item.value > 0 ? (item.upload / item.value) * barPercent : 0}%` }}
                          />
                        </div>
                        {/* Stats */}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-blue-500 dark:text-blue-400 whitespace-nowrap">↓ {formatBytes(item.download)}</span>
                            <span className="text-purple-500 dark:text-purple-400 whitespace-nowrap">↑ {formatBytes(item.upload)}</span>
                            <span className="flex items-center gap-1 tabular-nums">
                              <Link2 className="w-3 h-3" />
                              {formatNumber(item.connections)}
                            </span>
                          </div>
                          <span className="tabular-nums">{percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                      )}
                    </div>

                    {/* Layout for narrow container (vertical stack) */}
                    <div className="block @min-[200px]:hidden space-y-2">
                      {/* Row 1: Rank + Name */}
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center shrink-0",
                          badgeColor
                        )}>
                          {noTraffic ? "–" : item.rank + 1}
                        </span>
                        <span className={cn("flex-1 text-sm font-medium line-clamp-2 leading-tight", isWindows && "emoji-flag-font")} title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      
                      {/* Row 2: Stats Grid (hidden for zero-traffic) */}
                      {!noTraffic && (
                      <div className="pl-7 space-y-2">
                        {/* Total Traffic */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{t("total")}</span>
                          <span className="text-sm font-bold tabular-nums">{formatBytes(item.value)}</span>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                          <div
                            className="h-full bg-blue-500 dark:bg-blue-400"
                            style={{ width: `${item.value > 0 ? (item.download / item.value) * 100 : 0}%` }}
                          />
                          <div
                            className="h-full bg-purple-500 dark:bg-purple-400"
                            style={{ width: `${item.value > 0 ? (item.upload / item.value) * 100 : 0}%` }}
                          />
                        </div>
                        
                        {/* Download / Upload / Connections */}
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div className="text-center p-1 rounded bg-blue-50 dark:bg-blue-950/30">
                            <div className="text-blue-500 dark:text-blue-400 mb-0.5">↓</div>
                            <div className="font-medium tabular-nums truncate">{formatBytes(item.download)}</div>
                          </div>
                          <div className="text-center p-1 rounded bg-purple-50 dark:bg-purple-950/30">
                            <div className="text-purple-500 dark:text-purple-400 mb-0.5">↑</div>
                            <div className="font-medium tabular-nums truncate">{formatBytes(item.upload)}</div>
                          </div>
                          <div className="text-center p-1 rounded bg-muted/50">
                            <div className="text-muted-foreground mb-0.5"><Link2 className="w-3 h-3 mx-auto" /></div>
                            <div className="font-medium tabular-nums">{formatNumber(item.connections)}</div>
                          </div>
                        </div>
                      </div>
                      )}
                      
                      {/* Zero traffic message */}
                      {noTraffic && (
                        <div className="pl-7 text-xs text-muted-foreground">{t("noTrafficRecord")}</div>
                      )}
                    </div>
                  </button>
                );
              })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

  </>;
}
