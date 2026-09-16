"""Local registration server. Run with Python 3: python server.py."""
import json
import re
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / 'registrations.sqlite3'
PUBLIC = {'/', '/index.html', '/login.html', '/images.jpg',
          '/vina-fruske-gore.jpg', '/Dot_Networks_Full_Color.png'}


def initialize():
    with sqlite3.connect(DATABASE) as connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS registrations (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path not in PUBLIC:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path not in PUBLIC:
            self.send_error(404)
            return
        super().do_HEAD()

    def reply(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/api/registrations':
            self.reply(404, {'error': 'Not found'})
            return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.reply(415, {'error': 'JSON required'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048:
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or set(payload) != {'email'}:
                raise ValueError()
            email = payload['email']
            if not isinstance(email, str):
                raise ValueError()
            email = email.strip()
            if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.reply(400, {'error': 'Invalid email'})
            return
        try:
            with sqlite3.connect(DATABASE) as connection:
                connection.execute(
                    'INSERT INTO registrations (email) VALUES (?) ON CONFLICT(email) DO NOTHING',
                    (email,))
        except sqlite3.Error:
            self.reply(500, {'error': 'Unable to save registration'})
            return
        self.reply(200, {'ok': True})


if __name__ == '__main__':
    initialize()
    print('Open http://localhost:8000 — Ctrl+C to stop.')
    ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
