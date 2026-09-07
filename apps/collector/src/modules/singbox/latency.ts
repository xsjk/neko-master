import type { NativeGroup, NativeLatencyResult } from '@neko-master/shared';

/** Each request observes one node; group fan-out belongs to the UI. */
export class NativeLatencyTester {
  private busy = new Set<string>();
  constructor(
    private groups: () => NativeGroup[],
    private connected: () => boolean,
    private trigger: (tag: string) => Promise<unknown>,
    private timeoutMs = 30000,
  ) {}

  async test(tag: string): Promise<NativeLatencyResult> {
    const find = () => this.groups().flatMap(group => group.items).find(item => item.tag === tag);
    if (!this.connected()) throw new Error('sing-box is offline');
    const item = find();
    if (!item) throw new Error('Unknown node');
    if (this.busy.has(tag)) throw new Error('A latency test is already running for this node');
    this.busy.add(tag);
    const before = item.urlTestTime || '0';
    try {
      // History has second precision: avoid mistaking an unchanged timestamp for
      // an unfinished test when repeated tests have identical latency.
      const wait = Math.min(1100, Math.max(0, (Number(before) + 1) * 1000 - Date.now()));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (!this.connected()) throw new Error('sing-box disconnected during latency test');
      await this.trigger(tag);
      const deadline = Date.now() + this.timeoutMs;
      do {
        if (!this.connected()) throw new Error('sing-box disconnected during latency test');
        const next = find();
        if (!next) throw new Error('Node disappeared during latency test');
        const testedAt = next.urlTestTime || '0';
        if (testedAt !== '0' && testedAt !== before) {
          return { tag, status: 'success', delay: next.urlTestDelay, testedAt };
        }
        if (testedAt === '0' && before !== '0') return { tag, status: 'failed', testedAt };
        await new Promise(resolve => setTimeout(resolve, Math.min(100, this.timeoutMs)));
      } while (Date.now() < deadline);
      return { tag, status: 'timeout', testedAt: before };
    } finally { this.busy.delete(tag); }
  }
}
