import net from 'node:net';

/** Servidor SMTP mínimo só para teste: aceita tudo e guarda as mensagens para o teste ler. */
export async function startSmtpSink() {
  const mails = [];
  const server = net.createServer((socket) => {
    let buf = ''; let data = null; let current = { to: [], raw: '' };
    const send = (line) => socket.write(`${line}\r\n`);
    send('220 sink ESMTP');
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (data !== null) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) { data += buf; buf = ''; return; }
          data += buf.slice(0, end); buf = buf.slice(end + 5);
          current.raw = data; mails.push(current); current = { to: [], raw: '' }; data = null;
          send('250 queued');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) { socket.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n'); }
        else if (cmd.startsWith('AUTH')) send('235 ok');
        else if (cmd.startsWith('MAIL FROM')) send('250 ok');
        else if (cmd.startsWith('RCPT TO')) { current.to.push(line.slice(line.indexOf('<') + 1, line.indexOf('>')).toLowerCase()); send('250 ok'); }
        else if (cmd === 'DATA') { data = ''; send('354 go'); }
        else if (cmd === 'QUIT') { send('221 bye'); socket.end(); }
        else send('250 ok');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const decode = (raw) => raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return {
    port: server.address().port,
    mails,
    env: (port = server.address().port) => ({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', SMTP_USER: 'u', SMTP_PASSWORD: 'p', EMAIL_FROM: 'teste@placanamao.test' }),
    /** Token do último link de senha enviado para o endereço. */
    tokenFor(to) {
      for (let i = mails.length - 1; i >= 0; i -= 1) {
        if (!mails[i].to.includes(to.toLowerCase())) continue;
        const m = decode(mails[i].raw).match(/reset_token=([A-Za-z0-9_%-]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
      return null;
    },
    stop: () => new Promise((resolve) => server.close(resolve))
  };
}
