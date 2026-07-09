const { Client } = require('ssh2');
const c = new Client();
let out = '';
c.on('ready', function() {
  c.exec("grep -i 'sendCs\\|send-cs\\|cs_phone\\|cs_no_phone\\|Kirim WA ke CS\\|wa_cs_fail\\|CS WA\\|send CS' /root/.pm2/logs/broco-cms-error.log 2>/dev/null | tail -30", function(e, s) {
    if (e) { console.error(e.message); c.end(); return; }
    s.on('data', function(d) { out += d; });
    s.stderr.on('data', function(d) { out += d; });
    s.on('close', function() { console.log(out || 'No errors found'); c.end(); });
  });
}).connect({host:'187.127.124.59', username:'root', password:'Brocolblm123@', readyTimeout:15000});
