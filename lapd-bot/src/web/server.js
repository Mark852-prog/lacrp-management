// Small status page for the RRHosting domain. Serves the landing page, the logo and a health check.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomQuote } = require('../lib/branding');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function start(client) {
  const port = Number(process.env.SERVER_PORT || process.env.PORT);
  if (!port) {
    console.log('No SERVER_PORT/PORT set - web status page disabled.');
    return;
  }
  http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/health') {
      res.writeHead(client.isReady() ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ online: client.isReady(), ping: client.ws.ping }));
    }
    if (url === '/seal.png' || url === '/banner.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      return fs.createReadStream(path.join(ASSETS, url === '/seal.png' ? 'avatar.png' : 'banner.png')).pipe(res);
    }
    if (url === '/') {
      const html = PAGE
        .replace('{{QUOTE}}', escape(randomQuote()))
        .replace('{{STATUS}}', client.isReady() ? 'Online' : 'Starting up')
        .replace('{{STATUS_CLASS}}', client.isReady() ? 'on' : 'off');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 - This area is restricted. Step away from the tape.');
  }).listen(port, '0.0.0.0', () => console.log(`Web status page on port ${port}`));
}

module.exports = { start };
