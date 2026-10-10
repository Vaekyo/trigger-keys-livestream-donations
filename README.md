# Donation Controls: Valorant (Tako.id + Trakteer.id)

Donasi dari penonton (IDR) → aksi keyboard/mouse di Valorant + alert di OBS.
Aplikasi lokal Windows, Python, 2 dependency (`aiohttp`, `PyYAML`).

```
Trakteer (webhook / websocket) ─┐
Tako (webhook)  ── tunnel ──────┼─► app (127.0.0.1) ─► antrian ─► cek: ON? cooldown? Valorant fokus?
Panel test / CLI ───────────────┘                         │
                                                          ├─► SendInput (keyboard / gerak mouse)
                                                          ├─► overlay OBS (alert + badge ON/PAUSED)
                                                          └─► Streamer.bot (action alert / status)
```

> ⚠️ **Baca dulu: risiko anti-cheat.** App ini hanya memakai `SendInput` standar Windows:
> tanpa driver, tanpa baca memori, tanpa menyembunyikan diri dari Vanguard. Klik mouse hanya dipakai untuk
> **konfirmasi skill/ult** setelah tombolnya ditekan; tidak ada auto aim / logika menembak. Tapi input buatan di game kompetitif tetap area abu-abu
> di ToS Riot, jadi risikonya kamu tanggung sendiri. Tes dulu di **Practice Range**. Kalau Valorant
> **mengabaikan** input dari app ini, **berhenti di situ**; app ini sengaja tidak mencoba mengakalinya.

---

## 1. Ringkasan riset (Okt 2026)

| Platform | Metode | Auth | Catatan |
|---|---|---|---|
| **Trakteer** | Webhook resmi (`trakteer.id/manage/webhook`) | header `X-Webhook-Token` | Field: `transaction_id`, `supporter_name`, `supporter_message`, `price`, `net_amount`… Perlu URL publik (tunnel). |
| **Trakteer** | WebSocket resmi (tab "Via Websocket", protokol Pusher `socket.trakteer.id`) | My Channel ID | **Tanpa tunnel.** Fitur masih beta. |
| **Tako** | API callback (`tako.id/me/api-keys`, sejak v1.8.0 Juli 2025) | header `X-Tako-Signature` = HMAC-SHA256(body, Callback Secret) | Event `payment.success` + `data.amount`. Nama/pesan via `GET /api/v1/gift/{id}`. Format diambil dari kode komunitas, **belum ada dokumen resmi publik**. |
| **Tako** | Webhook menu Integrasi | `?key=` rahasia di URL | Format payload tidak terdokumentasi publik; parser dibuat toleran. |
| **Streamer.bot** | Tidak ada integrasi native Tako/Trakteer | – | Bisa dipicu lewat WebSocket API (`DoAction`). |

**Trade-off (kenapa desainnya begini):**
1. Full Streamer.bot: tidak ada integrasi Tako/Trakteer; verifikasi token/HMAC, cek fokus, antrian, rate limit, dan "lepas semua tombol saat error" harus ditulis manual di C# → rapuh.
2. Service Python kecil (dipilih): `SendInput` via `ctypes` tanpa compile apa pun; satu proses mengurus webhook + antrian + keamanan + overlay, sementara Streamer.bot tetap dipakai untuk alert/Stream Deck.
3. Trakteer: WebSocket (tab "Via Websocket") tidak butuh tunnel, jadi jadi default. Webhook HTTP jadi cadangan.
4. Tako: hanya webhook (butuh tunnel). Field-nya belum dikonfirmasi resmi, jadi `LOG_RAW_WEBHOOKS=1` menyimpan payload mentah untuk dicek.
5. Risiko: Vanguard/Riot bisa mengabaikan atau menandai input buatan; tidak ada workaround (lihat peringatan).

---

## 2. Instalasi (Windows)

1. Install **Python 3.13** dari <https://python.org> (centang *Add python.exe to PATH*). Kalau ada beberapa versi Python,
   `start.bat` otomatis memilih 3.13, 3.12 atau 3.11 dulu (versi yang terbukti jalan di v7).
2. Download / clone repo ini.
3. Klik dua kali **`start.bat`**. Saat pertama kali, script ini akan:
   - membuat `.venv` dan menginstall dependency,
   - membuat `.env` dari `.env.example`,
   - menjalankan app. Console menampilkan URL panel, overlay, dan webhook.
