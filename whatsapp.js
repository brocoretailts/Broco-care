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

function init() {
  if (initPromise) return initPromise;
  initPromise = new Promise(function(resolve) {
    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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

async function getQRBase64() {
  if (lastQr) {
    return await QRCode.toDataURL(lastQr);
  }
  return null;
}

async function forceReconnect() {
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
    return false;
  }
  try {
    var number = normalizePhone(phone);
    if (!number) return false;
    var chatId = number;
    var sent = await client.sendMessage(chatId, message);
    return !!sent;
  } catch (e) {
    console.error('WA send error:', e.message);
    return false;
  }
}

async function sendApprovalNotification(managementPhones, ticketNo, customer) {
  var msg = '\uD83D\uDD14 *APPROVAL DIBUTUHKAN*\n\nTicket: ' + ticketNo + '\nCustomer: ' + customer + '\n\nAda ticket baru yang membutuhkan approval Anda. Segera buka aplikasi Broco CMS.';
  for (var i = 0; i < managementPhones.length; i++) {
    await sendWaMessage(managementPhones[i], msg);
  }
}

async function sendApprovedNotification(adminPhone, ticketNo) {
  var msg = '\u2705 *TICKET DISETUJUI*\n\nTicket: ' + ticketNo + '\n\nManagement telah menyetujui ticket. Silakan buat jadwal teknisi.';
  await sendWaMessage(adminPhone, msg);
}

async function sendRejectedNotification(adminPhone, ticketNo) {
  var msg = '\u274C *TICKET DITOLAK*\n\nTicket: ' + ticketNo + '\n\nManagement telah menolak ticket.';
  await sendWaMessage(adminPhone, msg);
}

async function sendScheduleNotification(teknisiPhone, ticketNo, tanggal, jam) {
  var msg = '\uD83D\uDCC5 *JADWAL KUNJUNGAN BARU*\n\nTicket: ' + ticketNo + '\nTanggal: ' + tanggal + '\nJam: ' + jam + '\n\nSilakan cek aplikasi Broco CMS untuk detail.';
  await sendWaMessage(teknisiPhone, msg);
}

async function sendScheduleCancelledNotification(teknisiPhone, ticketNo) {
  var msg = '\u26A0\uFE0F *JADWAL DIBATALKAN*\n\nTicket: ' + ticketNo + '\n\nJadwal kunjungan telah dibatalkan.';
  await sendWaMessage(teknisiPhone, msg);
}

function getStatus() {
  return { connected: ready };
}

module.exports = {
  init: init,
  sendWaMessage: sendWaMessage,
  sendApprovalNotification: sendApprovalNotification,
  sendApprovedNotification: sendApprovedNotification,
  sendRejectedNotification: sendRejectedNotification,
  sendScheduleNotification: sendScheduleNotification,
  sendScheduleCancelledNotification: sendScheduleCancelledNotification,
  getStatus: getStatus,
  normalizePhone: normalizePhone,
  getQRBase64: getQRBase64,
  forceReconnect: forceReconnect
};
