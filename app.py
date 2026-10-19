"""PulseChat — multi-room chat app for CCA-2 CI/CD demo.

Single-container Flask app (no external DB) so Jenkins -> Docker Hub ->
Minikube stays trivially reproducible. SQLite file lives inside the
container; Deployment uses replicas: 1.
"""
import os
import sqlite3
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone

from flask import Flask, g, jsonify, render_template, request

APP_VERSION = os.environ.get("APP_VERSION", "v1.0-local")
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "chat.db"))
DEFAULT_ROOMS = ["general", "devops", "random"]
MAX_TEXT_LEN = 500
MAX_NAME_LEN = 30
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128
PBKDF2_ITERATIONS = 210_000
USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{3,30}$")

app = Flask(__name__)


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id)")
    conn.commit()
    conn.close()


init_db()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password, salt=None):
    effective_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        effective_salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${effective_salt}${digest}"


def _verify_password(password, password_hash):
    try:
        algorithm, iterations, salt, stored_digest = password_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    ).hex()
    return hmac.compare_digest(computed, stored_digest)


def _normalize_username(raw_username):
    username = str(raw_username or "").strip().lower()
    if not USERNAME_PATTERN.match(username):
        return None
    return username


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_token(user_id):
    token = secrets.token_urlsafe(32)
    db = get_db()
    db.execute(
        "INSERT INTO auth_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)",
        (user_id, _hash_token(token), _now_iso()),
    )
    db.commit()
    return token


def _auth_error(message="authentication required"):
    return jsonify(error=message), 401


def _require_auth():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, _auth_error()
    token = auth_header[len("Bearer "):].strip()
    if not token:
        return None, _auth_error()

    db = get_db()
    row = db.execute(
        """
        SELECT u.id, u.username, t.id AS token_id
        FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?
        """,
        (_hash_token(token),),
    ).fetchone()
    if row is None:
        return None, _auth_error("invalid or expired token")
    return dict(row), None


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


@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = _normalize_username(data.get("username", ""))
    password = str(data.get("password", ""))

    if username is None:
        return jsonify(error="username must be 3-30 chars using letters, numbers, _, ., -"), 400
    if not (MIN_PASSWORD_LEN <= len(password) <= MAX_PASSWORD_LEN):
        return jsonify(error=f"password must be {MIN_PASSWORD_LEN}-{MAX_PASSWORD_LEN} chars"), 400

    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, _hash_password(password), _now_iso()),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="username already exists"), 409

    token = _issue_token(cur.lastrowid)
    return jsonify(token=token, user={"id": cur.lastrowid, "username": username}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = _normalize_username(data.get("username", ""))
    password = str(data.get("password", ""))
    if username is None or not password:
        return jsonify(error="username and password are required"), 400

    db = get_db()
    row = db.execute(
        "SELECT id, username, password_hash FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None or not _verify_password(password, row["password_hash"]):
        return jsonify(error="invalid credentials"), 401

    token = _issue_token(row["id"])
    return jsonify(token=token, user={"id": row["id"], "username": row["username"]})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    user, err = _require_auth()
    if err:
        return err
    db = get_db()
    db.execute("DELETE FROM auth_tokens WHERE id = ?", (user["token_id"],))
    db.commit()
    return jsonify(ok=True)


@app.route("/api/auth/me", methods=["GET"])
def me():
    user, err = _require_auth()
    if err:
        return err
    return jsonify(user={"id": user["id"], "username": user["username"]})


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
    user, err = _require_auth()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    username = user["username"]
    room = str(data.get("room", "general")).strip()[:MAX_NAME_LEN] or "general"
    text = str(data.get("text", "")).strip()

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
