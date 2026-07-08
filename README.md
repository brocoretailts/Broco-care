# Broco Smart Care - CMS

Sistem manajemen service center untuk menangani komplain dan garansi produk elektronik/retail.

**URL:** https://broco-care.tech

---

## Alur Kerja Lengkap

```
Konsumen ──▶ CS ──▶ Admin ──▶ Management ──▶ Admin ──▶ CS ──▶ Konsumen
  (komplain)   (buat tiket)  (analisa)      (approve)  (jadwal+  (kirim link
                                                         voucher)   voucher)
                                                                       │
                                                                  Teknisi
                                                                  (kunjungan)
```

### 1. CS Menerima Komplain
- CS membuat **ticket** baru via menu **Buat Ticket**
- Mengisi data konsumen, produk, keluhan, upload foto/video
- Ticket otomatis masuk ke Admin dengan status **Waiting**

### 2. Admin Analisa
- Admin buka **Daftar Ticket** → klik ticket
- Isi **Analisa Admin** → klik **Kirim ke Management**
- Status berubah: **Approval**
- Notifikasi dikirim ke: Management (WA + notifikasi web), CS (notifikasi web)

### 3. Management Approve / Tolak
- Management buka menu **Approval** → tab **Pending**
- Pilih keputusan: **Servis** / **Ganti Unit** / **Tolak**
- Jika ditolak: ticket status **Rejected**, Admin & CS mendapat notifikasi
- Jika disetujui: ticket status **Waiting**, Admin dapat notifikasi

### 4. Admin Jadwal + Voucher
- Buka ticket → **Atur Jadwal** (pilih teknisi, tanggal, jam)
- Buat **Voucher Garansi** (tentukan tanggal berlaku)
- Generate Voucher → muncul **nomor unik + QR code**
- Voucher bisa **dicetak** atau **dilihat** kapan saja

### 5. CS Kirim Link ke Konsumen
- CS dapat notifikasi "Voucher sudah diterbitkan"
- Buka notifikasi → halaman voucher
- Klik **Salin Link Verifikasi**
- Paste link ke WhatsApp pribadi CS dan kirim ke konsumen

### 6. Teknisi Kunjungan
- Teknisi login, buka **Dashboard** → lihat jadwal hari ini
- Klik **Mulai Kunjungan** → isi **hasil pemeriksaan**
- Upload foto sebelum/sesudah, catat sparepart yang digunakan

### 7. Admin Tutup Ticket
- Setelah teknisi selesai dan konsumen terima hasil
- Admin klik **Tutup Ticket** → status **Completed**

---

## Fungsi per Role

### 👤 Admin
| Menu | Fungsi |
|------|--------|
| **Dashboard** | Statistik ticket, grafik, notifikasi |
| **Daftar Ticket** | Lihat, filter, analisa, atur jadwal, generate voucher, tutup ticket |
| **Buat Ticket** | Input manual ticket baru |
| **Kalender Jadwal** | Lihat jadwal teknisi per tanggal |
| **Master Produk** | Kelola data produk & garansi |
| **Master Teknisi** | Tambah/edit/aktifkan teknisi |
| **WhatsApp** | Scan QR, status koneksi, cek pesan gagal |
| **Pengaturan** | Profil, ubah password, kelola user, backup/restore database, **edit ketentuan voucher** |
| **Notifikasi** | Daftar notifikasi masuk |
| **Debug Logs** | Log error untuk troubleshooting |

### 👤 Customer Service (CS)
| Menu | Fungsi |
|------|--------|
| **Dashboard** | Statistik ticket milik CS |
| **Buat Ticket** | Input ticket dari komplain konsumen |
| **Ticket Saya** | Daftar ticket yang dibuat CS, lihat status & keputusan |
| **Notifikasi** | Notifikasi saat ticket diproses/ditolak/disetujui/voucher terbit |

### 👤 Management
| Menu | Fungsi |
|------|--------|
| **Dashboard** | Statistik approval & ticket |
| **Approval** | - **Pending:** Setujui/tolak ticket<br>- **Sudah Diproses:** Reset approval jika ada kesalahan |
| **Riwayat Approval** | Log semua keputusan approval |
| **Laporan** | Rekap data ticket & keputusan |
| **Notifikasi** | Notifikasi saat ada ticket baru perlu approval |

### 👤 Teknisi
| Menu | Fungsi |
|------|--------|
| **Dashboard** | Jadwal kunjungan hari ini |
| **Kunjungan** | Isi hasil pemeriksaan, upload foto, catat sparepart |
| **Riwayat** | Daftar semua kunjungan yang sudah dilakukan |

### 🌐 Publik (tanpa login)
| Halaman | Fungsi |
|---------|--------|
| **Verifikasi Voucher** | Scan QR → validasi voucher via token unik |

---

## Fitur Khusus

### Voucher Garansi QR
- Nomor unik + token QR **64 karakter** (cryptographic random)
- Konsumen scan QR → buka `https://broco-care.tech/voucher/TOKEN`
- Halaman verifikasi menunjukkan data voucher & status
- Bisa di cetak / disimpan sebagai PDF
- Link verifikasi bisa disalin dan dikirim manual oleh CS

### Approval + Reset
- Management bisa **reset approval** untuk ticket yang sudah diproses
- Ticket kembali ke antrian approval untuk keputusan ulang
- Semua riwayat approval tercatat di **Riwayat Approval**

### Notifikasi
- Notifikasi web (bell icon) untuk semua role
- WhatsApp ke Management saat ada ticket baru perlu approval
- WhatsApp ke Admin saat ticket disetujui/ditolak
- CS mendapat notifikasi di setiap tahap

### WhatsApp Gateway
- Menggunakan **Bailejs** (library WA WebJS)
- Scan QR dari menu **WhatsApp** untuk menghubungkan
- Auto-reconnect jika putus
- Pesan gagal tersimpan dan bisa dikirim ulang

---

## Login Default

| Username | Password | Role |
|----------|----------|------|
| admin | password | Administrator |
| management | password | Management |
| cs | password | Customer Service |
| teknisi | password | Teknisi |

> **Penting:** Segera ganti password setelah login pertama!

---

## Teknologi

- **Backend:** Node.js, Express.js
- **Database:** SQLite (better-sqlite3)
- **Frontend:** Bootstrap 5, EJS
- **WhatsApp:** Baileys (WebSocket)
- **QR Code:** qrcode npm
- **Deploy:** VPS Hostinger (Ubuntu), Nginx, PM2, Let's Encrypt SSL
