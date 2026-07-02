const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
      const { version } = await fetchLatestBaileysVersion();
      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ['Broco CMS', 'Chrome', '1.0.0']
      });
      sock.ev.on('creds.update', saveCreds);
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
  var msg = '\uD83D\uDD14 *APPROVAL DIBUTUHKAN*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nAda ticket baru yang membutuhkan approval Anda.' + appLink('/management/approval');
  await sendWithRetry(phone, msg);
}

async function sendFollowUpApprovalNotification(phone, ticketNo, customer) {
  var msg = '\uD83D\uDD14 *FOLLOW-UP APPROVAL*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nFollow-up ticket membutuhkan re-approval Anda.' + appLink('/management/approval');
  await sendWithRetry(phone, msg);
}

async function sendApprovedNotification(phone, ticketNo) {
  var msg = '\u2705 *TICKET DISETUJUI*\n\nTicket: ' + ticketNo + '\n\nManagement telah menyetujui ticket. Silakan buat jadwal teknisi.' + appLink('/admin/tickets');
  await sendWithRetry(phone, msg);
}

async function sendRejectedNotification(phone, ticketNo) {
  var msg = '\u274C *TICKET DITOLAK*\n\nTicket: ' + ticketNo + '\n\nManagement telah menolak ticket.' + appLink('/admin/tickets');
  await sendWithRetry(phone, msg);
}

async function sendScheduleNotification(phone, ticketNo, tanggal, jam) {
  var msg = '\uD83D\uDCC5 *JADWAL KUNJUNGAN BARU*\n\nTicket: ' + ticketNo + '\nTanggal: ' + tanggal + '\nJam: ' + jam + '\n\nSilakan cek aplikasi Broco CMS untuk detail.' + appLink('/teknisi/dashboard');
  await sendWithRetry(phone, msg);
}

async function sendScheduleCancelledNotification(phone, ticketNo) {
  var msg = '\u26A0\uFE0F *JADWAL DIBATALKAN*\n\nTicket: ' + ticketNo + '\n\nJadwal kunjungan telah dibatalkan.' + appLink('/teknisi/dashboard');
  await sendWithRetry(phone, msg);
}

function getStatus() {
  return { connected: ready };
}

module.exports = {
  init: init,
  sendWaMessage: sendWaMessage,
  sendWithRetry: sendWithRetry,
  sendApprovalNotification: sendApprovalNotification,
  sendFollowUpApprovalNotification: sendFollowUpApprovalNotification,
  sendApprovedNotification: sendApprovedNotification,
  sendRejectedNotification: sendRejectedNotification,
  sendScheduleNotification: sendScheduleNotification,
  sendScheduleCancelledNotification: sendScheduleCancelledNotification,
  getStatus: getStatus,
  normalizePhone: normalizePhone,
  getQRBase64: getQRBase64,
  forceReconnect: forceReconnect,
  getFailedMessages: getFailedMessages,
  resendMessage: resendMessage,
  clearFailedMessages: clearFailedMessages
};
