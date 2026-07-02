// Timestamped logger that also keeps a ring buffer for the dashboard.
const buffer = [];
const MAX = 500;

function push(level, msg) {
  const entry = { t: Date.now(), level, msg };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const line = `[${new Date(entry.t).toISOString()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  return entry;
}

export const log = {
  info: (m) => push('info', m),
  warn: (m) => push('warn', m),
  error: (m) => push('error', m),
  trade: (m) => push('trade', m),
  recent: (n = 100) => buffer.slice(-n),
};
