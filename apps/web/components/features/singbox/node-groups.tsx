"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2, Zap } from "lucide-react";
import type { NativeGroup, NativeLatencyResult } from "@neko-master/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getNativeQueryKey } from "@/lib/stats-query-keys";

async function action<T>(path: string, method: string, body: object): Promise<T> {
  const response = await fetch(`/api/singbox/groups/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    // Reverse proxies can return plain text or HTML errors instead of JSON.
    throw new Error(`HTTP ${response.status}: ${response.statusText || "Invalid server response"}`);
  }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}: ${response.statusText}`);
  return data;
}
function latencyColor(delay: number) {
  if (delay < 200) return "text-emerald-600 dark:text-emerald-400";
  if (delay < 500) return "text-amber-600 dark:text-amber-400";
  return "text-orange-600 dark:text-orange-400";
}
function NodeGroup({ group, connected }: { group: NativeGroup; connected: boolean }) {
  const t = useTranslations("singbox");
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const pending = useRef(new Set<string>());
  const [tests, setTests] = useState<Record<string, { pending?: boolean; result?: NativeLatencyResult; error?: string }>>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: getNativeQueryKey("status") });
  async function test(tag: string) {
    if (pending.current.has(tag)) return;
    pending.current.add(tag);
    setTests(old => ({ ...old, [tag]: { pending: true } }));
    try {
      const result = await action<NativeLatencyResult>("url-test", "POST", { tag });
      setTests(old => ({ ...old, [tag]: { result } }));
      void refresh();
    } catch (error) {
      setTests(old => ({ ...old, [tag]: { error: error instanceof Error ? error.message : String(error) } }));
    } finally { pending.current.delete(tag); }
  }
  const anyTesting = group.items.some(item => tests[item.tag]?.pending);
  const selection = useMutation({
    mutationFn: (member: string) => action("selection", "PUT", { group: group.tag, member }),
    onSuccess: refresh,
  });
  const available = group.items.filter(item => item.urlTestTime !== '0' && item.urlTestDelay > 0).length;
  return <section className="overflow-hidden rounded-xl border" aria-label={group.tag}>
    <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/30 p-4">
      <button type="button" className="flex min-w-0 items-center gap-2 text-left" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        <span className="break-all font-semibold">{group.tag}</span>
        <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{group.type}</span>
      </button>
      <Button variant="outline" size="sm" disabled={!connected || anyTesting} onClick={() => group.items.forEach(item => { void test(item.tag); })} aria-label={t("testGroupNamed", { name: group.tag })}>
        {anyTesting ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}{anyTesting ? t("testing") : t("testGroup")}
      </Button>
      <div className="flex w-full flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{t("currentNode")}: <span className="text-foreground">{group.selected || '—'}</span> · {group.selectable ? t("selectable") : t("automatic")}</span><span>{t("availableNodes", { available, total: group.items.length })}</span></div>
    </div>
    {selection.error && <div role="alert" className="flex items-center justify-between gap-3 border-t p-3 text-sm text-destructive"><span>{selection.error.message}</span><Button variant="outline" size="sm" disabled={!connected || selection.isPending} onClick={() => selection.mutate(selection.variables!)}>{t("retry")}</Button></div>}
    {expanded && <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{group.items.map(item => {
      const selected = item.tag === group.selected;
      const state = tests[item.tag];
      const result = state?.result;
      // Native automatic updates supersede a completed local test.
      const recent = result && Number(item.urlTestTime || 0) <= Number(result.testedAt);
      const failed = state?.error || (recent && result.status !== 'success');
      const loading = !!state?.pending;
      const delay = recent && result.status === 'success' ? result.delay : item.urlTestTime && item.urlTestTime !== '0' ? item.urlTestDelay : undefined;
      const label = loading ? t("testing") : failed ? t(result?.status === 'timeout' ? "testTimeout" : "testFailed") : delay !== undefined ? `${delay} ms` : t("untested");
      const name = <><span className="flex items-center gap-2 break-all text-sm font-medium">{selected && <Check className="size-4 shrink-0 text-primary" />}{item.tag}</span><span className="text-xs text-muted-foreground">{item.type}</span></>;
      return <div key={item.tag} className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors ${selected ? 'border-primary bg-primary/5' : 'bg-card'}`}>
        {group.selectable ? <button type="button" className="min-w-0 flex-1 space-y-1 text-left" aria-label={t("selectNamed", { name: item.tag })} aria-pressed={selected} disabled={!connected || selection.isPending} onClick={() => selection.mutate(item.tag)}>{name}</button> : <div className="min-w-0 flex-1 space-y-1">{name}</div>}
        <button type="button" className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-xs font-medium tabular-nums hover:bg-muted disabled:cursor-default ${failed ? 'text-destructive' : !loading && delay !== undefined ? latencyColor(delay) : 'text-muted-foreground'}`} title={state?.error || t("testNodeNamed", { name: item.tag })} aria-label={t("testNodeNamed", { name: item.tag })} disabled={!connected || loading} onClick={() => { void test(item.tag); }}>
          {loading ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}<span aria-live="polite">{label}</span>
        </button>
        {state?.error && <span role="alert" className="w-full break-words text-xs text-destructive">{state.error}</span>}
      </div>;
    })}</div>}
  </section>;
}
export function NodeGroups({ groups, connected, loading }: { groups: NativeGroup[]; connected: boolean; loading: boolean }) {
  const t = useTranslations("singbox");
  return <Card><CardHeader><CardTitle>{t("nodes")}</CardTitle><p className="text-sm text-muted-foreground">{t("latencyHelp")}</p></CardHeader><CardContent className="space-y-4">{loading ? t("loading") : groups.length ? groups.map(group => <NodeGroup key={group.tag} group={group} connected={connected} />) : t("noGroups")}</CardContent></Card>;
}
