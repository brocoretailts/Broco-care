const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.baileys_auth');
let sock = null;
let ready = false;
let lastQr = null;
let initPromise = null;
let reconnectTimer = null;
let initError = null;
let initAttempts = 0;

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000;
const RECONNECT_DELAY = 10000;
const MAX_FAILED_MSGS = 50;

let failedMessages = [];
let tursoWaClient = null;

function getTurso() {
  if (tursoWaClient) return tursoWaClient;
  if (process.env.TURSO_DB_URL) {
    try {
      const { createClient } = require('@libsql/client');
      tursoWaClient = createClient({
        url: process.env.TURSO_DB_URL,
        authToken: process.env.TURSO_DB_TOKEN || '',
      });
    } catch (e) {
      console.error('WA Turso init error:', e.message);
    }
  }
  return tursoWaClient;
}

async function ensureAuthTable() {
  var t = getTurso();
  if (!t) return;
  try {
    await t.execute("CREATE TABLE IF NOT EXISTS wa_auth (key TEXT PRIMARY KEY, value TEXT)");
  } catch (e) {
    console.error('WA ensureAuthTable error:', e.message);
  }
}

async function saveAuthToTurso() {
  var t = getTurso();
  if (!t) return;
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    var files = fs.readdirSync(SESSION_DIR);
    for (var f of files) {
      var fp = path.join(SESSION_DIR, f);
      var stat = fs.statSync(fp);
      if (stat.isFile() && stat.size < 500000) {
        var buf = fs.readFileSync(fp);
        var b64 = buf.toString('base64');
        await t.execute("INSERT OR REPLACE INTO wa_auth (key, value) VALUES (?, ?)", [f, b64]);
      }
    }
  } catch (e) {
    console.error('saveAuthToTurso error:', e.message);
  }
}

async function loadAuthFromTurso() {
  var t = getTurso();
  if (!t) return false;
  try {
    var rows = await t.execute("SELECT key, value FROM wa_auth");
    if (!rows || !rows.rows || !rows.rows.length) return false;
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    var validCount = 0;
    for (var row of rows.rows) {
      if (row.key.startsWith('_')) continue; // skip internal
      // validate base64 (ignore old utf-8 data)
      var buf = Buffer.from(row.value, 'base64');
      if (!buf || buf.length < 10) {
        console.log('WA auth skip invalid entry:', row.key);
        continue;
      }
      // verify it looks like valid JSON or Baileys key material
      var reEncoded = buf.toString('base64');
      if (reEncoded !== row.value) {
        console.log('WA auth skip non-base64 entry:', row.key);
        continue;
      }
      fs.writeFileSync(path.join(SESSION_DIR, row.key), buf);
      validCount++;
    }
    if (!validCount) {
      console.log('WA auth: no valid entries found, clearing all');
      await t.execute("DELETE FROM wa_auth", []);
      return false;
    }
    console.log('Restored WA auth from Turso (' + validCount + ' files)');
    return true;
  } catch (e) {
    console.error('loadAuthFromTurso error:', e.message);
    // If error, clear all to force fresh auth
    try { await t.execute("DELETE FROM wa_auth", []); } catch (e2) {}
    return false;
  }
}

