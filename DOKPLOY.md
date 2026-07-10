# Panduan Deploy Bismillah Interior di Dokploy

Panduan ini digunakan untuk menjalankan landing page, formulir konsultasi, dashboard admin, dan database SQLite pada domain:

```text
https://bismillahinterior.web.id
```

## 1. Persiapan

Pastikan tersedia:

- Server yang sudah terpasang Dokploy.
- Repository GitHub `aburasyidalfatih/bismillah-interior`.
- Akses pengaturan DNS domain `bismillahinterior.web.id`.
- Perubahan project terbaru sudah di-push ke branch `main`.

File deployment yang digunakan:

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`

## 2. Arahkan DNS Domain

Buka pengaturan DNS domain, lalu buat record:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `@` | IP publik server Dokploy | Auto atau 300 |

Opsional untuk domain `www`:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `CNAME` | `www` | `bismillahinterior.web.id` | Auto atau 300 |

Periksa propagasi DNS:

```bash
nslookup bismillahinterior.web.id
```

Alamat yang tampil harus sama dengan IP publik server Dokploy.

## 3. Buat Project di Dokploy

1. Masuk ke dashboard Dokploy.
2. Klik **Create Project**.
3. Gunakan nama `Bismillah Interior`.
4. Buka project tersebut.
5. Klik **Create Service**.
6. Pilih **Docker Compose**.
7. Gunakan nama service `bismillah-interior`.

## 4. Hubungkan Repository GitHub

Pada konfigurasi Docker Compose:

1. Pilih provider **GitHub** atau **Git**.
2. Pilih repository `aburasyidalfatih/bismillah-interior`.
3. Pilih branch `main`.
4. Isi Compose Path:

```text
./docker-compose.yml
```

5. Simpan konfigurasi.

Gunakan mode **Docker Compose**, bukan Docker Stack, karena project membangun image langsung dari `Dockerfile`.

## 5. Buat Secret dan Password Admin

Generate `SECRET_KEY` pada komputer lokal:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Buat password admin yang panjang, unik, dan tidak digunakan pada akun lain.

Jangan memasukkan secret atau password ke GitHub.

## 6. Isi Environment Dokploy

Buka bagian **Environment** pada service Compose, lalu isi:

```dotenv
SECRET_KEY=masukkan-hasil-generator-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=masukkan-password-admin-yang-kuat
SESSION_COOKIE_SECURE=true
TRUSTED_HOSTS=bismillahinterior.web.id
```

Keterangan:

| Variable | Fungsi |
| --- | --- |
| `SECRET_KEY` | Menandatangani sesi login admin. |
| `ADMIN_USERNAME` | Username untuk dashboard admin. |
| `ADMIN_PASSWORD` | Password dashboard admin. |
| `SESSION_COOKIE_SECURE` | Memastikan cookie admin hanya dikirim melalui HTTPS. |
| `TRUSTED_HOSTS` | Membatasi host yang diterima aplikasi. |

`DATABASE_PATH` tidak perlu ditambahkan karena Compose sudah mengaturnya ke:

```text
/app/data/bismillah.db
```

## 7. Deploy Pertama

1. Klik **Deploy**.
2. Tunggu proses build image selesai.
3. Buka menu **Logs**.
4. Pastikan tidak ada pesan error.
5. Pastikan container berstatus sehat atau running.

Pesan berikut menandakan environment belum lengkap:

```text
SECRET_KEY dan ADMIN_PASSWORD wajib dikonfigurasi pada environment production.
```

Isi environment yang kurang, lalu deploy ulang.

## 8. Hubungkan Domain

Setelah container berjalan:

1. Buka tab **Domains** pada service Docker Compose.
2. Klik **Add Domain**.
3. Isi konfigurasi:

| Field | Nilai |
| --- | --- |
| Host | `bismillahinterior.web.id` |
| Path | `/` |
| Internal Path | `/` |
| Service | `app` |
| Container Port | `8000` |
| HTTPS | Aktif |
| Certificate | Let's Encrypt |

4. Simpan domain.
5. Redeploy Docker Compose agar routing domain diterapkan.
6. Tunggu penerbitan sertifikat HTTPS.

Dokumentasi resmi domain Docker Compose:

<https://docs.dokploy.com/docs/core/docker-compose/domains>

## 9. Verifikasi Website

Buka:

```text
https://bismillahinterior.web.id
```

Periksa:

- Landing page tampil lengkap.
- Semua gambar dapat dibuka.
- Tombol formulir bergerak ke bagian konsultasi.
- Tidak ada peringatan sertifikat SSL.

Periksa health check:

```text
https://bismillahinterior.web.id/healthz
```

Respons yang benar:

```json
{"database":"sqlite","status":"ok"}
```

## 10. Verifikasi Formulir dan SQLite

1. Isi formulir konsultasi menggunakan data pengujian.
2. Kirim formulir.
3. Pastikan WhatsApp terbuka.
4. Masuk ke dashboard admin:

```text
https://bismillahinterior.web.id/admin
```

5. Login menggunakan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari Environment Dokploy.
6. Pastikan data pengujian muncul.
7. Ubah status menjadi **Sudah dihubungi** atau **Survei**.
8. Tambahkan catatan dan klik **Simpan Follow-up**.
9. Refresh halaman dan pastikan perubahan tetap tersimpan.

## 11. Penyimpanan SQLite

Database disimpan pada Docker named volume:

```text
bismillah_data
```

Mount di dalam container:

```text
/app/data
```

Jangan menghapus volume ketika redeploy. Menghapus container tidak menghapus data selama named volume tetap tersedia.

Pada Dokploy, nama volume lengkap biasanya mengikuti pola:

```text
<nama-service>_bismillah_data
```

## 12. Backup Database

Gunakan menu **Volume Backups** pada Dokploy:

1. Konfigurasikan tujuan backup S3.
2. Buka service Bismillah Interior.
3. Pilih **Volume Backups**.
4. Pilih service `app`.
5. Pilih volume yang berakhiran `_bismillah_data`.
6. Atur jadwal backup harian, misalnya:

```text
0 2 * * *
```

7. Aktifkan opsi mematikan container selama backup untuk mengurangi risiko inkonsistensi SQLite.

Dokumentasi resmi:

<https://docs.dokploy.com/docs/core/volume-backups>

## 13. Update Website

Setelah perubahan baru di-push ke GitHub:

1. Buka service Docker Compose di Dokploy.
2. Klik **Deploy** atau **Redeploy**.
3. Dokploy mengambil kode terbaru dari branch `main`.
4. Image dibangun ulang.
5. Named volume SQLite tetap digunakan.

Auto Deploy dapat diaktifkan melalui webhook GitHub apabila diperlukan.

## 14. Submit SEO Setelah Domain Aktif

1. Tambahkan `bismillahinterior.web.id` ke Google Search Console.
2. Verifikasi kepemilikan domain melalui DNS.
3. Submit sitemap:

```text
https://bismillahinterior.web.id/sitemap.xml
```

4. Gunakan URL Inspection untuk meminta indexing halaman utama.
5. Buat atau lengkapi Google Business Profile.

## 15. Troubleshooting

### Website menampilkan 502 Bad Gateway

- Pastikan container berjalan.
- Pastikan domain diarahkan ke service `app`.
- Pastikan Container Port bernilai `8000`.
- Periksa log Gunicorn dan health check.

### Domain belum mendapatkan HTTPS

- Periksa record DNS `A`.
- Pastikan domain sudah mengarah ke IP server.
- Simpan ulang domain dan redeploy Compose.
- Tunggu proses penerbitan sertifikat.

### Error Trusted Host

Pastikan environment berisi:

```dotenv
TRUSTED_HOSTS=bismillahinterior.web.id
```

Jika menggunakan `www`, ubah menjadi:

```dotenv
TRUSTED_HOSTS=bismillahinterior.web.id,www.bismillahinterior.web.id
```

### Tidak bisa login admin

- Periksa `ADMIN_USERNAME` dan `ADMIN_PASSWORD`.
- Pastikan tidak ada spasi tambahan pada environment.
- Redeploy setelah mengganti environment.
- Gunakan URL `/admin`.

### Formulir berhasil membuka WhatsApp tetapi data tidak muncul

- Buka `/healthz` dan pastikan database berstatus `sqlite`.
- Periksa log request `POST /api/submissions`.
- Pastikan volume `/app/data` dapat ditulis.
- Pastikan service menggunakan image terbaru.

### Data hilang setelah redeploy

- Pastikan `docker-compose.yml` masih memasang `bismillah_data:/app/data`.
- Jangan menghapus volume dari Dokploy atau Docker host.
- Pulihkan volume dari backup apabila volume sebelumnya terhapus.

## Checklist Go-live

- [ ] Kode terbaru sudah di-push ke GitHub.
- [ ] DNS domain mengarah ke IP server Dokploy.
- [ ] Environment production sudah lengkap.
- [ ] Docker Compose berhasil dibangun.
- [ ] Domain menggunakan service `app` dan port `8000`.
- [ ] HTTPS aktif.
- [ ] `/healthz` berstatus `ok`.
- [ ] Formulir menyimpan data.
- [ ] Dashboard admin dapat login.
- [ ] Status dan catatan follow-up tersimpan.
- [ ] Backup volume SQLite dijadwalkan.
- [ ] Sitemap dikirim ke Google Search Console.
