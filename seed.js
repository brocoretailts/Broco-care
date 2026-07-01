const bcrypt = require('bcryptjs');
const { run, runWithResults, queryAll } = require('./database');

async function seed() {
  const users = queryAll("SELECT COUNT(*) as count FROM users");
  if (users[0].count > 0) {
    console.log('Database sudah memiliki data. Lewati seeding.');
    return;
  }

  console.log('Seeding database...');

  const hash = bcrypt.hashSync('password', 10);

  const userData = [
    ['admin', hash, 'Admin Broco', 'admin', '081234567890', 'admin@broco.com'],
    ['management', hash, 'Management Broco', 'management', '081234567891', 'management@broco.com'],
    ['teknisi1', hash, 'Ahmad Teknisi', 'teknisi', '081234567892', 'ahmad@broco.com'],
    ['teknisi2', hash, 'Budi Teknisi', 'teknisi', '081234567893', 'budi@broco.com'],
    ['teknisi3', hash, 'Cecep Teknisi', 'teknisi', '081234567894', 'cecep@broco.com'],
  ];

  for (const u of userData) {
    run("INSERT INTO users (username, password, name, role, phone, email) VALUES (?, ?, ?, ?, ?, ?)", u);
  }

  const productData = [
    ['CCTV001', 'CCTV Outdoor Smart', 'SC-8000', 24],
    ['DH001', 'Dehumidifier Smart', 'DH-12L', 12],
    ['RAC001', 'Remote AC Online', 'RAC-WIFI', 12],
    ['DL001', 'Smart Door Lock', 'DL-200', 24],
    ['CCTV002', 'CCTV Indoor Pro', 'SC-5000', 24],
    ['ACS001', 'AC Split Smart', 'AC-S900', 12],
    ['WCH001', 'Water Heater Smart', 'WH-300', 12],
    ['LMP001', 'Smart Lamp LED', 'SL-100', 6],
  ];

  for (const p of productData) {
    run("INSERT INTO products (kode_barang, nama_produk, tipe, garansi_bulan) VALUES (?, ?, ?, ?)", p);
  }

  const today = new Date();
  const fmt = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const now = fmt(today);
  const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const sampleData = [
    { no: 'SC-2026-000001', pid: 1, kode: 'CCTV001', cust: 'PT ABC', kota: 'Jakarta', keluhan: 'Tidak menyala', status: 'waiting', analysis: null, decision: null },
    { no: 'SC-2026-000002', pid: 4, kode: 'DL001', cust: 'Andi Wijaya', kota: 'Bandung', keluhan: 'Tidak bisa unlock', status: 'approval', analysis: 'Diduga motor lock macet', decision: null },
    { no: 'SC-2026-000003', pid: 2, kode: 'DH001', cust: 'Budi Santoso', kota: 'Surabaya', keluhan: 'Tidak mengering', status: 'scheduled', analysis: 'Filter kotor', decision: 'Servis' },
    { no: 'SC-2026-000004', pid: 3, kode: 'RAC001', cust: 'Citra Dewi', kota: 'Jakarta', keluhan: 'Remote tidak connect', status: 'on_progress', analysis: 'Baterai remote habis', decision: 'Servis' },
    { no: 'SC-2026-000005', pid: 1, kode: 'CCTV001', cust: 'PT Maju Jaya', kota: 'Bandung', keluhan: 'Gambar buram', status: 'completed', analysis: 'Lensa kotor', decision: 'Servis' },
    { no: 'SC-2026-000006', pid: 5, kode: 'CCTV002', cust: 'Sari Ningsih', kota: 'Medan', keluhan: 'Tidak connect wifi', status: 'completed', analysis: 'Setting ulang wifi', decision: 'Servis' },
    { no: 'SC-2026-000007', pid: 4, kode: 'DL001', cust: 'Joko Susilo', kota: 'Semarang', keluhan: 'Sensor error', status: 'rejected', analysis: 'Kerusakan akibat air', decision: 'reject' },
    { no: 'SC-2026-000008', pid: 2, kode: 'DH001', cust: 'PT Sejahtera', kota: 'Jakarta', keluhan: 'Bocor', status: 'waiting', analysis: null, decision: null },
    { no: 'SC-2026-000009', pid: 6, kode: 'ACS001', cust: 'Dewi Lestari', kota: 'Surabaya', keluhan: 'Tidak dingin', status: 'approval', analysis: 'Freon habis', decision: null },
    { no: 'SC-2026-000010', pid: 3, kode: 'RAC001', cust: 'Ahmad Fauzi', kota: 'Bandung', keluhan: 'Tombol tidak berfungsi', status: 'completed', analysis: 'Karet tombol rusak', decision: 'Servis' },
    { no: 'SC-2026-000011', pid: 7, kode: 'WCH001', cust: 'PT Indah Jaya', kota: 'Jakarta', keluhan: 'Tidak panas', status: 'completed', analysis: 'Element pemanas putus', decision: 'Ganti Unit' },
    { no: 'SC-2026-000012', pid: 1, kode: 'CCTV001', cust: 'Rina Marlina', kota: 'Bogor', keluhan: 'Power supply rusak', status: 'completed', analysis: 'PSU rusak', decision: 'Ganti Sparepart' },
    { no: 'SC-2026-000013', pid: 4, kode: 'DL001', cust: 'Deni Gunawan', kota: 'Tangerang', keluhan: 'Kunci macet', status: 'completed', analysis: 'Motor lock aus', decision: 'Ganti Unit' },
    { no: 'SC-2026-000014', pid: 2, kode: 'DH001', cust: 'Fitri Handayani', kota: 'Bandung', keluhan: 'Bau tidak sedap', status: 'completed', analysis: 'Bak air kotor', decision: 'Servis' },
    { no: 'SC-2026-000015', pid: 5, kode: 'CCTV002', cust: 'PT Karya Mandiri', kota: 'Jakarta', keluhan: 'Tidak menyala', status: 'on_progress', analysis: 'Diduga kabel putus', decision: 'Servis' },
  ];

  for (const t of sampleData) {
    var nowStr = new Date().toLocaleString('sv-SE');
    var approvedAt = (t.status !== 'waiting') ? nowStr : null;
    var closedAt = (t.status === 'completed' || t.status === 'rejected') ? nowStr : null;

    run(
      "INSERT INTO tickets (ticket_no, created_by, product_id, kode_barang, tanggal_complaint, customer_name, customer_alamat, customer_hp, customer_email, customer_kota, customer_provinsi, tanggal_pembelian, toko, marketplace, keluhan, status, admin_analysis, management_decision, management_comment, approved_by, approved_at, closed_by, closed_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'Jawa Barat', ?, 'Toko Elektronik', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        t.no, t.pid, t.kode, now,
        t.cust, `Jl. Contoh No. ${rnd(1, 100)}`,
        `0813${rnd(10000000, 99999999)}`,
        `customer${rnd(1, 999)}@email.com`,
        t.kota,
        fmt(new Date(today.getTime() - rnd(1, 90) * 86400000)),
        rnd(0, 1) ? 'Tokopedia' : 'Shopee',
        t.keluhan, t.status,
        t.analysis || null,
        t.decision || null,
        t.decision === 'reject' ? 'Barang tidak dalam garansi' : null,
        (t.status !== 'waiting') ? 2 : null,
        approvedAt,
        (t.status === 'completed') ? 1 : null,
        closedAt
      ]
    );
  }

  const ticketsForSchedule = queryAll("SELECT id, ticket_no FROM tickets WHERE status IN ('scheduled','on_progress','completed')");
  for (const tk of ticketsForSchedule) {
    run(
      "INSERT INTO schedules (ticket_id, teknisi_id, tanggal, jam, created_by) VALUES (?, ?, ?, ?, 1)",
      [tk.id, (tk.id % 3) + 3, now, `${8 + (tk.id % 8)}:00`]
    );
  }

  const completedTickets = queryAll("SELECT id, ticket_no FROM tickets WHERE status = 'completed'");
  const solusiOptions = ['Servis', 'Ganti Sparepart', 'Ganti Unit'];
  for (const tk of completedTickets) {
    const solusi = solusiOptions[Math.floor(Math.random() * solusiOptions.length)];
    run(
      "INSERT INTO visit_results (ticket_id, teknisi_id, tanggal, jam, hasil_pemeriksaan, solusi, sparepart, tanggal_selesai) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [tk.id, (tk.id % 3) + 3, now, `${8 + (tk.id % 8)}:00`,
       'Ditemukan kerusakan pada komponen. Dilakukan perbaikan sesuai prosedur.',
       solusi,
       solusi === 'Ganti Sparepart' ? 'Sparepart standar' : null,
       now]
    );
  }

  const notifMessages = [
    [1, null, 'Complaint baru: SC-2026-000001 dari PT ABC membutuhkan approval', '/admin/tickets/1'],
    [2, null, 'Ada ticket baru menunggu approval Anda', '/management/approval'],
    [1, null, 'Management telah menyetujui ticket SC-2026-000002', '/admin/tickets/2'],
    [3, null, 'Anda mendapat jadwal kunjungan baru untuk ticket SC-2026-000003', '/teknisi/visit/3'],
    [1, null, 'Teknisi telah mengupload hasil kunjungan untuk SC-2026-000004', '/admin/tickets/4'],
  ];

  for (const n of notifMessages) {
    run("INSERT INTO notifications (user_id, role, message, link) VALUES (?, ?, ?, ?)", n);
  }

  run("INSERT INTO activity_log (ticket_id, user_id, action, description) SELECT id, 1, 'create', 'Ticket dibuat' FROM tickets");
  run("INSERT INTO activity_log (ticket_id, user_id, action, description) SELECT id, 2, 'approve', 'Disetujui Management' FROM tickets WHERE status IN ('scheduled','on_progress','completed')");
  run("INSERT INTO activity_log (ticket_id, user_id, action, description) SELECT id, 1, 'close', 'Ticket ditutup' FROM tickets WHERE status = 'completed'");

  console.log('Seeding selesai!');
  console.log('');
  console.log('Akun login:');
  console.log('  Admin      : admin / password');
  console.log('  Management : management / password');
  console.log('  Teknisi 1  : teknisi1 / password');
  console.log('  Teknisi 2  : teknisi2 / password');
  console.log('  Teknisi 3  : teknisi3 / password');
}

module.exports = { seed };
