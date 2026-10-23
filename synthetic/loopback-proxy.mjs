import http from 'node:http';

const target = process.env.SYNTHETIC_PROXY_TARGET;
if (target !== 'http://app:3000') {
  throw new Error('[synthetic] proxy target must be the isolated app service');
}

const server = http.createServer((request, response) => {
  const upstream = http.request({
    hostname: 'app',
    port: 3000,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: '127.0.0.1' },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end('synthetic upstream unavailable');
  });
  request.pipe(upstream);
});

server.listen(3000, '0.0.0.0', () => {
  console.log('[synthetic] loopback gateway listening');
});
