from pathlib import Path
import sqlite3

import pytest

from app import create_app


@pytest.fixture()
def app(tmp_path: Path):
    return create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD": "strong-test-password",
            "DATABASE_PATH": str(tmp_path / "test.db"),
            "SESSION_COOKIE_SECURE": False,
            "TRUSTED_HOSTS": None,
        }
    )


@pytest.fixture()
def client(app):
    return app.test_client()


def sample_submission():
    return {
        "name": "Andi Saputra",
        "phone": "081234567890",
        "address": "Payakumbuh Barat",
        "spaces": ["Kitchen set HPL", "Mini bar / pantry counter"],
        "otherSpace": "",
        "message": "Ukuran awal sekitar tiga meter.",
    }


def login(client):
    return client.post(
        "/api/admin/login",
        json={"username": "admin", "password": "strong-test-password"},
    )


def test_health_check_uses_sqlite(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.get_json() == {"database": "sqlite", "status": "ok"}


def test_submission_is_saved_and_visible_to_admin(client):
    response = client.post("/api/submissions", json=sample_submission())
    assert response.status_code == 201
    assert response.get_json()["saved"] is True

    assert login(client).status_code == 200
    response = client.get("/api/admin/submissions")
    body = response.get_json()

    assert response.status_code == 200
    assert body["stats"]["total"] == 1
    assert body["stats"]["new"] == 1
    assert body["submissions"][0]["lead"]["name"] == "Andi Saputra"
    assert body["submissions"][0]["lead"]["spaces"] == [
        "Kitchen set HPL",
        "Mini bar / pantry counter",
    ]


def test_admin_requires_login(client):
    response = client.get("/api/admin/submissions")
    assert response.status_code == 401


def test_admin_can_persist_follow_up(client):
    created = client.post("/api/submissions", json=sample_submission()).get_json()
    login(client)

    response = client.patch(
        f"/api/admin/submissions/{created['id']}",
        json={"status": "survey", "note": "Survei hari Senin pukul 10.00."},
    )
    body = response.get_json()["submission"]

    assert response.status_code == 200
    assert body["status"] == "survey"
    assert body["note"] == "Survei hari Senin pukul 10.00."


def test_invalid_submission_is_rejected(client):
    response = client.post(
        "/api/submissions",
        json={"name": "A", "phone": "123", "address": "", "spaces": []},
    )
    assert response.status_code == 400


def test_admin_export_and_noindex_headers(client):
    client.post("/api/submissions", json=sample_submission())
    login(client)

    response = client.get("/api/admin/export.csv")
    assert response.status_code == 200
    assert response.mimetype == "text/csv"
    assert "Andi Saputra" in response.get_data(as_text=True)

    response = client.get("/admin")
    assert response.status_code == 200
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"


def test_seo_files_are_served(client):
    robots = client.get("/robots.txt")
    sitemap = client.get("/sitemap.xml")

    assert robots.status_code == 200
    assert "Sitemap: https://bismillahinterior.web.id/sitemap.xml" in robots.get_data(as_text=True)
    assert sitemap.status_code == 200
    assert "https://bismillahinterior.web.id/" in sitemap.get_data(as_text=True)


def test_admin_can_manage_project_pipeline_and_payments(client):
    submission = client.post("/api/submissions", json=sample_submission()).get_json()
    login(client)

    response = client.post(
        "/api/admin/projects",
        json={"submissionId": submission["id"], "title": "Kitchen dan mini bar Andi"},
    )
    assert response.status_code == 201
    project = response.get_json()["project"]
    project_id = project["id"]
    assert project["code"].startswith("BI-")
    assert project["status"] == "follow_up"
    assert len(project["items"]) == 2

    response = client.patch(
        f"/api/admin/projects/{project_id}",
        json={
            "status": "production",
            "projectValue": 19_000_000,
            "designFee": 1_500_000,
            "schedule": {
                "surveyDate": "2026-07-15",
                "productionStartDate": "2026-07-20",
                "targetCompletionDate": "2026-08-20",
            },
            "notes": "Motif HPL menunggu persetujuan akhir.",
        },
    )
    assert response.status_code == 200
    project = response.get_json()["project"]
    assert project["status"] == "production"
    assert project["financial"]["projectValue"] == 19_000_000
    assert project["events"][0]["type"] == "status_changed"

    response = client.post(
        f"/api/admin/projects/{project_id}/payments",
        json={"type": "dp", "amount": 5_000_000, "paidAt": "2026-07-18", "method": "Transfer"},
    )
    assert response.status_code == 201
    project = response.get_json()["project"]
    assert project["financial"]["paid"] == 5_000_000
    assert project["financial"]["balance"] == 14_000_000

    response = client.post(
        f"/api/admin/projects/{project_id}/events",
        json={"note": "Material sudah masuk workshop."},
    )
    assert response.status_code == 201
    assert response.get_json()["project"]["events"][0]["note"] == "Material sudah masuk workshop."

    response = client.get("/api/admin/projects")
    body = response.get_json()
    assert response.status_code == 200
    assert body["stats"]["active"] == 1
    assert body["stats"]["production"] == 1
    assert body["stats"]["outstanding"] == 14_000_000

    duplicate = client.post("/api/admin/projects", json={"submissionId": submission["id"]})
    assert duplicate.status_code == 409


def test_project_item_can_be_updated_and_deleted(client):
    submission = client.post("/api/submissions", json=sample_submission()).get_json()
    login(client)
    project = client.post("/api/admin/projects", json={"submissionId": submission["id"]}).get_json()["project"]
    project_id = project["id"]
    item_id = project["items"][0]["id"]

    response = client.patch(
        f"/api/admin/projects/{project_id}/items/{item_id}",
        json={"status": "production", "dimensions": "300 x 60 cm", "material": "HPL motif kayu"},
    )
    assert response.status_code == 200
    item = next(item for item in response.get_json()["project"]["items"] if item["id"] == item_id)
    assert item["status"] == "production"
    assert item["dimensions"] == "300 x 60 cm"

    response = client.delete(f"/api/admin/projects/{project_id}/items/{item_id}")
    assert response.status_code == 200
    assert all(item["id"] != item_id for item in response.get_json()["project"]["items"])


def test_existing_leads_survive_project_schema_migration(tmp_path):
    database_path = tmp_path / "legacy.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE submissions (
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
            INSERT INTO submissions
                (created_at, name, phone, address, spaces_json)
            VALUES
                ('2026-07-01T10:00:00+00:00', 'Lead Lama', '081122334455', 'Payakumbuh', '["Wardrobe"]');
            """
        )

    migrated_app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD": "strong-test-password",
            "DATABASE_PATH": str(database_path),
            "SESSION_COOKIE_SECURE": False,
            "TRUSTED_HOSTS": None,
        }
    )
    migrated_client = migrated_app.test_client()
    assert login(migrated_client).status_code == 200
    leads = migrated_client.get("/api/admin/submissions").get_json()["submissions"]
    assert leads[0]["lead"]["name"] == "Lead Lama"
    assert migrated_client.get("/api/admin/projects").status_code == 200
