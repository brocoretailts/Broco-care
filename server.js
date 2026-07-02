require('dotenv').config();
process.env.TZ = 'Asia/Jakarta';
require('express-async-errors');
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');

const Database = require('better-sqlite3');
const { initDB, closeDB, run, runWithResults, queryAll, queryOne, SQLiteSessionStore, checkpoint, ensureTursoTables, syncLocalToTurso, exportTursoToLocal, prepareBackup, nowWIB } = require('./database');
const { seed } = require('./seed');
const { isAuthenticated, isAdmin, isManagement, isTeknisi, redirectIfAuthenticated } = require('./middleware/auth');
const wa = require('./whatsapp');
const cloudinary = require('./cloudinary');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const ALLOWED_MIMES = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf','video/mp4','video/webm','video/quicktime'];
function fileFilter(req, file, cb) {
  if (ALLOWED_MIMES.includes(file.mimetype)) return cb(null, true);
  console.log('Multer rejected file:', file.fieldname, file.originalname, file.mimetype);
  cb(null, false);
}
const upload = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

async function saveUploadedFile(file) {
  if (!file) return null;
  if (cloudinary.USE_CLOUDINARY) {
    try {
      return await cloudinary.uploadBuffer(file.buffer);
    } catch (e) {
      console.error('Cloudinary upload failed:', e.message);
      return null;
    }
  }
  const dir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 6)}${ext}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return filename;
}

process.on('unhandledRejection', function(reason) {
  console.error('UNHANDLED REJECTION:', reason instanceof Error ? reason.message : reason);
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.imgUrl = (p) => { if (!p) return ''; if (p.startsWith('http')) return p; return '/uploads/' + p; };
  next();
});

/* ============= RATE LIMIT (login brute-force) ============= */
var loginAttempts = {};
setInterval(function() { loginAttempts = {}; }, 15 * 60 * 1000);

/* ============= CSRF protection ============= */
function csrfToken(req, res, next) {
  if (req.session.user && !req.session.csrf) {
    req.session.csrf = require('crypto').randomBytes(24).toString('hex');
  }
  res.locals.csrf = req.session.csrf || '';
  if (req.method === 'POST' && req.session.user && !req.is('multipart/form-data')) {
    var token = req.body._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrf) {
      return res.status(403).send('Invalid CSRF token. Silakan refresh halaman.');
    }
  }
  next();
}
app.use(csrfToken);

function validateCsrf(req, res, next) {
  var token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrf) {
    return res.status(403).send('Invalid CSRF token. Silakan refresh halaman.');
  }
  next();
}

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  if (req.session.user) {
    try {
      res.locals.notifCount = await getNotifCount(req.session.user);
      res.locals.notifs = await getNotifs(req.session.user);
    } catch (e) {
      res.locals.notifCount = 0;
      res.locals.notifs = [];
    }
  } else {
    res.locals.notifCount = 0;
    res.locals.notifs = [];
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

async function getManagementPhones() {
  const users = await queryAll("SELECT phone FROM users WHERE role = 'management' AND phone IS NOT NULL");
  return [...new Set(users.map(u => u.phone).filter(Boolean))];
}

async function getAdminPhones() {
  const users = await queryAll("SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL");
  return [...new Set(users.map(u => u.phone).filter(Boolean))];
}

async function getAdminIds() {
  const users = await queryAll("SELECT id FROM users WHERE role = 'admin'");
  return users.map(u => u.id);
}

async function getTeknisiPhone(teknisiId) {
  const u = await queryOne("SELECT phone FROM users WHERE id = ?", [teknisiId]);
  return u ? u.phone : null;
}

function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'IP_ANDA';
}

/* ============= STARTUP ============= */

initDB();

async function startup() {
  try {
    await ensureTursoTables();
    await seed();
  } catch (e) {
    console.error('Startup DB error (non-fatal):', e.message);
  }
  wa.init();
  const ip = getLocalIP();
  console.log('');
  console.log('================================================');
  console.log('  Broco Smart Care - CMS Running!');
  console.log(`  Local   : http://localhost:${PORT}`);
  if (process.env.TURSO_DB_URL) console.log('  Database : Turso (remote)');
  else console.log(`  Network : http://${ip}:${PORT}`);
  console.log('================================================');
  console.log('');
}
startup();

app.get('/', async (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', redirectIfAuthenticated, async (req, res) => {
  res.render('auth/login', { error: null });
});

app.post('/login', async (req, res) => {
  var ip = req.ip || req.connection.remoteAddress;
  if (loginAttempts[ip] && loginAttempts[ip] >= 10) {
    return res.render('auth/login', { error: 'Terlalu banyak percobaan login. Coba lagi 15 menit.' });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.render('auth/login', { error: 'Username dan password wajib diisi' });
  if (username.length > 50 || password.length > 100) return res.render('auth/login', { error: 'Input tidak valid' });
  const user = await queryOne("SELECT * FROM users WHERE username = ? AND active = 1", [username]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    loginAttempts[ip] = (loginAttempts[ip] || 0) + 1;
    return res.render('auth/login', { error: 'Username atau password salah' });
  }
  delete loginAttempts[ip];
  req.session.user = {
    id: user.id, username: user.username, name: user.name,
    role: user.role, phone: user.phone, email: user.email
  };
  res.redirect('/dashboard');
});

app.get('/logout', async (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  const role = req.session.user.role;
  if (role === 'admin') return res.redirect('/admin/dashboard');
  if (role === 'management') return res.redirect('/management/dashboard');
  if (role === 'teknisi') return res.redirect('/teknisi/dashboard');
  res.redirect('/login');
});

async function getNotifCount(user) {
  if (!user) return 0;
  const r = await queryOne(
    "SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR role = ?) AND is_read = 0",
    [user.id, user.role]
  );
  return r ? r.count : 0;
}

async function getNotifs(user) {
  if (!user) return [];
  return await queryAll(
    "SELECT * FROM notifications WHERE (user_id = ? OR role = ?) ORDER BY created_at DESC LIMIT 10",
    [user.id, user.role]
  );
}

async function generateTicketNo() {
  const year = new Date().getFullYear();
  const last = await queryOne(
    "SELECT ticket_no FROM tickets WHERE ticket_no LIKE ? ORDER BY id DESC LIMIT 1",
    [`SC-${year}-%`]
  );
  let num = 1;
  if (last) {
    num = parseInt(last.ticket_no.split('-')[2]) + 1;
  }
  return `SC-${year}-${String(num).padStart(6, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}/${d.getFullYear()}`;
}

function toISODate(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const parts = ddmmyyyy.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return ddmmyyyy;
}

function toDDMMYYYY(iso) {
  if (!iso) return null;
  const parts = iso.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}

function trimStr(v, maxLen) {
  if (typeof v !== 'string') return '';
  return v.trim().substring(0, maxLen || 500);
}

function wrap(fn) {
  return (req, res, next) => {
    try { return fn(req, res, next); }
    catch (e) { console.error('Error:', e.message); res.status(500).send('Terjadi error: ' + e.message); }
  };
}

/* ============= ADMIN ROUTES ============= */

app.get('/admin/dashboard', isAuthenticated, isAdmin, async (req, res) => {
  const today = todayStr();
  const stats = {
    complaint_hari_ini: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE tanggal_complaint = ?", [today])).c,
    waiting_approval: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'approval'")).c,
    waiting_schedule: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'scheduled'")).c,
    on_progress: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'on_progress'")).c,
    completed: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'completed'")).c,
    rejected: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'rejected'")).c,
  };

  const topProducts = await queryAll(`
    SELECT p.nama_produk, COUNT(*) as total
    FROM tickets t JOIN products p ON t.product_id = p.id
    GROUP BY t.product_id ORDER BY total DESC LIMIT 5
  `);

  const avgTime = await queryOne(`
    SELECT AVG(
      julianday(substr(closed_at,1,10)) - julianday(substr(created_at,1,10))
    ) as avg_hari FROM tickets WHERE status = 'completed' AND closed_at IS NOT NULL
  `);

  const overdueTickets = await queryAll(`
    SELECT t.id, t.ticket_no, t.customer_name, t.customer_hp, t.keluhan, t.created_at, t.status,
      julianday(?) - julianday(t.created_at) as hari
    FROM tickets t
    WHERE t.status NOT IN ('completed','rejected')
    AND julianday(?) - julianday(t.created_at) > 3
    ORDER BY hari DESC LIMIT 10
  `, [nowWIB(), nowWIB()]);

  res.render('admin/dashboard', {
    stats, topProducts, overdueTickets,
    avgTime: avgTime ? Math.round(avgTime.avg_hari * 10) / 10 : 0,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user),
    todayStr: today
  });
});

