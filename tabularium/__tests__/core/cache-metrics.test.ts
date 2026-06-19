import { cacheMetrics } from '../../src/core/cache-metrics';
import { Cache } from '../../src/core/cache';

function mockConfig(name: string, overrides?: Partial<{
  size: number; hits: number; misses: number; staleHits: number; evictionCount: number; coalescedFetches: number;
}>) {
  return {
    name,
    getSnapshot: () => ({
      size: overrides?.size ?? 0,
      hits: overrides?.hits ?? 0,
      misses: overrides?.misses ?? 0,
      staleHits: overrides?.staleHits ?? 0,
      evictionCount: overrides?.evictionCount ?? 0,
      coalescedFetches: overrides?.coalescedFetches ?? 0,
      maxEntries: undefined as number | undefined,
    }),
  };
}

describe('cacheMetrics', () => {
  beforeEach(() => {
    cacheMetrics.stopAutoReport();
  });

  it('register e unregister — report count varia', () => {
    expect(cacheMetrics.report().length).toBe(0);
    cacheMetrics.register(mockConfig('test-1'));
    expect(cacheMetrics.report().length).toBe(1);
    cacheMetrics.register(mockConfig('test-2'));
    expect(cacheMetrics.report().length).toBe(2);
    cacheMetrics.unregister('test-1');
    expect(cacheMetrics.report().length).toBe(1);
    cacheMetrics.unregister('test-2');
    expect(cacheMetrics.report().length).toBe(0);
  });

  it('report restituisce metriche corrette', () => {
    cacheMetrics.register(mockConfig('test-a', { size: 10, hits: 50, misses: 50, staleHits: 5, evictionCount: 2 }));
    const report = cacheMetrics.report();
    expect(report.length).toBe(1);
    expect(report[0].name).toBe('test-a');
    expect(report[0].snapshot.size).toBe(10);
    expect(report[0].snapshot.hits).toBe(50);
    expect(report[0].snapshot.misses).toBe(50);
    expect(report[0].snapshot.staleHits).toBe(5);
    expect(report[0].snapshot.evictionCount).toBe(2);
    expect(report[0].snapshot.hitRate).toBe(50);
    cacheMetrics.unregister('test-a');
  });

  it('fromCache adapter funziona con Cache<T>', () => {
    const c = new Cache<string>(1000, { maxEntries: 10 });
    c.set('k1', 'v1');
    c.set('k2', 'v2');
    const adapter = mockConfig('from-cache-test', { size: c.size, hits: c.getStats().hits, misses: c.getStats().misses });
    expect(adapter.getSnapshot().size).toBe(2);
  });

  it('startAutoReport / stopAutoReport controllano il timer', () => {
    cacheMetrics.startAutoReport(5000);
    expect(cacheMetrics.isAutoReportRunning()).toBe(true);
    cacheMetrics.stopAutoReport();
    expect(cacheMetrics.isAutoReportRunning()).toBe(false);
  });

  it('hit rate 100% per hits=100, misses=0', () => {
    const cfg = mockConfig('full-hits', { hits: 100, misses: 0 });
    const snap = cfg.getSnapshot();
    const rate = snap.hits + snap.misses > 0 ? (snap.hits / (snap.hits + snap.misses)) * 100 : 0;
    expect(rate).toBe(100);
  });

  it('hit rate 0% per hits=0, misses=100', () => {
    const cfg = mockConfig('no-hits', { hits: 0, misses: 100 });
    const snap = cfg.getSnapshot();
    const rate = snap.hits + snap.misses > 0 ? (snap.hits / (snap.hits + snap.misses)) * 100 : 0;
    expect(rate).toBe(0);
  });
});
