'use strict';
/**
 * 마지막 배 — 독립 서버.
 * - public/ 폴더(게임 화면)와 Three.js 파일을 제공한다.
 * - /ws 웹소켓: 2인 방(초대코드), 방장 ↔ 동료 사이 메시지·스냅샷 전달, WebRTC 신호 (server/rooms.js)
 * - 좀비 계산은 방장 브라우저가 하므로 서버는 가볍다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createRooms } = require('./server/rooms');

const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(path.dirname(require.resolve('three')), '..');
const VENDOR_FILES = {
  '/vendor/three/three.module.js': path.join(THREE_DIR, 'build', 'three.module.js'),
  '/vendor/three/three.core.js': path.join(THREE_DIR, 'build', 'three.core.js'),
};
const MOUNTS = [{ prefix: '/vendor/three/addons/', dir: path.join(THREE_DIR, 'examples', 'jsm'), long: true }];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json']);
const gzCache = new Map();

function under(dir, rel) {
  const p = path.normalize(path.join(dir, rel));
  return p.startsWith(dir + path.sep) ? p : null;
}

/** 요청 경로 → 실제 파일 (허용되지 않은 경로면 null) */
function resolvePath(pathname) {
  if (VENDOR_FILES[pathname]) return { file: VENDOR_FILES[pathname], long: true };
  for (const m of MOUNTS) {
    if (pathname.startsWith(m.prefix)) {
      const file = under(m.dir, pathname.slice(m.prefix.length));
      return file ? { file, long: !!m.long } : null;
    }
  }
  const file = under(PUBLIC_DIR, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  return file ? { file, long: false } : null;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  const target = resolvePath(pathname);
  if (!target) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(target.file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(target.file).toLowerCase();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': target.long ? 'public, max-age=86400' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    fs.readFile(target.file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && data.length > 1024) {
        const key = `${target.file}:${etag}`;
        let gz = gzCache.get(key);
        if (!gz) {
          gz = zlib.gzipSync(data, { level: 6 });
          gzCache.set(key, gz);
        }
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
        data = gz;
      }
      headers['Content-Length'] = data.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

function createLastBoatServer() {
  const server = http.createServer(serveStatic);
  const rooms = createRooms();
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    rooms.wss.handleUpgrade(req, socket, head, (ws) => rooms.wss.emit('connection', ws, req));
  });
  return {
    server,
    rooms: rooms.rooms,
    close(cb) {
      rooms.close();
      server.close(cb);
    },
  };
}

module.exports = { createLastBoatServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3200;
  const HOST = process.env.HOST || '0.0.0.0';
  createLastBoatServer().server.listen(PORT, HOST, () => {
    console.log(`마지막 배 서버 실행 중 → http://localhost:${PORT}`);
  });
}
