"""Static server for RT75 Studio with caching disabled, so edits show up on reload.

WebHID needs a secure context; 127.0.0.1 counts as one.
Usage: python serve.py [port]   (default 5180)
"""
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    print(f"RT75 Studio on http://127.0.0.1:{port}")
    server.serve_forever()
