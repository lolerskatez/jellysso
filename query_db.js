const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./src/config/companion.db');
db.get("SELECT key, value FROM settings WHERE key = 'oidc_config'", (err, row) => {
  if (err) {
    console.error('Error:', err);
  } else if (row) {
    console.log('OIDC Config:', JSON.parse(row.value));
  } else {
    console.log('No OIDC config found');
  }
  db.close();
});