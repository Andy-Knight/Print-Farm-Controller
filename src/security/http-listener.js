/** Catch synchronous failures and rejected async handlers at the listener boundary. */
export function guardedHttpListener(handler) {
  return (req, res) => {
    Promise.resolve().then(() => handler(req, res)).catch(() => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(400, {'content-type':'text/plain; charset=utf-8', 'connection':'close'});
      res.end('Invalid request');
    });
  };
}
