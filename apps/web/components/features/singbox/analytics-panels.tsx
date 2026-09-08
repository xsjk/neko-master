"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { NativeStats, NativeChainStats, NativeCountryStats, NativeFilterRule, DomainStats } from "@neko-master/shared";
import { TopDomainsChart } from "@/components/features/stats/charts/proxy-chart";
import { RuleDistribution } from "@/components/features/rules/rule-distribution";
import { RuleChainDiagram, type AllChainFlowData } from "@/components/features/rules/rule-chain-flow";
import { WorldTrafficMap } from "@/components/features/countries/world-traffic-map";
import { CountryTrafficList } from "@/components/features/countries/country-traffic-list";
import { Button } from "@/components/ui/button";
import { getNativeQueryKey } from "@/lib/stats-query-keys";
import { formatBytes } from "@/lib/utils";

export type NativeSelect = (field: NativeFilterRule['field'], value: string) => void;
const colors = ['#3B82F6','#8B5CF6','#06B6D4','#10B981','#F59E0B','#EF4444','#EC4899'];
function useNative<T>(endpoint: string, params: string) {
  return useQuery({ queryKey: getNativeQueryKey(endpoint, params), queryFn: async (): Promise<T> => {
    const response = await fetch(`/api/singbox/${endpoint}?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }, refetchInterval: 5000 });
}
function QueryState({ loading, error, retry }: { loading: boolean; error: Error | null; retry: () => void }) {
  const t = useTranslations('singbox');
  return error ? <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error.message} <Button variant="outline" onClick={retry}>{t('retry')}</Button></div> : loading ? <p className="p-4 text-muted-foreground">{t('loading')}</p> : null;
}
const domains = (data: NativeStats): DomainStats[] => data.rows.map(row => ({domain:row.label, totalUpload:Number(row.upload),totalDownload:Number(row.download),totalConnections:Number(row.connections),ips:[],rules:[],chains:[],lastSeen:''}));
export function NativeDomains({ params, onSelect }: { params: string; onSelect: NativeSelect }) {
  const query = useNative<NativeStats>('stats', params + '&dimension=domain');
  return <><QueryState loading={query.isLoading} error={query.error} retry={() => query.refetch()} />{query.data && <TopDomainsChart data={domains(query.data)} onSelect={value => onSelect('domain',value)} />}</>;
}
export function NativeRules({ params, onSelect }: { params: string; onSelect: NativeSelect }) {
  const t = useTranslations('singbox');
  const rules = useNative<NativeStats>('stats', params + '&dimension=rule');
  const chains = useNative<NativeChainStats>('rule-chains', params);
  const graph = useMemo<AllChainFlowData>(() => {
    const result: AllChainFlowData = {nodes:[],links:[],rulePaths:{},maxLayer:0};
    const nodes = new Map<string,number>(), links = new Map<string,number>();
    for (const path of chains.data?.paths || []) {
      // Native tracker reports terminal outbound first, outermost group last.
      const names = [path.rule, ...path.chain.toReversed()];
      const route = result.rulePaths[path.rule] ||= {nodeIndices:[],linkIndices:[]};
      let previous: number | undefined;
      names.forEach((name,layer) => {
        const key = JSON.stringify([layer,name]);
        let index = nodes.get(key);
        if (index === undefined) {
          index = result.nodes.length; nodes.set(key,index);
          result.nodes.push({name:name || t('unknown'),rawName:name,badge:t('outbound'),layer,nodeType:layer === 0 ? 'rule' : layer === names.length-1 ? 'proxy' : 'group',totalUpload:0,totalDownload:0,totalConnections:0,rules:[]});
        }
        const node = result.nodes[index];
        node.totalUpload += Number(path.upload); node.totalDownload += Number(path.download); node.totalConnections += Number(path.connections);
        if (!node.rules.includes(path.rule)) node.rules.push(path.rule);
        if (!route.nodeIndices.includes(index)) route.nodeIndices.push(index);
        if (previous !== undefined) {
          const edgeKey = `${previous}:${index}`;
          let edge = links.get(edgeKey);
          if (edge === undefined) { edge=result.links.length; links.set(edgeKey,edge); result.links.push({source:previous,target:index,rules:[]}); }
          if (!result.links[edge].rules.includes(path.rule)) result.links[edge].rules.push(path.rule);
          if (!route.linkIndices.includes(edge)) route.linkIndices.push(edge);
        }
        previous=index; result.maxLayer=Math.max(result.maxLayer,layer);
      });
    }
    return result;
  }, [chains.data, t]);
  const chartData = (rules.data?.rows || []).map((row,index) => ({name:row.label || t('unknown'),rawName:row.label,value:Number(row.upload)+Number(row.download),upload:Number(row.upload),download:Number(row.download),connections:Number(row.connections),color:colors[index%colors.length],rank:index,hasTraffic:true}));
  return <div className="space-y-6">
    <QueryState loading={rules.isLoading} error={rules.error} retry={() => rules.refetch()} />
    {!!chartData.length && <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-7"><RuleDistribution chartData={chartData} selectedRule={null} onSelect={value => onSelect('rule',value)} /></div>}
    {rules.data && !chartData.length && <p>{t('empty')}</p>}
    <h2 className="text-lg font-semibold">{t('chainFlow')}</h2>
    <QueryState loading={chains.isLoading} error={chains.error} retry={() => chains.refetch()} />
    {chains.data && <><p className="text-sm text-muted-foreground">{t('chainCoverage', {bytes:formatBytes(Number(chains.data.unrecorded.upload)+Number(chains.data.unrecorded.download))})}</p>{chains.data.truncated && <p className="text-sm text-muted-foreground">{t('chainTruncated')}</p>}{graph.nodes.length ? <RuleChainDiagram data={graph} onSelect={onSelect} /> : <p>{t('empty')}</p>}</>}
  </div>;
}
export function NativeCountries({ params, onSelect }: { params: string; onSelect: NativeSelect }) {
  const t = useTranslations('singbox');
  const query = useNative<NativeCountryStats>('countries', params);
  const data = (query.data?.rows || []).map(row => ({country:row.label || 'Unknown',countryName:row.label || 'Unknown',continent:'',totalUpload:Number(row.upload),totalDownload:Number(row.download),totalConnections:Number(row.connections)}));
  const select = (country:string) => onSelect('country', country === 'Unknown' ? '' : country);
  return <div className="space-y-6"><QueryState loading={query.isLoading} error={query.error} retry={() => query.refetch()} />
    {query.data && <>{!query.data.geo.ready && <p role="status" className="text-muted-foreground">{t('geoUnavailable')}</p>}<WorldTrafficMap data={data} onSelect={select} />{data.length ? <CountryTrafficList data={data} includeUnknown onSelect={select} /> : <p>{t('empty')}</p>}<p className="text-xs text-muted-foreground">{t('geoHelp')} · <a href="https://db-ip.com" className="underline">IP Geolocation by DB-IP</a></p></>}
  </div>;
}
