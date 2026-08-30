# Flowdesk Server Survival Guide

Reference guide operasional untuk server staging Flowdesk di Ubuntu/Docker.

> Server contoh: `206.189.89.33`  
> User utama: `flowdesk`  
> Root project: `/opt/flowdesk`  
> Environment: `staging`

## Cara membaca panduan ini

Penanda risiko:

- **Aman** — hanya membaca status atau data.
- **Berdampak** — dapat memutus request atau menghentikan service sementara.
- **Berbahaya** — berpotensi menghapus data, membuka akses, atau membuat server tidak dapat diakses.

Command dalam panduan ini diasumsikan dijalankan setelah login ke server, kecuali bagian yang secara eksplisit bertuliskan **jalankan dari Mac**.

## Daftar isi

1. [Quick start](#1-quick-start)
2. [SSH dan orientasi server](#2-ssh-dan-orientasi-server)
3. [Lokasi project dan release](#3-lokasi-project-dan-release)
4. [Daftar container Flowdesk](#4-daftar-container-flowdesk)
5. [Status dan logs](#5-status-dan-logs)
6. [Restart, stop, start, exec, dan inspect](#6-restart-stop-start-exec-dan-inspect)
7. [PostgreSQL dan `flowdb`](#7-postgresql-dan-flowdb)
8. [Redis](#8-redis)
9. [Health checks](#9-health-checks)
10. [Caddy](#10-caddy)
11. [Ports dan Docker network](#11-ports-dan-docker-network)
12. [CPU, RAM, disk, dan resources](#12-cpu-ram-disk-dan-resources)
13. [Environment variables dan secrets](#13-environment-variables-dan-secrets)
14. [Images, releases, dan Docker Compose](#14-images-releases-dan-docker-compose)
15. [Pencarian file dan konfigurasi](#15-pencarian-file-dan-konfigurasi)
16. [`journalctl` dan Docker daemon](#16-journalctl-dan-docker-daemon)
17. [Firewall dan SSH security](#17-firewall-dan-ssh-security)
18. [Process dan system monitoring](#18-process-dan-system-monitoring)
19. [SCP: copy file Mac dan server](#19-scp-copy-file-mac-dan-server)
20. [Troubleshooting flow](#20-troubleshooting-flow)
21. [Recommended aliases](#21-recommended-aliases)
22. [Command berbahaya yang harus dihindari](#22-command-berbahaya-yang-harus-dihindari)

---

## 1. Quick start

Urutan pemeriksaan tercepat ketika Flowdesk terasa bermasalah:

```bash
ssh flowdesk@206.189.89.33
```

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

```bash
docker logs --tail 100 --timestamps flowdesk-staging-api-1
docker logs --tail 100 --timestamps flowdesk-staging-web-1
docker logs --tail 100 --timestamps flowdesk-staging-caddy-1
```

```bash
curl -i --max-time 10 http://206.189.89.33/api/livez
```

Kalau alias dari bagian akhir sudah dipasang, workflow sehari-hari cukup:

```bash
fps
fstats
fapi
flowdb
```

---

## 2. SSH dan orientasi server

### Masuk dari Mac

```bash
ssh flowdesk@206.189.89.33
```

Kalau SSH key tertentu harus dipakai:

```bash
ssh -i ~/.ssh/NAMA_PRIVATE_KEY flowdesk@206.189.89.33
```

Mode verbose untuk mendiagnosis kegagalan koneksi:

```bash
ssh -v flowdesk@206.189.89.33
```

Gunakan `-vvv` hanya jika detail `-v` belum cukup. Output verbose dapat memuat nama file, user, dan detail konfigurasi; jangan unggah mentah ke tempat publik.

### Masuk sebagai root

```bash
ssh root@206.189.89.33
```

Gunakan root hanya jika memang diperlukan. Normalnya lebih aman login sebagai `flowdesk`, lalu gunakan `sudo` untuk command administratif tertentu.

### Kenali posisi saat ini

```bash
whoami
hostname
pwd
date
```

Informasi host:

```bash
uname -a
cat /etc/os-release
uptime
who -b
```

Keluar dari server:

```bash
exit
```

Atau tekan `Ctrl+D`.

### Opsional: alias SSH di Mac

Tambahkan ke `~/.ssh/config` di Mac:

```sshconfig
Host flowdesk-staging
    HostName 206.189.89.33
    User flowdesk
    IdentityFile ~/.ssh/NAMA_PRIVATE_KEY
    IdentitiesOnly yes
```

Setelah itu cukup:

```bash
ssh flowdesk-staging
```

---

## 3. Lokasi project dan release

Lihat struktur utama:

```bash
ls -lah /opt/flowdesk
```

Masuk ke root deployment:

```bash
cd /opt/flowdesk
```

Lihat release yang tersedia:

```bash
ls -lah /opt/flowdesk/releases
```

Cari release aktif melalui symlink `current`:

```bash
readlink -f /opt/flowdesk/current
```

Masuk ke release aktif tanpa mengetik hash:

```bash
cd /opt/flowdesk/current
pwd
```

Contoh release yang pernah aktif:

```text
/opt/flowdesk/releases/1441e8a41223cf5ff5ad2955bbba64e0347c771a
```

Release directory dapat berasal dari deployment artifact dan belum tentu memiliki folder `.git`. Karena itu, image Docker yang sedang digunakan sering menjadi sumber paling akurat untuk mengetahui Git SHA aktif.

Lihat target symlink dan beberapa release terbaru:

```bash
ls -ld /opt/flowdesk/current
ls -lht /opt/flowdesk/releases | head -n 10
```

> Jangan mengubah symlink `current`, menghapus release, atau mengedit file release aktif secara manual tanpa memahami prosedur deployment dan rollback.

---

## 4. Daftar container Flowdesk

Container yang diketahui:

| Container                      | Fungsi utama                       |
| ------------------------------ | ---------------------------------- |
| `flowdesk-staging-caddy-1`     | Reverse proxy, HTTP/HTTPS, routing |
| `flowdesk-staging-api-1`       | Backend API                        |
| `flowdesk-staging-web-1`       | Frontend web                       |
| `flowdesk-staging-worker-1`    | Background jobs                    |
| `flowdesk-staging-scheduler-1` | Penjadwalan jobs                   |
| `flowdesk-staging-ingress-1`   | Ingress atau penerimaan event      |
| `flowdesk-staging-postgres-1`  | Database PostgreSQL                |
| `flowdesk-staging-redis-1`     | Cache/queue Redis                  |
| `flowdesk-staging-minio-1`     | Object storage MinIO               |
| `flowdesk-staging-clamav-1`    | Antivirus/file scanning            |

Lihat container yang sedang hidup:

```bash
docker ps
```

Format ringkas:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

Termasuk container yang sudah berhenti:

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

Filter container Flowdesk staging:

```bash
docker ps -a --filter 'name=flowdesk-staging-' \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
```

Arti status umum:

- `Up ...` — container hidup.
- `Up ... (healthy)` — hidup dan health check lolos.
- `Up ... (unhealthy)` — proses hidup tetapi health check gagal.
- `Restarting` — crash loop atau terus gagal saat startup.
- `Exited (0)` — berhenti normal.
- `Exited (1)` atau non-zero — proses berhenti karena error.

---

## 5. Status dan logs

### Log live per service

Tekan `Ctrl+C` untuk keluar dari mode follow. Ini hanya menghentikan tampilan log, bukan container.

```bash
docker logs -f flowdesk-staging-api-1
docker logs -f flowdesk-staging-web-1
docker logs -f flowdesk-staging-worker-1
docker logs -f flowdesk-staging-scheduler-1
docker logs -f flowdesk-staging-ingress-1
docker logs -f flowdesk-staging-caddy-1
docker logs -f flowdesk-staging-postgres-1
docker logs -f flowdesk-staging-redis-1
docker logs -f flowdesk-staging-minio-1
docker logs -f flowdesk-staging-clamav-1
```

### Log berbatas waktu/jumlah

100 baris terakhir:

```bash
docker logs --tail 100 --timestamps flowdesk-staging-api-1
```

10 menit terakhir:

```bash
docker logs --since 10m --timestamps flowdesk-staging-api-1
```

Rentang waktu tertentu:

```bash
docker logs \
  --since '2026-08-30T10:00:00+07:00' \
  --until '2026-08-30T10:15:00+07:00' \
  --timestamps \
  flowdesk-staging-api-1
```

### Filter log

Error dan warning:

```bash
docker logs --since 30m flowdesk-staging-api-1 2>&1 \
  | grep -iE 'error|warn|fatal|panic'
```

Status HTTP penting:

```bash
docker logs --since 30m flowdesk-staging-api-1 2>&1 \
  | grep -E 'statusCode.*(409|500|502|503)|"status":(409|500|502|503)'
```

Organization/RLS:

```bash
docker logs --since 30m flowdesk-staging-api-1 2>&1 \
  | grep -iE 'organization|membership|rls|row.level|permission denied'
```

Catatan: tidak semua aplikasi memakai format log yang sama. Jika filter menghasilkan kosong, periksa 100–200 baris mentah sebelum menyimpulkan tidak ada error.

---

## 6. Restart, stop, start, exec, dan inspect

### Restart satu service — **berdampak**

```bash
docker restart flowdesk-staging-api-1
docker restart flowdesk-staging-web-1
docker restart flowdesk-staging-worker-1
docker restart flowdesk-staging-caddy-1
```

Restart service aplikasi sekaligus — **berdampak**:

```bash
docker restart \
  flowdesk-staging-api-1 \
  flowdesk-staging-web-1 \
  flowdesk-staging-worker-1 \
  flowdesk-staging-scheduler-1 \
  flowdesk-staging-ingress-1
```

Jangan restart PostgreSQL, Redis, atau Docker daemon sebagai langkah pertama. Cari bukti masalahnya dulu.

### Stop/start — **berdampak**

```bash
docker stop flowdesk-staging-api-1
docker start flowdesk-staging-api-1
```

### Masuk ke dalam container

```bash
docker exec -it flowdesk-staging-api-1 sh
```

Kalau image memiliki Bash:

```bash
docker exec -it flowdesk-staging-api-1 bash
```

Image Alpine/minimal biasanya hanya menyediakan `sh`. Gunakan `exit` atau `Ctrl+D` untuk keluar.

Jalankan satu command tanpa membuka shell:

```bash
docker exec flowdesk-staging-api-1 pwd
docker exec flowdesk-staging-api-1 ps
```

### Inspect status

Status proses:

```bash
docker inspect flowdesk-staging-api-1 --format '{{.State.Status}}'
```

Health:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}'
```

Image aktif:

```bash
docker inspect flowdesk-staging-api-1 --format '{{.Config.Image}}'
```

Waktu mulai dan restart count:

```bash
docker inspect flowdesk-staging-api-1 \
  --format 'started={{.State.StartedAt}} restarts={{.RestartCount}} exit={{.State.ExitCode}}'
```

Alasan container terakhir berhenti:

```bash
docker inspect flowdesk-staging-api-1 \
  --format 'oom={{.State.OOMKilled}} error={{printf "%q" .State.Error}} finished={{.State.FinishedAt}}'
```

Mounts:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}'
```

---

## 7. PostgreSQL dan `flowdb`

### Masuk dengan command penuh

```bash
docker exec -it flowdesk-staging-postgres-1 sh -lc \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### Pasang fungsi `flowdb` yang simpel

Jalankan sekali di server:

```bash
cat >> ~/.bashrc <<'EOF'

flowdb() {
  docker exec -it flowdesk-staging-postgres-1 sh -lc \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}
EOF

source ~/.bashrc
```

Selanjutnya cukup:

```bash
flowdb
```

Function dipilih karena quoting-nya lebih mudah dibaca dan dirawat daripada alias satu baris yang bertumpuk.

### Command penting di dalam `psql`

Informasi koneksi:

```sql
\conninfo
SELECT current_database(), current_user;
```

Daftar schema dan tabel:

```sql
\dn
\dt flowdesk.*
\dt flowdesk.*organization*
\dt flowdesk.*user*
```

Struktur tabel:

```sql
\d flowdesk.organizations
\d flowdesk.memberships
\d flowdesk.roles
```

Data terbaru—gunakan limit:

```sql
SELECT *
FROM flowdesk.organizations
ORDER BY created_at DESC
LIMIT 20;
```

```sql
SELECT *
FROM flowdesk.memberships
ORDER BY created_at DESC
LIMIT 20;
```

Koneksi database aktif:

```sql
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY usename, state;
```

Role Flowdesk dan kemampuan bypass RLS:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname LIKE 'flowdesk%'
ORDER BY rolname;
```

Policy RLS:

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'flowdesk'
ORDER BY tablename, policyname;
```

Daftar dan source function:

```sql
\df flowdesk.*
\sf flowdesk.current_organization_id
```

Ukuran database dan tabel besar:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
```

```sql
SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

Keluar:

```sql
\q
```

### Batas aman saat memeriksa database

- Mulai dari `SELECT`; jangan langsung `UPDATE`, `DELETE`, `DROP`, atau `TRUNCATE`.
- Selalu gunakan `LIMIT` saat belum tahu ukuran tabel.
- Jangan mengubah role menjadi `SUPERUSER` atau `BYPASSRLS` untuk “memperbaiki” bug aplikasi.
- Jangan menonaktifkan RLS global. Perbaiki tenant/bootstrap path secara sempit dan teruji.
- Ambil backup dan siapkan rollback sebelum migration atau perubahan data manual.
- Jangan menyalin credential atau data customer ke chat publik.

---

## 8. Redis

Masuk ke CLI:

```bash
docker exec -it flowdesk-staging-redis-1 redis-cli
```

Jika Redis memakai autentikasi, jangan menaruh password langsung di command yang akan tersimpan di shell history. Cari mekanisme autentikasi deployment yang sudah digunakan.

Command aman di dalam Redis CLI:

```text
PING
INFO server
INFO memory
INFO stats
DBSIZE
```

Expected dari `PING`:

```text
PONG
```

Scan key secara bertahap:

```text
SCAN 0 COUNT 100
```

Jangan gunakan `KEYS *` pada database besar karena dapat memblokir Redis. Jangan pernah menjalankan command berikut untuk sekadar troubleshooting:

```text
FLUSHALL
FLUSHDB
```

Keluar:

```text
QUIT
```

Log Redis:

```bash
docker logs --tail 100 --timestamps flowdesk-staging-redis-1
```

---

## 9. Health checks

### Dari sisi publik

```bash
curl -i --max-time 10 http://206.189.89.33/api/livez
```

Yang dicari:

- DNS/IP dapat dijangkau.
- Port HTTP/HTTPS merespons.
- Caddy menerima request.
- Routing ke API bekerja.
- Endpoint menghasilkan status yang diharapkan, biasanya `200`.

Jika HTTP diarahkan ke HTTPS, respons `301`/`308` bisa normal. Ikuti redirect:

```bash
curl -iL --max-time 15 http://206.189.89.33/api/livez
```

### Dari dalam server

```bash
curl -i --max-time 10 http://127.0.0.1/api/livez
```

### Hanya status dan waktu respons

```bash
curl -sS -o /dev/null \
  -w 'status=%{http_code} total=%{time_total}s\n' \
  --max-time 10 \
  http://206.189.89.33/api/livez
```

### Health Docker

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{json .State.Health}}'
```

Catatan penting: `/livez` biasanya hanya memastikan proses hidup. Kalau tersedia endpoint readiness, gunakan juga untuk memastikan dependency seperti database/Redis benar-benar siap. Jangan menganggap satu respons `200` membuktikan seluruh alur customer berfungsi; lanjutkan dengan smoke test aplikasi.

---

## 10. Caddy

Log:

```bash
docker logs --tail 100 --timestamps flowdesk-staging-caddy-1
docker logs -f flowdesk-staging-caddy-1
```

Lihat Caddyfile aktif:

```bash
docker exec flowdesk-staging-caddy-1 cat /etc/caddy/Caddyfile
```

Validasi config—**aman**:

```bash
docker exec flowdesk-staging-caddy-1 \
  caddy validate --config /etc/caddy/Caddyfile
```

Reload config—**berdampak**, lakukan hanya setelah validasi:

```bash
docker exec flowdesk-staging-caddy-1 \
  caddy reload --config /etc/caddy/Caddyfile
```

Masuk ke container:

```bash
docker exec -it flowdesk-staging-caddy-1 sh
```

Saat terjadi `502 Bad Gateway`, cek berurutan:

1. API/web container hidup atau tidak.
2. Caddy dan upstream berada di Docker network yang sama.
3. Nama upstream dan port di Caddyfile benar.
4. Service upstream benar-benar listen.
5. Log Caddy dan service upstream pada timestamp yang sama.

---

## 11. Ports dan Docker network

Port host yang listen:

```bash
sudo ss -tulpn
```

Filter port umum:

```bash
sudo ss -tulpn | grep -E ':(22|80|443|3000|5432|6379)\b'
```

Alternatif jika `lsof` tersedia:

```bash
sudo lsof -i -P -n | grep LISTEN
```

Port container yang dipublikasikan:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Daftar Docker network:

```bash
docker network ls
```

Inspect network staging:

```bash
docker network inspect flowdesk-staging_default
```

IP internal API:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{range .NetworkSettings.Networks}}{{println .NetworkID .IPAddress}}{{end}}'
```

Network yang dipakai setiap container Flowdesk:

```bash
for c in $(docker ps -a --filter 'name=flowdesk-staging-' --format '{{.Names}}'); do
  printf '%s: ' "$c"
  docker inspect "$c" \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}'
done
```

Idealnya PostgreSQL `5432`, Redis `6379`, dan service internal lainnya tidak dipublikasikan ke internet. Akses antarservice dilakukan melalui Docker network.

---

## 12. CPU, RAM, disk, dan resources

Ringkasan server:

```bash
uptime
free -h
df -h
```

Monitor interaktif:

```bash
top
```

Kalau tersedia:

```bash
htop
```

Resource semua container secara live:

```bash
docker stats
```

Snapshot sekali saja:

```bash
docker stats --no-stream \
  --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}'
```

Penggunaan disk Docker:

```bash
docker system df
```

Ukuran direktori Flowdesk:

```bash
du -sh /opt/flowdesk/* 2>/dev/null
```

Inode—penting jika disk terlihat masih ada tetapi pembuatan file gagal:

```bash
df -ih
```

Cari sinyal OOM/kernel kill:

```bash
sudo journalctl -k --since '1 hour ago' \
  | grep -iE 'out of memory|oom|killed process'
```

Pada server 1 GB RAM, perhatian utama biasanya:

- container restart karena OOM;
- swap penuh atau tidak tersedia;
- ClamAV/PostgreSQL/Node bersaing memperebutkan RAM;
- disk Docker membesar karena images dan log;
- load tinggi karena job worker atau query berat.

Jangan langsung menjalankan `docker system prune -a`. Itu dapat menghapus cache dan image yang dibutuhkan untuk rollback.

---

## 13. Environment variables dan secrets

### Inspect environment container

Semua env API:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}'
```

Atau dari dalam container:

```bash
docker exec flowdesk-staging-api-1 env | sort
```

Filter nama variable tanpa sengaja menampilkan semuanya:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | cut -d= -f1 \
  | sort
```

Filter kelompok tertentu—outputnya mungkin berisi secret:

```bash
docker inspect flowdesk-staging-api-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(DATABASE|REDIS|POSTGRES|AUTH|CLERK|S3|MINIO)_'
```

### Aturan keamanan env

- Jangan screenshot atau paste seluruh output env ke chat/ticket publik.
- Jangan menjalankan command dengan password literal jika shell history aktif.
- Jangan commit `.env` ke Git.
- Jangan mengedit env release aktif tanpa mengetahui sumber kebenaran deployment.
- Jika secret sempat terekspos, anggap bocor dan lakukan rotasi; menghapus pesan saja tidak cukup.

---

## 14. Images, releases, dan Docker Compose

Daftar image:

```bash
docker images
```

Filter Flowdesk:

```bash
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' \
  | grep -i flowdesk
```

Image tiap container aktif:

```bash
docker ps --filter 'name=flowdesk-staging-' \
  --format 'table {{.Names}}\t{{.Image}}'
```

Pola image yang pernah digunakan:

```text
ghcr.io/ryanakml/flowdesk-api:<git-sha>
ghcr.io/ryanakml/flowdesk-web:<git-sha>
ghcr.io/ryanakml/flowdesk-worker:<git-sha>
```

Contoh Git SHA/release:

```text
1441e8a41223cf5ff5ad2955bbba64e0347c771a
```

### Git metadata jika tersedia

```bash
cd /opt/flowdesk/current
git status
git log -1 --oneline
git rev-parse HEAD
```

Kalau muncul `not a git repository`, itu dapat normal untuk artifact deployment. Gunakan tag image dan nama release sebagai bukti versi aktif.

### Docker Compose

Jika seluruh env deployment termuat dengan benar:

```bash
cd /opt/flowdesk/current
docker compose ps
docker compose logs --tail 100 api
```

Dalam deployment ini, Compose dapat membutuhkan variable seperti:

```text
IMAGE_TAG
IMAGE_REGISTRY
POSTGRES_DB
POSTGRES_USER
```

Jika `docker compose` mengeluh variable kosong, jangan mengarang nilai. Untuk inspeksi container yang sudah hidup, gunakan command langsung:

```bash
docker logs
docker inspect
docker exec
docker restart
```

Hindari `docker compose up`, `down`, atau `pull` sampai sumber env dan prosedur deployment sudah dipastikan. `docker compose down` dapat menghentikan seluruh stack.

---

## 15. Pencarian file dan konfigurasi

Cari Compose files:

```bash
find /opt/flowdesk -type f \
  \( -name 'compose.yml' -o -name 'compose.yaml' -o -name 'docker-compose.yml' -o -name 'docker-compose.yaml' \) \
  2>/dev/null
```

Cari file env—hanya menampilkan nama file:

```bash
find /opt/flowdesk -type f -name '.env*' -print 2>/dev/null
```

Cari Caddyfile:

```bash
find /opt/flowdesk -type f -iname '*caddy*' -print 2>/dev/null
```

Cari referensi variable:

```bash
grep -RIl --exclude-dir='.git' 'IMAGE_TAG' /opt/flowdesk 2>/dev/null
```

Cari file yang berubah dalam 24 jam terakhir:

```bash
find /opt/flowdesk -type f -mmin -1440 -print 2>/dev/null
```

Gunakan `grep -RIl` untuk hanya menampilkan nama file. `grep -R` biasa dapat mencetak nilai secret jika pattern berada pada baris credential.

---

## 16. `journalctl` dan Docker daemon

Log system terbaru:

```bash
sudo journalctl -n 100 --no-pager
```

Error sejak satu jam terakhir:

```bash
sudo journalctl -p err --since '1 hour ago' --no-pager
```

Log Docker daemon:

```bash
sudo journalctl -u docker -n 100 --no-pager
```

Follow Docker daemon:

```bash
sudo journalctl -u docker -f
```

Status daemon:

```bash
sudo systemctl status docker --no-pager
```

Restart Docker daemon—**berdampak besar**:

```bash
sudo systemctl restart docker
```

Restart daemon dapat mengganggu seluruh container. Jalankan hanya bila ada bukti masalah berada di daemon Docker, bukan sekadar satu aplikasi.

---

## 17. Firewall dan SSH security

### Pemeriksaan firewall

```bash
sudo ufw status verbose
```

Idealnya port publik yang memang dibutuhkan hanya:

```text
22/tcp   SSH
80/tcp   HTTP
443/tcp  HTTPS
```

PostgreSQL `5432`, Redis `6379`, MinIO, dan port internal aplikasi tidak seharusnya terbuka ke seluruh internet.

Jangan mengubah rule UFW dari sesi SSH tunggal tanpa:

1. memastikan rule SSH sudah diizinkan;
2. menyimpan sesi SSH yang sekarang tetap terbuka;
3. membuka sesi kedua untuk menguji login;
4. mempunyai jalur recovery melalui console provider.

### Pemeriksaan konfigurasi SSH efektif

Lebih akurat daripada hanya membaca satu file:

```bash
sudo sshd -T \
  | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication) '
```

Cari override pada file konfigurasi:

```bash
sudo grep -RInE \
  '^[[:space:]]*(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null
```

Authorized keys user saat ini:

```bash
ls -ld ~/.ssh
ls -l ~/.ssh/authorized_keys
```

Permission ideal:

```text
~/.ssh                 700
~/.ssh/authorized_keys 600
```

Jangan mencetak atau membagikan private key. Isi `authorized_keys` adalah public key, tetapi tetap dapat mengungkap identitas/comment user; bagikan hanya jika perlu.

---

## 18. Process dan system monitoring

Semua process:

```bash
ps aux
```

Process paling banyak memakai RAM:

```bash
ps aux --sort=-%mem | head -n 15
```

Process paling banyak memakai CPU:

```bash
ps aux --sort=-%cpu | head -n 15
```

Cari process tertentu tanpa menangkap command pencarian itu sendiri:

```bash
pgrep -a docker
pgrep -a postgres
```

Load, user login, dan uptime:

```bash
uptime
w
```

Koneksi jaringan aktif:

```bash
ss -s
```

Tes DNS dan internet keluar:

```bash
getent hosts github.com
curl -I --max-time 10 https://github.com
ping -c 4 1.1.1.1
```

Catatan: ping dapat diblokir walaupun HTTP/HTTPS berfungsi. Gunakan beberapa sinyal sebelum menyimpulkan internet mati.

---

## 19. SCP: copy file Mac dan server

Semua command bagian ini dijalankan dari **terminal Mac**, bukan dari dalam sesi SSH.

Mac ke server:

```bash
scp ./file.txt flowdesk@206.189.89.33:/tmp/
```

Server ke folder Mac saat ini:

```bash
scp flowdesk@206.189.89.33:/tmp/file.txt ./
```

Copy folder Mac ke server:

```bash
scp -r ./folder flowdesk@206.189.89.33:/tmp/
```

Dengan SSH config alias:

```bash
scp ./file.txt flowdesk-staging:/tmp/
```

Aturan aman:

- Gunakan `/tmp` untuk transfer sementara, lalu pindahkan secara sadar.
- Jangan menimpa config aktif secara langsung dengan SCP.
- Verifikasi file setelah transfer dengan `ls -lh` dan checksum jika penting.
- Hindari menyalin database dump, `.env`, private key, atau data customer ke lokasi tidak terenkripsi.

Checksum di Mac dan server:

```bash
shasum -a 256 ./file.txt
ssh flowdesk@206.189.89.33 'sha256sum /tmp/file.txt'
```

---

## 20. Troubleshooting flow

### A. Website tidak bisa dibuka

1. Cek dari Mac:

   ```bash
   curl -iL --max-time 15 http://206.189.89.33/api/livez
   ```

2. SSH ke server dan cek Caddy:

   ```bash
   docker ps --filter 'name=flowdesk-staging-caddy-1'
   docker logs --tail 100 --timestamps flowdesk-staging-caddy-1
   ```

3. Cek port host:

   ```bash
   sudo ss -tulpn | grep -E ':(80|443)\b'
   ```

4. Cek API/web container dan log-nya.
5. Cek UFW hanya setelah memastikan service memang listen.

### B. `502 Bad Gateway`

1. Caddy hidup, tetapi upstream kemungkinan gagal.
2. Cek `api`, `web`, dan Docker network.
3. Cocokkan timestamp log Caddy dengan log upstream.
4. Periksa apakah container restart/OOM.
5. Validasi Caddyfile sebelum reload.

### C. API `500`

```bash
docker logs --since 15m --timestamps flowdesk-staging-api-1
docker inspect flowdesk-staging-api-1 \
  --format 'status={{.State.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
```

Lalu cek dependency:

- PostgreSQL menerima koneksi atau tidak.
- Redis menjawab `PONG` atau tidak.
- Migration/schema cocok dengan image aktif atau tidak.
- Env yang dibutuhkan tersedia atau tidak—jangan tampilkan secret ke publik.

### D. Container `Restarting` atau `Exited`

```bash
docker logs --tail 200 --timestamps NAMA_CONTAINER
docker inspect NAMA_CONTAINER \
  --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{printf "%q" .State.Error}}'
free -h
df -h
```

Restart hanya setelah log awal diambil. Kalau langsung restart, bukti penting dapat tenggelam.

### E. Database/RLS/organization aneh

1. Reproduksi behavior aplikasi terlebih dahulu.
2. Cocokkan request dengan log API.
3. Masuk dengan `flowdb`.
4. Cek `pg_stat_activity`, role koneksi API, dan `pg_policies`.
5. Pastikan tenant context/bootstrap flow benar.
6. Jangan menyelesaikan masalah dengan memberi `BYPASSRLS` ke role aplikasi.

Untuk validasi flow organisasi, uji end-to-end:

1. Login fresh/incognito.
2. Buat organization dengan slug unik.
3. Pastikan redirect ke dashboard.
4. Refresh; organization harus tetap terbaca.
5. Cek `GET /api/v1/organizations`; hasil tidak boleh tiba-tiba `[]`.
6. Buat slug yang sama; `409` dapat menjadi respons yang benar.

### F. Server terasa lambat

```bash
uptime
free -h
df -h
df -ih
docker stats --no-stream
ps aux --sort=-%mem | head -n 15
ps aux --sort=-%cpu | head -n 15
```

Cari OOM dan error kernel/system. Pisahkan masalah CPU, RAM, disk, network, database, dan aplikasi; “lambat” bukan satu jenis kegagalan.

### Prinsip troubleshooting utama

```text
Reproduce
  -> ukur dampak
  -> cek status
  -> ambil log bertimestamp
  -> isolasi layer yang rusak
  -> lakukan perubahan terkecil
  -> verifikasi health + behavior end-to-end
  -> catat hasil
```

Restart bukan diagnosis. Restart boleh memulihkan service sementara, tetapi akar masalah tetap harus ditemukan dari log, metrics, state container, dan pola kejadiannya.

---

## 21. Recommended aliases

Jalankan blok ini sekali di server sebagai user `flowdesk`:

```bash
cat >> ~/.bashrc <<'EOF'

# Flowdesk staging helpers
alias flow='cd /opt/flowdesk'
alias flowcurrent='cd /opt/flowdesk/current'
alias fps='docker ps --filter "name=flowdesk-staging-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'
alias fpa='docker ps -a --filter "name=flowdesk-staging-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"'
alias fapi='docker logs -f --tail 100 --timestamps flowdesk-staging-api-1'
alias fweb='docker logs -f --tail 100 --timestamps flowdesk-staging-web-1'
alias fworker='docker logs -f --tail 100 --timestamps flowdesk-staging-worker-1'
alias fscheduler='docker logs -f --tail 100 --timestamps flowdesk-staging-scheduler-1'
alias fingress='docker logs -f --tail 100 --timestamps flowdesk-staging-ingress-1'
alias fcaddy='docker logs -f --tail 100 --timestamps flowdesk-staging-caddy-1'
alias fpostgres='docker logs -f --tail 100 --timestamps flowdesk-staging-postgres-1'
alias fredis='docker logs -f --tail 100 --timestamps flowdesk-staging-redis-1'
alias fstats='docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}"'
alias fhealth='curl -i --max-time 10 http://206.189.89.33/api/livez'

flowdb() {
  docker exec -it flowdesk-staging-postgres-1 sh -lc \
    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}
EOF

source ~/.bashrc
```

Command harian setelah alias aktif:

| Command       | Fungsi                                      |
| ------------- | ------------------------------------------- |
| `flow`        | Masuk ke `/opt/flowdesk`                    |
| `flowcurrent` | Masuk ke release aktif                      |
| `fps`         | Container Flowdesk yang hidup               |
| `fpa`         | Semua container Flowdesk termasuk yang mati |
| `fapi`        | Follow 100 log API terakhir                 |
| `fweb`        | Follow log web                              |
| `fworker`     | Follow log worker                           |
| `fscheduler`  | Follow log scheduler                        |
| `fingress`    | Follow log ingress                          |
| `fcaddy`      | Follow log Caddy                            |
| `fpostgres`   | Follow log PostgreSQL                       |
| `fredis`      | Follow log Redis                            |
| `fstats`      | Snapshot CPU/RAM container                  |
| `fhealth`     | Health check publik                         |
| `flowdb`      | Masuk ke PostgreSQL                         |

Verifikasi setelah pemasangan:

```bash
type fps
type flowdb
fps
```

Kalau blok tidak aktif setelah login baru, cek shell yang digunakan:

```bash
echo "$SHELL"
```

Panduan ini memakai `~/.bashrc`, sesuai shell Bash yang umum di Ubuntu.

---

## 22. Command berbahaya yang harus dihindari

Jangan menjalankan command berikut tanpa tujuan jelas, backup, dan rencana recovery:

```bash
docker system prune -a
docker volume prune
docker compose down -v
sudo systemctl restart docker
```

Di PostgreSQL:

```sql
DROP DATABASE ...;
DROP SCHEMA ... CASCADE;
TRUNCATE ...;
DELETE FROM ...;
ALTER ROLE ... SUPERUSER;
ALTER ROLE ... BYPASSRLS;
```

Di Redis:

```text
FLUSHALL
FLUSHDB
KEYS *
```

Juga hindari:

- menghapus `/opt/flowdesk`, release, volume, atau database directory secara manual;
- menonaktifkan firewall atau SSH password/key protection secara membabi buta;
- membuka `5432`/`6379` ke seluruh internet;
- menempelkan `.env`, database URL, token, atau private key ke chat/ticket;
- mengubah file release aktif sebagai pengganti deployment yang terlacak;
- restart berulang tanpa mengambil log dan status terlebih dahulu.

---

## Checklist penutupan insiden

Sebelum menyatakan masalah selesai:

- [ ] Container yang relevan `Up` dan tidak restart loop.
- [ ] Health endpoint mengembalikan status yang diharapkan.
- [ ] Log baru tidak menghasilkan error yang sama.
- [ ] CPU, RAM, disk, dan inode berada dalam batas aman.
- [ ] Dependency penting—PostgreSQL/Redis—merespons.
- [ ] Behavior customer diuji end-to-end, bukan hanya `/livez`.
- [ ] Tidak ada secret yang terekspos selama troubleshooting.
- [ ] Perubahan yang dilakukan tercatat dan dapat di-rollback.
- [ ] Jika restart hanya memulihkan sementara, root cause tetap dibuatkan tindak lanjut.

---

Dokumen ini adalah panduan operasional untuk konfigurasi Flowdesk yang diketahui saat dibuat. Jika nama container, domain, endpoint, folder release, atau deployment workflow berubah, perbarui guide agar tetap menjadi sumber referensi yang akurat.