app.get('/admin/tickets/create', isAuthenticated, isAdmin, async (req, res) => {
  const products = await queryAll("SELECT * FROM products ORDER BY nama_produk");
  const ticketNo = await generateTicketNo();
  res.render('admin/ticket-create', {
    products, ticketNo, today: todayStr(),
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/tickets/create', isAuthenticated, isAdmin, upload.fields([
  { name: 'faktur', maxCount: 1 },
  { name: 'foto_produk', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'foto_kerusakan', maxCount: 1 },
]), validateCsrf, async (req, res) => {
  const body = req.body;
  const files = req.files || {};
  if (!body.customer_name || !body.keluhan) return res.redirect('/admin/tickets/create?error=required');

  const result = await runWithResults(
    `INSERT INTO tickets (ticket_no, created_by, product_id, kode_barang, tanggal_complaint,
      customer_name, customer_alamat, customer_hp, customer_email, customer_kota, customer_provinsi,
      tanggal_pembelian, toko, marketplace, nomor_invoice, faktur_path, serial_number, keluhan,
      foto_produk_path, video_path, foto_kerusakan_path, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`,
    [
      body.ticket_no || await generateTicketNo(), req.session.user.id,
      body.product_id || null, trimStr(body.kode_barang, 50), body.tanggal_complaint || todayStr(),
      trimStr(body.customer_name, 100), trimStr(body.customer_alamat, 200), trimStr(body.customer_hp, 20),
      trimStr(body.customer_email, 100), trimStr(body.customer_kota, 100), trimStr(body.customer_provinsi, 100),
      body.tanggal_pembelian ? toDDMMYYYY(body.tanggal_pembelian) : null, trimStr(body.toko, 100), trimStr(body.marketplace, 100),
      trimStr(body.nomor_invoice, 50), await saveUploadedFile(files.faktur ? files.faktur[0] : null),
      trimStr(body.serial_number, 100), trimStr(body.keluhan, 1000),
      await saveUploadedFile(files.foto_produk ? files.foto_produk[0] : null),
      await saveUploadedFile(files.video ? files.video[0] : null),
      await saveUploadedFile(files.foto_kerusakan ? files.foto_kerusakan[0] : null)
    ]
  );

  await run(
    "INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
    [result.lastInsertRowid, req.session.user.id, 'create', 'Ticket dibuat']
  );

  res.redirect('/admin/tickets');
});

app.get('/admin/products/lookup', isAuthenticated, async (req, res) => {
  const kode = req.query.kode;
  const product = await queryOne("SELECT * FROM products WHERE kode_barang = ?", [kode]);
  res.json(product || null);
});

app.get('/admin/tickets', isAuthenticated, isAdmin, async (req, res) => {
  let sql = `SELECT t.*, p.nama_produk, p.tipe, u.name as created_by_name FROM tickets t LEFT JOIN products p ON t.product_id = p.id LEFT JOIN users u ON t.created_by = u.id WHERE 1=1`;
  const params = [];

  if (req.query.status && req.query.status !== 'all') {
    sql += ' AND t.status = ?'; params.push(req.query.status);
  }
  if (req.query.produk) {
    sql += ' AND p.nama_produk LIKE ?'; params.push(`%${req.query.produk}%`);
  }
  if (req.query.marketplace) {
    sql += ' AND t.marketplace LIKE ?'; params.push(`%${req.query.marketplace}%`);
  }
  if (req.query.customer) {
    sql += ' AND t.customer_name LIKE ?'; params.push(`%${req.query.customer}%`);
  }
  if (req.query.kota) {
    sql += ' AND t.customer_kota LIKE ?'; params.push(`%${req.query.kota}%`);
  }
  if (req.query.teknisi) {
    sql += ' AND t.id IN (SELECT ticket_id FROM schedules WHERE teknisi_id = ?)'; params.push(req.query.teknisi);
  }
  if (req.query.penanganan === 'sudah') {
    sql += " AND t.id IN (SELECT ticket_id FROM visit_results)";
  }
  if (req.query.penanganan === 'belum') {
    sql += " AND t.id NOT IN (SELECT ticket_id FROM visit_results WHERE ticket_id IS NOT NULL) AND t.status NOT IN ('rejected')";
  }

  sql += ' ORDER BY t.id DESC';

  const tickets = await queryAll(sql, params);
  const teknisi = await queryAll("SELECT id, name FROM users WHERE role = 'teknisi'");

  res.render('admin/ticket-list', {
    tickets, teknisi,
    filters: req.query,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.get('/admin/tickets/:id', isAuthenticated, isAdmin, async (req, res) => {
  const ticket = await queryOne(`
    SELECT t.*, p.nama_produk, p.tipe, p.garansi_bulan,
      u1.name as created_by_name, u2.name as approved_by_name, u3.name as closed_by_name
    FROM tickets t
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN users u1 ON t.created_by = u1.id
    LEFT JOIN users u2 ON t.approved_by = u2.id
    LEFT JOIN users u3 ON t.closed_by = u3.id
    WHERE t.id = ?
  `, [req.params.id]);

  if (!ticket) return res.redirect('/admin/tickets');

  const schedule = await queryOne("SELECT s.*, u.name as teknisi_name FROM schedules s LEFT JOIN users u ON s.teknisi_id = u.id WHERE s.ticket_id = ?", [req.params.id]);
  const visit = await queryOne("SELECT * FROM visit_results WHERE ticket_id = ?", [req.params.id]);
  const logs = await queryAll("SELECT l.*, u.name as user_name FROM activity_log l LEFT JOIN users u ON l.user_id = u.id WHERE l.ticket_id = ? ORDER BY l.created_at ASC", [req.params.id]);
  const teknisi = await queryAll("SELECT id, name FROM users WHERE role = 'teknisi'");

  res.render('admin/ticket-detail', {
    ticket, schedule, visit, logs, teknisi,
    wa_failed: req.query.wa_failed,
    wa_ok: req.query.wa,
    wa_phones: req.query.wp,
    error: req.query.error,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/tickets/:id/analysis', isAuthenticated, isAdmin, async (req, res) => {
  const analysis = req.body.admin_analysis;
  await run("UPDATE tickets SET admin_analysis = ?, status = 'approval', updated_at = ? WHERE id = ?", [analysis, nowWIB(), req.params.id]);
  await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)", [req.params.id, req.session.user.id, 'send_approval', 'Dikirim ke management untuk approval']);
  await run("INSERT INTO notifications (role, message, link) VALUES (?, ?, ?)", ['management', `Ticket membutuhkan approval Anda`, '/management/approval']);
  const ticket = await queryOne("SELECT ticket_no, customer_name FROM tickets WHERE id = ?", [req.params.id]);
  var waOk = 0;
  if (ticket) {
    var phones = await getManagementPhones();
    if (phones.length) waOk = await wa.sendToMany(phones, wa.sendApprovalNotification, ticket.ticket_no, ticket.customer_name);
  }
  res.redirect(`/admin/tickets/${req.params.id}` + (waOk === 0 ? '?wa_failed=1' : ''));
});

app.post('/admin/tickets/:id/followup', isAuthenticated, isAdmin, async (req, res) => {
  try {
    var note = req.body.followup_note || 'Follow-up diperlukan (kunjungan sebelumnya belum selesai)';
    var curTicket = await queryOne("SELECT ticket_no, customer_name, COALESCE(follow_up_count,0) as fcount, COALESCE(admin_analysis,'') as aanalysis FROM tickets WHERE id = ?", [req.params.id]);
    if (!curTicket) return res.redirect('/admin/tickets');
    var newCount = curTicket.fcount + 1;
    var analysisNote = '[Follow-up #' + newCount + '] ' + note;
    var updatedAnalysis = (curTicket.aanalysis || '') + '\n' + analysisNote;
    await run("UPDATE tickets SET admin_analysis = ?, status = 'approval', follow_up_count = ?, updated_at = ? WHERE id = ?",
      [updatedAnalysis, newCount, nowWIB(), req.params.id]);
    await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
      [req.params.id, req.session.user.id, 'send_approval', 'Follow-up #' + newCount + ' dikirim ke management untuk re-approval']);
    await run("INSERT INTO notifications (role, message, link) VALUES (?, ?, ?)", ['management', 'Follow-up ticket membutuhkan re-approval Anda', '/management/approval']);
     const ticket = await queryOne("SELECT ticket_no, customer_name FROM tickets WHERE id = ?", [req.params.id]);
    var waOk = 0;
    if (ticket) {
      var phones = await getManagementPhones();
      if (phones.length) {
        waOk = await wa.sendToMany(phones, wa.sendApprovalNotification, ticket.ticket_no, ticket.customer_name);
      }
    }
    res.redirect(`/admin/tickets/${req.params.id}?wa=${waOk}&wp=${phones?phones.length:0}`);
  } catch (e) {
    console.error('Followup error:', e.stack || e.message);
    res.redirect(`/admin/tickets/${req.params.id}?error=followup_failed`);
  }
});

app.post('/admin/tickets/:id/schedule', isAuthenticated, isAdmin, async (req, res) => {
  var { teknisi_id, tanggal, jam, notes } = req.body;
  tanggal = toDDMMYYYY(tanggal);
  if (!teknisi_id || !tanggal || !jam) return res.redirect(`/admin/tickets/${req.params.id}?error=required`);
  const existing = await queryOne("SELECT id FROM schedules WHERE ticket_id = ?", [req.params.id]);
  if (existing) {
    await run("UPDATE schedules SET teknisi_id = ?, tanggal = ?, jam = ?, notes = ? WHERE ticket_id = ?",
      [teknisi_id, tanggal, jam, notes, req.params.id]);
  } else {
    await runWithResults(
      "INSERT INTO schedules (ticket_id, teknisi_id, tanggal, jam, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [req.params.id, teknisi_id, tanggal, jam, notes, req.session.user.id]
    );
  }
  await run("UPDATE tickets SET status = 'scheduled', updated_at = ? WHERE id = ?", [nowWIB(), req.params.id]);
  await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
    [req.params.id, req.session.user.id, 'schedule', `Dijadwalkan ke teknisi pada ${tanggal} ${jam}`]);
  await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
    [teknisi_id, `Anda mendapat jadwal kunjungan baru`, `/teknisi/visit/${req.params.id}`]);
  const tick = await queryOne("SELECT ticket_no FROM tickets WHERE id = ?", [req.params.id]);
  if (tick) await wa.sendScheduleNotification(await getTeknisiPhone(teknisi_id), tick.ticket_no, tanggal, jam);
  res.redirect(`/admin/tickets/${req.params.id}`);
});

app.post('/admin/tickets/:id/cancel-schedule', isAuthenticated, isAdmin, async (req, res) => {
  const s = await queryOne("SELECT teknisi_id FROM schedules WHERE ticket_id = ?", [req.params.id]);
  await run("DELETE FROM schedules WHERE ticket_id = ?", [req.params.id]);
  await run("UPDATE tickets SET status = 'waiting', updated_at = ? WHERE id = ?", [nowWIB(), req.params.id]);
  await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
    [req.params.id, req.session.user.id, 'schedule', 'Jadwal dibatalkan']);
  if (s) {
    await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
      [s.teknisi_id, `Jadwal kunjungan dibatalkan`, `/teknisi/visit/${req.params.id}`]);
    const tick = await queryOne("SELECT ticket_no FROM tickets WHERE id = ?", [req.params.id]);
    if (tick) await wa.sendScheduleCancelledNotification(await getTeknisiPhone(s.teknisi_id), tick.ticket_no);
  }
  res.redirect(`/admin/tickets/${req.params.id}`);
});

app.post('/admin/tickets/:id/close', isAuthenticated, isAdmin, async (req, res) => {
  var wib = nowWIB();
  await run("UPDATE tickets SET status = 'completed', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?",
    [req.session.user.id, wib, wib, req.params.id]);
  await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
    [req.params.id, req.session.user.id, 'close', 'Ticket ditutup']);
  res.redirect(`/admin/tickets/${req.params.id}`);
});

