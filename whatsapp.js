const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');
let client = null;
let ready = false;
let qrShown = false;
let lastQr = null;
let initPromise = null;
let reconnectTimer = null;

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000;
const RECONNECT_DELAY = 10000;
const MAX_FAILED_MSGS = 50;

let failedMessages = [];

function init() {
  if (initPromise) return initPromise;
  initPromise = new Promise(function(resolve) {
    cleanup();
    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--single-process',
          '--disable-background-networking',
          '--disable-sync',
          '--mute-audio',
          '--no-first-run',
          '--disable-notifications',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees,site-per-process,Translate',
          '--js-flags=--max-heap-size=256 --max-old-space-size=256'
        ],
        protocolTimeout: 600000
      }
    });

    client.on('qr', function(qr) {
      lastQr = qr;
      if (!qrShown) {
        console.log('\n========================================');
        console.log('  SCAN QR CODE UNTUK WHATSAPP NOTIF');
        console.log('  Buka WhatsApp > Settings > Linked Devices');
        console.log('========================================\n');
        qrcodeTerminal.generate(qr, { small: true });
        qrShown = true;
      }
    });

    client.on('ready', function() {
      ready = true;
      qrShown = false;
      lastQr = null;
      console.log('\n\u2713 WhatsApp terhubung! Notifikasi akan dikirim via WA.\n');
      resolve(true);
    });

    client.on('disconnected', function(reason) {
      ready = false;
      console.log('WhatsApp disconnected:', reason);
      scheduleReconnect();
    });

    client.on('auth_failure', function(msg) {
      console.error('WhatsApp auth failure:', msg);
      ready = false;
      resolve(false);
    });

    client.initialize().catch(function(err) {
      console.error('WhatsApp init error:', err.message);
      ready = false;
      resolve(false);
    });
  });
  return initPromise;
}

function scheduleReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); }
  reconnectTimer = setTimeout(function() {
    console.log('WhatsApp: mencoba reconnect ulang...');
    initPromise = null;
    init();
  }, RECONNECT_DELAY);
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
  if (client) {
    try { await client.destroy(); } catch(e) {}
  }
  ready = false;
  qrShown = false;
  lastQr = null;
  initPromise = null;
  var authDir = path.join(__dirname, '.wwebjs_auth');
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  return init();
}

function normalizePhone(phone) {
  if (!phone) return null;
  var num = phone.replace(/[^0-9]/g, '');
  if (num.startsWith('0')) num = '62' + num.substring(1);
  if (num.startsWith('62')) return num + '@c.us';
  return null;
}

async function sendWaMessage(phone, message) {
  if (!ready || !client) {
    console.log('WhatsApp not ready. Skipping WA notification to', phone);
    addFailed(phone, message, 'WA not ready');
    return false;
  }
  try {
    var number = normalizePhone(phone);
    if (!number) return false;
    var sent = await client.sendMessage(number, message);
    if (sent) {
      removeFailed(phone, message);
    }
    return !!sent;
  } catch (e) {
    var errMsg = e.message || String(e);
    console.error('WA send error:', errMsg);
    addFailed(phone, message, errMsg);
    if (errMsg.includes('timed out') || errMsg.includes('Timeout') || errMsg.includes('Protocol error')) {
      console.log('WA timeout detected — triggering reconnect...');
      ready = false;
      scheduleReconnect();
    }
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
  if (!ready || !client) return false;
  try {
    var number = normalizePhone(phone);
    if (!number) return false;
    var sent = await client.sendMessage(number, message);
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

async function sendApprovalNotification(managementPhones, ticketNo, customer) {
  var msg = '\uD83D\uDD14 *APPROVAL DIBUTUHKAN*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nAda ticket baru yang membutuhkan approval Anda.' + appLink('/management/approval');
  for (var i = 0; i < managementPhones.length; i++) {
    await sendWithRetry(managementPhones[i], msg);
  }
}

async function sendApprovedNotification(adminPhone, ticketNo) {
  var msg = '\u2705 *TICKET DISETUJUI*\n\nTicket: ' + ticketNo + '\n\nManagement telah menyetujui ticket. Silakan buat jadwal teknisi.' + appLink('/admin/tickets');
  await sendWithRetry(adminPhone, msg);
}

async function sendRejectedNotification(adminPhone, ticketNo) {
  var msg = '\u274C *TICKET DITOLAK*\n\nTicket: ' + ticketNo + '\n\nManagement telah menolak ticket.' + appLink('/admin/tickets');
  await sendWithRetry(adminPhone, msg);
}

async function sendScheduleNotification(teknisiPhone, ticketNo, tanggal, jam) {
  var msg = '\uD83D\uDCC5 *JADWAL KUNJUNGAN BARU*\n\nTicket: ' + ticketNo + '\nTanggal: ' + tanggal + '\nJam: ' + jam + '\n\nSilakan cek aplikasi Broco CMS untuk detail.' + appLink('/teknisi/dashboard');
  await sendWithRetry(teknisiPhone, msg);
}

async function sendScheduleCancelledNotification(teknisiPhone, ticketNo) {
  var msg = '\u26A0\uFE0F *JADWAL DIBATALKAN*\n\nTicket: ' + ticketNo + '\n\nJadwal kunjungan telah dibatalkan.' + appLink('/teknisi/dashboard');
  await sendWithRetry(teknisiPhone, msg);
}

function getStatus() {
  return { connected: ready };
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
  getStatus: getStatus,
  normalizePhone: normalizePhone,
  getQRBase64: getQRBase64,
  forceReconnect: forceReconnect,
  getFailedMessages: getFailedMessages,
  resendMessage: resendMessage,
  clearFailedMessages: clearFailedMessages
};
