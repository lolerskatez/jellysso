const https = require('https');
const fs = require('fs');
const path = require('path');

// For development HTTPS
if (process.env.NODE_ENV !== 'production') {
  const key = fs.readFileSync(path.join(__dirname, '../certs/key.pem'));
  const cert = fs.readFileSync(path.join(__dirname, '../certs/cert.pem'));
  
  https.createServer({ key, cert }, app).listen(3443, () => {
    console.log('HTTPS server running on port 3443');
  });
}