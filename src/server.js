import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SERVER_PORT } from './config.js';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serves the dashboard, a JSON state endpoint, an SSE live stream, and controls.
export function startServer(state) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/state', (req, res) => {
    res.json({ ...state.snapshot(), logs: log.recent(80) });
  });

  // Server-Sent Events: push a fresh snapshot on every engine update.
  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();

    const send = (snap) => res.write(`data: ${JSON.stringify({ ...snap, logs: log.recent(40) })}\n\n`);
    send(state.snapshot());

    const onUpdate = (snap) => send(snap);
    state.on('update', onUpdate);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);

    req.on('close', () => {
      clearInterval(ping);
      state.off('update', onUpdate);
    });
  });

  app.post('/api/control', (req, res) => {
    const { action } = req.body || {};
    switch (action) {
      case 'pause': state.running = false; log.warn('engine paused via dashboard'); break;
      case 'resume': state.running = true; log.info('engine resumed via dashboard'); break;
      case 'kill': state.killed = true; state.running = false; log.error('KILL SWITCH engaged via dashboard'); break;
      case 'reset-kill': state.killed = false; log.warn('kill switch reset via dashboard'); break;
      default: return res.status(400).json({ ok: false, error: 'unknown action' });
    }
    state.emitUpdate();
    return res.json({ ok: true, running: state.running, killed: state.killed });
  });

  app.listen(SERVER_PORT, () => log.info(`dashboard on http://localhost:${SERVER_PORT}`));
}
