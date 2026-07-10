from pathlib import Path

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
