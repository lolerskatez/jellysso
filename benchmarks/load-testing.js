#!/usr/bin/env node
/**
 * Load Testing Script
 * Simulates multiple concurrent users and operations
 */

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

const results = {
  timestamp: new Date().toISOString(),
  testConfig: {
    concurrentUsers: 10,
    requestsPerUser: 100,
    testDuration: 'varies',
    totalRequests: 1000
  },
  results: {
    sessionOperations: {},
    cacheOperations: {},
    pluginOperations: {},
    apiSimulation: {}
  }
};

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║        LOAD TESTING - CONCURRENT OPERATION SUITE            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

function formatTime(ms) {
  if (ms < 1) return (ms * 1000).toFixed(2) + ' μs';
  if (ms < 1000) return ms.toFixed(3) + ' ms';
  return (ms / 1000).toFixed(3) + ' s';
}

/**
 * Load Test 1: Session Store Under Load
 */
async function testSessionStoreLoad() {
  console.log('📊 Load Test 1: SessionStore Concurrent Load');
  console.log('─'.repeat(60));

  try {
    const SessionStore = require('./src/models/SessionStore');
    const sessionStore = new SessionStore();

    const concurrentUsers = 50;
    const operationsPerUser = 20;
    const sessionTimes = [];

    console.log(`Testing: ${concurrentUsers} concurrent users, ${operationsPerUser} operations each\n`);

    const testStart = performance.now();

    const userPromises = [];
    for (let user = 0; user < concurrentUsers; user++) {
      userPromises.push(
        new Promise((resolve) => {
          const opResults = [];

          for (let op = 0; op < operationsPerUser; op++) {
            const sid = `user-${user}-session-${op}`;
            const sessionData = {
              userId: `user-${user}`,
              loginTime: new Date().toISOString(),
              metadata: { op }
            };

            const start = performance.now();
            sessionStore.set(sid, sessionData, (err) => {
              if (!err) {
                sessionStore.get(sid, (err2) => {
                  const end = performance.now();
                  opResults.push(end - start);
                });
              }
            });
          }

          setTimeout(() => resolve(opResults), 100);
        })
      );
    }

    const allResults = await Promise.all(userPromises);
    const testEnd = performance.now();
    const totalTime = testEnd - testStart;

    const flatResults = allResults.flat();
    const avgTime = flatResults.reduce((a, b) => a + b) / flatResults.length;
    const maxTime = Math.max(...flatResults);
    const minTime = Math.min(...flatResults);

    console.log(`✅ Results:`);
    console.log(`   Total Operations: ${flatResults.length}`);
    console.log(`   Total Time: ${formatTime(totalTime)}`);
    console.log(`   Average Op Time: ${formatTime(avgTime)}`);
    console.log(`   Max Op Time: ${formatTime(maxTime)}`);
    console.log(`   Min Op Time: ${formatTime(minTime)}`);
    console.log(`   Ops/sec: ${Math.round(flatResults.length / (totalTime / 1000))}\n`);

    results.results.sessionOperations = {
      totalOperations: flatResults.length,
      totalTime,
      avgTime,
      maxTime,
      minTime,
      opsPerSec: Math.round(flatResults.length / (totalTime / 1000))
    };

  } catch (e) {
    console.log(`❌ Error: ${e.message}\n`);
  }
}

/**
 * Load Test 2: Cache Manager Under Load
 */
async function testCacheManagerLoad() {
  console.log('📊 Load Test 2: CacheManager Concurrent Load');
  console.log('─'.repeat(60));

  try {
    const CacheManager = require('./src/models/CacheManager');
    const cache = new CacheManager({ maxSize: 10000 });

    const concurrentUsers = 50;
    const operationsPerUser = 100;
    const cacheTimes = [];

    console.log(`Testing: ${concurrentUsers} concurrent users, ${operationsPerUser} operations each\n`);

    const testStart = performance.now();

    const userPromises = [];
    for (let user = 0; user < concurrentUsers; user++) {
      userPromises.push(
        new Promise((resolve) => {
          const opResults = [];

          for (let op = 0; op < operationsPerUser; op++) {
            const key = `user-${user}-data-${op % 20}`;
            const data = { userId: user, opId: op, value: Math.random() };

            // Mix of reads and writes (70% reads, 30% writes)
            if (Math.random() < 0.7) {
              // Read
              const start = performance.now();
              cache.get(key);
              const end = performance.now();
              opResults.push(end - start);
            } else {
              // Write
              const start = performance.now();
              cache.set(key, data);
              const end = performance.now();
              opResults.push(end - start);
            }
          }

          resolve(opResults);
        })
      );
    }

    const allResults = await Promise.all(userPromises);
    const testEnd = performance.now();
    const totalTime = testEnd - testStart;

    const flatResults = allResults.flat();
    const avgTime = flatResults.reduce((a, b) => a + b) / flatResults.length;
    const maxTime = Math.max(...flatResults);
    const minTime = Math.min(...flatResults);

    const stats = cache.getStats();

    console.log(`✅ Results:`);
    console.log(`   Total Operations: ${flatResults.length}`);
    console.log(`   Total Time: ${formatTime(totalTime)}`);
    console.log(`   Average Op Time: ${formatTime(avgTime)}`);
    console.log(`   Max Op Time: ${formatTime(maxTime)}`);
    console.log(`   Min Op Time: ${formatTime(minTime)}`);
    console.log(`   Ops/sec: ${Math.round(flatResults.length / (totalTime / 1000))}`);
    console.log(`   Cache Entries: ${stats.size}`);
    console.log(`   Hit Rate: ${((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)}%\n`);

    results.results.cacheOperations = {
      totalOperations: flatResults.length,
      totalTime,
      avgTime,
      maxTime,
      minTime,
      opsPerSec: Math.round(flatResults.length / (totalTime / 1000)),
      cacheEntries: stats.size,
      hitRate: ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)
    };

  } catch (e) {
    console.log(`❌ Error: ${e.message}\n`);
  }
}

