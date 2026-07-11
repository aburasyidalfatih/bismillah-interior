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
PROJECT_STATUSES = {
    "follow_up",
    "consultation",
    "survey",
    "design_quote",
    "design",
    "awaiting_dp",
    "dp_received",
    "production",
    "installation",
    "completed",
    "on_hold",
    "lost",
}
PROJECT_ITEM_STATUSES = {"planning", "approved", "production", "ready", "installed"}
PAYMENT_TYPES = {"design_fee", "dp", "installment", "final", "other"}
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
        connection.execute("PRAGMA foreign_keys = ON")
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

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL UNIQUE,
                code TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'follow_up'
                    CHECK (status IN (
                        'follow_up', 'consultation', 'survey', 'design_quote', 'design',
                        'awaiting_dp', 'dp_received', 'production', 'installation',
                        'completed', 'on_hold', 'lost'
                    )),
                project_value INTEGER NOT NULL DEFAULT 0 CHECK (project_value >= 0),
                design_fee INTEGER NOT NULL DEFAULT 0 CHECK (design_fee >= 0),
                consultation_date TEXT NOT NULL DEFAULT '',
                survey_date TEXT NOT NULL DEFAULT '',
                production_start_date TEXT NOT NULL DEFAULT '',
                installation_date TEXT NOT NULL DEFAULT '',
                target_completion_date TEXT NOT NULL DEFAULT '',
                completed_at TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
            CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);

            CREATE TABLE IF NOT EXISTS project_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
                dimensions TEXT NOT NULL DEFAULT '',
                material TEXT NOT NULL DEFAULT '',
                price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
                status TEXT NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'approved', 'production', 'ready', 'installed')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_project_items_project ON project_items(project_id);

            CREATE TABLE IF NOT EXISTS project_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                payment_type TEXT NOT NULL
                    CHECK (payment_type IN ('design_fee', 'dp', 'installment', 'final', 'other')),
                amount INTEGER NOT NULL CHECK (amount > 0),
                paid_at TEXT NOT NULL,
                method TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_project_payments_project ON project_payments(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_payments_paid_at ON project_payments(paid_at DESC);

            CREATE TABLE IF NOT EXISTS project_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                from_status TEXT NOT NULL DEFAULT '',
                to_status TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                actor TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_project_events_project
                ON project_events(project_id, created_at DESC);
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)",
            (utc_now().isoformat(),),
        )


def client_key():
    return request.remote_addr or "unknown"


def clean_text(value, maximum):
    return str(value or "").strip()[:maximum]


def clean_date(value):
    date_value = clean_text(value, 10)
    if not date_value:
        return ""
    try:
        datetime.strptime(date_value, "%Y-%m-%d")
    except ValueError:
        return None
    return date_value


def clean_money(value, maximum=100_000_000_000):
    if value in (None, ""):
        return 0
    try:
        amount = int(value)
    except (TypeError, ValueError):
        return None
    if amount < 0 or amount > maximum:
        return None
    return amount


def row_value(row, key, default=None):
    return row[key] if key in row.keys() else default


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

    project_id = row_value(row, "project_id")
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
        "project": (
            {
                "id": str(project_id),
                "code": row_value(row, "project_code", ""),
                "status": row_value(row, "project_status", "follow_up"),
            }
            if project_id
            else None
        ),
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
        clauses.append("s.status = ?")
        parameters.append(status)

    if search:
        query = f"%{search.lower()}%"
        clauses.append(
            "(LOWER(s.name) LIKE ? OR LOWER(s.phone) LIKE ? OR LOWER(s.address) LIKE ? "
            "OR LOWER(s.spaces_json) LIKE ? OR LOWER(s.message) LIKE ?)"
        )
        parameters.extend([query] * 5)

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, parameters


