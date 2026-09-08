"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { nativeFilterFields, nativeFilterOperators, type NativeFilterExpression, type NativeFilterRule, type NativeGroup } from "@neko-master/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getNativeQueryKey } from "@/lib/stats-query-keys";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/singbox/${path}`, init);
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(result.error || response.statusText);
  return result;
}
function appliedDraft(draft: NativeFilterExpression): NativeFilterExpression {
  return { ...draft, rules: draft.rules.map(rule => {
    if (rule.op !== 'in' && rule.op !== 'notIn') return rule;
    const values = [...new Set(rule.values.filter(text => text.trim() !== ''))];
    return { ...rule, values: values.length ? values : [''] };
  }) };
}
export function FilterBuilder({ value, exact, groups, onApply, onClear, onRemoveExact }: {
  value: NativeFilterExpression; exact: Record<string, string>; onRemoveExact: (field: string) => void; groups: NativeGroup[]; onApply: (value: NativeFilterExpression) => void; onClear: () => void;
}) {
  const t = useTranslations("singbox");
  const [draft, setDraft] = useState(() => value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const options = useQuery({ queryKey: getNativeQueryKey("filter-options"), queryFn: () => json<Record<string, string[]>>("filter-options"), staleTime: 60000, enabled: editing });
  const selectClass = "h-10 rounded-lg border border-input bg-background px-3 text-sm";
  const update = (index: number, patch: Partial<NativeFilterRule>) => setDraft(old => ({ ...old, rules: old.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) }));
  const changed = JSON.stringify(value) !== JSON.stringify(appliedDraft(draft));
  async function apply() {
    setPending(true); setError("");
    try { onApply(await json<NativeFilterExpression>("filters/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filter: JSON.stringify(appliedDraft(draft)) }) })); setEditing(false); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  function addRule() {
    setDraft(old => ({ ...(editing ? old : value), rules: [...(editing ? old.rules : value.rules), { field: 'outbound', op: 'in', values: [] }] }));
    setEditing(true); setError('');
  }
  const exactEntries = Object.entries(exact).filter(([, text]) => text);
  function ruleLabel(rule: NativeFilterRule) {
    const text = rule.values.map(text => text || t("unknown")).join(', ');
    const operand = rule.op === 'in' ? text : rule.op === 'notIn' ? `≠ ${text}` : rule.op === 'contains' ? `${t('op_contains')} ${text}` : rule.op === 'notContains' ? `${t('op_notContains')} ${text}` : `${rule.op === 'notRegex' ? '!' : ''}/${text}/${rule.ignoreCase ? 'i' : ''}`;
    return `${t(rule.field)}: ${operand}`;
  }
  const chip = (label: string, remove: () => void, key: string) => <Button key={key} type="button" variant="secondary" size="sm" className="max-w-full gap-2" title={label} disabled={pending} onClick={remove}><span className="max-w-72 truncate">{label}</span><span aria-hidden="true">×</span><span className="sr-only">{t('removeFilter')}</span></Button>;
  const ruleChips = value.rules.map((rule, index) => chip(ruleLabel(rule), () => onApply({ ...value, rules: value.rules.filter((_, i) => i !== index) }), `rule-${index}`));
  const groupedOr = value.match === 'any' && value.rules.length > 1;
  return <div className="space-y-3">
    <div data-testid="active-filters" className="flex flex-wrap items-center gap-2">
      {exactEntries.map(([field, text]) => chip(`${t(field)}: ${text}`, () => onRemoveExact(field), `exact-${field}`))}
      {groupedOr ? <>{!!exactEntries.length && <span className="text-xs text-muted-foreground">AND</span>}<div role="group" aria-label={t('filterAny')} className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-dashed p-2"><span className="text-xs text-muted-foreground">OR</span>{ruleChips}</div></> : ruleChips}
      {!editing && <><Button size="sm" variant="outline" disabled={value.rules.length >= 20} onClick={addRule}>{t('addFilterRule')}</Button>{!!value.rules.length && <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setError(''); setEditing(true); }}>{t('editFilters')}</Button>}{(!!value.rules.length || !!exactEntries.length) && <Button size="sm" variant="ghost" onClick={onClear}>{t('clear')}</Button>}</>}
    </div>
    {editing && <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <div className="flex flex-wrap items-center gap-3"><select className={selectClass} aria-label={t("filterMatch")} value={draft.match} disabled={pending} onChange={event => setDraft({ ...draft, match: event.target.value as NativeFilterExpression['match'] })}><option value="all">{t("filterAll")}</option><option value="any">{t("filterAny")}</option></select><span className="text-xs text-muted-foreground">{changed ? t("filterUnapplied") : t("filterHelp")}</span></div>
    {draft.rules.map((rule, index) => {
      const multi = rule.op === "in" || rule.op === "notIn";
      const regex = rule.op === "regex" || rule.op === "notRegex";
      const choices = [...new Set([...(options.data?.[rule.field] || []), ...(rule.field === 'outbound' ? groups.flatMap(group => group.items.map(item => item.tag)) : [])].filter(Boolean))].sort();
      return <fieldset key={index} disabled={pending} className="min-w-0 space-y-2 rounded-lg border p-3"><legend className="px-1 text-xs text-muted-foreground">{t("filterRule", { index: index + 1 })}</legend>
        <div className="flex flex-wrap gap-2"><select className={selectClass} aria-label={t("filterField", { index: index + 1 })} value={rule.field} onChange={event => update(index, { field: event.target.value as NativeFilterRule['field'], values: [] })}>{nativeFilterFields.map(field => <option key={field} value={field}>{t(field)}</option>)}</select>
          <select className={selectClass} aria-label={t("filterOp", { index: index + 1 })} value={rule.op} onChange={event => { const op = event.target.value as NativeFilterRule['op']; update(index, { op, values: ['in','notIn'].includes(op) ? rule.values : rule.values.slice(0, 1) }); }}>{nativeFilterOperators.map(op => <option key={op} value={op}>{t('op_' + op)}</option>)}</select>
          <Button type="button" variant="ghost" aria-label={t("removeFilterRule", { index: index + 1 })} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) })}>{t("removeFilter")}</Button>
        </div>
        {multi ? <><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label={t("filterValue", { index: index + 1 })} placeholder={t("filterValuesHelp")} value={rule.values.join('\n')} onChange={event => update(index, { values: event.target.value ? event.target.value.split('\n') : [] })} />
          {!!choices.length && <details><summary className="cursor-pointer text-sm">{t("filterChoose")}</summary><div className="mt-2 flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-auto">{choices.map(choice => <label key={choice} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.values.includes(choice)} onChange={event => update(index, { values: event.target.checked ? [...rule.values.filter(text => text.trim() !== ''), choice] : rule.values.filter(v => v !== choice) })} />{choice}</label>)}</div></details>}</> : <Input aria-label={t("filterValue", { index: index + 1 })} value={rule.values[0] || ''} onChange={event => update(index, { values: event.target.value ? [event.target.value] : [] })} />}
        {regex && <div className="space-y-1 text-xs text-muted-foreground"><label className="flex items-center gap-2"><input type="checkbox" checked={!!rule.ignoreCase} onChange={event => update(index, { ignoreCase: event.target.checked })} />{t("filterIgnoreCase")}</label><p>{t("filterRegexHelp")}</p></div>}
      </fieldset>;
    })}
    {options.error && <p className="text-xs text-muted-foreground">{t("filterOptionsError")} <Button size="sm" variant="ghost" onClick={() => options.refetch()}>{t("retry")}</Button></p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || draft.rules.length >= 20} onClick={addRule}>{t("addFilterRule")}</Button><Button disabled={pending} onClick={apply}>{pending ? t("loading") : t("apply")}</Button><Button variant="outline" disabled={pending} onClick={() => { setDraft(value); setError(''); setEditing(false); }}>{t("cancelFilters")}</Button></div>
    </div>}
  </div>;
}
