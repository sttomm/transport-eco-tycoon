#!/usr/bin/env python3
"""Dev server: http.server with Cache-Control: no-cache.

Plain `python -m http.server` lets browsers heuristically cache ES modules.
After editing src/*.js a reload then serves a stale old/new module mix —
broken imports kill main.js and the game area stays blank. no-cache forces
revalidation on every request; unchanged files still answer 304, so it
stays fast.
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8741))
    print(f'Serving on http://localhost:{port} (no-cache)')
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
