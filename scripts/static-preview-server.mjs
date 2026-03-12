import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || process.env.PORT || 4173);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url || '/', `http://127.0.0.1:${port}`).pathname;
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const resolvedPath = path.resolve(rootDir, relativePath);

    if (!resolvedPath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const stat = await fs.stat(resolvedPath).catch(() => null);
    const filePath = stat?.isDirectory() ? path.join(resolvedPath, 'index.html') : resolvedPath;
    const body = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static preview available at http://127.0.0.1:${port}`);
});