4. Tutup app (Ctrl+C), lalu isi **`.env`** (lihat langkah 3 dan 4). Jalankan `start.bat` lagi.

> Jalankan app **bukan sebagai Administrator** (Valorant juga normalnya tidak). Windows memblokir
> input dari proses yang "levelnya" berbeda dengan game.

---

## 3. Sambungkan Trakteer

**Pilihan A: Via Websocket (disarankan, TANPA ngrok)** · `.env`: `TRAKTEER_MODE=websocket`
1. Buka <https://trakteer.id/manage/webhook>, lalu tab **Via Websocket**.
2. Salin **My Channel ID** ke `TRAKTEER_CHANNEL_ID=` di `.env`, lalu simpan dan restart `start.bat`.
3. Di console harus muncul `Trakteer: siap menerima donasi`.
4. Kirim notifikasi tes dari dashboard Trakteer; tes itu harus muncul di log panel.
   (`TRAKTEER_WS_TEST_CHANNEL=1` membuat tes ikut masuk.)

Channel ID itu sama seperti password untuk melihat donasi masuk, jadi jangan dishare.

**Pilihan B: Via Http / webhook (butuh ngrok)** · `.env`: `TRAKTEER_MODE=webhook`
1. Jalankan tunnel ke port webhook (lihat bagian 5).
2. Tab **Via Http** → Webhook URL: `https://ALAMAT-NGROK/webhook/trakteer`.
   **Bukan** `http://127.0.0.1...`, karena server Trakteer tidak bisa menjangkau PC kamu (error 403 / 1003).
3. Salin **My Webhook Token** ke `TRAKTEER_WEBHOOK_TOKEN=` di `.env`, lalu restart.
4. Klik **Send Webhook Test**; harus muncul status 200.

Pakai **salah satu** saja, supaya satu donasi tidak terhitung dua kali.

## 4. Sambungkan Tako

**Cara A: API Callback (disarankan, ada tanda tangan HMAC)**
1. Buka <https://tako.id/me/api-keys> dan buat API Key.
2. **Callback URL**: `https://ALAMAT-TUNNEL/webhook/tako`
3. **Callback Secret**: isi teks acak panjang, lalu salin yang sama ke `TAKO_CALLBACK_SECRET=`.
4. Salin API key ke `TAKO_API_KEY=` (dipakai untuk mengambil nama dan pesan donatur).

**Cara B: Webhook menu Integrasi**
1. Isi `TAKO_WEBHOOK_KEY=` dengan teks acak.
2. URL webhook di Tako: `https://ALAMAT-TUNNEL/webhook/tako?key=TEKS_ACAK_TADI`

Lalu kirim donasi kecil ke akun sendiri dan cek `logs/raw_webhooks.jsonl`. Kalau nominal/nama
terbaca salah, kirim isi file itu ke developer (tanpa token) supaya parser-nya disesuaikan.

## 5. Tunnel (untuk webhook)

Tunnel **hanya** ke port webhook **8788**. Port 8787 (panel/kontrol) jangan pernah di-tunnel.

- **Cloudflare (gratis):** install `cloudflared`, lalu jalankan
  `cloudflared tunnel --url http://localhost:8788`. Alamat `https://xxxx.trycloudflare.com` akan
  **berganti setiap kali dijalankan**, jadi URL di Trakteer/Tako harus diupdate tiap stream.
  Supaya permanen, pakai *named tunnel* + domain sendiri.
- **ngrok:** akun gratis dapat 1 domain statis:
  `ngrok http --url=NAMA.ngrok-free.app 8788`. URL-nya tetap, jadi cukup diisi sekali.

## 6. OBS

Tambah **Browser Source**:

| Source | URL | Ukuran |
|---|---|---|
| Alert + badge | `http://127.0.0.1:8787/overlay` | 1920×1080 |
| Hanya badge | `http://127.0.0.1:8787/overlay?alerts=0` | 1920×1080 |
| Hanya alert | `http://127.0.0.1:8787/overlay?badge=0` | 1920×1080 |
| Price list | `http://127.0.0.1:8787/pricelist` | 460×720 |

Suara: taruh file `.mp3` di folder `sounds/`, lalu di `config.yaml` isi `sound: /sounds/nama.mp3`
(per aksi) atau `overlay.default_sound`. Centang **Control audio via OBS** di Browser Source.

## 7. Streamer.bot + Stream Deck