app.post('/admin/tickets/:id/delete', isAuthenticated, isAdmin, validateCsrf, async (req, res) => {
  await run("DELETE FROM visit_results WHERE ticket_id = ?", [req.params.id]);
  await run("DELETE FROM activity_log WHERE ticket_id = ?", [req.params.id]);
  await run("DELETE FROM notifications WHERE link LIKE ?", [`%/admin/tickets/${req.params.id}%`]);
  await run("DELETE FROM schedules WHERE ticket_id = ?", [req.params.id]);
  await run("DELETE FROM tickets WHERE id = ?", [req.params.id]);
  res.redirect('/admin/tickets?success=ticket_deleted');
});

/* ============= CALENDAR SCHEDULING ============= */

app.get('/admin/calendar', isAuthenticated, isAdmin, async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const datePattern = `%/${String(month).padStart(2,'0')}/${year}`;

  const schedulingData = await queryAll(`
    SELECT s.id, s.ticket_id, s.teknisi_id, s.tanggal, s.jam, s.notes,
      t.ticket_no, t.customer_name, t.customer_kota, t.status,
      u.name as teknisi_name, p.nama_produk
    FROM schedules s
    JOIN tickets t ON s.ticket_id = t.id
    LEFT JOIN users u ON s.teknisi_id = u.id
    LEFT JOIN products p ON t.product_id = p.id
    WHERE s.tanggal LIKE ? OR s.tanggal LIKE ?
    ORDER BY s.tanggal, s.jam
  `, [datePattern, `${year}-${String(month).padStart(2,'0')}-%`]);

  const tickets = await queryAll(`
    SELECT t.id, t.ticket_no, t.customer_name, t.customer_kota, t.status,
      p.nama_produk, s.id as schedule_id
    FROM tickets t
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN schedules s ON s.ticket_id = t.id
    WHERE t.status IN ('waiting','approval','scheduled','on_progress')
    ORDER BY t.created_at DESC
  `);

  const teknisi = await queryAll("SELECT id, name FROM users WHERE role = 'teknisi' AND active = 1");

  res.render('admin/calendar', {
    schedulingData, year, month, tickets, teknisi,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/calendar/schedule', isAuthenticated, isAdmin, async (req, res) => {
  try {
    var { ticket_id, teknisi_id, tanggal, jam, notes } = req.body;
    tanggal = toDDMMYYYY(tanggal);
    if (!ticket_id || !teknisi_id || !tanggal || !jam) {
      return res.redirect('/admin/calendar?error=missing_fields');
    }
    const existing = await queryOne("SELECT id FROM schedules WHERE ticket_id = ?", [ticket_id]);
    if (existing) {
      await run("UPDATE schedules SET teknisi_id = ?, tanggal = ?, jam = ?, notes = ? WHERE ticket_id = ?",
        [teknisi_id, tanggal, jam, notes, ticket_id]);
    } else {
      await runWithResults(
        "INSERT INTO schedules (ticket_id, teknisi_id, tanggal, jam, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [ticket_id, teknisi_id, tanggal, jam, notes, req.session.user.id]
      );
    }
    await run("UPDATE tickets SET status = 'scheduled', updated_at = ? WHERE id = ? AND status IN ('waiting','approval')", [nowWIB(), ticket_id]);
    await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
      [ticket_id, req.session.user.id, 'schedule', `Dijadwalkan: ${tanggal} ${jam} - ${teknisi_id}`]);
    await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
      [teknisi_id, `Anda mendapat jadwal kunjungan baru ${tanggal} ${jam}`, `/teknisi/visit/${ticket_id}`]);
    const tick = await queryOne("SELECT ticket_no FROM tickets WHERE id = ?", [ticket_id]);
    if (tick) await wa.sendScheduleNotification(await getTeknisiPhone(teknisi_id), tick.ticket_no, tanggal, jam);
    res.redirect('/admin/calendar?success=scheduled');
  } catch (e) {
    console.error('Schedule error:', e);
    res.redirect('/admin/calendar?error=' + encodeURIComponent(e.message));
  }
});