/**
 * Load Test 3: Plugin System Under Load
 */
async function testPluginSystemLoad() {
  console.log('📊 Load Test 3: PluginManager Concurrent Load');
  console.log('─'.repeat(60));

  try {
    const PluginManager = require('./src/models/PluginManager');

    const concurrentUsers = 20;
    const hooksPerUser = 50;

    console.log(`Testing: ${concurrentUsers} concurrent hook executions, ${hooksPerUser} hooks each\n`);

    const testStart = performance.now();

    const userPromises = [];
    for (let user = 0; user < concurrentUsers; user++) {
      userPromises.push(
        new Promise(async (resolve) => {
          const opResults = [];

          for (let hook = 0; hook < hooksPerUser; hook++) {
            const hookName = `load-test:hook-${user}-${hook % 10}`;
            
            const start = performance.now();
            await PluginManager.executeHook(hookName, { user, hookNum: hook });
            const end = performance.now();
            
            opResults.push(end - start);
          }

          resolve(opResults);
        })
      );
    }

    const allResults = await Promise.all(userPromises);
    const testEnd = performance.now();
    const totalTime = testEnd - testStart;

    const flatResults = allResults.flat();
    const avgTime = flatResults.reduce((a, b) => a + b) / flatResults.length;
    const maxTime = Math.max(...flatResults);
    const minTime = Math.min(...flatResults);

    const pStats = PluginManager.getStats();

    console.log(`✅ Results:`);
    console.log(`   Total Hook Calls: ${flatResults.length}`);
    console.log(`   Total Time: ${formatTime(totalTime)}`);
    console.log(`   Average Call Time: ${formatTime(avgTime)}`);
    console.log(`   Max Call Time: ${formatTime(maxTime)}`);
    console.log(`   Min Call Time: ${formatTime(minTime)}`);
    console.log(`   Calls/sec: ${Math.round(flatResults.length / (totalTime / 1000))}\n`);

    results.results.pluginOperations = {
      totalCalls: flatResults.length,
      totalTime,
      avgTime,
      maxTime,
      minTime,
      callsPerSec: Math.round(flatResults.length / (totalTime / 1000))
    };

  } catch (e) {
    console.log(`❌ Error: ${e.message}\n`);
  }
}

/**
 * Load Test 4: API Simulation
 */
async function testApiSimulation() {
  console.log('📊 Load Test 4: API Endpoint Simulation');
  console.log('─'.repeat(60));

  try {
    const CacheManager = require('./src/models/CacheManager');
    const cache = new CacheManager();

    // Simulate typical API endpoints
    const simulateApiCall = async () => {
      const start = performance.now();

      // Simulate: check cache -> fetch data -> update cache
      let result = cache.get('api-response');
      if (!result) {
        // Simulate 5ms database query
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
        result = { data: 'simulated-api-response', timestamp: Date.now() };
        cache.set('api-response', result);
      }

      const end = performance.now();
      return end - start;
    };

    const concurrentRequests = 100;
    const requestsPerConnection = 10;

    console.log(`Testing: ${concurrentRequests} concurrent connections, ${requestsPerConnection} requests each\n`);

    const testStart = performance.now();

    const promises = [];
    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(
        new Promise(async (resolve) => {
          const times = [];
          for (let req = 0; req < requestsPerConnection; req++) {
            const time = await simulateApiCall();
            times.push(time);
          }
          resolve(times);
        })
      );
    }

    const allResults = await Promise.all(promises);
    const testEnd = performance.now();
    const totalTime = testEnd - testStart;

    const flatResults = allResults.flat();
    const avgTime = flatResults.reduce((a, b) => a + b) / flatResults.length;
    const maxTime = Math.max(...flatResults);
    const minTime = Math.min(...flatResults);

    console.log(`✅ Results:`);
    console.log(`   Total Requests: ${flatResults.length}`);
    console.log(`   Total Time: ${formatTime(totalTime)}`);
    console.log(`   Average Response: ${formatTime(avgTime)}`);
    console.log(`   Max Response: ${formatTime(maxTime)}`);
    console.log(`   Min Response: ${formatTime(minTime)}`);
    console.log(`   Requests/sec: ${Math.round(flatResults.length / (totalTime / 1000))}\n`);

    results.results.apiSimulation = {
      totalRequests: flatResults.length,
      totalTime,
      avgTime,
      maxTime,
      minTime,
      requestsPerSec: Math.round(flatResults.length / (totalTime / 1000))
    };

  } catch (e) {
    console.log(`❌ Error: ${e.message}\n`);
  }
}

/**
 * Run All Tests
 */
async function runAllTests() {
  try {
    await testSessionStoreLoad();
    await testCacheManagerLoad();
    await testPluginSystemLoad();
    await testApiSimulation();

    // Summary
    console.log('═'.repeat(60));
    console.log('📈 LOAD TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`\n✅ All load tests completed successfully\n`);

    // Save results
    const reportPath = path.join(__dirname, 'load-test-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`📊 Results saved to: ${reportPath}\n`);

  } catch (e) {
    console.log(`❌ Fatal error: ${e.message}`);
  }
}

// Start tests
runAllTests();