1. Streamer.bot → **Servers/Clients → WebSocket Server** → Start (default `127.0.0.1:8080`, password opsional).
2. `.env`: `STREAMERBOT_ENABLED=1`, isi `STREAMERBOT_PASSWORD` kalau diaktifkan.
3. Buat action **`Donation Control Alert`**: dijalankan setiap aksi donasi dimulai, dengan argumen
   `%donor%`, `%amount%`, `%amountText%`, `%action%`, `%message%`, `%platform%`. Pakai untuk TTS, efek,
   scene, atau memicu Vfinity / alat lain yang sudah terhubung ke Streamer.bot.
4. (Opsional) action **`Donation Control State`**: argumen `%state%` (`ON`/`PAUSED`), misalnya untuk
   mengganti ikon tombol Stream Deck.
5. **Tombol kill switch di Stream Deck:** isi `CONTROL_TOKEN=` (teks acak) di `.env`. Di Streamer.bot,
   buat action dengan sub-action **Fetch URL**:
   `http://127.0.0.1:8787/api/toggle?token=ISI_TOKEN` (atau `/api/pause`, `/api/resume`).
   Hubungkan action itu ke tombol Stream Deck lewat plugin Streamer.bot.

## 7b. Buka panel dari HP / MacBook

Supaya tidak perlu keluar dari Valorant:
1. HP/MacBook harus di **WiFi yang sama** dengan PC gaming.
2. `config.yaml` → `server.allow_lan: true` (sudah default).
3. Jalankan `start.bat`. Di console muncul baris **Panel di HP/Mac**, contoh
   `http://192.168.1.20:8787/panel?token=aW13jtzj`. Buka link itu **persis** (dengan token) di HP/Mac,
   lalu bookmark. Setelah sekali dibuka, token disimpan di browser.
4. Saat pertama kali, Windows Firewall akan bertanya: centang **Private networks**, lalu **Allow access**.
   Kalau terlanjur ditolak: Windows Security → Firewall → *Allow an app through firewall* → centang Python (Private).

Tanpa token, orang lain di WiFi yang sama tidak bisa membuka panel. Token ada di `logs/panel_token.txt`
(atau pakai `CONTROL_TOKEN` di `.env`). Port webhook (8788) tetap hanya bisa diakses dari PC itu sendiri.
Jangan nyalakan `allow_lan` di WiFi publik.

---

## 8. Keamanan & kontrol

- **Kill switch: `F12`** (global, tetap jalan saat Valorant fokus). Begitu ditekan, aksi yang sedang berjalan
  berhenti, **semua tombol dilepas**, dan status jadi PAUSED. Tekan lagi untuk ON.
  App **mulai dalam keadaan PAUSED** (`start_paused: true`).
  Kalau F12 tidak jalan (Windows kadang mencadangkan F12 untuk debugger), ganti `kill_switch_key` ke `F10`, `PAUSE`,
  atau `CTRL+SHIFT+P`, lalu restart.
- **Antrian (tanpa cooldown):** semua donasi masuk antrian dan dijalankan **satu per satu, berurutan**.
  Jeda kecil `gap_between_actions_s` (0,5 dtk) supaya aksi tidak menempel; batas pengaman `max_actions_per_minute` (60).
- **Batas:** hold/spam/jitter/wait maksimal `max_hold_s` (10 dtk); satu aksi maksimal `max_action_s` (20 dtk).
  Setiap tombol yang ditekan **selalu dilepas** di akhir, termasuk saat error, timeout, atau kill switch.
- **Fokus:** input hanya dikirim kalau jendela aktif adalah `VALORANT-Win64-Shipping.exe`. Kalau tidak,
  donasi menunggu (`when_unfocused: wait`) atau dilewati (`skip`). Donasi yang menunggu lebih dari
  `max_queue_age_s` dilewati, dan overlay tetap mengucapkan terima kasih.
- **Anti-duplikat:** ID transaksi yang sama diabaikan (tetap diingat setelah restart, di `logs/seen_ids.txt`).
- **Log:** semua event ada di `logs/events.jsonl` (waktu, platform, donatur, nominal, aksi, hasil).
- **Mouse:** hanya klik (konfirmasi skill/ult) dan gerak relatif (*spin*, *drunk aim*). Tidak ada aim.

## 9. Atur aksi (`config.yaml`)

