const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'database.sqlite');
let db = null;
let turso = null;
let isTurso = false;

function rowsToObjects(rows, columns) {
  if (!rows || !columns) return [];
  return rows.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function createTablesLocal() {
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expired_at ON sessions(expired_at)`);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    phone TEXT, email TEXT, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kode_barang TEXT UNIQUE NOT NULL,
    nama_produk TEXT NOT NULL, tipe TEXT, garansi_bulan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no TEXT UNIQUE NOT NULL,
    created_by INTEGER, product_id INTEGER, kode_barang TEXT,
    tanggal_complaint TEXT, customer_name TEXT, customer_alamat TEXT,
    customer_hp TEXT, customer_email TEXT, customer_kota TEXT,
    customer_provinsi TEXT, tanggal_pembelian TEXT, toko TEXT,
    marketplace TEXT, nomor_invoice TEXT, faktur_path TEXT,
    serial_number TEXT, keluhan TEXT, foto_produk_path TEXT,
    video_path TEXT, foto_kerusakan_path TEXT,
    status TEXT DEFAULT 'waiting', admin_analysis TEXT,
    management_decision TEXT, management_comment TEXT,
    approved_by INTEGER, approved_at TEXT, closed_by INTEGER,
    closed_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
    teknisi_id INTEGER NOT NULL, tanggal TEXT, jam TEXT, notes TEXT,
    created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS visit_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
    teknisi_id INTEGER NOT NULL, tanggal TEXT, jam TEXT,
    hasil_pemeriksaan TEXT, solusi TEXT,
    foto_sebelum_path TEXT, foto_sesudah_path TEXT, video_path TEXT,
    sparepart TEXT, tanggal_selesai TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT,
    message TEXT NOT NULL, link TEXT, related_id INTEGER,
    is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, description TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
}

const TURSO_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    phone TEXT, email TEXT, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kode_barang TEXT UNIQUE NOT NULL,
    nama_produk TEXT NOT NULL, tipe TEXT, garansi_bulan INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no TEXT UNIQUE NOT NULL,
    created_by INTEGER, product_id INTEGER, kode_barang TEXT,
    tanggal_complaint TEXT, customer_name TEXT, customer_alamat TEXT,
    customer_hp TEXT, customer_email TEXT, customer_kota TEXT,
    customer_provinsi TEXT, tanggal_pembelian TEXT, toko TEXT,
    marketplace TEXT, nomor_invoice TEXT, faktur_path TEXT,
    serial_number TEXT, keluhan TEXT, foto_produk_path TEXT,
    video_path TEXT, foto_kerusakan_path TEXT,
    status TEXT DEFAULT 'waiting', admin_analysis TEXT,
    management_decision TEXT, management_comment TEXT,
    approved_by INTEGER, approved_at TEXT, closed_by INTEGER,
    closed_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
    teknisi_id INTEGER NOT NULL, tanggal TEXT, jam TEXT, notes TEXT,
    created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS visit_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL,
    teknisi_id INTEGER NOT NULL, tanggal TEXT, jam TEXT,
    hasil_pemeriksaan TEXT, solusi TEXT,
    foto_sebelum_path TEXT, foto_sesudah_path TEXT, video_path TEXT,
    sparepart TEXT, tanggal_selesai TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT,
    message TEXT NOT NULL, link TEXT, related_id INTEGER,
    is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, description TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`
];

async function ensureTursoTables() {
  if (!turso) return;
  for (const sql of TURSO_TABLE_SQL) {
    await turso.execute({ sql, args: [] });
  }
}

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode=WAL');
  db.pragma('foreign_keys=ON');

  isTurso = !!(process.env.TURSO_DB_URL);
  if (isTurso) {
    const { createClient } = require('@libsql/client');
    turso = createClient({
      url: process.env.TURSO_DB_URL,
      authToken: process.env.TURSO_DB_TOKEN || '',
    });
  }

  createTablesLocal();
  return db;
}

async function run(sql, params = []) {
  if (turso) {
    try { return await turso.execute({ sql, args: params }); } catch (e) { console.error('Turso run error, fallback local:', e.message); }
  }
  return db.prepare(sql).run(params);
}

async function runWithResults(sql, params = []) {
  if (turso) {
    try { return await turso.execute({ sql, args: params }); } catch (e) { console.error('Turso runWithResults error, fallback local:', e.message); }
  }
  return db.prepare(sql).run(params);
}

async function queryAll(sql, params = []) {
  if (turso) {
    try {
      const r = await turso.execute({ sql, args: params });
      return rowsToObjects(r.rows, r.columns);
    } catch (e) { console.error('Turso queryAll error, fallback local:', e.message); }
  }
  return db.prepare(sql).all(params);
}

