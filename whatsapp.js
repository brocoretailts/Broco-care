const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.baileys_auth');
let sock = null;
let ready = false;
let lastQr = null;
let initPromise = null;
let reconnectTimer = null;

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000;
const RECONNECT_DELAY = 10000;
const MAX_FAILED_MSGS = 50;

let failedMessages = [];

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async function() {
    cleanup();
    if (sock) { try { sock.end(undefined); } catch(e) {} sock = null; }
    ready = false;
    lastQr = null;
    try {
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
      });
      sock.ev.on('creds.update', function() {
        saveCreds();
      });
      sock.ev.on('connection.update', function(update) {
        var { connection, lastDisconnect, qr } = update;
        if (qr) {
          lastQr = qr;
          console.log('Baileys QR received (scan with WhatsApp)');
        }
        if (connection === 'open') {
          ready = true;
          lastQr = null;
          console.log('\n\u2713 WhatsApp terhubung! Notifikasi akan dikirim via WA.\n');
        }
        if (connection === 'close') {
          ready = false;
          var reason = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 'unknown';
          console.log('WhatsApp disconnected (reason:', reason, '). Reconnecting in', RECONNECT_DELAY / 1000, 's...');
          initPromise = null;
          setTimeout(init, RECONNECT_DELAY);
        }
      });
      return true;
    } catch (e) {
      console.error('Baileys init error:', e.message);
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
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWaMessage_not_ready', 'phone=' + phone + ' ready=' + ready + ' sock=' + !!sock);
    addFailed(phone, message, 'WA not ready');
    return false;
  }
  try {
    var number = normalizePhone(phone);
    if (!number) {
      if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWaMessage_bad_phone', 'phone=' + phone + ' normalized=null');
      return false;
    }
    var jid = number + '@s.whatsapp.net';
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWaMessage_sending', 'jid=' + jid + ' msg_len=' + message.length);
    var sent = await sock.sendMessage(jid, { text: message });
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWaMessage_sent', 'jid=' + jid + ' sent=' + !!sent);
    if (sent) {
      removeFailed(phone, message);
    }
    return !!sent;
  } catch (e) {
    var errMsg = e.message || String(e);
    console.error('WA send error:', errMsg);
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWaMessage_error', 'phone=' + phone + ' error=' + errMsg + ' stack=' + (e.stack || ''));
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
  if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWithRetry', 'phone=' + phone + ' retries=' + retries + ' ready=' + ready);
  for (var i = 0; i < retries; i++) {
    var ok = await sendWaMessage(phone, message);
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWithRetry_attempt', 'phone=' + phone + ' attempt=' + (i+1) + ' ok=' + ok);
    if (ok) return true;
    if (i < retries - 1) await new Promise(function(r) { setTimeout(r, RETRY_DELAY); });
  }
  if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendWithRetry_failed', 'phone=' + phone + ' all retries exhausted');
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
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendApprovalNotification', 'phone=' + phone + ' ticketNo=' + ticketNo + ' customer=' + customer);
    var msg = '\uD83D\uDD14 *APPROVAL DIBUTUHKAN*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nAda ticket baru yang membutuhkan approval Anda.' + appLink('/management/approval');
    var result = await sendWithRetry(phone, msg);
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendApprovalNotification_result', 'phone=' + phone + ' result=' + result);
    return result;
  } catch (e) {
    console.error('sendApprovalNotification error:', e.message);
    if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendApprovalNotification_error', 'phone=' + phone + ' error=' + e.message);
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
  if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendToMany_start', 'Phones: ' + JSON.stringify(phones) + ' fn: ' + (fn.name || 'anon') + ' args: ' + JSON.stringify(args));
  var results = await Promise.allSettled(phones.map(function(p) {
    return fn(p, ...args).catch(function(e) {
      if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendToMany_fn_catch', 'Phone ' + p + ' failed: ' + (e && e.message));
      return false;
    });
  }));
  var ok = results.filter(function(r) { return r.status === 'fulfilled' && r.value; }).length;
  var fail = results.length - ok;
  if (typeof global !== 'undefined' && global.logDebug) global.logDebug('sendToMany_end', 'ok=' + ok + ' fail=' + fail + ' total=' + results.length);
  if (fail > 0) console.error('WA sendToMany:', fail, 'of', results.length, 'failed');
  return ok;
}

function getStatus() {
  return { connected: ready, qrAvailable: !!lastQr };
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
  getFailedMessages: getFailedMessages,
  resendMessage: resendMessage,
  clearFailedMessages: clearFailedMessages
};
