// Local stand-in for api.telegram.org used by the demo and the acceptance tests.
// It records every Bot API call to .telegram-stub-log.jsonl so the notification payloads can be
// inspected, and it can be made to fail on purpose to prove the outbox retries.
// This is NOT the real Telegram service: no message leaves this machine.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.STUB_PORT || 9099);
const logFile = path.join(process.cwd(), '.telegram-stub-log.jsonl');
let messageId = 1000;

function offline() {
  return fs.existsSync(path.join(process.cwd(), '.telegram-stub-offline'));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/__log') return send(200, { calls: readLog() });
    if (url.pathname === '/__reset') {
      fs.writeFileSync(logFile, '');
      return send(200, { ok: true });
    }
    if (url.pathname === '/__offline') {
      fs.writeFileSync(path.join(process.cwd(), '.telegram-stub-offline'), '1');
      return send(200, { ok: true, offline: true });
    }
    if (url.pathname === '/__online') {
      fs.rmSync(path.join(process.cwd(), '.telegram-stub-offline'), { force: true });
      return send(200, { ok: true, offline: false });
    }

    const match = url.pathname.match(/^\/bot[^/]+\/(\w+)$/);
    if (!match) return send(404, { ok: false, error_code: 404, description: 'Not found' });
    const method = match[1];
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

    fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), method, body }) + '\n');

    if (offline()) {
      return send(500, { ok: false, error_code: 500, description: 'Simulated Bot API outage' });
    }
    if (method === 'sendMessage') {
      if (typeof body.chat_id !== 'number' || typeof body.text !== 'string') {
        return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat_id and text are required' });
      }
      return send(200, { ok: true, result: { message_id: ++messageId, chat: { id: body.chat_id }, text: body.text } });
    }
    if (method === 'answerCallbackQuery' || method === 'setWebhook' || method === 'deleteWebhook') {
      return send(200, { ok: true, result: true });
    }
    if (method === 'getUpdates') return send(200, { ok: true, result: [] });
    if (method === 'getMe') {
      return send(200, { ok: true, result: { id: 123456, is_bot: true, username: 'kidsstore_demo_bot' } });
    }
    return send(200, { ok: true, result: true });
  });
});

function readLog() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

server.listen(port, '127.0.0.1', () => console.log(`Telegram Bot API stub listening on 127.0.0.1:${port}`));
