const { Client } = require('ssh2');
const c = new Client();
const cmds = [
  'cd /var/www/broco && node seed.js 2>&1',
  'cd /var/www/broco && node -e "var d=require(\"./database\");var rows=d.queryAll(\"SELECT id,username,role FROM users\",[]);console.log(JSON.stringify(rows));if(rows&&rows.length)rows.forEach(function(r){console.log(\"User:\"+r.username+\" Role:\"+r.role)});else console.log(\"NO USERS\")" 2>&1',
  'pm2 restart broco-cms 2>&1'
];
let i = 0;
c.on('ready', function n() {
  if (i >= cmds.length) return c.end();
  const cmd = cmds[i++];
  console.log('--- CMD ' + i + ' ---');
  c.exec(cmd, function(e, s) {
    if (e) { console.error('ERR:', e.message); return n(); }
    let o = '';
    s.on('data', function(d) { o += d; });
    s.stderr.on('data', function(d) { o += d; });
    s.on('close', function() { if (o.trim()) console.log(o.trim().substring(0,2000)); n(); });
  });
}).connect({host:'187.127.124.59', username:'root', password:'Brocolblm123@', readyTimeout:30000});
