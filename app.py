import csv
import io
import json
import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, Response, current_app, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix


ROOT_DIR = Path(__file__).resolve().parent
ALLOWED_STATUSES = {"new", "contacted", "survey", "design", "won", "lost"}
PUBLIC_FILES = {"styles.css", "script.js", "admin.css", "admin.js", "robots.txt", "sitemap.xml"}


class WindowLimiter:
    def __init__(self, limit, window_seconds):
        self.limit = limit
        self.window_seconds = window_seconds
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self.lock:
            bucket = self.events[key]
            while bucket and now - bucket[0] > self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            return True

    def clear(self, key):
        with self.lock:
            self.events.pop(key, None)


submission_limiter = WindowLimiter(limit=8, window_seconds=600)
login_limiter = WindowLimiter(limit=8, window_seconds=900)


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def create_app(test_config=None):
    app = Flask(__name__, static_folder=None)
    app_env = os.getenv("APP_ENV", "development").lower()
    secret_key = os.getenv("SECRET_KEY")
    admin_password = os.getenv("ADMIN_PASSWORD", "")

    if app_env == "production" and (not secret_key or not admin_password):
        raise RuntimeError("SECRET_KEY dan ADMIN_PASSWORD wajib dikonfigurasi pada environment production.")

    app.config.from_mapping(
        APP_ENV=app_env,
        SECRET_KEY=secret_key or secrets.token_hex(32),
        ADMIN_USERNAME=os.getenv("ADMIN_USERNAME", "admin"),
        ADMIN_PASSWORD=admin_password,
        DATABASE_PATH=os.getenv("DATABASE_PATH", str(ROOT_DIR / "data" / "bismillah.db")),
        MAX_CONTENT_LENGTH=32 * 1024,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=env_bool("SESSION_COOKIE_SECURE", app_env == "production"),
    )

    trusted_hosts = [host.strip() for host in os.getenv("TRUSTED_HOSTS", "").split(",") if host.strip()]
    if trusted_hosts:
        app.config["TRUSTED_HOSTS"] = trusted_hosts

    if test_config:
        app.config.update(test_config)

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    register_routes(app)
    register_headers(app)
    init_database(app)
    return app


