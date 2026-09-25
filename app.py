"""SignBridge API — pure Python standard library. No pip install required.
Runs with: python3 app.py  (or: python app.py on Windows)
"""
import json
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
DB = ROOT / "signbridge.db"

GESTURES = [
    # single-hand categories (MediaPipe GestureRecognizer built-ins)
    {"id": "open_palm", "model": "Open_Palm", "label": "HELLO", "text": "Hello"},
    {"id": "thumb_up", "model": "Thumb_Up", "label": "YES", "text": "Yes"},
    {"id": "thumb_down", "model": "Thumb_Down", "label": "NO", "text": "No"},
    {"id": "closed_fist", "model": "Closed_Fist", "label": "STOP", "text": "Stop"},
    {"id": "victory", "model": "Victory", "label": "PEACE", "text": "Peace"},
    {"id": "ilove_you", "model": "ILoveYou", "label": "I LOVE YOU", "text": "I love you"},
    {"id": "pointing_up", "model": "Pointing_Up", "label": "ATTENTION", "text": "Attention, please"},
    # two-hand fusion vocabulary — every pair across the 7 categories (28 combos)
    {"id": "twin_palm_hello", "model": "Open_Palm + Open_Palm", "label": "DUAL HELLO", "text": "Hello — together"},
    {"id": "twin_thumb_yes", "model": "Thumb_Up + Thumb_Up", "label": "DUAL YES", "text": "Yes — we agree"},
    {"id": "twin_thumb_no", "model": "Thumb_Down + Thumb_Down", "label": "DUAL NO", "text": "No — both sides"},
    {"id": "twin_victory", "model": "Victory + Victory", "label": "PEACE TOGETHER", "text": "Peace — together"},
    {"id": "twin_love", "model": "ILoveYou + ILoveYou", "label": "LOVE TOGETHER", "text": "Love — together"},
    {"id": "twin_fist_strong", "model": "Closed_Fist + Closed_Fist", "label": "STRONG TOGETHER", "text": "We stand strong together"},
    {"id": "twin_point_attention", "model": "Pointing_Up + Pointing_Up", "label": "ATTENTION PLEASE", "text": "Attention, please — together"},
    {"id": "fist_palm_pause", "model": "Closed_Fist + Open_Palm", "label": "PAUSE + LISTEN", "text": "Pause and listen"},
    {"id": "fist_point_wait", "model": "Closed_Fist + Pointing_Up", "label": "WAIT, ONE THING", "text": "Wait — one more thing"},
    {"id": "fist_thumbup_holdon", "model": "Closed_Fist + Thumb_Up", "label": "HOLD ON, OKAY", "text": "Hold on — but okay"},
    {"id": "fist_thumbdown_stop", "model": "Closed_Fist + Thumb_Down", "label": "STOP, DISAGREE", "text": "Stop — I disagree"},
    {"id": "fist_victory_stand", "model": "Closed_Fist + Victory", "label": "STAND FOR PEACE", "text": "Standing firm for peace"},
    {"id": "fist_iloveyou_protect", "model": "Closed_Fist + ILoveYou", "label": "PROTECT WITH LOVE", "text": "I will protect you with love"},
    {"id": "palm_point_lookhere", "model": "Open_Palm + Pointing_Up", "label": "LOOK HERE", "text": "Hello — look here"},
    {"id": "palm_thumbup_hello_yes", "model": "Open_Palm + Thumb_Up", "label": "HELLO, YES", "text": "Hello — and yes"},
    {"id": "palm_thumbdown_hello_no", "model": "Open_Palm + Thumb_Down", "label": "HELLO, NO", "text": "Hello — but no"},
    {"id": "victory_palm_welcome", "model": "Open_Palm + Victory", "label": "WELCOME TOGETHER", "text": "Welcome — come in"},
    {"id": "palm_iloveyou", "model": "Open_Palm + ILoveYou", "label": "I AM WITH YOU", "text": "I am with you"},
    {"id": "point_thumbup_note_yes", "model": "Pointing_Up + Thumb_Up", "label": "NOTE THIS, YES", "text": "Note this — yes"},
    {"id": "point_thumbdown_note_no", "model": "Pointing_Up + Thumb_Down", "label": "NOTE THIS, NO", "text": "Note this — no"},
    {"id": "point_victory_point_peace", "model": "Pointing_Up + Victory", "label": "POINT FOR PEACE", "text": "One important point for peace"},
    {"id": "point_iloveyou_important", "model": "Pointing_Up + ILoveYou", "label": "IMPORTANT, LOVE", "text": "This matters — with love"},
    {"id": "thumbup_thumbdown_mixed", "model": "Thumb_Up + Thumb_Down", "label": "MIXED FEELINGS", "text": "Mixed feelings — yes and no"},
    {"id": "thumbup_victory_yes_peace", "model": "Thumb_Up + Victory", "label": "YES TO PEACE", "text": "Yes — to peace"},
    {"id": "thumbup_iloveyou_yes_love", "model": "Thumb_Up + ILoveYou", "label": "YES WITH LOVE", "text": "Yes — with love"},
    {"id": "thumbdown_victory_no_fighting", "model": "Thumb_Down + Victory", "label": "NO MORE FIGHTING", "text": "No — let\u2019s have peace instead"},
    {"id": "thumbdown_iloveyou_no_love", "model": "Thumb_Down + ILoveYou", "label": "NO, BUT LOVE", "text": "No — but still with love"},
    {"id": "victory_iloveyou_peace_love", "model": "Victory + ILoveYou", "label": "PEACE AND LOVE", "text": "Peace and love"},
]


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = db()
    con.execute("""CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gesture TEXT NOT NULL,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        hands INTEGER NOT NULL DEFAULT 2,
        fusion_id TEXT,
        created_at TEXT NOT NULL
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gesture TEXT NOT NULL,
        expected TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        landmarks TEXT NOT NULL,
        frame_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )""")
    con.commit()
    con.close()


