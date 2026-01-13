#!/usr/bin/env node
/**
 * Performance Benchmarking Suite for Jellyfin Companion
 * Measures performance of SessionStore, CacheManager, PluginManager, and APIs
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Results storage
const results = {
  timestamp: new Date().toISOString(),
  benchmarks: {},
  summary: {}
};

// Utilities
function formatTime(ms) {
  if (ms < 0.001) return (ms * 1000000).toFixed(2) + ' μs';
  if (ms < 1) return (ms * 1000).toFixed(2) + ' μs';
  if (ms < 1000) return ms.toFixed(3) + ' ms';
  return (ms / 1000).toFixed(3) + ' s';
}

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║    JELLYFIN COMPANION - PERFORMANCE BENCHMARKS             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// ============================================================
// BENCHMARK 1: SessionStore Performance
// ============================================================

console.log('📊 BENCHMARK 1: SessionStore Performance');
console.log('─'.repeat(60));

try {
  const SessionStore = require('./src/models/SessionStore');
  const sessionStore = new SessionStore();
  
  const testSid = 'perf-test-' + Date.now();
  const testSession = {
    userId: 'user-123',
    username: 'testuser',
    roles: ['admin', 'user'],
    loginTime: new Date().toISOString(),
    metadata: { device: 'chrome', ip: '192.168.1.1' }
  };

  // Benchmark: SET operations
  const setTimes = [];
  const setIterations = 1000;
  
  for (let i = 0; i < setIterations; i++) {
    const sid = `${testSid}-${i}`;
    const start = performance.now();
    sessionStore.set(sid, testSession, () => {});
    const end = performance.now();
    setTimes.push(end - start);
  }

  const avgSet = setTimes.reduce((a, b) => a + b) / setTimes.length;
  const maxSet = Math.max(...setTimes);
  const minSet = Math.min(...setTimes);

  console.log(`\n✅ SET Operations (${setIterations} iterations):`);
  console.log(`   Average: ${formatTime(avgSet)}`);
  console.log(`   Min:     ${formatTime(minSet)}`);
  console.log(`   Max:     ${formatTime(maxSet)}`);

  // Benchmark: GET operations
  const getTimes = [];
  const getIterations = 1000;
  
  for (let i = 0; i < getIterations; i++) {
    const sid = `${testSid}-${i % 100}`;
    const start = performance.now();
    sessionStore.get(sid, () => {});
    const end = performance.now();
    getTimes.push(end - start);
  }

  const avgGet = getTimes.reduce((a, b) => a + b) / getTimes.length;
  const maxGet = Math.max(...getTimes);
  const minGet = Math.min(...getTimes);

  console.log(`\n✅ GET Operations (${getIterations} iterations):`);
  console.log(`   Average: ${formatTime(avgGet)}`);
  console.log(`   Min:     ${formatTime(minGet)}`);
  console.log(`   Max:     ${formatTime(maxGet)}`);

  results.benchmarks.sessionStore = {
    set: { avg: avgSet, min: minSet, max: maxSet },
    get: { avg: avgGet, min: minGet, max: maxGet },
    iterations: { set: setIterations, get: getIterations }
  };

} catch (e) {
  console.log(`❌ Error: ${e.message}`);
}

// ============================================================
// BENCHMARK 2: CacheManager Performance
// ============================================================

console.log('\n\n📊 BENCHMARK 2: CacheManager Performance');
console.log('─'.repeat(60));

try {
  const CacheManager = require('./src/models/CacheManager');
  const cache = new CacheManager({ maxSize: 5000 });

  const testData = { 
    id: 123, 
    name: 'Test Item',
    description: 'Performance test data'.repeat(10),
    metadata: { created: new Date(), updated: new Date() }
  };

  // Benchmark: SET operations
  const cacheSetTimes = [];
  const cacheSetIterations = 10000;
  
  for (let i = 0; i < cacheSetIterations; i++) {
    const start = performance.now();
    cache.set(`cache-key-${i % 100}`, testData);
    const end = performance.now();
    cacheSetTimes.push(end - start);
  }

  const avgCacheSet = cacheSetTimes.reduce((a, b) => a + b) / cacheSetTimes.length;
  const maxCacheSet = Math.max(...cacheSetTimes);
  const minCacheSet = Math.min(...cacheSetTimes);

  console.log(`\n✅ SET Operations (${cacheSetIterations} iterations):`);
  console.log(`   Average: ${formatTime(avgCacheSet)}`);
  console.log(`   Min:     ${formatTime(minCacheSet)}`);
  console.log(`   Max:     ${formatTime(maxCacheSet)}`);

  // Benchmark: GET operations (with hits)
  const cacheGetTimes = [];
  const cacheGetIterations = 10000;
  let cacheHits = 0;
  
  for (let i = 0; i < cacheGetIterations; i++) {
    const start = performance.now();
    const result = cache.get(`cache-key-${i % 100}`);
    const end = performance.now();
    cacheGetTimes.push(end - start);
    if (result !== null) cacheHits++;
  }

  const avgCacheGet = cacheGetTimes.reduce((a, b) => a + b) / cacheGetTimes.length;
  const maxCacheGet = Math.max(...cacheGetTimes);
  const minCacheGet = Math.min(...cacheGetTimes);
  const hitRate = ((cacheHits / cacheGetIterations) * 100).toFixed(2);

  console.log(`\n✅ GET Operations (${cacheGetIterations} iterations):`);
  console.log(`   Average: ${formatTime(avgCacheGet)}`);
  console.log(`   Min:     ${formatTime(minCacheGet)}`);
  console.log(`   Max:     ${formatTime(maxCacheGet)}`);
  console.log(`   Hit Rate: ${hitRate}%`);

  // Get cache stats
  const stats = cache.getStats();
  console.log(`\n📈 Cache Statistics:`);
  console.log(`   Entries: ${stats.size}`);
  console.log(`   Hits: ${formatNumber(stats.hits)}`);
  console.log(`   Misses: ${formatNumber(stats.misses)}`);

  results.benchmarks.cacheManager = {
    set: { avg: avgCacheSet, min: minCacheSet, max: maxCacheSet },
    get: { avg: avgCacheGet, min: minCacheGet, max: maxCacheGet, hitRate: parseFloat(hitRate) },
    iterations: { set: cacheSetIterations, get: cacheGetIterations },
    stats: { entries: stats.size, hits: stats.hits, misses: stats.misses }
  };

} catch (e) {
  console.log(`❌ Error: ${e.message}`);
}

// ============================================================
// BENCHMARK 3: PluginManager Performance
// ============================================================

console.log('\n\n📊 BENCHMARK 3: PluginManager Performance');
console.log('─'.repeat(60));

try {
  const PluginManager = require('./src/models/PluginManager');

  // Benchmark: Hook registration
  const hookRegTimes = [];
  const hookRegIterations = 100;
  
  for (let i = 0; i < hookRegIterations; i++) {
    const start = performance.now();
    PluginManager.registerHook(`test:hook-${i}`, () => {}, 10);
    const end = performance.now();
    hookRegTimes.push(end - start);
  }

  const avgHookReg = hookRegTimes.reduce((a, b) => a + b) / hookRegTimes.length;
  const maxHookReg = Math.max(...hookRegTimes);
  const minHookReg = Math.min(...hookRegTimes);

  console.log(`\n✅ Hook Registration (${hookRegIterations} hooks):`);
  console.log(`   Average: ${formatTime(avgHookReg)}`);
  console.log(`   Min:     ${formatTime(minHookReg)}`);
  console.log(`   Max:     ${formatTime(maxHookReg)}`);

  // Benchmark: Hook execution
  const hookExecTimes = [];
  const hookExecIterations = 1000;
  
  (async () => {
    for (let i = 0; i < hookExecIterations; i++) {
      const start = performance.now();
      await PluginManager.executeHook('test:hook-0', {});
      const end = performance.now();
      hookExecTimes.push(end - start);
    }

    const avgHookExec = hookExecTimes.reduce((a, b) => a + b) / hookExecTimes.length;
    const maxHookExec = Math.max(...hookExecTimes);
    const minHookExec = Math.min(...hookExecTimes);

    console.log(`\n✅ Hook Execution (${hookExecIterations} executions):`);
    console.log(`   Average: ${formatTime(avgHookExec)}`);
    console.log(`   Min:     ${formatTime(minHookExec)}`);
    console.log(`   Max:     ${formatTime(maxHookExec)}`);

    // Plugin stats
    const pStats = PluginManager.getStats();
    console.log(`\n📈 Plugin System Statistics:`);
    console.log(`   Plugins Loaded: ${pStats.pluginsLoaded}`);
    console.log(`   Hooks Registered: ${pStats.hooksRegistered}`);
    console.log(`   Middleware Count: ${pStats.middlewareCount}`);

    results.benchmarks.pluginManager = {
      hookRegistration: { avg: avgHookReg, min: minHookReg, max: maxHookReg },
      hookExecution: { avg: avgHookExec, min: minHookExec, max: maxHookExec },
      iterations: { registration: hookRegIterations, execution: hookExecIterations },
      stats: { pluginsLoaded: pStats.pluginsLoaded, hooksRegistered: pStats.hooksRegistered }
    };

    continueWithOtherBenchmarks();
  })();

} catch (e) {
  console.log(`❌ Error: ${e.message}`);
}

function continueWithOtherBenchmarks() {
  // ============================================================
  // BENCHMARK 4: Concurrent Operations
  // ============================================================

  console.log('\n\n📊 BENCHMARK 4: Concurrent Operations');
  console.log('─'.repeat(60));

  try {
    const CacheManager = require('./src/models/CacheManager');
    const cache = new CacheManager();

    const concurrentStart = performance.now();
    const promises = [];

    for (let i = 0; i < 500; i++) {
      promises.push(
        new Promise((resolve) => {
          cache.set(`concurrent-${i}`, { value: i });
          setTimeout(() => {
            cache.get(`concurrent-${i % 100}`);
            resolve();
          }, Math.random() * 10);
        })
      );
    }

    Promise.all(promises).then(() => {
      const concurrentEnd = performance.now();
      const concurrentTime = concurrentEnd - concurrentStart;

      console.log(`\n✅ 500 Concurrent Cache Operations:`);
      console.log(`   Total Time: ${formatTime(concurrentTime)}`);
      console.log(`   Ops/sec: ${formatNumber(Math.round(500 / (concurrentTime / 1000)))}`);

      results.benchmarks.concurrent = {
        operations: 500,
        totalTime: concurrentTime,
        opsPerSec: Math.round(500 / (concurrentTime / 1000))
      };

      printSummary();
    });

  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

function printSummary() {
  // ============================================================
  // SUMMARY & ANALYSIS
  // ============================================================

  console.log('\n\n📈 PERFORMANCE SUMMARY');
  console.log('═'.repeat(60));

  const sessionStoreResults = results.benchmarks.sessionStore;
  const cacheResults = results.benchmarks.cacheManager;
  const pluginResults = results.benchmarks.pluginManager;

  if (sessionStoreResults) {
    console.log('\n📌 SessionStore:');
    console.log(`   • SET: ${formatTime(sessionStoreResults.set.avg)} avg (${sessionStoreResults.iterations.set} ops)`);
    console.log(`   • GET: ${formatTime(sessionStoreResults.get.avg)} avg (${sessionStoreResults.iterations.get} ops)`);
    
    results.summary.sessionStore = {
      setAvg: sessionStoreResults.set.avg,
      getAvg: sessionStoreResults.get.avg,
      status: sessionStoreResults.get.avg < 10 ? '✅ GOOD' : '⚠️ NEEDS OPTIMIZATION'
    };
  }

  if (cacheResults) {
    console.log('\n📌 CacheManager:');
    console.log(`   • SET: ${formatTime(cacheResults.set.avg)} avg (${cacheResults.iterations.set} ops)`);
    console.log(`   • GET: ${formatTime(cacheResults.get.avg)} avg (${cacheResults.iterations.get} ops, ${cacheResults.get.hitRate}% hits)`);
    console.log(`   • Entries: ${cacheResults.stats.entries} / 5000 (${((cacheResults.stats.entries/5000)*100).toFixed(1)}%)`);
    
    results.summary.cacheManager = {
      setAvg: cacheResults.set.avg,
      getAvg: cacheResults.get.avg,
      hitRate: cacheResults.get.hitRate,
      status: cacheResults.get.avg < 1 ? '✅ EXCELLENT' : cacheResults.get.avg < 5 ? '✅ GOOD' : '⚠️ NEEDS OPTIMIZATION'
    };
  }

  if (pluginResults) {
    console.log('\n📌 PluginManager:');
    console.log(`   • Hook Reg: ${formatTime(pluginResults.hookRegistration.avg)} avg (${pluginResults.iterations.registration} ops)`);
    console.log(`   • Hook Exec: ${formatTime(pluginResults.hookExecution.avg)} avg (${pluginResults.iterations.execution} ops)`);
    console.log(`   • Plugins: ${pluginResults.stats.pluginsLoaded}`);
    
    results.summary.pluginManager = {
      hookRegAvg: pluginResults.hookRegistration.avg,
      hookExecAvg: pluginResults.hookExecution.avg,
      status: pluginResults.hookExecution.avg < 1 ? '✅ EXCELLENT' : '✅ GOOD'
    };
  }

  if (results.benchmarks.concurrent) {
    console.log('\n📌 Concurrent Operations:');
    console.log(`   • 500 ops in ${formatTime(results.benchmarks.concurrent.totalTime)}`);
    console.log(`   • ${formatNumber(results.benchmarks.concurrent.opsPerSec)} ops/sec`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ Benchmark Complete\n');

  // Save results to file
  const reportPath = path.join(__dirname, 'benchmark-results.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📊 Results saved to: ${reportPath}`);

  // Generate HTML report
  generateHtmlReport();
}

function generateHtmlReport() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jellyfin Companion - Performance Report</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 3px solid #0066cc; padding-bottom: 10px; }
        .benchmark { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #0066cc; }
        .metric { display: grid; grid-template-columns: 200px 1fr; gap: 10px; margin: 10px 0; }
        .metric-label { font-weight: bold; color: #666; }
        .metric-value { color: #333; font-family: monospace; }
        .status-good { color: #28a745; font-weight: bold; }
        .status-warning { color: #ffc107; font-weight: bold; }
        .status-bad { color: #dc3545; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #0066cc; color: white; }
        tr:hover { background: #f5f5f5; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Jellyfin Companion - Performance Benchmark Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>

        <div class="benchmark">
            <h2>📊 SessionStore Performance</h2>
            <div class="metric">
                <div class="metric-label">SET Average:</div>
                <div class="metric-value">${formatTime(results.benchmarks.sessionStore?.set.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">GET Average:</div>
                <div class="metric-value">${formatTime(results.benchmarks.sessionStore?.get.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Status:</div>
                <div class="metric-value status-good">${results.summary.sessionStore?.status || 'N/A'}</div>
            </div>
        </div>

        <div class="benchmark">
            <h2>📊 CacheManager Performance</h2>
            <div class="metric">
                <div class="metric-label">SET Average:</div>
                <div class="metric-value">${formatTime(results.benchmarks.cacheManager?.set.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">GET Average:</div>
                <div class="metric-value">${formatTime(results.benchmarks.cacheManager?.get.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Cache Hit Rate:</div>
                <div class="metric-value">${results.benchmarks.cacheManager?.get.hitRate || 0}%</div>
            </div>
            <div class="metric">
                <div class="metric-label">Status:</div>
                <div class="metric-value status-good">${results.summary.cacheManager?.status || 'N/A'}</div>
            </div>
        </div>

        <div class="benchmark">
            <h2>📊 PluginManager Performance</h2>
            <div class="metric">
                <div class="metric-label">Hook Registration:</div>
                <div class="metric-value">${formatTime(results.benchmarks.pluginManager?.hookRegistration.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Hook Execution:</div>
                <div class="metric-value">${formatTime(results.benchmarks.pluginManager?.hookExecution.avg || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Status:</div>
                <div class="metric-value status-good">${results.summary.pluginManager?.status || 'N/A'}</div>
            </div>
        </div>

        <div class="benchmark">
            <h2>📊 Concurrent Operations</h2>
            <div class="metric">
                <div class="metric-label">Total Time:</div>
                <div class="metric-value">${formatTime(results.benchmarks.concurrent?.totalTime || 0)}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Operations/sec:</div>
                <div class="metric-value">${formatNumber(results.benchmarks.concurrent?.opsPerSec || 0)}</div>
            </div>
        </div>

        <div class="footer">
            <p><strong>Performance Targets:</strong></p>
            <ul>
                <li>✅ SessionStore GET: < 10ms (Target: Database latency)</li>
                <li>✅ CacheManager GET: < 1ms (Target: In-memory speed)</li>
                <li>✅ PluginManager Hook: < 1ms (Target: Minimal overhead)</li>
                <li>✅ Concurrent Ops: > 5000 ops/sec</li>
            </ul>
        </div>
    </div>
</body>
</html>`;

  const reportPath = path.join(__dirname, 'benchmark-report.html');
  fs.writeFileSync(reportPath, html);
  console.log(`📄 HTML Report saved to: ${reportPath}`);
}

// Start benchmarks
console.log('Starting benchmarks...\n');
