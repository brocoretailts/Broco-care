const { Client } = require('ssh2');
const c = new Client();
c.on('ready', function() {
  c.exec("pm2 logs broco-cms --lines 80 --nostream 2>&1 | grep -iE 'error|voucher|qr|ERRO' | tail -40", function(e, s) {
    var o = '';
    s.on('data', function(d) { o += d; });
    s.stderr.on('data', function(d) { o += d; });
    s.on('close', function() { console.log(o.substring(0,3000) || 'no errors'); c.end(); });
  });
}).connect({host:'187.127.124.59', username:'root', password:'Brocolblm123@', readyTimeout:15000});