def migrate_db():
    con = db()
    cols = {r[1] for r in con.execute("PRAGMA table_info(messages)").fetchall()}
    if "hands" not in cols:
        con.execute("ALTER TABLE messages ADD COLUMN hands INTEGER NOT NULL DEFAULT 2")
    if "fusion_id" not in cols:
        con.execute("ALTER TABLE messages ADD COLUMN fusion_id TEXT")
    con.commit()
    con.close()


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def require_str(body, key, min_len=1, max_len=None, default=None, required=True):
    val = body.get(key, default)
    if val is None:
        if required:
            raise ApiError(422, f"'{key}' is required")
        return default
    if not isinstance(val, str):
        raise ApiError(422, f"'{key}' must be a string")
    if len(val) < min_len or (max_len and len(val) > max_len):
        raise ApiError(422, f"'{key}' length must be between {min_len} and {max_len}")
    return val


def require_float(body, key, ge=None, le=None, required=True, default=None):
    val = body.get(key, default)
    if val is None:
        if required:
            raise ApiError(422, f"'{key}' is required")
        return default
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise ApiError(422, f"'{key}' must be a number")
    val = float(val)
    if ge is not None and val < ge:
        raise ApiError(422, f"'{key}' must be >= {ge}")
    if le is not None and val > le:
        raise ApiError(422, f"'{key}' must be <= {le}")
    return val


def require_int(body, key, ge=None, le=None, default=None):
    val = body.get(key, default)
    if val is None:
        return default
    if not isinstance(val, int) or isinstance(val, bool):
        raise ApiError(422, f"'{key}' must be an integer")
    if ge is not None and val < ge:
        raise ApiError(422, f"'{key}' must be >= {ge}")
    if le is not None and val > le:
        raise ApiError(422, f"'{key}' must be <= {le}")
    return val


