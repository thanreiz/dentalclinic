// Minimal local SMTP sink for QA: accepts any AUTH, appends each message to a JSONL file.
// Usage: node tests/e2e/support/smtp-sink.mjs [port=2526] [outFile=/tmp/qa-mail.jsonl]
import net from 'node:net';
import fs from 'node:fs';

const port = Number(process.argv[2] || 2526);
const out = process.argv[3] || '/tmp/qa-mail.jsonl';

net
  .createServer((sock) => {
    let mode = 'cmd';
    let data = '';
    let from = '';
    const to = [];
    let buf = '';
    const send = (s) => sock.write(s + '\r\n');
    send('220 qa-sink ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (mode === 'data') {
          if (line === '.') {
            fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), from, to: [...to], raw: data }) + '\n');
            data = '';
            to.length = 0;
            mode = 'cmd';
            send('250 OK queued');
          } else data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        if (mode === 'auth-user') { mode = 'auth-pass'; send('334 UGFzc3dvcmQ6'); continue; }
        if (mode === 'auth-pass') { mode = 'cmd'; send('235 OK'); continue; }
        const u = line.toUpperCase();
        if (u.startsWith('EHLO')) { sock.write('250-qa-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
        else if (u.startsWith('HELO')) send('250 qa-sink');
        else if (u.startsWith('AUTH PLAIN')) send('235 OK');
        else if (u.startsWith('AUTH LOGIN')) { mode = 'auth-user'; send('334 VXNlcm5hbWU6'); }
        else if (u.startsWith('MAIL FROM')) { from = line.slice(10); send('250 OK'); }
        else if (u.startsWith('RCPT TO')) { to.push(line.slice(8)); send('250 OK'); }
        else if (u === 'DATA') { mode = 'data'; send('354 go'); }
        else if (u === 'QUIT') { send('221 bye'); sock.end(); }
        else send('250 OK');
      }
    });
    sock.on('error', () => {});
  })
  .listen(port, '127.0.0.1', () => console.log(`smtp sink on ${port} -> ${out}`));