app.get('/admin/calendar/tickets', isAuthenticated, isAdmin, async (req, res) => {
  const tickets = await queryAll(`
    SELECT t.id, t.ticket_no, t.customer_name, t.customer_kota, t.status,
      p.nama_produk, s.id as schedule_id
    FROM tickets t
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN schedules s ON s.ticket_id = t.id
    WHERE t.status IN ('waiting','approval')
    ORDER BY t.created_at DESC
  `);
  res.json(tickets);
});

app.get('/admin/calendar/events', isAuthenticated, isAdmin, async (req, res) => {
  const events = await queryAll(`
    SELECT s.id, s.ticket_id, s.teknisi_id, s.tanggal, s.jam, s.notes,
      t.ticket_no, t.customer_name, t.customer_kota,
      u.name as teknisi_name, p.nama_produk
    FROM schedules s
    JOIN tickets t ON s.ticket_id = t.id
    LEFT JOIN users u ON s.teknisi_id = u.id
    LEFT JOIN products p ON t.product_id = p.id
    ORDER BY s.tanggal, s.jam
  `);
  res.json(events);
});

app.get('/admin/products', isAuthenticated, isAdmin, async (req, res) => {
  const products = await queryAll("SELECT * FROM products ORDER BY nama_produk");
  res.render('admin/products', {
    products,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/products', isAuthenticated, isAdmin, async (req, res) => {
  const { kode_barang, nama_produk, tipe, garansi_bulan } = req.body;
  await runWithResults(
    "INSERT INTO products (kode_barang, nama_produk, tipe, garansi_bulan) VALUES (?, ?, ?, ?)",
    [kode_barang, nama_produk, tipe, parseInt(garansi_bulan) || 0]
  );
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/edit', isAuthenticated, isAdmin, async (req, res) => {
  const { kode_barang, nama_produk, tipe, garansi_bulan } = req.body;
  await run("UPDATE products SET kode_barang = ?, nama_produk = ?, tipe = ?, garansi_bulan = ? WHERE id = ?",
    [kode_barang, nama_produk, tipe, parseInt(garansi_bulan) || 0, req.params.id]);
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', isAuthenticated, isAdmin, async (req, res) => {
  await run("DELETE FROM products WHERE id = ?", [req.params.id]);
  res.redirect('/admin/products');
});

app.get('/admin/teknisi', isAuthenticated, isAdmin, async (req, res) => {
  const teknisi = await queryAll("SELECT * FROM users WHERE role = 'teknisi' ORDER BY name");
  res.render('admin/teknisi', {
    teknisi,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/teknisi', isAuthenticated, isAdmin, async (req, res) => {
  const { name, username, phone } = req.body;
  if (!name || !username) return res.redirect('/admin/teknisi');
  const hash = require('bcryptjs').hashSync('password', 10);
  try {
    await runWithResults(
      "INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, 'teknisi', ?)",
      [username, hash, name, phone || '']
    );
  } catch (e) {
    console.error('Create teknisi error:', e.message);
  }
  res.redirect('/admin/teknisi');
});

app.post('/admin/teknisi/:id/edit', isAuthenticated, isAdmin, async (req, res) => {
  const { name, phone, username } = req.body;
  await run("UPDATE users SET name = ?, phone = ?, username = ? WHERE id = ? AND role = 'teknisi'",
    [name, phone || '', username, req.params.id]);
  if (req.body.password) {
    const hash = require('bcryptjs').hashSync(req.body.password, 10);
    await run("UPDATE users SET password = ? WHERE id = ?", [hash, req.params.id]);
  }
  res.redirect('/admin/teknisi');
});

app.post('/admin/teknisi/:id/toggle', isAuthenticated, isAdmin, async (req, res) => {
  const u = await queryOne("SELECT active FROM users WHERE id = ? AND role = 'teknisi'", [req.params.id]);
  if (u) {
    await run("UPDATE users SET active = ? WHERE id = ?", [u.active ? 0 : 1, req.params.id]);
  }
  res.redirect('/admin/teknisi');
});

app.get('/admin/whatsapp', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/whatsapp', {
    waConnected: wa.getStatus().connected,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.get('/admin/settings', isAuthenticated, isAdmin, async (req, res) => {
  const dbPath = require('path').join(__dirname, 'database.sqlite');
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  const uploadsPath = uploadsDir;
  const uploadsSize = fs.existsSync(uploadsPath)
    ? fs.readdirSync(uploadsPath).reduce(function(sum, f) {
        try { return sum + fs.statSync(path.join(uploadsPath, f)).size; } catch(e) { return sum; }
      }, 0)
    : 0;
  const admins = await queryAll("SELECT id, username, name, phone, email, role FROM users WHERE role IN ('admin','management') ORDER BY role, name");
  res.render('admin/settings', {
    dbPath, dbSize, uploadsSize, uploadsDir, admins,
    user: req.session.user,
    query: req.query,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/admin/settings/password', isAuthenticated, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) return res.redirect('/admin/settings?error=password_mismatch');
  if (new_password.length < 4) return res.redirect('/admin/settings?error=password_short');
  const user = await queryOne("SELECT password FROM users WHERE id = ?", [req.session.user.id]);
  if (!user || !bcrypt.compareSync(current_password, user.password)) {
    return res.redirect('/admin/settings?error=wrong_password');
  }
  const hash = bcrypt.hashSync(new_password, 10);
  await run("UPDATE users SET password = ? WHERE id = ?", [hash, req.session.user.id]);
  res.redirect('/admin/settings?success=password_changed');
});

app.post('/admin/settings/profile', isAuthenticated, async (req, res) => {
  const { name, phone, email } = req.body;
  await run("UPDATE users SET name = ?, phone = ?, email = ? WHERE id = ?",
    [name, phone || '', email || '', req.session.user.id]);
  req.session.user.name = name;
  req.session.user.phone = phone || '';
  req.session.user.email = email || '';
  res.redirect('/admin/settings?success=profile_updated');
});

app.post('/admin/settings/user/create', isAuthenticated, isAdmin, async (req, res) => {
  const { name, username, password, role, phone, email } = req.body;
  if (!name || !username || !password || !role) return res.redirect('/admin/settings?error=missing_fields');
  if (!['admin','management'].includes(role)) return res.redirect('/admin/settings?error=invalid_role');
  try {
    const hash = bcrypt.hashSync(password, 10);
    await runWithResults(
      "INSERT INTO users (username, password, name, role, phone, email) VALUES (?, ?, ?, ?, ?, ?)",
      [username, hash, name, role, phone || '', email || '']
    );
    res.redirect('/admin/settings?success=user_created');
  } catch (e) {
    res.redirect('/admin/settings?error=' + encodeURIComponent('Username sudah ada'));
  }
});

app.post('/admin/settings/user/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { name, phone, email, username } = req.body;
  await run("UPDATE users SET name = ?, phone = ?, email = ?, username = ? WHERE id = ? AND role IN ('admin','management')",
    [name, phone || '', email || '', username, req.params.id]);
  if (req.body.password) {
    const hash = bcrypt.hashSync(req.body.password, 10);
    await run("UPDATE users SET password = ? WHERE id = ?", [hash, req.params.id]);
  }
  res.redirect('/admin/settings?success=user_updated');
});

app.get('/admin/backup/download', isAuthenticated, isAdmin, async (req, res) => {
  const dbPath = path.join(__dirname, 'database.sqlite');
  if (!fs.existsSync(dbPath)) return res.redirect('/admin/settings?error=db_not_found');
  prepareBackup();
  if (process.env.TURSO_DB_URL) {
    try { await exportTursoToLocal(); } catch (e) { console.error('Export Turso error:', e.message); }
  }
  prepareBackup();
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  res.download(dbPath, `broco-backup-${dateStr}.sqlite`);
});

var archiver = require('archiver');
app.get('/admin/backup/download-full', isAuthenticated, isAdmin, async function(req, res) {
  prepareBackup();
  if (process.env.TURSO_DB_URL) {
    try { await exportTursoToLocal(); } catch (e) { console.error('Export Turso error:', e.message); }
  }
  prepareBackup();
  var dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  var zipPath = path.join(__dirname, 'temp', 'broco-full-backup-' + dateStr + '.zip');
  try {
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    }
    await new Promise(function(resolve, reject) {
      var output = fs.createWriteStream(zipPath);
      var archive = new archiver.ZipArchive({ zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', function(err) { reject(err); });
      archive.pipe(output);
      archive.file(path.join(__dirname, 'database.sqlite'), { name: 'database.sqlite' });
      var uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (fs.existsSync(uploadsDir)) {
        archive.directory(uploadsDir, 'uploads');
      }
      archive.finalize();
    });
    res.download(zipPath, 'broco-full-backup-' + dateStr + '.zip', function(err) {
      if (err) console.error('Download error:', err.message);
      try { fs.unlinkSync(zipPath); } catch(e) {}
    });
  } catch (e) {
    console.error('Backup error:', e.message);
    try { fs.unlinkSync(zipPath); } catch(e2) {}
    res.status(500).send('Backup failed: ' + e.message);
  }
});

var tempDir = path.join(__dirname, 'temp');
try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch(e) {}
const restoreUpload = multer({ dest: tempDir, limits: { fileSize: 100 * 1024 * 1024 } });
app.post('/admin/settings/restore', isAuthenticated, isAdmin, function(req, res, next) {
  restoreUpload.single('database')(req, res, function(err) {
    if (err) {
      console.error('Multer error:', err.message);
      return res.redirect('/admin/settings?error=' + encodeURIComponent('upload_error: ' + err.message));
    }
    next();
  });
}, async function(req, res) {
  var uploadedFile = null;
  try {
    if (!req.file) return res.redirect('/admin/settings?error=file_required');
    uploadedFile = req.file.path;
    if (!req.file.originalname.endsWith('.sqlite')) {
      try { fs.unlinkSync(uploadedFile); } catch(e) {}
      return res.redirect('/admin/settings?error=invalid_file');
    }
    var testDb;
    try {
      testDb = new Database(uploadedFile);
      testDb.pragma('wal_checkpoint(TRUNCATE)');
      testDb.exec("SELECT 1");
      testDb.close();
    } catch (e) {
      try { fs.unlinkSync(uploadedFile); } catch(e2) {}
      console.error('Restore validation error:', e.message);
      return res.redirect('/admin/settings?error=' + encodeURIComponent('invalid_database: ' + e.message));
    }
    var dbPath = path.join(__dirname, 'database.sqlite');
    var backupPath = dbPath + '.backup';
    try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch(e) {}
    closeDB();
    try { if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    var hasDb = fs.existsSync(dbPath);
    if (hasDb) fs.renameSync(dbPath, backupPath);
    try { if (fs.existsSync(backupPath + '-wal')) fs.unlinkSync(backupPath + '-wal'); } catch(e) {}
    try { if (fs.existsSync(backupPath + '-shm')) fs.unlinkSync(backupPath + '-shm'); } catch(e) {}
    fs.copyFileSync(uploadedFile, dbPath);
    try { fs.unlinkSync(uploadedFile); } catch(e) {}
    uploadedFile = null;
    try {
      initDB();
      if (process.env.TURSO_DB_URL) await syncLocalToTurso();
      await queryAll("SELECT COUNT(*) FROM users");
      try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch(e) {}
      try {
        var tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch(e) {}
      res.redirect('/admin/settings?success=restored');
    } catch (e) {
      console.error('Restore error:', e.message);
      closeDB();
      try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch(e2) {}
      try { if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal'); } catch(e2) {}
      try { if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm'); } catch(e2) {}
      if (hasDb) fs.renameSync(backupPath, dbPath);
      initDB();
      res.redirect('/admin/settings?error=restore_failed');
    }
  } catch (e) {
    try { if (uploadedFile) fs.unlinkSync(uploadedFile); } catch(e2) {}
    res.redirect('/admin/settings?error=restore_failed');
  }
});

var extractZip = require('extract-zip');
app.post('/admin/settings/restore-full', isAuthenticated, isAdmin, function(req, res, next) {
  restoreUpload.single('backup')(req, res, function(err) {
    if (err) return res.redirect('/admin/settings?error=' + encodeURIComponent('upload_error: ' + err.message));
    next();
  });
}, async function(req, res) {
  var uploadedFile = null;
  try {
    if (!req.file) return res.redirect('/admin/settings?error=file_required');
    uploadedFile = req.file.path;
    if (!req.file.originalname.endsWith('.zip')) {
      try { fs.unlinkSync(uploadedFile); } catch(e) {}
      return res.redirect('/admin/settings?error=invalid_file');
    }
    var extractDir = path.join(__dirname, 'temp', 'restore_' + Date.now());
    try { fs.mkdirSync(extractDir, { recursive: true }); } catch(e) {}
    await extractZip(uploadedFile, { dir: extractDir });
    var extractedDb = path.join(extractDir, 'database.sqlite');
    if (!fs.existsSync(extractedDb)) {
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch(e) {}
      try { fs.unlinkSync(uploadedFile); } catch(e) {}
      return res.redirect('/admin/settings?error=invalid_backup');
    }
    var testDb;
    try {
      testDb = new Database(extractedDb);
      testDb.pragma('wal_checkpoint(TRUNCATE)');
      testDb.prepare("SELECT COUNT(*) FROM users").get();
      testDb.close();
    } catch (e) {
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch(e2) {}
      try { fs.unlinkSync(uploadedFile); } catch(e2) {}
      return res.redirect('/admin/settings?error=' + encodeURIComponent('invalid_database: ' + e.message));
    }
    var dbPath = path.join(__dirname, 'database.sqlite');
    var backupPath = dbPath + '.backup';
    try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch(e) {}
    closeDB();
    try { if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal'); } catch(e) {}
    try { if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm'); } catch(e) {}
    var hasDb = fs.existsSync(dbPath);
    if (hasDb) fs.renameSync(dbPath, backupPath);
    fs.copyFileSync(extractedDb, dbPath);
    try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch(e) {}
    var extractedUploads = path.join(extractDir, 'uploads');
    var uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (fs.existsSync(extractedUploads)) {
      if (fs.existsSync(uploadsDir)) {
        try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch(e) {}
      }
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch(e) {}
      var files = fs.readdirSync(extractedUploads);
      files.forEach(function(f) {
        try { fs.copyFileSync(path.join(extractedUploads, f), path.join(uploadsDir, f)); } catch(e) {}
      });
    }
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch(e) {}
    try { fs.unlinkSync(uploadedFile); } catch(e) {}
    uploadedFile = null;
    try {
      initDB();
      if (process.env.TURSO_DB_URL) await syncLocalToTurso();
      await queryAll("SELECT COUNT(*) FROM users");
      try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch(e) {}
      res.redirect('/admin/settings?success=restored');
    } catch (e) {
      console.error('Full restore error:', e.message);
      closeDB();
      if (hasDb && fs.existsSync(backupPath)) {
        try { fs.unlinkSync(dbPath); } catch(e2) {}
        fs.renameSync(backupPath, dbPath);
      }
      initDB();
      res.redirect('/admin/settings?error=restore_failed');
    }
  } catch (e) {
    console.error('Full restore error:', e.message);
    try { if (uploadedFile) fs.unlinkSync(uploadedFile); } catch(e2) {}
    res.redirect('/admin/settings?error=restore_failed');
  }
});

app.post('/admin/settings/reset-data', isAuthenticated, isAdmin, validateCsrf, async (req, res) => {
  await run("DELETE FROM visit_results");
  await run("DELETE FROM activity_log");
  await run("DELETE FROM notifications");
  await run("DELETE FROM schedules");
  await run("DELETE FROM tickets");
  res.redirect('/admin/settings?success=reset_data');
});

app.post('/admin/settings/reset-total', isAuthenticated, isAdmin, validateCsrf, async (req, res) => {
  await run("DELETE FROM visit_results");
  await run("DELETE FROM activity_log");
  await run("DELETE FROM notifications");
  await run("DELETE FROM schedules");
  await run("DELETE FROM tickets");
  await run("DELETE FROM products");
  await run("DELETE FROM users WHERE role != 'admin'");
  res.redirect('/admin/settings?success=reset_total');
});

app.get('/admin/notifications', isAuthenticated, isAdmin, async (req, res) => {
  await run("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now','-3 days')");
  const notifs = await queryAll(
    "SELECT * FROM notifications WHERE (user_id = ? OR role = ?) ORDER BY is_read ASC, created_at DESC LIMIT 50",
    [req.session.user.id, req.session.user.role]
  );
  res.render('admin/notifications', {
    notifs,
    notifCount: 0
  });
});

/* ============= MANAGEMENT ROUTES ============= */

app.get('/management/dashboard', isAuthenticated, isManagement, async (req, res) => {
  try {
    const stats = {
      waiting: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'approval'")).c,
      completed_this_month: (await queryOne("SELECT COUNT(*) as c FROM tickets WHERE status = 'completed' AND substr(created_at,6,2) = substr(?,6,2)", [nowWIB()])).c,
      total: (await queryOne("SELECT COUNT(*) as c FROM tickets")).c,
    };

    const pendingApproval = await queryAll(`
      SELECT t.id, t.ticket_no, t.customer_name, p.nama_produk, t.keluhan, t.created_at, t.admin_analysis
      FROM tickets t LEFT JOIN products p ON t.product_id = p.id
      WHERE t.status = 'approval' ORDER BY t.created_at DESC LIMIT 5
    `);

    const monthlyStats = await queryAll(`
      SELECT substr(created_at,6,2) as bulan, COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as selesai
      FROM tickets WHERE substr(created_at,1,4) = substr(?,1,4)
      GROUP BY bulan ORDER BY bulan
    `, [nowWIB()]);

    const chartLabels = JSON.stringify(monthlyStats.map(function(m) { return 'Bulan '+m.bulan }));
    const chartTotals = JSON.stringify(monthlyStats.map(function(m) { return m.total }));
    const chartCompleted = JSON.stringify(monthlyStats.map(function(m) { return m.selesai }));

    res.render('management/dashboard', {
      stats, pendingApproval, monthlyStats,
      chartLabels, chartTotals, chartCompleted,
      notifCount: await getNotifCount(req.session.user),
      notifs: await getNotifs(req.session.user)
    });
  } catch (e) {
    console.error('Management dashboard error:', e);
    res.status(500).send('Error loading dashboard: ' + e.message);
  }
});

app.get('/management/approval', isAuthenticated, isManagement, async (req, res) => {
  const tickets = await queryAll(`
    SELECT t.*, p.nama_produk, p.tipe, u.name as created_by_name
    FROM tickets t LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.status = 'approval' ORDER BY t.created_at DESC
  `);
  await run("UPDATE notifications SET is_read = 1 WHERE role = 'management' AND is_read = 0");
  res.render('management/approval', {
    tickets,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/management/approval/:id', isAuthenticated, isManagement, async (req, res) => {
  try {
    const { decision, comment } = req.body;
    if (decision !== 'Servis' && decision !== 'Ganti Unit' && decision !== 'reject') {
      return res.redirect('/management/approval');
    }
    const tick = await queryOne("SELECT ticket_no FROM tickets WHERE id = ?", [req.params.id]);
    const tickNo = tick ? tick.ticket_no : `#${req.params.id}`;
    if (decision === 'reject') {
      await run("UPDATE tickets SET management_decision = ?, management_comment = ?, status = 'rejected', updated_at = ? WHERE id = ?",
        [decision, comment || '', nowWIB(), req.params.id]);
      await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
        [req.params.id, req.session.user.id, 'reject', `Ditolak: ${comment || 'Tidak ada komentar'}`]);
      var adminIdsReject = await getAdminIds();
      for (const uid of adminIdsReject) {
        await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
          [uid, `Ticket ditolak oleh Management`, `/admin/tickets/${req.params.id}`]);
      }
      var adminPhones = await getAdminPhones();
      if (adminPhones.length) await wa.sendToMany(adminPhones, wa.sendRejectedNotification, tickNo);
    } else {
      var wib2 = nowWIB();
      await run("UPDATE tickets SET management_decision = ?, management_comment = ?, status = 'waiting', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?",
        [decision, comment || '', req.session.user.id, wib2, wib2, req.params.id]);
      await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
        [req.params.id, req.session.user.id, 'approve', `Disetujui: ${decision} - ${comment || ''}`]);
      var adminIds = await getAdminIds();
      for (const uid of adminIds) {
        await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
          [uid, `Ticket disetujui Management, silakan buat jadwal`, `/admin/tickets/${req.params.id}`]);
      }
      var adminPhones = await getAdminPhones();
      if (adminPhones.length) await wa.sendToMany(adminPhones, wa.sendApprovedNotification, tickNo);
    }
    res.redirect('/management/approval');
  } catch (e) {
    console.error('Approval error:', e);
    res.status(500).send('Error: ' + e.message);
  }
});

app.get('/management/reports', isAuthenticated, isManagement, async (req, res) => {
  try {
    const productComplaints = await queryAll(`
      SELECT COALESCE(p.nama_produk, 'Unknown') as nama_produk, COALESCE(p.tipe, '') as tipe, COUNT(*) as total
      FROM tickets t LEFT JOIN products p ON t.product_id = p.id
      GROUP BY t.product_id ORDER BY total DESC
    `);

    const marketplaceComplaints = await queryAll(`
      SELECT COALESCE(marketplace, 'Unknown') as marketplace, COUNT(*) as total
      FROM tickets GROUP BY marketplace ORDER BY total DESC
    `);

    const topIssues = await queryAll(`
      SELECT keluhan, COUNT(*) as total FROM tickets
      WHERE keluhan IS NOT NULL GROUP BY keluhan ORDER BY total DESC LIMIT 10
    `);

    const avgResolution = await queryOne(`
      SELECT AVG(
        julianday(substr(COALESCE(closed_at, ?),1,10)) -
        julianday(substr(created_at,1,10))
      ) as avg_hari FROM tickets WHERE status = 'completed'
    `, [nowWIB()]);

    const topTeknisi = await queryAll(`
      SELECT u.name, COUNT(v.id) as total_visit
      FROM visit_results v
      JOIN users u ON v.teknisi_id = u.id
      GROUP BY v.teknisi_id ORDER BY total_visit DESC
    `);

    const topProblemProducts = await queryAll(`
      SELECT COALESCE(p.nama_produk, 'Unknown') as nama_produk, COALESCE(p.tipe, '') as tipe, COUNT(*) as total
      FROM tickets t LEFT JOIN products p ON t.product_id = p.id
      WHERE t.status IN ('completed','on_progress')
      GROUP BY t.product_id ORDER BY total DESC LIMIT 10
    `);

    const chartProductLabels = JSON.stringify(productComplaints.map(function(p){ return p.nama_produk.replace(/'/g,'') }));
    const chartProductData = JSON.stringify(productComplaints.map(function(p){ return p.total }));
    const chartMarketplaceLabels = JSON.stringify(marketplaceComplaints.map(function(m){ return m.marketplace.replace(/'/g,'') }));
    const chartMarketplaceData = JSON.stringify(marketplaceComplaints.map(function(m){ return m.total }));

    res.render('management/reports', {
      productComplaints, marketplaceComplaints, topIssues,
      avgResolution: avgResolution ? Math.round((avgResolution.avg_hari || 0) * 10) / 10 : 0,
      topTeknisi, topProblemProducts,
      chartProductLabels, chartProductData, chartMarketplaceLabels, chartMarketplaceData,
      notifCount: await getNotifCount(req.session.user),
      notifs: await getNotifs(req.session.user)
    });
  } catch (e) {
    console.error('Reports error:', e);
    res.status(500).send('Error loading reports: ' + e.message);
  }
});

/* ============= TEKNISI ROUTES ============= */

app.get('/teknisi/dashboard', isAuthenticated, isTeknisi, async (req, res) => {
  const today = todayStr();
  const todaySchedule = await queryAll(`
    SELECT s.*, t.ticket_no, t.customer_name, t.customer_kota, t.customer_alamat,
      t.customer_hp, t.keluhan, t.status,
      p.nama_produk, p.tipe,
      v.id as visit_id
    FROM schedules s
    JOIN tickets t ON s.ticket_id = t.id
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN visit_results v ON v.ticket_id = t.id
    WHERE s.teknisi_id = ? AND s.tanggal = ?
    ORDER BY s.jam ASC
  `, [req.session.user.id, today]);

  const upcomingSchedule = await queryAll(`
    SELECT s.*, t.ticket_no, t.customer_name, t.customer_kota, p.nama_produk
    FROM schedules s
    JOIN tickets t ON s.ticket_id = t.id
    LEFT JOIN products p ON t.product_id = p.id
    WHERE s.teknisi_id = ?
      AND SUBSTR(s.tanggal, 7, 4) || '-' || SUBSTR(s.tanggal, 4, 2) || '-' || SUBSTR(s.tanggal, 1, 2) > date('now','localtime')
    ORDER BY SUBSTR(s.tanggal, 7, 4) || '-' || SUBSTR(s.tanggal, 4, 2) || '-' || SUBSTR(s.tanggal, 1, 2) ASC, s.jam ASC LIMIT 10
  `, [req.session.user.id]);

  const stats = {
    today: todaySchedule.length,
    completed: (await queryOne("SELECT COUNT(*) as c FROM visit_results v JOIN schedules s ON v.ticket_id = s.ticket_id WHERE s.teknisi_id = ?", [req.session.user.id])).c,
    total: (await queryOne("SELECT COUNT(*) as c FROM schedules WHERE teknisi_id = ?", [req.session.user.id])).c
  };

  res.render('teknisi/dashboard', {
    todaySchedule, upcomingSchedule, stats,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.get('/teknisi/visit/:ticketId', isAuthenticated, isTeknisi, async (req, res) => {
  const ticket = await queryOne(`
    SELECT t.*, p.nama_produk, p.tipe
    FROM tickets t LEFT JOIN products p ON t.product_id = p.id
    WHERE t.id = ?
  `, [req.params.ticketId]);

  if (!ticket) return res.redirect('/teknisi/dashboard');

  const schedule = await queryOne("SELECT * FROM schedules WHERE ticket_id = ? AND teknisi_id = ?", [req.params.ticketId, req.session.user.id]);
  const visit = await queryOne("SELECT * FROM visit_results WHERE ticket_id = ?", [req.params.ticketId]);

  res.render('teknisi/visit', {
    ticket, schedule, visit,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.post('/teknisi/visit/:ticketId', isAuthenticated, isTeknisi, upload.fields([
  { name: 'foto_sebelum', maxCount: 1 },
  { name: 'foto_sesudah', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]), validateCsrf, async (req, res) => {
  const body = req.body;
  const files = req.files || {};
  const now = todayStr();
  const jam = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (!body.hasil_pemeriksaan) return res.redirect(`/teknisi/visit/${req.params.ticketId}?error=pemeriksaan_required`);

  const existing = await queryOne("SELECT id FROM visit_results WHERE ticket_id = ?", [req.params.ticketId]);
  if (existing) {
    await run(`UPDATE visit_results SET tanggal=?, jam=?, hasil_pemeriksaan=?, solusi=?, sparepart=?, tanggal_selesai=?,
      foto_sebelum_path=COALESCE(?,foto_sebelum_path), foto_sesudah_path=COALESCE(?,foto_sesudah_path),
      video_path=COALESCE(?,video_path) WHERE ticket_id=?`,
      [now, jam, trimStr(body.hasil_pemeriksaan, 2000), trimStr(body.solusi, 1000), trimStr(body.sparepart, 500), body.tanggal_selesai ? toDDMMYYYY(body.tanggal_selesai) : now,
       await saveUploadedFile(files.foto_sebelum ? files.foto_sebelum[0] : null),
       await saveUploadedFile(files.foto_sesudah ? files.foto_sesudah[0] : null),
       await saveUploadedFile(files.video ? files.video[0] : null),
       req.params.ticketId]);
  } else {
    await runWithResults(
      `INSERT INTO visit_results (ticket_id, teknisi_id, tanggal, jam, hasil_pemeriksaan, solusi, sparepart,
        foto_sebelum_path, foto_sesudah_path, video_path, tanggal_selesai)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.ticketId, req.session.user.id, now, jam, trimStr(body.hasil_pemeriksaan, 2000), trimStr(body.solusi, 1000), trimStr(body.sparepart, 500),
       await saveUploadedFile(files.foto_sebelum ? files.foto_sebelum[0] : null),
       await saveUploadedFile(files.foto_sesudah ? files.foto_sesudah[0] : null),
       await saveUploadedFile(files.video ? files.video[0] : null),
       body.tanggal_selesai ? toDDMMYYYY(body.tanggal_selesai) : now]
    );
  }

  // Semua hasil kunjungan: status on_progress, notifikasi admin (in-app)
  // Follow-up: tambah follow_up_count + log khusus
  // WA ke management dilakukan ADMIN lewat menu "Ajukan Follow-up"
  var isFollowUp = (body.solusi === 'Butuh Sparepart (Follow-up)' || body.solusi === 'Ganti Baru (Follow-up)' || body.solusi === 'Tidak Bisa Diperbaiki');
  
  await run("UPDATE tickets SET status = 'on_progress', updated_at = ? WHERE id = ?", [nowWIB(), req.params.ticketId]);

  if (isFollowUp) {
    // Increment follow_up_count
    const currentFollowUp = await queryOne("SELECT follow_up_count FROM tickets WHERE id = ?", [req.params.ticketId]);
    const newCount = (currentFollowUp && currentFollowUp.follow_up_count || 0) + 1;
    await run("UPDATE tickets SET follow_up_count = ? WHERE id = ?", [newCount, req.params.ticketId]);
    
    var descMap = {
      'Butuh Sparepart (Follow-up)': 'Kunjungan: butuh sparepart, follow-up dari admin diperlukan',
      'Ganti Baru (Follow-up)': 'Kunjungan: butuh unit baru, follow-up dari admin diperlukan',
      'Tidak Bisa Diperbaiki': 'Kunjungan: tidak bisa diperbaiki, follow-up dari admin diperlukan'
    };
    var desc = descMap[body.solusi] || 'Kunjungan: butuh follow-up dari admin';
    
    await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
      [req.params.ticketId, req.session.user.id, 'follow_up', desc]);
    
    var adminIds = await getAdminIds();
    for (const uid of adminIds) {
      await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        [uid, 'Hasil kunjungan: butuh follow-up dari Admin', `/admin/tickets/${req.params.ticketId}`]);
    }
  } else {
    await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
      [req.params.ticketId, req.session.user.id, 'visit', 'Kunjungan dilakukan']);
    var adminIds = await getAdminIds();
    for (const uid of adminIds) {
      await run("INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        [uid, 'Teknisi telah mengupload hasil kunjungan untuk ticket', `/admin/tickets/${req.params.ticketId}`]);
    }
  }

  res.redirect(`/teknisi/visit/${req.params.ticketId}`);
});

app.post('/teknisi/visit/:ticketId/start', isAuthenticated, isTeknisi, async (req, res) => {
  await run("UPDATE tickets SET status = 'on_progress', updated_at = ? WHERE id = ?", [nowWIB(), req.params.ticketId]);
  await run("INSERT INTO activity_log (ticket_id, user_id, action, description) VALUES (?, ?, ?, ?)",
    [req.params.ticketId, req.session.user.id, 'start_visit', 'Kunjungan dimulai']);
  res.redirect(`/teknisi/visit/${req.params.ticketId}`);
});

app.get('/teknisi/history', isAuthenticated, isTeknisi, async (req, res) => {
  const visits = await queryAll(`
    SELECT v.*, t.ticket_no, t.customer_name, t.customer_kota, p.nama_produk
    FROM visit_results v
    JOIN tickets t ON v.ticket_id = t.id
    LEFT JOIN products p ON t.product_id = p.id
    WHERE v.teknisi_id = ?
    ORDER BY v.created_at DESC
  `, [req.session.user.id]);

  res.render('teknisi/history', {
    visits,
    notifCount: await getNotifCount(req.session.user),
    notifs: await getNotifs(req.session.user)
  });
});

app.get('/management/notifications', isAuthenticated, isManagement, async (req, res) => {
  await run("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now','-3 days')");
  const notifs = await queryAll("SELECT * FROM notifications WHERE role = 'management' ORDER BY is_read ASC, created_at DESC LIMIT 50");
  res.render('management/notifications', {
    notifs,
    notifCount: 0
  });
});

/* ============= NOTIFICATION API ============= */

app.get('/api/notifications/count', isAuthenticated, async (req, res) => {
  res.json({ count: await getNotifCount(req.session.user) });
});

app.post('/api/notifications/read/:id', isAuthenticated, async (req, res) => {
  await run("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', isAuthenticated, async (req, res) => {
  await run("UPDATE notifications SET is_read = 1 WHERE (user_id = ? OR role = ?) AND is_read = 0",
    [req.session.user.id, req.session.user.role]);
  res.json({ ok: true });
});

app.post('/api/notifications/delete-read', isAuthenticated, async (req, res) => {
  await run("DELETE FROM notifications WHERE (user_id = ? OR role = ?) AND is_read = 1 AND created_at < datetime('now','-3 days')",
    [req.session.user.id, req.session.user.role]);
  res.json({ ok: true });
});

app.post('/api/notifications/cleanup', isAuthenticated, async (req, res) => {
  await run("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now','-7 days')");
  res.json({ ok: true });
});

app.get('/api/wa/status', isAuthenticated, async (req, res) => {
  res.json(wa.getStatus());
});

app.get('/api/wa/qr-image', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const qrDataUrl = await wa.getQRBase64();
    if (qrDataUrl) {
      res.json({ qr: qrDataUrl, connected: false });
    } else {
      res.json({ qr: null, connected: wa.getStatus().connected, message: wa.getStatus().connected ? 'Terhubung' : 'QR belum tersedia, tunggu beberapa saat...' });
    }
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.post('/api/wa/reconnect', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await wa.forceReconnect();
    res.json({ ok: true, message: 'Memulai ulang koneksi WhatsApp...' });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/wa/failed', isAuthenticated, async (req, res) => {
  res.json({ messages: wa.getFailedMessages() });
});

app.post('/api/wa/resend', isAuthenticated, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.json({ ok: false, error: 'phone and message required' });
  const ok = await wa.resendMessage(phone, message);
  res.json({ ok });
});

app.post('/api/wa/clear-failed', isAuthenticated, async (req, res) => {
  wa.clearFailedMessages();
  res.json({ ok: true });
});

app.post('/api/wa/test-send', isAuthenticated, isAdmin, async (req, res) => {
  var phone = req.body.phone || '';
  var ticketNo = req.body.ticket_no || 'TEST-001';
  var customer = req.body.customer || 'Test Customer';
  try {
    var ok = await wa.sendApprovalNotification(phone, ticketNo, customer);
    res.json({ ok: ok, phone: phone, ticketNo: ticketNo, customer: customer, message: ok ? 'WA terkirim' : 'WA gagal' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

setInterval(async function() {
  try {
    await run("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now','-3 days')");
  } catch(e) { /* ignore */ }
}, 3600000);

/* ============= 404 HANDLER ============= */
app.use(function(req, res) {
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).send('<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>404 - Halaman Tidak Ditemukan</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.container{text-align:center;background:white;padding:40px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.container h1{color:#333;margin:0 0 10px 0}.container p{color:#666;margin:0}a{color:#007bff;text-decoration:none}</style></head><body><div class=\"container\"><h1>404</h1><p>Halaman tidak ditemukan</p><a href=\"/\">Kembali ke halaman utama</a></div></body></html>');
});

app.listen(PORT, '0.0.0.0', () => {});