Diedit langsung, **otomatis dimuat ulang** saat disimpan. Kalau ada salah ketik, error muncul di console dan config lama tetap dipakai.
Aturan pemilihan: **tier tertinggi yang `min_amount` ≤ nominal**. Aksi `enabled: false` dilewati,
dan tier di bawahnya yang dipakai.

Tier bawaan (kelipatan Rp2.000):

| Nominal | Aksi | Input |
|---|---|---|
| Rp2.000 | Jump | Space |
| Rp4.000 | Crouch spam 3 dtk | Ctrl berulang |
| Rp6.000 | Skill random | C / Q / E → K |
| Rp8.000 | Drop weapon | G |
| Rp10.000 | Ultimate | X → K |

**Wajib di Valorant:** Settings → Controls → Combat → **Fire** → isi tombol **kedua** = `K`.
Skill/ult dipakai lewat tombol K (keyboard), bukan klik mouse.

```yaml
- name: Random skill
  min_amount: 6000
  enabled: true
  overlay_text: "Pakai skill random"
  sound: /sounds/skill.mp3
  steps:
    - random_tap: [C, Q, E]   # pilih skill
    - wait: 900               # tunggu animasi skill keluar (ms; 1000 = 1 detik)
    - hold: {key: K, ms: 150} # pakai skill (Fire kedua)
```

Tampilan nominal: **1 WHISKAS = Rp1.000**, jadi Rp6.000 tampil "6 WHISKAS" (`overlay.money_divisor: 1000`,
`overlay.money_format: "{amount} WHISKAS"`). Untuk Rupiah lagi: `money_divisor: 1` dan `money_format: "Rp{amount}"`.
`min_amount` di config tetap angka Rupiah dari Tako/Trakteer. Di panel, kolom Nominal diisi dalam WHISKAS (mis. 6).

Angka `wait`/`ms` dalam **milidetik** (1000 = 1 detik). Kalau skill belum sempat keluar saat K ditekan,
naikkan `wait` (mis. 1200). Kolom **Hasil** di log panel menunjukkan tombol yang benar-benar dikirim,
contoh `ok | tombol: Q → K`.

Step: `tap`, `random_tap`, `click`, `hold`, `spam`, `wait`, `mouse`, `jitter`. Penjelasannya ada di bagian atas `config.yaml`.
Keybind bawaan = default Valorant (Space, Ctrl, C/Q/E, G, X). Ganti kalau bind kamu beda.
Mau tambah tier? Salin satu blok, ganti `name` dan `min_amount` (mis. 12000), simpan.

Catatan: aksi default hanya pakai keyboard. (Error 87 di versi v1–v11 ternyata bug di app sendiri: di Python 3.14
data tombol terkirim ke Windows sebagai data mouse. Sudah diperbaiki di v12.)
`safety.fire_key: K` membuat setiap step `click: LEFT` (misalnya dari config versi lama) otomatis menekan **K**,
bukan klik mouse. Kosongkan `fire_key` hanya kalau memang mau klik mouse sungguhan.
Kalau skill sedang tidak ada charge, tombol K (Fire) akan menembakkan senjata sekali ke arah mana pun
kamu sedang melihat. `selftest.bat` bisa dipakai untuk cek input keyboard/mouse di desktop.

---

## 10. TEST MODE: wajib sebelum live

Semua tes ini **tanpa uang sungguhan**.

**A. Tes aman tanpa game (dry run)**
1. `config.yaml` → `dry_run: true`. Jalankan `start.bat`.
2. Buka panel <http://127.0.0.1:8787/panel> dan overlay di OBS.
3. Klik **ON**, lalu klik tombol-tombol tier. Overlay muncul, dan log menampilkan tombol yang *akan* ditekan.
4. Tes anti-duplikat: isi "ID donasi" yang sama lalu kirim 2×. Kiriman kedua harus `duplicate`.
5. Tes alur webhook lengkap (token/HMAC ikut dicek):
   ```
   simulate.bat 4000 --via trakteer --name Budi
   simulate.bat 10000 --via tako --name Caca --message "ult dong!"
   simulate.bat 2000 --id abc --id-repeat
   simulate.bat pause   |   simulate.bat resume
   ```

**B. Practice Range (input sungguhan)**
1. `dry_run: false`. Buka Valorant → **Practice Range**.
2. Di panel, klik **ON** (atau tekan F12), lalu klik tier `Rp2.000 · Jump`, dan **langsung klik ke jendela Valorant**
   (aksi menunggu sampai Valorant fokus).