async function init() {
  if (initPromise) return initPromise;
  initAttempts++;
  initError = null;
  initPromise = (async function() {
    cleanup();
    if (sock) { try { sock.end(undefined); } catch(e) {} sock = null; }
    ready = false;
    lastQr = null;
    try {
      await ensureAuthTable();
      if (fs.existsSync(SESSION_DIR)) {
        var old = fs.readdirSync(SESSION_DIR);
        for (var f of old) fs.unlinkSync(path.join(SESSION_DIR, f));
        fs.rmdirSync(SESSION_DIR);
      }
      var loaded = await loadAuthFromTurso();
      if (loaded) console.log('WA auth restored from Turso, no QR scan needed');
      const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ['Broco CMS', 'Chrome', '1.0.0'],
        keepAliveIntervalMs: 15000,
        maxMsgRetryCount: 5,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
      });
      sock.ev.on('error', function(err) {
        console.error('Baileys socket error (ignored):', err.message);
        initError = 'Socket error: ' + err.message;
      });
      sock.ev.on('creds.update', function() {
        saveCreds();
        saveAuthToTurso();
      });
      sock.ev.on('connection.update', function(update) {
        var { connection, lastDisconnect, qr } = update;
        if (qr) {
          lastQr = qr;
          initError = null;
          console.log('Baileys QR received (scan with WhatsApp)');
        }
        if (connection === 'open') {
          ready = true;
          lastQr = null;
          initError = null;
          console.log('\n\u2713 WhatsApp terhubung! Notifikasi akan dikirim via WA.\n');
          saveAuthToTurso();
        }
        if (connection === 'close') {
          ready = false;
          var reason = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 'unknown';
          var errMsg = lastDisconnect && lastDisconnect.error ? lastDisconnect.error.message || lastDisconnect.error : '';
          initError = 'Disconnected (reason: ' + reason + ') ' + errMsg;
          console.log('WhatsApp disconnected (reason:', reason, ')', errMsg, '. Reconnecting in', RECONNECT_DELAY / 1000, 's...');
          // On BAD_SESSION, keep auth in Turso — the validation in loadAuthFromTurso
          // will skip corrupted entries and restore valid ones. Fresh QR will appear
          // automatically if no valid auth exists.
          initPromise = null;
          setTimeout(init, RECONNECT_DELAY);
        }
      });
      // watchdog: if no connection.update after 60s, log warning
      var watchdog = setTimeout(function() {
        if (!ready && !lastQr) {
          var warn = 'WA init watchdog: no connection event after 60s (attempt ' + initAttempts + ')';
          console.warn(warn);
          if (!initError) initError = warn;
        }
      }, 60000);
      watchdog.unref();
      return true;
    } catch (e) {
      var msg = e.message || String(e);
      console.error('Baileys init error:', msg);
      initError = 'Init error: ' + msg;
      ready = false;
      console.log('WhatsApp init failed — retrying in', RECONNECT_DELAY / 1000, 's...');
      initPromise = null;
      setTimeout(init, RECONNECT_DELAY);
      return false;
    }
  })();
  return initPromise;
}

function cleanup() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

async function getQRBase64() {
  if (lastQr) {
    return await QRCode.toDataURL(lastQr);
  }
  return null;
}

async function clearAuthAndReconnect() {
  var t = getTurso();
  if (t) try { await t.execute("DELETE FROM wa_auth", []); } catch(e) {}
  if (fs.existsSync(SESSION_DIR)) {
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch(e) {}
  }
  initPromise = null;
  return forceReconnect();
}

async function forceReconnect() {
  cleanup();
  if (sock) { try { sock.end(undefined); } catch(e) {} }
  ready = false;
  lastQr = null;
  initPromise = null;
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  }
  return init();
}

function normalizePhone(phone) {
  if (!phone) return null;
  if (typeof phone !== 'string') return null;
  var num = phone.replace(/[^0-9]/g, '');
  if (num.startsWith('0')) num = '62' + num.substring(1);
  if (num.startsWith('62')) return num;
  return null;
}

async function sendWaMessage(phone, message) {
  if (!ready || !sock) {
    console.log('WhatsApp not ready. Skipping WA notification to', phone);
    addFailed(phone, message, 'WA not ready');
    return false;
  }
  try {
    var number = normalizePhone(phone);
    if (!number) return false;
    var jid = number + '@s.whatsapp.net';
    var sent = await sock.sendMessage(jid, { text: message });
    if (sent) {
      removeFailed(phone, message);
    }
    return !!sent;
  } catch (e) {
    var errMsg = e.message || String(e);
    console.error('WA send error:', errMsg);
    addFailed(phone, message, errMsg);
    return false;
  }
}

function addFailed(phone, message, reason) {
  failedMessages.unshift({ phone: normalizePhone(phone) || phone, message: message, reason: reason || 'unknown', time: new Date().toISOString() });
  if (failedMessages.length > MAX_FAILED_MSGS) failedMessages.pop();
}

function removeFailed(phone, message) {
  var idx = failedMessages.findIndex(function(f) { return f.phone === phone && f.message === message; });
  if (idx >= 0) failedMessages.splice(idx, 1);
}

function getFailedMessages() {
  return failedMessages;
}

async function resendMessage(phone, message) {
  if (!ready || !sock) return false;
  try {
    var number = normalizePhone(phone);
    if (!number) return false;
    var jid = number + '@s.whatsapp.net';
    var sent = await sock.sendMessage(jid, { text: message });
    if (sent) {
      removeFailed(phone, message);
    }
    return !!sent;
  } catch (e) {
    console.error('WA resend error:', e.message);
    return false;
  }
}