def connect_database():
    database_path = Path(current_app.config["DATABASE_PATH"])
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def init_database(app):
    database_path = Path(app.config["DATABASE_PATH"])
    database_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(database_path, timeout=10) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                spaces_json TEXT NOT NULL,
                other_space TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'contacted', 'survey', 'design', 'won', 'lost')),
                admin_note TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_submissions_created_at
                ON submissions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_submissions_status
                ON submissions(status);
            """
        )


def client_key():
    return request.remote_addr or "unknown"


def clean_text(value, maximum):
    return str(value or "").strip()[:maximum]


def parse_submission_payload():
    if request.is_json:
        data = request.get_json(silent=True) or {}
        raw_spaces = data.get("spaces") or data.get("selectedSpaces") or []
        bot_field = data.get("bot-field", "")
    else:
        data = request.form
        raw_spaces = request.form.getlist("spaces") or request.form.get("selectedSpaces", "")
        bot_field = request.form.get("bot-field", "")

    if isinstance(raw_spaces, str):
        raw_spaces = [item.strip() for item in raw_spaces.split(",")]
    elif not isinstance(raw_spaces, list):
        raw_spaces = []

    spaces = []
    for item in raw_spaces:
        value = clean_text(item, 100)
        if value and value not in spaces:
            spaces.append(value)

    other_space = clean_text(data.get("otherSpace", ""), 160)
    if other_space and other_space not in spaces:
        spaces.append(other_space)

    return {
        "name": clean_text(data.get("name"), 100),
        "phone": clean_text(data.get("phone"), 30),
        "address": clean_text(data.get("address"), 180),
        "spaces": spaces[:20],
        "other_space": other_space,
        "message": clean_text(data.get("message"), 2000),
        "bot_field": clean_text(bot_field, 100),
    }


def validate_submission(payload):
    if len(payload["name"]) < 2:
        return "Nama minimal terdiri dari 2 karakter."

    phone_digits = "".join(character for character in payload["phone"] if character.isdigit())
    if not 9 <= len(phone_digits) <= 15:
        return "Nomor WhatsApp tidak valid."

    if len(payload["address"]) < 3:
        return "Kota atau kecamatan perlu diisi."

    if not payload["spaces"]:
        return "Pilih minimal satu jenis furnitur atau isi pilihan lain."

    return None


def row_to_submission(row):
    try:
        spaces = json.loads(row["spaces_json"])
    except (TypeError, json.JSONDecodeError):
        spaces = []

    return {
        "id": str(row["id"]),
        "createdAt": row["created_at"],
        "status": row["status"],
        "note": row["admin_note"],
        "lead": {
            "name": row["name"],
            "phone": row["phone"],
            "address": row["address"],
            "spaces": spaces,
            "message": row["message"],
        },
    }


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("admin_authenticated"):
            return jsonify({"message": "Sesi admin diperlukan."}), 401
        return view(*args, **kwargs)

    return wrapped


def submission_filters(status, search):
    clauses = []
    parameters = []

    if status in ALLOWED_STATUSES:
        clauses.append("status = ?")
        parameters.append(status)

    if search:
        query = f"%{search.lower()}%"
        clauses.append(
            "(LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(address) LIKE ? "
            "OR LOWER(spaces_json) LIKE ? OR LOWER(message) LIKE ?)"
        )
        parameters.extend([query] * 5)

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, parameters


def get_submissions(status="all", search="", limit=500):
    where, parameters = submission_filters(status, search)
    query = f"SELECT * FROM submissions{where} ORDER BY id DESC LIMIT ?"
    parameters.append(limit)

    with connect_database() as connection:
        return [row_to_submission(row) for row in connection.execute(query, parameters).fetchall()]


def get_stats():
    now = utc_now()
    today = now.replace(hour=0, minute=0, second=0)
    week_ago = now - timedelta(days=7)

    with connect_database() as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count
            FROM submissions
            """,
            (today.isoformat(), week_ago.isoformat()),
        ).fetchone()

    return {
        "total": row["total"] or 0,
        "today": row["today"] or 0,
        "week": row["week"] or 0,
        "new": row["new_count"] or 0,
    }


