// LOCAL E2E ONLY: the suite player (vite preview) listens on [::1] only; Docker's host gateway
// reaches the host over IPv4. Forward 127.0.0.1:<port> to [::1]:<port>, TLS untouched end to end.
import net from 'node:net';
for (const port of process.argv.slice(2).map(Number)) {
  net
    .createServer((c) => {
      const up = net.connect({ host: '::1', port });
      c.pipe(up).pipe(c);
      const end = () => {
        c.destroy();
        up.destroy();
      };
      c.on('error', end);
      up.on('error', end);
    })
    .listen(port, '127.0.0.1', () => console.log(`v4 forward 127.0.0.1:${port} -> [::1]:${port}`));
}
