'use strict';

// Dependency-free Node server: static hosting + a small authoritative WebSocket TDM simulation.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const TICK = 1000 / 30;
const SNAPSHOT = 1000 / 15;
const WORLD = { w: 3000, h: 1900 };
const TEAM_SIZE = 5;
const SCORE_LIMIT = 40;
const MATCH_LENGTH = 180;
const obstacles = [
  [440,300,270,132],[1080,210,150,290],[1760,310,310,145],[2350,205,155,330],
  [720,840,180,320],[1330,730,340,135],[2050,880,235,145],[2530,770,210,332],
  [355,1375,290,135],[1085,1270,155,300],[1640,1430,330,145],[2245,1300,145,310],[2600,1485,250,130]
];
const spawn = {
  blue: [{x:230,y:660},{x:270,y:870},{x:250,y:1120},{x:410,y:610},{x:430,y:1290}],
  red: [{x:2770,y:650},{x:2710,y:870},{x:2750,y:1120},{x:2590,y:610},{x:2560,y:1290}]
};
const rooms = [];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function uid() { return crypto.randomBytes(5).toString('hex'); }
function cleanName(name) { return String(name || 'RANGER').replace(/[^a-z0-9 _-]/ig, '').trim().slice(0, 12).toUpperCase() || 'RANGER'; }
function hitObstacle(x, y, r) {
  for (const [ox, oy, ow, oh] of obstacles) {
    const nx = clamp(x, ox, ox + ow), ny = clamp(y, oy, oy + oh);
    if ((x - nx) ** 2 + (y - ny) ** 2 < r ** 2) return true;
  }
  return false;
}
function move(player, dx, dy, dt) {
  const nx = clamp(player.x + dx * dt, 38, WORLD.w - 38);
  const ny = clamp(player.y + dy * dt, 38, WORLD.h - 38);
  if (!hitObstacle(nx, player.y, 19)) player.x = nx; else player.vx *= -.12;
  if (!hitObstacle(player.x, ny, 19)) player.y = ny; else player.vy *= -.12;
}
function wsFrame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  let header;
  if (body.length < 126) header = Buffer.from([0x80 | opcode, body.length]);
  else if (body.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  return Buffer.concat([header, body]);
}
function send(client, message) { if (client.socket.writable) client.socket.write(wsFrame(message)); }
function broadcast(room, message) { for (const c of room.clients.values()) send(c, message); }

function createRoom() {
  const room = { id: uid(), clients: new Map(), players: new Map(), bullets: [], events: [], blue: 0, red: 0, time: MATCH_LENGTH, started: false, finished: false, lastShot: 0 };
  rooms.push(room); return room;
}
function availableRoom() { return rooms.find(r => !r.started && r.players.size < TEAM_SIZE * 2) || createRoom(); }
function lobby(room) {
  const blue = [...room.players.values()].filter(p => p.team === 'blue').length;
  const red = room.players.size - blue;
  broadcast(room, { t: 'lobby', count: room.players.size, blue, red, need: TEAM_SIZE * 2 - room.players.size });
}
function playerFor(room, client) {
  const blue = [...room.players.values()].filter(p => p.team === 'blue').length;
  const red = room.players.size - blue;
  const team = blue <= red ? 'blue' : 'red';
  const index = team === 'blue' ? blue : red;
  const s = spawn[team][index];
  return { id: client.id, name: client.name, team, index, x: s.x, y: s.y, vx: 0, vy: 0, angle: team === 'blue' ? 0 : Math.PI, hp: 100, shield: 100, alive: true, respawn: 0, invuln: 1.2, shootCd: 0, dashCd: 0, boost: 0, input: { mx: 0, my: 0, angle: team === 'blue' ? 0 : Math.PI, fire: false, dash: false }, kills: 0, deaths: 0 };
}
function resetPlayer(p) {
  const s = spawn[p.team][p.index];
  p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.hp = p.shield = 100; p.alive = true; p.respawn = 0; p.invuln = 1.1; p.shootCd = 0; p.dashCd = 0; p.boost = 0;
}
function startRoom(room) {
  room.started = true; room.finished = false; room.blue = room.red = 0; room.time = MATCH_LENGTH; room.bullets = []; room.events = [];
  for (const p of room.players.values()) resetPlayer(p);
  broadcast(room, { t: 'start', room: room.id, players: room.players.size });
}
function kill(room, victim, attacker) {
  if (!victim.alive) return;
  victim.alive = false; victim.deaths++; victim.hp = victim.shield = 0; victim.respawn = 3.1;
  if (attacker) { attacker.kills++; room[attacker.team]++; room.events.push({ k: 'kill', killer: attacker.name, victim: victim.name, team: attacker.team }); }
}
function damage(room, victim, amount, attacker) {
  if (!victim.alive || victim.invuln > 0) return;
  const absorbed = Math.min(victim.shield, amount); victim.shield -= absorbed; victim.hp -= amount - absorbed;
  if (victim.hp <= 0) kill(room, victim, attacker);
}
function shoot(room, p) {
  p.shootCd = .125;
  const angle = p.angle;
  room.bullets.push({ id: uid(), x: p.x + Math.cos(angle) * 24, y: p.y + Math.sin(angle) * 24, px: p.x, py: p.y, vx: Math.cos(angle) * 980, vy: Math.sin(angle) * 980, team: p.team, owner: p.id, life: .72, damage: 17 });
}
function updateRoom(room, dt) {
  if (!room.started || room.finished) return;
  room.time -= dt;
  for (const p of room.players.values()) {
    p.shootCd -= dt; p.dashCd -= dt; p.invuln -= dt; p.boost -= dt;
    if (!p.alive) { p.respawn -= dt; if (p.respawn <= 0) resetPlayer(p); continue; }
    const input = p.input;
    p.angle = Number.isFinite(input.angle) ? input.angle : p.angle;
    let mx = clamp(Number(input.mx) || 0, -1, 1), my = clamp(Number(input.my) || 0, -1, 1);
    const d = Math.hypot(mx, my); if (d > 1) { mx /= d; my /= d; }
    if (input.dash && p.dashCd <= 0) { p.dashCd = 3; p.boost = .16; p.vx = mx || Math.cos(p.angle); p.vy = my || Math.sin(p.angle); const s = Math.hypot(p.vx, p.vy) || 1; p.vx = p.vx / s * 710; p.vy = p.vy / s * 710; p.invuln = .18; input.dash = false; }
    const speed = p.boost > 0 ? 560 : 280;
    p.vx += (mx * speed - p.vx) * Math.min(1, dt * 11); p.vy += (my * speed - p.vy) * Math.min(1, dt * 11);
    if (!mx) p.vx *= Math.max(0, 1 - dt * 9); if (!my) p.vy *= Math.max(0, 1 - dt * 9);
    move(p, p.vx, p.vy, dt);
    if (input.fire && p.shootCd <= 0) shoot(room, p);
  }
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const b = room.bullets[i]; b.life -= dt; b.px = b.x; b.py = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD.w || b.y > WORLD.h || hitObstacle(b.x, b.y, 3)) { room.bullets.splice(i, 1); continue; }
    for (const p of room.players.values()) if (p.alive && p.team !== b.team && Math.hypot(p.x - b.x, p.y - b.y) < 23) { damage(room, p, b.damage, room.players.get(b.owner)); room.bullets.splice(i, 1); break; }
  }
  if (room.blue >= SCORE_LIMIT || room.red >= SCORE_LIMIT || room.time <= 0) { room.finished = true; broadcast(room, { t: 'end', blue: room.blue, red: room.red }); }
}
function snapshot(room) {
  if (!room.started || room.finished) return;
  const players = [...room.players.values()].map(p => ({ id:p.id, name:p.name, team:p.team, x:Math.round(p.x), y:Math.round(p.y), vx:Math.round(p.vx), vy:Math.round(p.vy), angle:p.angle, hp:p.hp, shield:p.shield, alive:p.alive, respawn:p.respawn, invuln:p.invuln, dashCd:p.dashCd, boost:p.boost, kills:p.kills }));
  const bullets = room.bullets.map(b => ({ x:b.x, y:b.y, px:b.px, py:b.py, team:b.team }));
  broadcast(room, { t:'state', time:room.time, blue:room.blue, red:room.red, players, bullets, events:room.events.splice(0) });
}