def get_submissions(status="all", search="", limit=500):
    where, parameters = submission_filters(status, search)
    query = f"""
        SELECT s.*, p.id AS project_id, p.code AS project_code, p.status AS project_status
        FROM submissions s
        LEFT JOIN projects p ON p.submission_id = s.id
        {where}
        ORDER BY s.id DESC
        LIMIT ?
    """
    parameters.append(limit)

    with connect_database() as connection:
        return [row_to_submission(row) for row in connection.execute(query, parameters).fetchall()]


def get_submission(connection, submission_id):
    return connection.execute(
        """
        SELECT s.*, p.id AS project_id, p.code AS project_code, p.status AS project_status
        FROM submissions s
        LEFT JOIN projects p ON p.submission_id = s.id
        WHERE s.id = ?
        """,
        (submission_id,),
    ).fetchone()


def project_status_from_submission(status):
    return {
        "new": "follow_up",
        "contacted": "consultation",
        "survey": "survey",
        "design": "design",
        "won": "awaiting_dp",
        "lost": "lost",
    }.get(status, "follow_up")


def next_project_code(connection):
    prefix = f"BI-{utc_now().year}-"
    row = connection.execute(
        "SELECT code FROM projects WHERE code LIKE ? ORDER BY code DESC LIMIT 1",
        (f"{prefix}%",),
    ).fetchone()
    sequence = 1
    if row:
        try:
            sequence = int(row["code"].rsplit("-", 1)[-1]) + 1
        except (TypeError, ValueError):
            sequence = connection.execute(
                "SELECT COUNT(*) + 1 AS next_sequence FROM projects WHERE code LIKE ?",
                (f"{prefix}%",),
            ).fetchone()["next_sequence"]
    return f"{prefix}{sequence:04d}"