function clearFailedMessages() {
  failedMessages = [];
}

async function sendWithRetry(phone, message, retries) {
  if (retries === undefined) retries = MAX_RETRIES;
  for (var i = 0; i < retries; i++) {
    var ok = await sendWaMessage(phone, message);
    if (ok) return true;
    if (i < retries - 1) await new Promise(function(r) { setTimeout(r, RETRY_DELAY); });
  }
  return false;
}

function appLink(path) {
  var url = process.env.APP_URL || '';
  if (!url) return '';
  url = url.replace(/\/+$/, '');
  return '\n' + url + (path || '');
}

async function sendApprovalNotification(phone, ticketNo, customer) {
  try {
    var msg = '\uD83D\uDD14 *APPROVAL DIBUTUHKAN*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nAda ticket baru yang membutuhkan approval Anda.' + appLink('/management/approval');
    return await sendWithRetry(phone, msg);
  } catch (e) {
    console.error('sendApprovalNotification error:', e.message);
    return false;
  }
}

async function sendApprovedNotification(phone, ticketNo) {
  try {
    var msg = '\u2705 *TICKET DISETUJUI*\n\nTicket: ' + ticketNo + '\n\nManagement telah menyetujui ticket. Silakan buat jadwal teknisi.' + appLink('/admin/tickets');
    return await sendWithRetry(phone, msg);
  } catch (e) {
    console.error('sendApprovedNotification error:', e.message);
    return false;
  }
}

async function sendRejectedNotification(phone, ticketNo) {
  try {
    var msg = '\u274C *TICKET DITOLAK*\n\nTicket: ' + ticketNo + '\n\nManagement telah menolak ticket.' + appLink('/admin/tickets');
    return await sendWithRetry(phone, msg);
  } catch (e) {
    console.error('sendRejectedNotification error:', e.message);
    return false;
  }
}

async function sendScheduleNotification(phone, ticketNo, tanggal, jam) {
  try {
    var msg = '\uD83D\uDCC5 *JADWAL KUNJUNGAN BARU*\n\nTicket: ' + ticketNo + '\nTanggal: ' + tanggal + '\nJam: ' + jam + '\n\nSilakan cek aplikasi Broco CMS untuk detail.' + appLink('/teknisi/dashboard');
    return await sendWithRetry(phone, msg);
  } catch (e) {
    console.error('sendScheduleNotification error:', e.message);
    return false;
  }
}

async function sendScheduleCancelledNotification(phone, ticketNo) {
  try {
    var msg = '\u26A0\uFE0F *JADWAL DIBATALKAN*\n\nTicket: ' + ticketNo + '\n\nJadwal kunjungan telah dibatalkan.' + appLink('/teknisi/dashboard');
    return await sendWithRetry(phone, msg);
  } catch (e) {
    console.error('sendScheduleCancelledNotification error:', e.message);
    return false;
  }
}

async function sendToMany(phones, fn) {
  var args = Array.prototype.slice.call(arguments, 2);
  if (!phones || !phones.length) return 0;
  var results = await Promise.allSettled(phones.map(function(p) {
    return fn(p, ...args).catch(function() { return false; });
  }));
  var ok = results.filter(function(r) { return r.status === 'fulfilled' && r.value; }).length;
  var fail = results.length - ok;
  if (fail > 0) console.error('WA sendToMany:', fail, 'of', results.length, 'failed');
  return ok;
}

function getStatus() {
  return { connected: ready, qrAvailable: !!lastQr, initAttempts: initAttempts, error: initError };
}

module.exports = {
  init: init,
  sendWaMessage: sendWaMessage,
  sendWithRetry: sendWithRetry,
  sendApprovalNotification: sendApprovalNotification,
  sendApprovedNotification: sendApprovedNotification,
  sendRejectedNotification: sendRejectedNotification,
  sendScheduleNotification: sendScheduleNotification,
  sendScheduleCancelledNotification: sendScheduleCancelledNotification,
  sendToMany: sendToMany,
  appLink: appLink,
  getStatus: getStatus,
  normalizePhone: normalizePhone,
  getQRBase64: getQRBase64,
  forceReconnect: forceReconnect,
  clearAuthAndReconnect: clearAuthAndReconnect,
  getFailedMessages: getFailedMessages,
  resendMessage: resendMessage,
  clearFailedMessages: clearFailedMessages
};