function handleMessage(client, message) {
  let data; try { data = JSON.parse(message); } catch { return; }
  if (data.t === 'join' && !client.room) {
    client.name = cleanName(data.name); const room = availableRoom(); client.room = room; const player = playerFor(room, client); room.clients.set(client.id, client); room.players.set(client.id, player);
    send(client, { t:'joined', id:client.id, team:player.team, room:room.id }); lobby(room); if (room.players.size === TEAM_SIZE * 2) startRoom(room);
  } else if (data.t === 'input' && client.room && client.room.started) {
    const p = client.room.players.get(client.id); if (!p) return; p.input.mx = data.mx; p.input.my = data.my; p.input.angle = data.angle; p.input.fire = !!data.fire; if (data.dash) p.input.dash = true;
  }
}
function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0], masked = (client.buffer[1] & 0x80) !== 0; let length = client.buffer[1] & 0x7f, offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (client.buffer.length < 10) return; const n = client.buffer.readBigUInt64BE(2); if (n > 65536n) { client.socket.destroy(); return; } length = Number(n); offset = 10; }
    const maskBytes = masked ? 4 : 0; if (client.buffer.length < offset + maskBytes + length) return;
    const opcode = first & 0x0f, mask = masked ? client.buffer.subarray(offset, offset + 4) : null, body = Buffer.from(client.buffer.subarray(offset + maskBytes, offset + maskBytes + length)); client.buffer = client.buffer.subarray(offset + maskBytes + length);
    if (masked) for (let i=0;i<body.length;i++) body[i] ^= mask[i % 4];
    if (opcode === 8) { client.socket.end(); return; } if (opcode === 9) { client.socket.write(wsFrame(body, 10)); continue; } if (opcode === 1) handleMessage(client, body.toString());
  }
}
function removeClient(client) {
  const room = client.room; if (!room) return; room.clients.delete(client.id); room.players.delete(client.id); client.room = null;
  if (!room.players.size) { const index = rooms.indexOf(room); if (index >= 0) rooms.splice(index, 1); } else if (!room.started) lobby(room);
}

const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/manifest+json', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  let pathname; try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400).end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html'; const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); fs.createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { id: uid(), socket, buffer: Buffer.alloc(0), room: null, name: 'RANGER' };
  socket.on('data', chunk => parseFrames(client, chunk)); socket.on('close', () => removeClient(client)); socket.on('error', () => removeClient(client));
});
setInterval(() => { for (const room of [...rooms]) updateRoom(room, TICK / 1000); }, TICK);
setInterval(() => { for (const room of rooms) snapshot(room); }, SNAPSHOT);
server.listen(PORT, '0.0.0.0', () => console.log(`NOVA STRIKE server running at http://localhost:${PORT}`));