class Handler(BaseHTTPRequestHandler):
    server_version = "SignBridge/2.0"

    def log_message(self, fmt, *args):
        print(f"[signbridge] {self.address_string()} - {fmt % args}")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON body")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            if path == "/":
                self._send_json(200, {"name": "SignBridge", "version": "2.0.0", "status": "online",
                                       "architecture": "Python stdlib HTTP server + SQLite + on-device MediaPipe"})
            elif path == "/health":
                con = db(); con.execute("SELECT 1"); con.close()
                self._send_json(200, {"status": "healthy", "database": "ok",
                                       "timestamp": datetime.now(timezone.utc).isoformat()})
            elif path == "/api/v1/gestures":
                self._send_json(200, {"gestures": GESTURES})
            elif path == "/api/v1/messages":
                limit = max(1, min(int(query.get("limit", ["50"])[0]), 200))
                con = db()
                rows = con.execute("SELECT * FROM messages ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
                con.close()
                self._send_json(200, {"items": [dict(r) for r in rows]})
            elif path == "/api/v1/analytics":
                con = db()
                total = con.execute("SELECT COUNT(*) c FROM messages").fetchone()["c"]
                avg = con.execute("SELECT COALESCE(AVG(confidence),0) a FROM messages").fetchone()["a"]
                top = con.execute("SELECT gesture,COUNT(*) c FROM messages GROUP BY gesture ORDER BY c DESC LIMIT 5").fetchall()
                con.close()
                self._send_json(200, {"total_messages": total, "average_confidence": round(avg, 4),
                                       "top_gestures": [dict(x) for x in top]})
            else:
                self._send_json(404, {"detail": "Not found"})
        except ApiError as e:
            self._send_json(e.status, {"detail": e.detail})
        except Exception as e:
            self._send_json(500, {"detail": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._read_json_body()
            if path == "/api/v1/messages":
                gesture = require_str(body, "gesture", 1, 80)
                text = require_str(body, "text", 1, 500)
                confidence = require_float(body, "confidence", 0, 1)
                source = require_str(body, "source", 1, 30, default="camera", required=False)
                hands = require_int(body, "hands", 1, 2, default=2)
                fusion_id = require_str(body, "fusion_id", 0, 80, default=None, required=False)
                con = db()
                cur = con.execute(
                    "INSERT INTO messages(gesture,text,confidence,source,hands,fusion_id,created_at) VALUES(?,?,?,?,?,?,?)",
                    (gesture, text, confidence, source, hands, fusion_id, datetime.now(timezone.utc).isoformat()))
                con.commit()
                item = con.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
                con.close()
                self._send_json(201, dict(item))
            elif path == "/api/v1/recordings":
                label = require_str(body, "label", 1, 100)
                landmarks = require_str(body, "landmarks", 2, 500000)
                frame_count = require_int(
                    body,
                    "frame_count",
                    1,
                    10000,
                    default=0,
                    required=False
                )

                con = db()

                cur = con.execute(
                    """
                    INSERT INTO recordings
                    (label, landmarks, frame_count, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        label,
                        landmarks,
                        frame_count,
                        datetime.now(timezone.utc).isoformat()
                    )
                )

                con.commit()

                item = con.execute(
                    "SELECT * FROM recordings WHERE id=?",
                    (cur.lastrowid,)
                ).fetchone()

                con.close()

                self._send_json(201, dict(item))
                    
            elif path == "/api/v1/feedback":
                gesture = require_str(body, "gesture", 1)
                expected = require_str(body, "expected", 1)
                confidence = require_float(body, "confidence", 0, 1)
                con = db()
                con.execute("INSERT INTO feedback(gesture,expected,confidence,created_at) VALUES(?,?,?,?)",
                            (gesture, expected, confidence, datetime.now(timezone.utc).isoformat()))
                con.commit()
                con.close()
                self._send_json(201, {"saved": True})

            elif path == "/api/v1/recordings":
                limit = max(1, min(int(query.get("limit", ["100"])[0]), 500))
                con = db()
                rows = con.execute(
                    "SELECT * FROM recordings ORDER BY id DESC LIMIT ?",
                    (limit,)
                ).fetchall()
                con.close()

                self._send_json(200, {
                    "items": [dict(r) for r in rows]
                })

            else:
                self._send_json(404, {"detail": "Not found"})
        except ApiError as e:
            self._send_json(e.status, {"detail": e.detail})
        except Exception as e:
            self._send_json(500, {"detail": str(e)})

    def do_DELETE(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/v1/messages":
                con = db(); con.execute("DELETE FROM messages"); con.commit(); con.close()
                self._send_json(200, {"cleared": True})
            else:
                self._send_json(404, {"detail": "Not found"})
        except Exception as e:
            self._send_json(500, {"detail": str(e)})


def main(host="0.0.0.0", port=8000):
    init_db()
    migrate_db()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"SignBridge API running on http://{host}:{port}  (Python stdlib only — no pip install needed)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    main(port=port)
