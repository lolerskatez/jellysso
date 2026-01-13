#!/usr/bin/env node
/**
 * Benchmark Runner - Orchestrates all performance tests
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       JELLYFIN COMPANION - BENCHMARK ORCHESTRATOR           ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const benchmarks = [
  {
    name: 'Performance Suite',
    file: 'benchmarks/performance-suite.js',
    description: 'Core system performance benchmarks'
  },
  {
    name: 'Load Testing',
    file: 'benchmarks/load-testing.js',
    description: 'Concurrent load testing'
  }
];

let completed = 0;
const startTime = Date.now();

function runBenchmark(benchmark, index) {
  return new Promise((resolve) => {
    console.log(`\n📌 Running Benchmark ${index + 1}/${benchmarks.length}: ${benchmark.name}`);
    console.log(`   Description: ${benchmark.description}`);
    console.log('   Starting...\n');

    const proc = spawn('node', [benchmark.file], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`   ✅ ${benchmark.name} completed`);
      } else {
        console.log(`   ⚠️ ${benchmark.name} exited with code ${code}`);
      }
      resolve(code);
    });

    proc.on('error', (err) => {
      console.log(`   ❌ Error running ${benchmark.name}: ${err.message}`);
      resolve(1);
    });
  });
}

async function runAllBenchmarks() {
  for (let i = 0; i < benchmarks.length; i++) {
    await runBenchmark(benchmarks[i], i);
    completed++;
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('✅ BENCHMARK SUITE COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Benchmarks Run: ${completed}/${benchmarks.length}`);
  console.log(`   Total Duration: ${duration}s`);
  console.log(`\n📁 Output Files:`);

  // List generated reports
  const reportFiles = [
    { name: 'benchmark-results.json', desc: 'Detailed performance metrics' },
    { name: 'benchmark-report.html', desc: 'Visual performance report' },
    { name: 'load-test-results.json', desc: 'Load test results' }
  ];

  reportFiles.forEach(file => {
    const filePath = path.join(__dirname, file.name);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      console.log(`   ✅ ${file.name} (${(stat.size / 1024).toFixed(1)}KB) - ${file.desc}`);
    } else {
      console.log(`   ⏳ ${file.name} - Will be generated during benchmark`);
    }
  });

  console.log('\n🎯 Next Steps:');
  console.log('   1. Review benchmark-report.html in your browser');
  console.log('   2. Check benchmark-results.json for detailed metrics');
  console.log('   3. Compare against performance targets');
  console.log('   4. Run periodically to track performance trends\n');
}

// Run benchmarks
runAllBenchmarks().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
