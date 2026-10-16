"""PulseChat — multi-room chat app for CCA-2 CI/CD demo.

Single-container Flask app (no external DB) so Jenkins -> Docker Hub ->
Minikube stays trivially reproducible. SQLite file lives inside the
container; Deployment uses replicas: 1.
"""
import os
import sqlite3
from datetime import datetime, timezone

from flask import Flask, g, jsonify, render_template, request

APP_VERSION = os.environ.get("APP_VERSION", "v1.0-local")
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "chat.db"))
DEFAULT_ROOMS = ["general", "devops", "random"]
MAX_TEXT_LEN = 500
MAX_NAME_LEN = 30

app = Flask(__name__)


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            room TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_room_id ON messages(room, id)")
    conn.commit()
    conn.close()


init_db()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


@app.route("/")
def index():
    return render_template("index.html", app_version=APP_VERSION)


@app.route("/health")
def health():
    try:
        db = get_db()
        db.execute("SELECT 1").fetchone()
        return jsonify(status="ok", version=APP_VERSION), 200
    except Exception as exc:  # pragma: no cover
        return jsonify(status="error", detail=str(exc)), 500


@app.route("/api/version")
def version():
    return jsonify(version=APP_VERSION)


@app.route("/api/rooms")
def rooms():
    db = get_db()
    rows = db.execute("SELECT DISTINCT room FROM messages").fetchall()
    seen = [r["room"] for r in rows]
    ordered = DEFAULT_ROOMS + [r for r in seen if r not in DEFAULT_ROOMS]
    return jsonify(rooms=ordered)


@app.route("/api/messages", methods=["GET"])
def list_messages():
    room = request.args.get("room", "general").strip()[:MAX_NAME_LEN] or "general"
    try:
        limit = min(int(request.args.get("limit", "50")), 200)
    except ValueError:
        limit = 50
    db = get_db()
    rows = db.execute(
        "SELECT id, username, room, text, created_at FROM messages "
        "WHERE room = ? ORDER BY id DESC LIMIT ?",
        (room, limit),
    ).fetchall()
    msgs = [dict(r) for r in reversed(rows)]
    return jsonify(room=room, messages=msgs)


@app.route("/api/messages", methods=["POST"])
def post_message():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()[:MAX_NAME_LEN]
    room = str(data.get("room", "general")).strip()[:MAX_NAME_LEN] or "general"
    text = str(data.get("text", "")).strip()

    if not username:
        return jsonify(error="username is required"), 400
    if not text:
        return jsonify(error="text is required"), 400
    if len(text) > MAX_TEXT_LEN:
        return jsonify(error=f"text must be <= {MAX_TEXT_LEN} chars"), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO messages (username, room, text, created_at) VALUES (?, ?, ?, ?)",
        (username, room, text, _now_iso()),
    )
    db.commit()
    row = db.execute(
        "SELECT id, username, room, text, created_at FROM messages WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return jsonify(dict(row)), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
