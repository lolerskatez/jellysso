const fs = require('fs');
const p = 'e:/JellySSO/jellysso/src/routes/quickconnect.js';
let c = fs.readFileSync(p, 'utf8');
const marker = 'module.exports = router;';
const idx = c.indexOf(marker);
if (idx >= 0) {
  const kept = c.slice(0, idx + marker.length) + '\n';
  fs.writeFileSync(p, kept, 'utf8');
  console.log('Done. Lines: ' + kept.split('\n').length);
} else {
  console.log('Marker not found');
}