def register_routes(app):
    @app.get("/")
    def index_page():
        return send_from_directory(ROOT_DIR, "index.html")

    @app.get("/admin")
    @app.get("/admin.html")
    def admin_page():
        return send_from_directory(ROOT_DIR, "admin.html")

    @app.get("/assets/<path:filename>")
    def asset_file(filename):
        return send_from_directory(ROOT_DIR / "assets", filename)

    @app.get("/<path:filename>")
    def public_file(filename):
        if filename not in PUBLIC_FILES:
            return jsonify({"message": "Halaman tidak ditemukan."}), 404
        return send_from_directory(ROOT_DIR, filename)

    @app.get("/healthz")
    def health_check():
        with connect_database() as connection:
            connection.execute("SELECT 1").fetchone()
        return jsonify({"status": "ok", "database": "sqlite"})

    @app.post("/api/submissions")
    def create_submission():
        if not submission_limiter.allow(client_key()):
            return jsonify({"message": "Terlalu banyak permintaan. Silakan coba lagi beberapa menit."}), 429

        payload = parse_submission_payload()
        if payload["bot_field"]:
            return jsonify({"saved": True}), 201

        validation_error = validate_submission(payload)
        if validation_error:
            return jsonify({"message": validation_error}), 400

        created_at = utc_now().isoformat()
        with connect_database() as connection:
            cursor = connection.execute(
                """
                INSERT INTO submissions
                    (created_at, name, phone, address, spaces_json, other_space, message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    payload["name"],
                    payload["phone"],
                    payload["address"],
                    json.dumps(payload["spaces"], ensure_ascii=True),
                    payload["other_space"],
                    payload["message"],
                ),
            )
            submission_id = cursor.lastrowid

        return jsonify({"saved": True, "id": submission_id, "createdAt": created_at}), 201

    @app.get("/api/admin/session")
    def admin_session():
        if not session.get("admin_authenticated"):
            return jsonify({"authenticated": False}), 401
        return jsonify({"authenticated": True, "username": session.get("admin_username")})

    @app.post("/api/admin/login")
    def admin_login():
        key = client_key()
        if not login_limiter.allow(key):
            return jsonify({"message": "Terlalu banyak percobaan login. Coba kembali dalam 15 menit."}), 429

        payload = request.get_json(silent=True) or {}
        username = clean_text(payload.get("username"), 100)
        password = str(payload.get("password") or "")
        valid_username = secrets.compare_digest(username, current_app.config["ADMIN_USERNAME"])
        valid_password = bool(current_app.config["ADMIN_PASSWORD"]) and secrets.compare_digest(
            password, current_app.config["ADMIN_PASSWORD"]
        )

        if not (valid_username and valid_password):
            return jsonify({"message": "Username atau password tidak sesuai."}), 401

        login_limiter.clear(key)
        session.clear()
        session.permanent = True
        session["admin_authenticated"] = True
        session["admin_username"] = username
        return jsonify({"authenticated": True, "username": username})

    @app.post("/api/admin/logout")
    @admin_required
    def admin_logout():
        session.clear()
        return jsonify({"authenticated": False})

    @app.get("/api/admin/submissions")
    @admin_required
    def admin_submissions():
        status = request.args.get("status", "all")
        search = clean_text(request.args.get("search", ""), 120)
        if status != "all" and status not in ALLOWED_STATUSES:
            return jsonify({"message": "Filter status tidak valid."}), 400

        return jsonify(
            {
                "submissions": get_submissions(status=status, search=search),
                "stats": get_stats(),
                "generatedAt": utc_now().isoformat(),
            }
        )

    @app.patch("/api/admin/submissions/<int:submission_id>")
    @admin_required
    def update_submission(submission_id):
        payload = request.get_json(silent=True) or {}
        status = payload.get("status")
        note = clean_text(payload.get("note", ""), 4000)

        if status not in ALLOWED_STATUSES:
            return jsonify({"message": "Status follow-up tidak valid."}), 400

        with connect_database() as connection:
            cursor = connection.execute(
                "UPDATE submissions SET status = ?, admin_note = ? WHERE id = ?",
                (status, note, submission_id),
            )
            if cursor.rowcount == 0:
                return jsonify({"message": "Data customer tidak ditemukan."}), 404
            row = connection.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()

        return jsonify({"submission": row_to_submission(row)})

    @app.get("/api/admin/export.csv")
    @admin_required
    def export_submissions():
        status = request.args.get("status", "all")
        search = clean_text(request.args.get("search", ""), 120)
        rows = get_submissions(status=status, search=search, limit=5000)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["tanggal", "nama", "whatsapp", "kota_kecamatan", "produk", "kebutuhan", "status", "catatan"])

        for item in rows:
            lead = item["lead"]
            writer.writerow(
                [
                    item["createdAt"],
                    lead["name"],
                    lead["phone"],
                    lead["address"],
                    ", ".join(lead["spaces"]),
                    lead["message"],
                    item["status"],
                    item["note"],
                ]
            )

        filename = f"leads-bismillah-interior-{utc_now().date().isoformat()}.csv"
        return Response(
            "\ufeff" + output.getvalue(),
            mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.errorhandler(413)
    def payload_too_large(_error):
        return jsonify({"message": "Data yang dikirim terlalu besar."}), 413


def register_headers(app):
    @app.after_request
    def apply_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://unpkg.com; "
            "style-src 'self'; "
            "img-src 'self' data: https://images.pexels.com; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )

        if request.path.startswith("/admin") or request.path.startswith("/api/"):
            response.headers["X-Robots-Tag"] = "noindex, nofollow"

        if request.path.startswith("/api/admin"):
            response.headers["Cache-Control"] = "no-store"
        elif request.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=604800"

        return response


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=8000, debug=False)