def add_project_event(connection, project_id, event_type, note="", from_status="", to_status=""):
    connection.execute(
        """
        INSERT INTO project_events
            (project_id, event_type, from_status, to_status, note, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            event_type,
            from_status,
            to_status,
            clean_text(note, 2000),
            clean_text(session.get("admin_username", "admin"), 100),
            utc_now().isoformat(),
        ),
    )


def touch_project(connection, project_id):
    connection.execute(
        "UPDATE projects SET updated_at = ? WHERE id = ?",
        (utc_now().isoformat(), project_id),
    )


def row_to_project(connection, row):
    items = connection.execute(
        "SELECT * FROM project_items WHERE project_id = ? ORDER BY id",
        (row["id"],),
    ).fetchall()
    payments = connection.execute(
        "SELECT * FROM project_payments WHERE project_id = ? ORDER BY paid_at DESC, id DESC",
        (row["id"],),
    ).fetchall()
    events = connection.execute(
        "SELECT * FROM project_events WHERE project_id = ? ORDER BY id DESC LIMIT 100",
        (row["id"],),
    ).fetchall()
    total_paid = sum(payment["amount"] for payment in payments)
    balance = max(row["project_value"] - total_paid, 0)

    try:
        spaces = json.loads(row["spaces_json"])
    except (TypeError, json.JSONDecodeError):
        spaces = []

    return {
        "id": str(row["id"]),
        "submissionId": str(row["submission_id"]),
        "code": row["code"],
        "title": row["title"],
        "status": row["status"],
        "notes": row["notes"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "completedAt": row["completed_at"],
        "customer": {
            "name": row["customer_name"],
            "phone": row["customer_phone"],
            "address": row["customer_address"],
            "spaces": spaces,
            "message": row["customer_message"],
        },
        "schedule": {
            "consultationDate": row["consultation_date"],
            "surveyDate": row["survey_date"],
            "productionStartDate": row["production_start_date"],
            "installationDate": row["installation_date"],
            "targetCompletionDate": row["target_completion_date"],
        },
        "financial": {
            "projectValue": row["project_value"],
            "designFee": row["design_fee"],
            "paid": total_paid,
            "balance": balance,
        },
        "items": [
            {
                "id": str(item["id"]),
                "name": item["name"],
                "quantity": item["quantity"],
                "dimensions": item["dimensions"],
                "material": item["material"],
                "price": item["price"],
                "status": item["status"],
            }
            for item in items
        ],
        "payments": [
            {
                "id": str(payment["id"]),
                "type": payment["payment_type"],
                "amount": payment["amount"],
                "paidAt": payment["paid_at"],
                "method": payment["method"],
                "note": payment["note"],
            }
            for payment in payments
        ],
        "events": [
            {
                "id": str(event["id"]),
                "type": event["event_type"],
                "fromStatus": event["from_status"],
                "toStatus": event["to_status"],
                "note": event["note"],
                "actor": event["actor"],
                "createdAt": event["created_at"],
            }
            for event in events
        ],
    }


def project_filters(status, search):
    clauses = []
    parameters = []
    if status in PROJECT_STATUSES:
        clauses.append("p.status = ?")
        parameters.append(status)
    if search:
        query = f"%{search.lower()}%"
        clauses.append(
            "(LOWER(p.code) LIKE ? OR LOWER(p.title) LIKE ? OR LOWER(s.name) LIKE ? "
            "OR LOWER(s.phone) LIKE ? OR LOWER(s.address) LIKE ?)"
        )
        parameters.extend([query] * 5)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, parameters


PROJECT_SELECT = """
    SELECT
        p.*,
        s.name AS customer_name,
        s.phone AS customer_phone,
        s.address AS customer_address,
        s.spaces_json,
        s.message AS customer_message
    FROM projects p
    JOIN submissions s ON s.id = p.submission_id
"""


def get_project(connection, project_id):
    row = connection.execute(f"{PROJECT_SELECT} WHERE p.id = ?", (project_id,)).fetchone()
    return row_to_project(connection, row) if row else None


def get_projects(status="all", search="", limit=500):
    where, parameters = project_filters(status, search)
    parameters.append(limit)
    with connect_database() as connection:
        rows = connection.execute(
            f"{PROJECT_SELECT}{where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?",
            parameters,
        ).fetchall()
        return [row_to_project(connection, row) for row in rows]


def get_project_stats():
    active_statuses = tuple(PROJECT_STATUSES - {"completed", "lost"})
    placeholders = ",".join("?" for _ in active_statuses)
    with connect_database() as connection:
        row = connection.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ({placeholders}) THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'production' THEN 1 ELSE 0 END) AS production,
                SUM(CASE WHEN status = 'installation' THEN 1 ELSE 0 END) AS installation,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                COALESCE(SUM(project_value), 0) AS total_value
            FROM projects
            """,
            active_statuses,
        ).fetchone()
        paid = connection.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM project_payments").fetchone()["total"]

    return {
        "total": row["total"] or 0,
        "active": row["active"] or 0,
        "production": row["production"] or 0,
        "installation": row["installation"] or 0,
        "completed": row["completed"] or 0,
        "totalValue": row["total_value"] or 0,
        "paid": paid or 0,
        "outstanding": max((row["total_value"] or 0) - (paid or 0), 0),
    }


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

    @app.get("/api/admin/projects")
    @admin_required
    def admin_projects():
        status = request.args.get("status", "all")
        search = clean_text(request.args.get("search", ""), 120)
        if status != "all" and status not in PROJECT_STATUSES:
            return jsonify({"message": "Filter tahap project tidak valid."}), 400

        return jsonify(
            {
                "projects": get_projects(status=status, search=search),
                "stats": get_project_stats(),
                "generatedAt": utc_now().isoformat(),
            }
        )

    @app.post("/api/admin/projects")
    @admin_required
    def create_project():
        payload = request.get_json(silent=True) or {}
        try:
            submission_id = int(payload.get("submissionId"))
        except (TypeError, ValueError):
            return jsonify({"message": "Lead untuk project tidak valid."}), 400

        with connect_database() as connection:
            connection.execute("BEGIN IMMEDIATE")
            submission = connection.execute(
                "SELECT * FROM submissions WHERE id = ?",
                (submission_id,),
            ).fetchone()
            if not submission:
                return jsonify({"message": "Lead tidak ditemukan."}), 404

            existing = connection.execute(
                "SELECT id FROM projects WHERE submission_id = ?",
                (submission_id,),
            ).fetchone()
            if existing:
                return jsonify({"message": "Lead ini sudah memiliki project."}), 409

            try:
                spaces = json.loads(submission["spaces_json"])
            except (TypeError, json.JSONDecodeError):
                spaces = []

            default_title = ", ".join(spaces[:2]) or f"Project {submission['name']}"
            title = clean_text(payload.get("title") or default_title, 160)
            if len(title) < 2:
                return jsonify({"message": "Nama project minimal 2 karakter."}), 400

            now = utc_now().isoformat()
            status = project_status_from_submission(submission["status"])
            code = next_project_code(connection)
            cursor = connection.execute(
                """
                INSERT INTO projects
                    (submission_id, code, title, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (submission_id, code, title, status, now, now),
            )
            project_id = cursor.lastrowid

            for item_name in spaces or ["Furniture custom"]:
                connection.execute(
                    """
                    INSERT INTO project_items
                        (project_id, name, quantity, created_at, updated_at)
                    VALUES (?, ?, 1, ?, ?)
                    """,
                    (project_id, clean_text(item_name, 160), now, now),
                )

            add_project_event(
                connection,
                project_id,
                "project_created",
                f"Project dibuat dari lead {submission['name']}.",
                to_status=status,
            )
            project = get_project(connection, project_id)

        return jsonify({"project": project}), 201

    @app.get("/api/admin/projects/<int:project_id>")
    @admin_required
    def admin_project(project_id):
        with connect_database() as connection:
            project = get_project(connection, project_id)
        if not project:
            return jsonify({"message": "Project tidak ditemukan."}), 404
        return jsonify({"project": project})

    @app.patch("/api/admin/projects/<int:project_id>")
    @admin_required
    def update_project(project_id):
        payload = request.get_json(silent=True) or {}
        with connect_database() as connection:
            current = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not current:
                return jsonify({"message": "Project tidak ditemukan."}), 404

            status = payload.get("status", current["status"])
            if status not in PROJECT_STATUSES:
                return jsonify({"message": "Tahap project tidak valid."}), 400

            title = clean_text(payload.get("title", current["title"]), 160)
            notes = clean_text(payload.get("notes", current["notes"]), 6000)
            project_value = clean_money(payload.get("projectValue", current["project_value"]))
            design_fee = clean_money(payload.get("designFee", current["design_fee"]))
            if len(title) < 2:
                return jsonify({"message": "Nama project minimal 2 karakter."}), 400
            if project_value is None or design_fee is None:
                return jsonify({"message": "Nilai project atau biaya desain tidak valid."}), 400

            schedule = payload.get("schedule") or {}
            date_values = {
                "consultation_date": clean_date(schedule.get("consultationDate", current["consultation_date"])),
                "survey_date": clean_date(schedule.get("surveyDate", current["survey_date"])),
                "production_start_date": clean_date(
                    schedule.get("productionStartDate", current["production_start_date"])
                ),
                "installation_date": clean_date(schedule.get("installationDate", current["installation_date"])),
                "target_completion_date": clean_date(
                    schedule.get("targetCompletionDate", current["target_completion_date"])
                ),
            }
            if any(value is None for value in date_values.values()):
                return jsonify({"message": "Format tanggal project tidak valid."}), 400

            now = utc_now().isoformat()
            completed_at = current["completed_at"]
            if status == "completed" and not completed_at:
                completed_at = now
            elif status != "completed":
                completed_at = ""

            connection.execute(
                """
                UPDATE projects
                SET title = ?, status = ?, project_value = ?, design_fee = ?,
                    consultation_date = ?, survey_date = ?, production_start_date = ?,
                    installation_date = ?, target_completion_date = ?, completed_at = ?,
                    notes = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    title,
                    status,
                    project_value,
                    design_fee,
                    date_values["consultation_date"],
                    date_values["survey_date"],
                    date_values["production_start_date"],
                    date_values["installation_date"],
                    date_values["target_completion_date"],
                    completed_at,
                    notes,
                    now,
                    project_id,
                ),
            )

            if status != current["status"]:
                add_project_event(
                    connection,
                    project_id,
                    "status_changed",
                    clean_text(payload.get("statusNote", ""), 1000),
                    from_status=current["status"],
                    to_status=status,
                )
            else:
                add_project_event(connection, project_id, "project_updated", "Detail project diperbarui.")
            project = get_project(connection, project_id)

        return jsonify({"project": project})

    @app.post("/api/admin/projects/<int:project_id>/items")
    @admin_required
    def create_project_item(project_id):
        payload = request.get_json(silent=True) or {}
        name = clean_text(payload.get("name"), 160)
        dimensions = clean_text(payload.get("dimensions"), 160)
        material = clean_text(payload.get("material"), 160)
        status = payload.get("status", "planning")
        price = clean_money(payload.get("price"))
        try:
            quantity = int(payload.get("quantity", 1))
        except (TypeError, ValueError):
            quantity = 0

        if len(name) < 2 or not 1 <= quantity <= 1000 or price is None or status not in PROJECT_ITEM_STATUSES:
            return jsonify({"message": "Data item furniture tidak valid."}), 400

        with connect_database() as connection:
            if not connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone():
                return jsonify({"message": "Project tidak ditemukan."}), 404
            now = utc_now().isoformat()
            connection.execute(
                """
                INSERT INTO project_items
                    (project_id, name, quantity, dimensions, material, price, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, name, quantity, dimensions, material, price, status, now, now),
            )
            touch_project(connection, project_id)
            add_project_event(connection, project_id, "item_added", f"Item ditambahkan: {name}.")
            project = get_project(connection, project_id)
        return jsonify({"project": project}), 201

    @app.patch("/api/admin/projects/<int:project_id>/items/<int:item_id>")
    @admin_required
    def update_project_item(project_id, item_id):
        payload = request.get_json(silent=True) or {}
        with connect_database() as connection:
            current = connection.execute(
                "SELECT * FROM project_items WHERE id = ? AND project_id = ?",
                (item_id, project_id),
            ).fetchone()
            if not current:
                return jsonify({"message": "Item furniture tidak ditemukan."}), 404

            name = clean_text(payload.get("name", current["name"]), 160)
            dimensions = clean_text(payload.get("dimensions", current["dimensions"]), 160)
            material = clean_text(payload.get("material", current["material"]), 160)
            status = payload.get("status", current["status"])
            price = clean_money(payload.get("price", current["price"]))
            try:
                quantity = int(payload.get("quantity", current["quantity"]))
            except (TypeError, ValueError):
                quantity = 0
            if len(name) < 2 or not 1 <= quantity <= 1000 or price is None or status not in PROJECT_ITEM_STATUSES:
                return jsonify({"message": "Data item furniture tidak valid."}), 400

            connection.execute(
                """
                UPDATE project_items
                SET name = ?, quantity = ?, dimensions = ?, material = ?, price = ?, status = ?, updated_at = ?
                WHERE id = ? AND project_id = ?
                """,
                (name, quantity, dimensions, material, price, status, utc_now().isoformat(), item_id, project_id),
            )
            touch_project(connection, project_id)
            add_project_event(connection, project_id, "item_updated", f"Item diperbarui: {name}.")
            project = get_project(connection, project_id)
        return jsonify({"project": project})

    @app.delete("/api/admin/projects/<int:project_id>/items/<int:item_id>")
    @admin_required
    def delete_project_item(project_id, item_id):
        with connect_database() as connection:
            item = connection.execute(
                "SELECT name FROM project_items WHERE id = ? AND project_id = ?",
                (item_id, project_id),
            ).fetchone()
            if not item:
                return jsonify({"message": "Item furniture tidak ditemukan."}), 404
            connection.execute("DELETE FROM project_items WHERE id = ? AND project_id = ?", (item_id, project_id))
            touch_project(connection, project_id)
            add_project_event(connection, project_id, "item_deleted", f"Item dihapus: {item['name']}.")
            project = get_project(connection, project_id)
        return jsonify({"project": project})

    @app.post("/api/admin/projects/<int:project_id>/payments")
    @admin_required
    def create_project_payment(project_id):
        payload = request.get_json(silent=True) or {}
        payment_type = payload.get("type", "other")
        amount = clean_money(payload.get("amount"))
        paid_at = clean_date(payload.get("paidAt") or utc_now().date().isoformat())
        method = clean_text(payload.get("method"), 80)
        note = clean_text(payload.get("note"), 500)
        if payment_type not in PAYMENT_TYPES or not amount or paid_at is None:
            return jsonify({"message": "Data pembayaran tidak valid."}), 400

        with connect_database() as connection:
            if not connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone():
                return jsonify({"message": "Project tidak ditemukan."}), 404
            connection.execute(
                """
                INSERT INTO project_payments
                    (project_id, payment_type, amount, paid_at, method, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, payment_type, amount, paid_at, method, note, utc_now().isoformat()),
            )
            touch_project(connection, project_id)
            add_project_event(connection, project_id, "payment_added", f"Pembayaran dicatat: Rp{amount:,}.")
            project = get_project(connection, project_id)
        return jsonify({"project": project}), 201

    @app.delete("/api/admin/projects/<int:project_id>/payments/<int:payment_id>")
    @admin_required
    def delete_project_payment(project_id, payment_id):
        with connect_database() as connection:
            payment = connection.execute(
                "SELECT amount FROM project_payments WHERE id = ? AND project_id = ?",
                (payment_id, project_id),
            ).fetchone()
            if not payment:
                return jsonify({"message": "Pembayaran tidak ditemukan."}), 404
            connection.execute(
                "DELETE FROM project_payments WHERE id = ? AND project_id = ?",
                (payment_id, project_id),
            )
            touch_project(connection, project_id)
            add_project_event(
                connection,
                project_id,
                "payment_deleted",
                f"Pembayaran Rp{payment['amount']:,} dihapus.",
            )
            project = get_project(connection, project_id)
        return jsonify({"project": project})

    @app.post("/api/admin/projects/<int:project_id>/events")
    @admin_required
    def create_project_note(project_id):
        payload = request.get_json(silent=True) or {}
        note = clean_text(payload.get("note"), 2000)
        if len(note) < 2:
            return jsonify({"message": "Catatan aktivitas masih kosong."}), 400
        with connect_database() as connection:
            if not connection.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone():
                return jsonify({"message": "Project tidak ditemukan."}), 404
            touch_project(connection, project_id)
            add_project_event(connection, project_id, "note_added", note)
            project = get_project(connection, project_id)
        return jsonify({"project": project}), 201

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
            row = get_submission(connection, submission_id)

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

    @app.get("/api/admin/projects-export.csv")
    @admin_required
    def export_projects():
        status = request.args.get("status", "all")
        search = clean_text(request.args.get("search", ""), 120)
        if status != "all" and status not in PROJECT_STATUSES:
            return jsonify({"message": "Filter tahap project tidak valid."}), 400
        rows = get_projects(status=status, search=search, limit=5000)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "kode_project",
                "customer",
                "whatsapp",
                "alamat",
                "project",
                "tahap",
                "nilai_project",
                "sudah_dibayar",
                "sisa_tagihan",
                "target_selesai",
                "item_furniture",
                "catatan",
            ]
        )
        for project in rows:
            writer.writerow(
                [
                    project["code"],
                    project["customer"]["name"],
                    project["customer"]["phone"],
                    project["customer"]["address"],
                    project["title"],
                    project["status"],
                    project["financial"]["projectValue"],
                    project["financial"]["paid"],
                    project["financial"]["balance"],
                    project["schedule"]["targetCompletionDate"],
                    ", ".join(item["name"] for item in project["items"]),
                    project["notes"],
                ]
            )

        filename = f"projects-bismillah-interior-{utc_now().date().isoformat()}.csv"
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
