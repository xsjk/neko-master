import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeGroup } from '@neko-master/shared';
import { NativeLatencyTester } from './latency.js';
let groups: NativeGroup[];
let online: boolean;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10000); online = true;
  groups = [{ tag: 'auto', type: 'urltest', selectable: false, selected: 'a', items: [
    { tag: 'a', type: 'direct', urlTestTime: '1', urlTestDelay: 20 },
    { tag: 'b', type: 'direct', urlTestTime: '0', urlTestDelay: 0 },
  ] }];
});
afterEach(() => vi.useRealTimers());
const setup = (trigger = vi.fn(async (_tag: string) => {})) => ({ trigger, tester: new NativeLatencyTester(() => groups, () => online, trigger, 500) });
describe('native latency tests', () => {
  it('returns fast nodes independently while another node is still pending', async () => {
    const { tester, trigger } = setup();
    const fast = tester.test('a');
    let slowFinished = false;
    const slow = tester.test('b').then(result => { slowFinished = true; return result; });
    await vi.advanceTimersByTimeAsync(100);
    groups[0].items[0].urlTestTime = '10';
    groups[0].items[0].urlTestDelay = 42;
    await vi.advanceTimersByTimeAsync(100);
    expect(await fast).toEqual({ tag: 'a', status: 'success', delay: 42, testedAt: '10' });
    expect(slowFinished).toBe(false);
    expect(trigger.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(400);
    expect(await slow).toEqual({ tag: 'b', status: 'timeout', testedAt: '0' });
  });
  it('does not accept stale history or duplicate tests for the same node', async () => {
    const { tester } = setup(); const pending = tester.test('a');
    await expect(tester.test('a')).rejects.toThrow('already running');
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toEqual({ tag: 'a', status: 'timeout', testedAt: '1' });
  });
  it('reports deleted history as failure', async () => {
    const { tester } = setup(); const pending = tester.test('a');
    groups[0].items[0].urlTestTime = '0';
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({ tag: 'a', status: 'failed', testedAt: '0' });
  });
  it('crosses the timestamp second boundary before testing', async () => {
    groups[0].items[0].urlTestTime = '10';
    const { tester, trigger } = setup(); const pending = tester.test('a');
    await vi.advanceTimersByTimeAsync(999); expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(trigger).toHaveBeenCalledWith('a');
    groups[0].items[0].urlTestTime = '11';
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe('success');
  });
  it('rejects unknown and offline outbounds and releases locks after errors', async () => {
    const trigger = vi.fn(async () => { throw new Error('RPC failure'); });
    const { tester } = setup(trigger);
    await expect(tester.test('unknown')).rejects.toThrow('Unknown');
    await expect(tester.test('a')).rejects.toThrow('RPC failure');
    await expect(tester.test('a')).rejects.toThrow('RPC failure');
    online = false;
    await expect(tester.test('auto')).rejects.toThrow('offline');
  });
});