3. Cek satu per satu: Jump, Crouch spam, Skill (+K), Drop, Ult (+K).
4. **Tes kill switch:** picu `Rp4.000 · Crouch spam`, lalu tekan **F12** di tengah jalan. Karakter harus langsung
   berhenti jongkok-berdiri dan status jadi PAUSED.
5. **Tes antrian:** klik beberapa tier cepat-cepat. Semua harus jalan berurutan, satu per satu.
6. Alt-Tab ke aplikasi lain lalu picu aksi: harus **menunggu** dan tidak mengetik di aplikasi lain.

> ❗ Kalau di Practice Range **tidak ada reaksi sama sekali** (padahal log bilang `ok` dan mode `LIVE`),
> berarti Valorant/Vanguard mengabaikan input buatan. **Berhenti**, jangan diakali. Kabari developer.

**C. Tes platform asli**
- Trakteer: tombol *Send Webhook Test* (mode webhook) atau tombol test overlay (mode websocket).
- Tako: donasi kecil ke akun sendiri, lalu cek log dan `logs/raw_webhooks.jsonl`.

---

## Struktur file

```
app/__main__.py     start app, server, hotkey
app/engine.py       antrian, cooldown, rate limit, fokus, step runner (lepas tombol di finally)
app/inputs.py       SendInput Windows + dry-run + hotkey global
app/platforms.py    Trakteer & Tako: auth + parsing + WebSocket Trakteer
app/streamerbot.py  client WebSocket Streamer.bot
app/server.py       webhook (8788) dan panel/overlay/API (8787)
app/simulate.py     CLI test mode
app/selftest.py     tes keyboard/mouse di desktop (selftest.bat)
web/                overlay.html, pricelist.html, panel.html
config.yaml         aksi + pengaturan keamanan
.env.example        template token/rahasia
tests/              unit test (python -m unittest discover tests)
```

## Masalah umum

| Gejala | Solusi |
|---|---|
| Webhook `401 unauthorized` | Token/secret di `.env` beda dengan dashboard. Restart app setelah mengubah `.env`. |
| Tidak ada yang terjadi | Status masih PAUSED? Mode DRY-RUN? Valorant fokus? Lihat "Aksi sekarang" di panel. |
| "Hotkey gagal didaftarkan" | Tombol dipakai aplikasi lain. Ganti `kill_switch_key`. |
| Donasi dobel | Trakteer: pakai satu mode saja (webhook **atau** websocket). |
| Trakteer webhook 403 / error 1003 | Webhook URL masih `127.0.0.1`. Pakai alamat ngrok, atau pindah ke mode websocket. |
| `SendInput gagal (error 87)` | Pastikan pakai v12 atau lebih baru (bug Python 3.14 sudah diperbaiki). Kalau masih, jalankan `selftest.bat` dan kirim hasilnya. |
| Skill cuma terpilih, tidak terpakai | 1) Fire kedua = `K` sudah di-set di Valorant? Tes tekan K manual. 2) Naikkan `wait` sebelum K (mis. 1200). |
| Panel tidak bisa dibuka dari HP | WiFi sama? Link lengkap dengan `?token=`? Firewall Windows mengizinkan Python (Private)? |

## Sumber riset
- Trakteer, *Panduan Webhook*: <https://help.trakteer.id/help-center/articles/70/panduan-webhook>
- Trakteer, artikel webhook: <https://medium.com/trakteer/tingkatkan-efisiensi-komunikasi-dengan-fitur-webhook-di-trakteer-ce89bc2a0051>
- Contoh payload WebSocket Trakteer: <https://gist.github.com/rmdwirizki/e7b1507f08d993b8a68aceb28ed41c9a>
- Library komunitas `trakteerjs` (WebSocket Pusher): <https://www.npmjs.com/package/trakteerjs>
- Tako changelog (API v1.8.0): <https://help.tako.id/en/article/changelog-takos-update-kt4izf/>
- Contoh callback Tako (`X-Tako-Signature`, `payment.success`): <https://github.com/sundanese2727/tako-relay>
- Streamer.bot WebSocket client resmi (`DoAction`, auth): <https://www.npmjs.com/package/@streamerbot/client>
- Daftar integrasi Streamer.bot: <https://docs.streamer.bot/guide/integrations>
