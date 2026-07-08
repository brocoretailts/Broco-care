const { Client } = require('ssh2');
const c = new Client();
let out = '';
c.on('ready', function() {
  c.exec('cd /var/www/broco && echo "===BRANCH===" && git branch && echo "===LOG===" && git log --oneline -3 && echo "===FILES===" && grep -n "placeholder" views/admin/ticket-detail.ejs | head -3 && echo "---" && grep -n "required" views/admin/ticket-detail.ejs | head -3 && echo "===DONE==="', function(e, s) {
    if (e) { console.error(e.message); c.end(); return; }
    s.on('data', function(d) { out += d; });
    s.stderr.on('data', function(d) { out += d; });
    s.on('close', function() { console.log(out); c.end(); });
  });
}).connect({host:'187.127.124.59', username:'root', password:'Brocolblm123@', readyTimeout:15000});
