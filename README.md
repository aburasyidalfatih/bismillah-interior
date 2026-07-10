# Bismillah Interior

Landing page, formulir konsultasi, dashboard admin, dan penyimpanan SQLite untuk Bismillah Interior.

Panduan deployment lengkap: [DOKPLOY.md](DOKPLOY.md).

## Jalankan dengan Docker

1. Salin `.env.example` menjadi `.env`.
2. Ganti `SECRET_KEY` dan `ADMIN_PASSWORD` dengan nilai yang kuat.
3. Jalankan:

```bash
docker compose up --build
```

Aplikasi berjalan di port internal `8000`. Untuk pengujian lokal, tambahkan sementara `ports: ["8000:8000"]` atau jalankan image dengan `docker run -p 8000:8000`.

## Environment Production

| Variable | Wajib | Keterangan |
| --- | --- | --- |
| `SECRET_KEY` | Ya | Secret acak untuk menandatangani sesi admin. |
| `ADMIN_USERNAME` | Tidak | Username admin, default `admin`. |
| `ADMIN_PASSWORD` | Ya | Password dashboard admin. |
| `DATABASE_PATH` | Tidak | Default production `/app/data/bismillah.db`. |
| `SESSION_COOKIE_SECURE` | Tidak | Gunakan `true` saat domain sudah HTTPS. |
| `TRUSTED_HOSTS` | Tidak | Default `bismillahinterior.web.id`. Pisahkan beberapa host dengan koma. |

Generate secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Jangan commit file `.env`.

## Deploy ke Dokploy

1. Arahkan DNS `A` untuk `bismillahinterior.web.id` ke IP server Dokploy.
2. Di Dokploy, buat **Project** lalu tambahkan service **Docker Compose**.
3. Pilih repository GitHub `aburasyidalfatih/bismillah-interior`, branch `main`.
4. Isi Compose Path dengan `./docker-compose.yml`.
5. Tambahkan environment berikut di Dokploy:

```dotenv
SECRET_KEY=<hasil-generator-secret>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<password-admin-yang-kuat>
SESSION_COOKIE_SECURE=true
TRUSTED_HOSTS=bismillahinterior.web.id
```

6. Klik **Deploy**.
7. Buka tab **Domains**, pilih service `bismillah-interior`, lalu tambahkan:
   - Host: `bismillahinterior.web.id`
   - Path: `/`
   - Container Port: `8000`
   - HTTPS: aktifkan certificate/Let's Encrypt
8. Redeploy Compose setelah menambahkan atau mengubah domain.

Dokploy merekomendasikan konfigurasi domain melalui tab Domains dan akan menambahkan routing Traefik secara otomatis. Dokumentasi: <https://docs.dokploy.com/docs/core/docker-compose/domains>.

## Dashboard Admin

- URL: `https://bismillahinterior.web.id/admin`
- Login menggunakan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari environment Dokploy.
- Status follow-up, catatan, dan data customer tersimpan di SQLite.
- Data dapat diekspor menjadi CSV dari dashboard.

## Database dan Backup

SQLite disimpan di named volume `bismillah_data` pada `/app/data`. Volume ini tetap tersedia saat container direstart atau aplikasi diredeploy.

Gunakan menu **Volume Backups** Dokploy untuk backup terjadwal. Pilih service `bismillah-interior` dan volume yang berakhiran `_bismillah_data`. Untuk konsistensi SQLite, aktifkan opsi mematikan container selama proses backup. Dokumentasi: <https://docs.dokploy.com/docs/core/volume-backups>.

## Health Check

```text
GET /healthz
```

Respons normal:

```json
{"database":"sqlite","status":"ok"}
```

## SEO Setelah Go-live

1. Tambahkan property domain `bismillahinterior.web.id` ke Google Search Console.
2. Submit `https://bismillahinterior.web.id/sitemap.xml`.
3. Gunakan URL Inspection untuk meminta indexing halaman utama.
4. Lengkapi profil Google Business dengan nomor WhatsApp, alamat usaha yang sebenarnya, foto proyek asli, dan area layanan Sumatera Barat.
5. Tambahkan halaman studi kasus kota hanya setelah tersedia proyek atau informasi lokal yang unik. Hindari membuat banyak halaman kota dengan isi yang sama.

## Pengembangan Lokal Tanpa Docker

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
set ADMIN_PASSWORD=local-password
python app.py
```

Jalankan pengujian:

```bash
pytest -q
```