async function queryOne(sql, params = []) {
  if (turso) {
    try {
      const r = await turso.execute({ sql, args: params });
      const rows = rowsToObjects(r.rows, r.columns);
      return rows[0] || null;
    } catch (e) { console.error('Turso queryOne error, fallback local:', e.message); }
  }
  return db.prepare(sql).get(params) || null;
}

function getDB() { return db; }

function closeDB() {
  try { if (db) { db.close(); db = null; } } catch (e) { /* ignore */ }
  turso = null;
}

function checkpoint() {
  if (!isTurso && db) {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) { /* ignore */ }
  }
}

function cleanupSessions() {
  try {
    db.prepare("DELETE FROM sessions WHERE expired_at < ?").run(Math.floor(Date.now() / 1000));
  } catch (e) { /* ignore */ }
}

class SQLiteSessionStore extends (require('express-session').Store) {
  get(sid, cb) {
    try {
      const row = db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expired_at >= ?").get(sid, Math.floor(Date.now() / 1000));
      if (typeof cb === 'function') cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { if (typeof cb === 'function') cb(e); }
  }
  set(sid, session, cb) {
    try {
      const sess = JSON.stringify(session);
      const maxAge = session.cookie && session.cookie.maxAge ? session.cookie.maxAge : 86400000;
      const expired_at = Math.floor(Date.now() / 1000) + Math.floor(maxAge / 1000);
      db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)").run(sid, sess, expired_at);
      if (typeof cb === 'function') cb(null);
    } catch (e) { if (typeof cb === 'function') cb(e); }
  }
  destroy(sid, cb) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      if (typeof cb === 'function') cb(null);
    } catch (e) { if (typeof cb === 'function') cb(e); }
  }
  touch(sid, session, cb) {
    try {
      const maxAge = session.cookie && session.cookie.maxAge ? session.cookie.maxAge : 86400000;
      const expired_at = Math.floor(Date.now() / 1000) + Math.floor(maxAge / 1000);
      db.prepare("UPDATE sessions SET expired_at = ? WHERE sid = ?").run(expired_at, sid);
      if (typeof cb === 'function') cb(null);
    } catch (e) { if (typeof cb === 'function') cb(e); }
  }
}

const SYNC_TABLES = ['users', 'products', 'tickets', 'schedules', 'visit_results', 'notifications', 'activity_log'];

async function syncLocalToTurso() {
  if (!turso || !db) return;
  const rev = [...SYNC_TABLES].reverse();
  for (const t of rev) {
    try { await turso.execute({ sql: `DELETE FROM "${t}"`, args: [] }); } catch (e) { /* ignore */ }
  }
  for (const table of SYNC_TABLES) {
    const rows = db.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const ph = cols.map(() => '?').join(',');
    const qn = cols.map(c => `"${c}"`).join(',');
    for (const row of rows) {
      try {
        await turso.execute({ sql: `INSERT INTO "${table}" (${qn}) VALUES (${ph})`, args: cols.map(c => row[c]) });
      } catch (e) {
        console.error(`Turso sync error [${table}]:`, e.message);
      }
    }
  }
}

async function exportTursoToLocal() {
  if (!turso || !db) return;
  const tables = ['users', 'products', 'tickets', 'schedules', 'visit_results', 'notifications', 'activity_log'];
  try { db.exec("ROLLBACK"); } catch (e) { /* clear hanging tx from prev error */ }
  try {
    db.exec("BEGIN");
    for (const t of tables) {
      db.exec(`DELETE FROM "${t}"`);
    }
    for (const table of tables) {
      const r = await turso.execute({ sql: `SELECT * FROM "${table}"`, args: [] });
      const rows = rowsToObjects(r.rows, r.columns);
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const ph = cols.map(() => '?').join(',');
      const qn = cols.map(c => `"${c}"`).join(',');
      const stmt = db.prepare(`INSERT INTO "${table}" (${qn}) VALUES (${ph})`);
      for (const row of rows) {
        stmt.run(cols.map(c => row[c]));
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch (e2) { /* ignore */ }
    throw e;
  }
}

setInterval(cleanupSessions, 3600000);

function prepareBackup() {
  if (!db) return;
  createTablesLocal();
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) { /* ignore */ }
}

module.exports = { initDB, closeDB, run, runWithResults, queryAll, queryOne, getDB, SQLiteSessionStore, checkpoint, ensureTursoTables, syncLocalToTurso, exportTursoToLocal, prepareBackup, SYNC_TABLES };
