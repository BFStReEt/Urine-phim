import http from 'http';
import https from 'https';
import { URL } from 'url';

export default function handler(req, res) {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl) {
      res.status(400).send('Missing url parameter');
      return;
    }

    const targetUrl = decodeURIComponent(rawUrl);
    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://ophim17.cc/',
        'Origin': 'https://ophim17.cc'
      }
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        res.writeHead(302, {
          'Location': `/api/cors-proxy?url=${encodeURIComponent(proxyRes.headers.location)}`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end();
        return;
      }

      res.writeHead(proxyRes.statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': proxyRes.headers['content-type'] || 'application/vnd.apple.mpegurl'
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Vercel API CORS Proxy Error:', err.message);
      res.status(500).send('Proxy Request Error: ' + err.message);
    });

    proxyReq.end();
  } catch (e) {
    res.status(400).send('Invalid URL');
  }
}
