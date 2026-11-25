(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const ui = {
    menu: document.querySelector('#menu'), hud: document.querySelector('#hud'), end: document.querySelector('#end-screen'),
    play: document.querySelector('#play-button'), online: document.querySelector('#online-button'), replay: document.querySelector('#replay-button'), playerName: document.querySelector('#player-name'), onlineStatus: document.querySelector('#online-status'),
    blue: document.querySelector('#blue-score'), red: document.querySelector('#red-score'), timer: document.querySelector('#timer'),
    hp: document.querySelector('#health-fill'), shield: document.querySelector('#shield-fill'), healthLabel: document.querySelector('#health-label'),
    mission: document.querySelector('#mission-text'), feed: document.querySelector('#kill-feed'),
    fps: document.querySelector('#fps-value'), qualityMode: document.querySelector('#quality-mode'), networkPill: document.querySelector('#network-pill'), networkText: document.querySelector('#network-text'),
    respawn: document.querySelector('#respawn-panel'), respawnTime: document.querySelector('#respawn-time'),
    fire: document.querySelector('#fire-button'), dash: document.querySelector('#dash-button'), dashCooldown: document.querySelector('#dash-cooldown'),
    finalBlue: document.querySelector('#final-blue'), finalRed: document.querySelector('#final-red'), resultTitle: document.querySelector('#result-title'), resultCopy: document.querySelector('#result-copy'), resultOverline: document.querySelector('#result-overline')
  };

  const TAU = Math.PI * 2;
  const world = { w: 3000, h: 1900 };
  // Dynamic resolution protects input responsiveness before it sacrifices visual detail.
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const quality = {
    baseDpr: Math.min(devicePixelRatio || 1, coarsePointer ? 1.38 : 1.7), dpr: 1,
    scale: 1, particles: coarsePointer ? .74 : 1, maxParticles: coarsePointer ? 165 : 245,
    frameMs: 16.7, fps: 60, lastScaleCheck: 0, hudTick: 0
  };
  let W = 0, H = 0, now = 0, last = 0, started = false, audioCtx, audioBus;
  let game = null;
  let socket = null;
  const online = { id: null, team: 'blue', joined: false, inputTick: 0, dashQueued: false, soundCd: 0 };
  const key = Object.create(null);
  const pointer = { x: 0, y: 0, fire: false, moveId: null, aimId: null, moveX: 0, moveY: 0 };
  const obstacles = [
    { x: 440, y: 300, w: 270, h: 132, type: 'crate' }, { x: 1080, y: 210, w: 150, h: 290, type: 'tower' },
    { x: 1760, y: 310, w: 310, h: 145, type: 'crate' }, { x: 2350, y: 205, w: 155, h: 330, type: 'tower' },
    { x: 720, y: 840, w: 180, h: 320, type: 'tower' }, { x: 1330, y: 730, w: 340, h: 135, type: 'crate' },
    { x: 2050, y: 880, w: 235, h: 145, type: 'crate' }, { x: 2530, y: 770, w: 210, h: 332, type: 'tower' },
    { x: 355, y: 1375, w: 290, h: 135, type: 'crate' }, { x: 1085, y: 1270, w: 155, h: 300, type: 'tower' },
    { x: 1640, y: 1430, w: 330, h: 145, type: 'crate' }, { x: 2245, y: 1300, w: 145, h: 310, type: 'tower' },
    { x: 2600, y: 1485, w: 250, h: 130, type: 'crate' }
  ];
  const spawn = { blue: [{x:230,y:660},{x:270,y:870},{x:250,y:1120},{x:410,y:610},{x:430,y:1290}], red: [{x:2770,y:650},{x:2710,y:870},{x:2750,y:1120},{x:2590,y:610},{x:2560,y:1290}] };
  const groundDetails = Array.from({ length: 125 }, (_, i) => ({
    x: 35 + ((i * 251) % 2910), y: 30 + ((i * 433) % 1830),
    kind: i % 7 === 0 ? 'brush' : i % 5 === 0 ? 'debris' : 'scuff', rot: (i * 1.71) % TAU, size: 5 + (i * 17) % 22
  }));

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function len(x, y) { return Math.hypot(x, y); }
  function normalize(x, y) { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; }
  function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function teamColor(team) { return team === 'blue' ? '#48caff' : '#ff5268'; }
  function isMobile() { return matchMedia('(pointer: coarse)').matches; }

  function resize() {
    const rect = canvas.getBoundingClientRect(); W = rect.width; H = rect.height;
    quality.dpr = quality.baseDpr * quality.scale;
    canvas.width = Math.round(W * quality.dpr); canvas.height = Math.round(H * quality.dpr);
    ctx.setTransform(quality.dpr, 0, 0, quality.dpr, 0, 0);
  }
  addEventListener('resize', resize, { passive: true }); resize();

  function actor(team, index, player = false) {
    const p = spawn[team][index % spawn[team].length];
    return { id: `${team}-${index}-${Math.random()}`, team, index, player, name: player ? 'YOU' : (team === 'blue' ? ['VEX', 'NOVA', 'KITE', 'GHOST'][index - 1] : ['RIFT', 'HEX', 'CROW', 'ONYX', 'VOID'][index]),
      x: p.x + rand(-25,25), y:p.y + rand(-35,35), vx:0, vy:0, r:18, angle: team === 'blue' ? 0 : Math.PI,
      hp:100, shield:100, maxHp:100, alive:true, respawn:0, shootCd:rand(0,.6), dashCd:0, invuln:.5, hit:0, step:rand(0,TAU),
      target:null, goal:null, brain:rand(0,.18), hasSight:false, kills:0, deaths:0, boost:0 };
  }
  function newMatch(mode = 'offline') {
    game = { mode, time:180, blue:0, red:0, actors:[], bullets:[], particles:[], rings:[], decals:[], camera:{x:0,y:0,shake:0}, player:null, ended:false, lastFeed:0 };
    const me = actor(mode === 'online' ? online.team : 'blue', 0, true); game.player = me; game.actors.push(me);
    if (mode === 'offline') { for(let i=1;i<5;i++) game.actors.push(actor('blue', i)); for(let i=0;i<5;i++) game.actors.push(actor('red', i)); }
    game.camera.x = me.x; game.camera.y = me.y;
    updateHUD(true);
  }

  function closeOnline() { if (socket) { socket.onclose = null; socket.close(); socket = null; } online.joined = false; online.id = null; }
  function startGame(mode = 'offline') {
    if (!audioCtx) createAudio();
    if (mode === 'offline') closeOnline();
    newMatch(mode); started = true; ui.menu.classList.add('hidden'); ui.end.classList.add('hidden'); ui.hud.classList.remove('hidden');
    ui.networkPill.classList.toggle('hidden', mode !== 'online'); ui.networkPill.classList.toggle('live', mode === 'online'); ui.networkText.textContent = mode === 'online' ? 'SQUAD LINK' : 'OFFLINE';
    addFeed('SYSTEM', mode === 'online' ? 'SQUAD LINK ESTABLISHED' : 'ALPHA SQUAD DEPLOYED', 'blue');
    requestAnimationFrame(loop);
  }
  function joinOnline() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') { ui.onlineStatus.textContent = 'Run “npm start”, then open this game from the server.'; return; }
    if (!audioCtx) createAudio();
    closeOnline(); ui.online.disabled = true; ui.onlineStatus.textContent = 'Connecting to match server…';
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ t:'join', name:ui.playerName.value }));
    socket.onmessage = event => receiveOnline(event.data);
    socket.onerror = () => { ui.onlineStatus.textContent = 'Server unavailable — start it with npm start.'; ui.online.disabled = false; };
    socket.onclose = () => { if (!game || game.mode !== 'online' || !game.ended) { ui.onlineStatus.textContent = 'Connection lost. Try matchmaking again.'; ui.online.disabled = false; } };
  }
  function receiveOnline(raw) {
    let data; try { data = JSON.parse(raw); } catch { return; }
    if (data.t === 'joined') { online.id = data.id; online.team = data.team; online.joined = true; ui.onlineStatus.textContent = `Joined ${data.team.toUpperCase()} squad — waiting for players…`; blip('join'); }
    if (data.t === 'lobby') ui.onlineStatus.textContent = `${data.count}/10 connected · ${data.need} more needed to deploy`;
    if (data.t === 'start') { ui.online.disabled = false; startGame('online'); }
    if (data.t === 'state') applyOnlineState(data);
    if (data.t === 'end') { if (game) { game.blue = data.blue; game.red = data.red; game.time = 0; endGame(); } }
  }
  ui.play.addEventListener('click', () => startGame('offline')); ui.online.addEventListener('click', joinOnline); ui.replay.addEventListener('click', () => game?.mode === 'online' ? joinOnline() : startGame('offline'));

  function createAudio() {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); const compressor = audioCtx.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.knee.value = 13; compressor.ratio.value = 8; audioBus = audioCtx.createGain(); audioBus.gain.value = .6; audioBus.connect(compressor).connect(audioCtx.destination); } catch(e) { audioCtx = null; }
  }
  function noiseBurst(t, duration, volume) { if (!audioCtx || !audioBus) return; const buffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * duration), audioCtx.sampleRate), samples = buffer.getChannelData(0); for(let i=0;i<samples.length;i++) samples[i] = (Math.random()*2-1) * (1-i/samples.length); const source = audioCtx.createBufferSource(), gain = audioCtx.createGain(); source.buffer=buffer; gain.gain.setValueAtTime(volume,t); gain.gain.exponentialRampToValueAtTime(.001,t+duration); source.connect(gain).connect(audioBus); source.start(t); }
  function blip(type, intensity = 1) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime, osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    const data = type === 'shot' ? [175, 74, .055, 'square'] : type === 'hit' ? [360, 135, .07, 'sine'] : type === 'dash' ? [160, 520, .14, 'sawtooth'] : type === 'join' ? [380, 680, .16, 'sine'] : [105, 42, .22, 'sawtooth'];
    osc.type = data[3]; osc.frequency.setValueAtTime(data[0], t); osc.frequency.exponentialRampToValueAtTime(data[1], t + data[2]);
    gain.gain.setValueAtTime((type === 'shot' ? .032 : .05) * intensity, t); gain.gain.exponentialRampToValueAtTime(.001, t + data[2]);
    osc.connect(gain).connect(audioBus); osc.start(t); osc.stop(t + data[2]); if (type === 'shot') noiseBurst(t,.032,.024*intensity); if (type === 'boom') noiseBurst(t,.16,.07*intensity); if (type === 'dash') noiseBurst(t,.08,.018);
  }

  function hitObstacle(x, y, radius) {
    for (const o of obstacles) {
      const nx = clamp(x, o.x, o.x + o.w), ny = clamp(y, o.y, o.y + o.h);
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < radius * radius) return o;
    }
    return null;
  }
  function moveActor(a, dx, dy, dt) {
    const nx = clamp(a.x + dx * dt, a.r + 20, world.w - a.r - 20);
    if (!hitObstacle(nx, a.y, a.r)) a.x = nx; else a.vx *= -.18;
    const ny = clamp(a.y + dy * dt, a.r + 20, world.h - a.r - 20);
    if (!hitObstacle(a.x, ny, a.r)) a.y = ny; else a.vy *= -.18;
  }
  function closestEnemy(a) {
    let best = null, bestD = Infinity;
    for (const other of game.actors) if (other.alive && other.team !== a.team) { const d = (other.x-a.x)**2 + (other.y-a.y)**2; if (d < bestD) { bestD=d;best=other; } }
    return best;
  }
  function sightClear(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(d / 40);
    for (let i = 1; i < steps; i++) if (hitObstacle(a.x + (b.x-a.x)*i/steps, a.y+(b.y-a.y)*i/steps, 4)) return false;
    return true;
  }
  function updateAI(a, dt) {
    // Targeting/raycasting is intentionally throttled: it is visually identical but avoids ten full raycasts per frame.
    a.brain -= dt;
    if (a.brain <= 0) {
      a.brain = rand(.085, .14);
      if (!a.target || !a.target.alive || Math.hypot(a.target.x-a.x, a.target.y-a.y) > 760) a.target = closestEnemy(a);
      a.hasSight = !!a.target && sightClear(a, a.target);
    }
    const t = a.target; if (!t) return;
    const dx=t.x-a.x, dy=t.y-a.y, d=Math.hypot(dx,dy)||1; a.angle = Math.atan2(dy,dx);
    const desired = d > 390 ? 1 : d < 245 ? -0.7 : 0;
    const side = Math.sin(now*.0012 + a.index*3.8) * (d < 490 ? .46 : .12);
    const nx=dx/d*desired - dy/d*side, ny=dy/d*desired + dx/d*side;
    const speed = a.boost > 0 ? 430 : 170;
    a.vx += (nx*speed-a.vx)*Math.min(1,dt*4.8); a.vy += (ny*speed-a.vy)*Math.min(1,dt*4.8);
    moveActor(a,a.vx,a.vy,dt);
    if(d<585 && a.hasSight && a.shootCd <= 0) shoot(a, a.angle + rand(-.065,.065));
    if(d < 155 && a.dashCd <=0 && Math.random()<dt*.35) dash(a, -dx/d, -dy/d);
  }
  function updatePlayer(a, dt) {
    let x = (key.KeyD || key.ArrowRight ? 1 : 0) - (key.KeyA || key.ArrowLeft ? 1 : 0) + pointer.moveX;
    let y = (key.KeyS || key.ArrowDown ? 1 : 0) - (key.KeyW || key.ArrowUp ? 1 : 0) + pointer.moveY;
    if (x || y) { const n=normalize(x,y); x=n.x;y=n.y; }
    const speed = a.boost > 0 ? 560 : 280;
    a.vx += (x*speed-a.vx)*Math.min(1,dt*11); a.vy += (y*speed-a.vy)*Math.min(1,dt*11);
    if (!x) a.vx *= Math.max(0,1-dt*9); if (!y) a.vy *= Math.max(0,1-dt*9);
    moveActor(a,a.vx,a.vy,dt);
    const wx = game.camera.x + (pointer.x-W/2), wy=game.camera.y+(pointer.y-H/2);
    if (Number.isFinite(wx)) a.angle=Math.atan2(wy-a.y,wx-a.x);
    if ((pointer.fire || key.Space) && a.shootCd <= 0) shoot(a,a.angle);
  }
  function applyOnlineState(data) {
    if (!game || game.mode !== 'online') return;
    game.time = data.time; game.blue = data.blue; game.red = data.red;
    const current = new Map(game.actors.filter(a => a.networkId).map(a => [a.networkId, a]));
    const present = new Set();
    for (const state of data.players) {
      present.add(state.id); let a;
      if (state.id === online.id) { a = game.player; a.player = true; } else a = current.get(state.id);
      if (!a) { a = actor(state.team, 0, false); game.actors.push(a); }
      const firstState = !a.networkId, lostHp = a.networkId && a.hp > state.hp; a.networkId = state.id; a.name = state.name; a.team = state.team; if(firstState){a.x=state.x;a.y=state.y;a.angle=state.angle;}a.tx = state.x; a.ty = state.y; a.targetAngle = state.angle; a.vx = state.vx; a.vy = state.vy; a.hp = state.hp; a.shield = state.shield; a.alive = state.alive; a.respawn = state.respawn; a.invuln = state.invuln; a.dashCd = state.dashCd; a.boost = state.boost; a.kills = state.kills;
      if (lostHp) { a.hit = .16; if (a.player) blip('hit'); }
    }
    game.actors = game.actors.filter(a => a.player || present.has(a.networkId));
    game.bullets = data.bullets || [];
    for (const event of data.events || []) { addFeed(event.killer, event.victim, event.team); if (event.victim === game.player.name) { game.camera.shake = 7; blip('boom'); } }
  }
  function sendOnlineInput(dt) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !game?.player) return;
    let mx = (key.KeyD || key.ArrowRight ? 1 : 0) - (key.KeyA || key.ArrowLeft ? 1 : 0) + pointer.moveX;
    let my = (key.KeyS || key.ArrowDown ? 1 : 0) - (key.KeyW || key.ArrowUp ? 1 : 0) + pointer.moveY;
    const distance = Math.hypot(mx, my); if (distance > 1) { mx /= distance; my /= distance; }
    const wx = game.camera.x + pointer.x - W / 2, wy = game.camera.y + pointer.y - H / 2;
    const angle = Number.isFinite(wx) ? Math.atan2(wy - game.player.y, wx - game.player.x) : game.player.angle;
    online.inputTick -= dt; online.soundCd -= dt;
    if ((pointer.fire || key.Space) && online.soundCd <= 0) { blip('shot'); online.soundCd = .13; }
    if (online.inputTick > 0) return; online.inputTick = .05;
    socket.send(JSON.stringify({ t:'input', mx, my, angle, fire: pointer.fire || key.Space, dash: online.dashQueued })); online.dashQueued = false;
  }
  function updateOnline(dt) {
    sendOnlineInput(dt);
    for (const a of game.actors) { if (Number.isFinite(a.tx)) { a.x += (a.tx-a.x)*Math.min(1,dt*18); a.y += (a.ty-a.y)*Math.min(1,dt*18); let turn=(a.targetAngle-a.angle+Math.PI*3)%TAU-Math.PI;a.angle+=turn*Math.min(1,dt*18); } a.step += Math.hypot(a.vx, a.vy) * dt * .025; a.hit -= dt; }
    for(let i=game.particles.length-1;i>=0;i--){const q=game.particles[i];q.life-=dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=Math.max(0,1-dt*4);q.vy*=Math.max(0,1-dt*4);if(q.life<=0)game.particles.splice(i,1);}for(let i=game.rings.length-1;i>=0;i--){const r=game.rings[i];r.life-=dt;if(r.life<=0)game.rings.splice(i,1);}
    const p = game.player; game.camera.x += (p.x-game.camera.x)*Math.min(1,dt*8); game.camera.y += (p.y-game.camera.y)*Math.min(1,dt*8); game.camera.x=clamp(game.camera.x,W*.36,world.w-W*.36);game.camera.y=clamp(game.camera.y,H*.36,world.h-H*.36); game.camera.shake*=Math.max(0,1-dt*13); updateHUD();
  }
  function dash(a, dx = Math.cos(a.angle), dy = Math.sin(a.angle)) {
    if (game?.mode === 'online') { if (a?.alive) { online.dashQueued = true; blip('dash'); } return; }
    if (a.dashCd > 0 || !a.alive) return;
    a.dashCd = 3; a.boost = .16; a.vx = dx*710; a.vy=dy*710; a.invuln=.20;
    ring(a.x,a.y,12,65,teamColor(a.team),.28); burst(a.x,a.y,14,teamColor(a.team),190,3); if(a.player) blip('dash');
  }
  function shoot(a, ang) {
    a.shootCd = a.player ? .105 : rand(.28,.43); a.angle = ang;
    const sx=a.x+Math.cos(ang)*23, sy=a.y+Math.sin(ang)*23;
    const speed = a.player ? 990 : 790;
    game.bullets.push({x:sx,y:sy,px:sx,py:sy,vx:Math.cos(ang)*speed,vy:Math.sin(ang)*speed,team:a.team,owner:a,life:.74,damage:a.player?17:14});
    burst(sx,sy,3,a.team==='blue'?'#a5f4ff':'#ffb0b8',70,2); a.vx-=Math.cos(ang)*18;a.vy-=Math.sin(ang)*18;
    if(a.player) blip('shot');
  }
  function burst(x,y,count,color,speed=110,size=3) {
    const available = Math.max(0, quality.maxParticles - game.particles.length);
    const max = Math.min(available, Math.ceil(count * quality.particles));
    for(let i=0;i<max;i++){const a=rand(0,TAU),v=rand(speed*.25,speed);game.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rand(.18,.5),max:.5,color,size:rand(size*.45,size),glow:Math.random()>.58});}
  }
  function ring(x,y,from,to,color,life) { game.rings.push({x,y,r:from,to,color,life,max:life}); }
  function damage(target, amount, owner) {
    if (!target.alive || target.invuln > 0) return;
    target.hit=.19; game.camera.shake = target.player ? 9 : game.camera.shake;
    let left=amount; if(target.shield>0){const used=Math.min(target.shield,left);target.shield-=used;left-=used;} target.hp-=left;
    burst(target.x,target.y,7,target.team==='blue'?'#74e8ff':'#ff8494',125,3); if(target.player) blip('hit');
    if(target.hp<=0) kill(target,owner);
  }
  function kill(victim, killer) {
    victim.alive=false;victim.deaths++;victim.respawn=victim.player?3.2:2.5;victim.hp=0;victim.shield=0;victim.vx=victim.vy=0;
    if(killer){killer.kills++; game[killer.team]++; addFeed(killer.name, victim.name, killer.team);}
    ring(victim.x,victim.y,12,94,teamColor(victim.team),.4);burst(victim.x,victim.y,28,teamColor(victim.team),260,4);blip('boom');
    if(victim.player) ui.respawn.classList.remove('hidden');
    if(game.blue>=40 || game.red>=40) endGame();
  }
  function respawn(a) {
    const p = spawn[a.team][a.index % spawn[a.team].length];a.x=p.x+rand(-30,30);a.y=p.y+rand(-35,35);a.hp=100;a.shield=100;a.alive=true;a.invuln=1.15;a.boost=0;a.vx=a.vy=0;
    ring(a.x,a.y,12,75,teamColor(a.team),.35);if(a.player){ui.respawn.classList.add('hidden');addFeed('SYSTEM','YOU REDEPLOYED','blue');}
  }
  function addFeed(killer, victim, team) {
    const div=document.createElement('div'); div.className='feed-line';div.innerHTML=`<b>${killer}</b> <span>✦</span> <em>${victim}</em>`;if(team==='red')div.querySelector('b').style.color='#ff8291';
    ui.feed.prepend(div);setTimeout(()=>div.remove(),3300);
  }
  function endGame() {
    if(game.ended) return;game.ended=true;started=false;pointer.fire=false;ui.hud.classList.add('hidden');
    const won=game.blue>game.red;ui.resultTitle.textContent=won?'VICTORY':'DEFEAT';ui.resultCopy.textContent=won?'Alpha squad owns the arena.':'Omega held the arena this round.';ui.resultOverline.textContent=game.time<=0?'TIME EXPIRED':'MATCH COMPLETE';ui.finalBlue.textContent=String(game.blue).padStart(2,'0');ui.finalRed.textContent=String(game.red).padStart(2,'0');ui.end.classList.remove('hidden');
  }
  function updateHUD(force = false) {
    if (!force && now < quality.hudTick) return;
    quality.hudTick = now + 90;
    if(!game) return; const p=game.player;ui.blue.textContent=String(game.blue).padStart(2,'0');ui.red.textContent=String(game.red).padStart(2,'0');ui.timer.textContent=fmtTime(game.time);ui.hp.style.width=`${Math.max(0,p.hp)}%`;ui.shield.style.width=`${Math.max(0,p.shield)}%`;ui.healthLabel.textContent=`${Math.max(0,Math.ceil(p.hp))} / 100`;const cd=clamp(p.dashCd/3,0,1);ui.dashCooldown.style.transform=`translateY(${(1-cd)*100}%)`;ui.mission.textContent=game.blue===game.red?'Break the deadlock':game.blue>game.red?'Defend Alpha lead':'Push to take the lead';if(!p.alive)ui.respawnTime.textContent=Math.max(1,Math.ceil(p.respawn));
    ui.fps.textContent = String(Math.min(120, Math.round(quality.fps)));
    ui.qualityMode.textContent = quality.scale < .86 ? 'BOOST' : 'HDR';
  }
  function tuneRenderer(dt) {
    const sample = dt * 1000;
    quality.frameMs += (sample - quality.frameMs) * .06;
    quality.fps = 1000 / quality.frameMs;
    if (now - quality.lastScaleCheck < 1400) return;
    quality.lastScaleCheck = now;
    const next = quality.frameMs > 19 ? quality.scale - .1 : quality.frameMs < 10.2 ? quality.scale + .06 : quality.scale;
    const clamped = clamp(Math.round(next * 100) / 100, .7, 1);
    if (clamped !== quality.scale) { quality.scale = clamped; resize(); }
  }
  function update(dt) {
    if(!game||game.ended)return;
    if (game.mode === 'online') { updateOnline(dt); return; }
    game.time-=dt;if(game.time<=0){game.time=0;endGame();return;}
    const p=game.player;
    for(const a of game.actors){
      a.shootCd-=dt;a.dashCd-=dt;a.invuln-=dt;a.hit-=dt;a.boost-=dt;a.step+=Math.hypot(a.vx,a.vy)*dt*.025;
      if(!a.alive){a.respawn-=dt;if(a.respawn<=0)respawn(a);continue;}
      if(a.player)updatePlayer(a,dt);else updateAI(a,dt);
    }
    for(let i=game.bullets.length-1;i>=0;i--){const b=game.bullets[i];b.life-=dt;b.px=b.x;b.py=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;let hit=hitObstacle(b.x,b.y,3);if(hit||b.life<=0||b.x<0||b.y<0||b.x>world.w||b.y>world.h){if(hit)burst(b.x,b.y,4,'#b5e7ff',80,2);game.bullets.splice(i,1);continue;}for(const a of game.actors)if(a.alive&&a.team!==b.team&&Math.hypot(a.x-b.x,a.y-b.y)<a.r+5){damage(a,b.damage,b.owner);game.bullets.splice(i,1);break;}}
    for(let i=game.particles.length-1;i>=0;i--){const q=game.particles[i];q.life-=dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=Math.max(0,1-dt*4);q.vy*=Math.max(0,1-dt*4);if(q.life<=0)game.particles.splice(i,1);}for(let i=game.rings.length-1;i>=0;i--){const r=game.rings[i];r.life-=dt;if(r.life<=0)game.rings.splice(i,1);}
    game.camera.x+=(p.x-game.camera.x)*Math.min(1,dt*6);game.camera.y+=(p.y-game.camera.y)*Math.min(1,dt*6);game.camera.x=clamp(game.camera.x,W*.36,world.w-W*.36);game.camera.y=clamp(game.camera.y,H*.36,world.h-H*.36);game.camera.shake*=Math.max(0,1-dt*13);updateHUD();
  }
  function sx(x){return x-game.camera.x+W/2;}function sy(y){return y-game.camera.y+H/2;}
  function onScreen(x,y,margin=80){return x>-margin&&x<W+margin&&y>-margin&&y<H+margin;}
  function roundedRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function drawBackground() {
    // Concrete, roads and ground clutter read as a believable training compound without texture downloads.
    ctx.fillStyle='#25332d';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#343d3a';ctx.fillRect(sx(0),sy(700),world.w,230);ctx.fillRect(sx(1420),sy(0),180,world.h);
    ctx.fillStyle='rgba(8,14,14,.2)';ctx.fillRect(sx(0),sy(812),world.w,8);ctx.fillRect(sx(1506),sy(0),8,world.h);
    ctx.strokeStyle='rgba(217,190,95,.28)';ctx.lineWidth=2;ctx.setLineDash([22,18]);ctx.beginPath();ctx.moveTo(sx(0),sy(813));ctx.lineTo(sx(world.w),sy(813));ctx.moveTo(sx(1510),sy(0));ctx.lineTo(sx(1510),sy(world.h));ctx.stroke();ctx.setLineDash([]);
    for(const d of groundDetails){const x=sx(d.x),y=sy(d.y);if(!onScreen(x,y,30))continue;ctx.save();ctx.translate(x,y);ctx.rotate(d.rot);if(d.kind==='brush'){ctx.fillStyle='rgba(80,104,64,.55)';ctx.fillRect(-d.size,-2,d.size*2,4);ctx.fillRect(-2,-d.size*.7,4,d.size*1.4);}else if(d.kind==='debris'){ctx.fillStyle='rgba(151,148,115,.35)';ctx.fillRect(-d.size/2,-d.size/5,d.size,d.size*.4);}else{ctx.strokeStyle='rgba(12,20,18,.18)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-d.size,0);ctx.lineTo(d.size,0);ctx.stroke();}ctx.restore();}
    const glow=ctx.createRadialGradient(sx(1500),sy(950),24,sx(1500),sy(950),510);glow.addColorStop(0,'rgba(218,192,119,.12)');glow.addColorStop(1,'rgba(35,49,41,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  }
  function drawObstacle(o) {
    const x=sx(o.x),y=sy(o.y);if(!onScreen(x+o.w/2,y+o.h/2,200))return;ctx.save();
    ctx.fillStyle='rgba(4,8,7,.35)';roundedRect(x+7,y+9,o.w,o.h,5);ctx.fill();
    if(o.type==='tower'){
      roundedRect(x,y,o.w,o.h,5);ctx.fillStyle='#5d635d';ctx.fill();ctx.strokeStyle='rgba(213,225,194,.25)';ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle='#3d433f';ctx.fillRect(x+10,y+11,o.w-20,o.h-22);ctx.fillStyle='rgba(175,188,158,.25)';for(let yy=y+20;yy<y+o.h-12;yy+=32)ctx.fillRect(x+13,yy,o.w-26,2);
      ctx.fillStyle='rgba(240,211,100,.47)';ctx.fillRect(x+8,y+9,4,o.h-18);
    }else{
      roundedRect(x,y,o.w,o.h,5);ctx.fillStyle='#6d705b';ctx.fill();ctx.strokeStyle='rgba(226,220,176,.28)';ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle='rgba(39,44,34,.5)';ctx.fillRect(x+8,y+9,o.w-16,7);ctx.strokeStyle='rgba(235,228,188,.19)';for(let xx=x+17;xx<x+o.w-10;xx+=25){ctx.beginPath();ctx.moveTo(xx,y+9);ctx.lineTo(xx,y+o.h-8);ctx.stroke();}
      ctx.fillStyle='rgba(237,177,65,.42)';ctx.fillRect(x+13,y+13,Math.min(36,o.w*.22),3);
    }ctx.restore();
  }
  function drawActor(a) {
    if(!a.alive)return;const x=sx(a.x),y=sy(a.y);if(!onScreen(x,y,90))return;const col=teamColor(a.team), uniform=a.team==='blue'?'#536c69':'#706058';ctx.save();
    ctx.globalAlpha=.32;ctx.fillStyle='#050807';ctx.beginPath();ctx.ellipse(x,y+20,23,8,0,0,TAU);ctx.fill();ctx.globalAlpha=1;
    if(a.invuln>0){ctx.strokeStyle=col;ctx.globalAlpha=.25+Math.sin(now*.016)*.12;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,28+Math.sin(now*.012)*2,0,TAU);ctx.stroke();ctx.globalAlpha=1;}
    const run=Math.sin(a.step)*3;ctx.save();ctx.translate(x,y);ctx.rotate(a.angle);ctx.lineCap='round';
    ctx.strokeStyle='#202923';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(-7,7);ctx.lineTo(-12,20+run);ctx.moveTo(7,7);ctx.lineTo(12,20-run);ctx.stroke();ctx.strokeStyle='#101513';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(-12,20+run);ctx.lineTo(-16,23+run);ctx.moveTo(12,20-run);ctx.lineTo(16,23-run);ctx.stroke();
    ctx.fillStyle='#303d36';roundedRect(-13,-12,26,26,6);ctx.fill();ctx.fillStyle=uniform;roundedRect(-11,-10,22,21,5);ctx.fill();ctx.fillStyle='#26312b';roundedRect(-8,-7,16,15,3);ctx.fill();ctx.fillStyle='rgba(221,220,183,.4)';ctx.fillRect(-6,-4,12,2);ctx.fillRect(-6,2,12,2);
    ctx.fillStyle='#2a332e';roundedRect(-10,-19,20,14,7);ctx.fill();ctx.fillStyle='#131a18';roundedRect(-8,-17,17,7,4);ctx.fill();ctx.fillStyle='rgba(127,171,158,.5)';ctx.fillRect(-5,-15,11,2);
    ctx.strokeStyle='#3c4a42';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(6,-3);ctx.lineTo(19,2);ctx.moveTo(9,6);ctx.lineTo(21,3);ctx.stroke();ctx.strokeStyle='#111816';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(10,-1);ctx.lineTo(34,-1);ctx.stroke();ctx.strokeStyle='#7d8b80';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(17,-1);ctx.lineTo(37,-1);ctx.stroke();ctx.fillStyle=col;ctx.fillRect(-12,-2,4,7);ctx.restore();
    if(!a.player){ctx.fillStyle='rgba(2,10,19,.72)';ctx.fillRect(x-18,y-34,36,4);ctx.fillStyle=col;ctx.fillRect(x-18,y-34,36*(a.hp/100),4);}
    if(a.player){ctx.strokeStyle='rgba(176,244,255,.72)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,30,0,TAU);ctx.stroke();}ctx.restore();
  }
  function drawEffects() {
    ctx.save();ctx.globalCompositeOperation='lighter';for(const b of game.bullets){const x=sx(b.x),y=sy(b.y),px=sx(b.px),py=sy(b.py);if(!onScreen(x,y,20))continue;ctx.strokeStyle=b.team==='blue'?'#76ebff':'#ff7184';ctx.lineWidth=2;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=7;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();}for(const r of game.rings){const p=1-r.life/r.max,R=r.r+(r.to-r.r)*p,x=sx(r.x),y=sy(r.y);ctx.globalAlpha=(1-p)*.75;ctx.strokeStyle=r.color;ctx.shadowColor=r.color;ctx.shadowBlur=8;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,R,0,TAU);ctx.stroke();}ctx.shadowBlur=0;for(const q of game.particles){const x=sx(q.x),y=sy(q.y);if(!onScreen(x,y,10))continue;ctx.globalAlpha=Math.min(1,q.life/q.max*1.8);ctx.fillStyle=q.color;ctx.fillRect(x-q.size/2,y-q.size/2,q.size,q.size);}ctx.restore();
  }
  function drawMinimap() { const mw=112,mh=72,x=W-mw-17,y=H-mh-17;ctx.save();ctx.globalAlpha=.88;ctx.fillStyle='rgba(4,13,25,.72)';roundedRect(x,y,mw,mh,6);ctx.fill();ctx.strokeStyle='rgba(143,205,235,.26)';ctx.stroke();ctx.save();roundedRect(x+3,y+3,mw-6,mh-6,4);ctx.clip();for(const o of obstacles){ctx.fillStyle='rgba(138,189,211,.25)';ctx.fillRect(x+o.x/world.w*mw,y+o.y/world.h*mh,o.w/world.w*mw,o.h/world.h*mh);}for(const a of game.actors)if(a.alive){ctx.fillStyle=a.team==='blue'?'#61dfff':'#ff7084';ctx.fillRect(x+a.x/world.w*mw-1.5,y+a.y/world.h*mh-1.5,3,3);}ctx.restore();ctx.restore(); }
  function render() {
    if(!game)return;ctx.setTransform(quality.dpr,0,0,quality.dpr,0,0);const shake=game.camera.shake;ctx.save();ctx.translate(rand(-shake,shake),rand(-shake,shake));drawBackground();for(const o of obstacles)drawObstacle(o);for(const a of game.actors)drawActor(a);drawEffects();ctx.restore();if(started)drawMinimap();
    const vignette=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.7);vignette.addColorStop(.45,'rgba(0,0,0,0)');vignette.addColorStop(1,'rgba(0,3,10,.42)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
  }
  function loop(t) { if(!started)return;now=t;const dt=Math.min(.035,(t-last||16)/1000);last=t;tuneRenderer(dt);update(dt);render();if(started)requestAnimationFrame(loop); }

  addEventListener('keydown', e=>{key[e.code]=true;if(e.code==='KeyQ')dash(game?.player);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();});addEventListener('keyup',e=>key[e.code]=false);
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;});
  canvas.addEventListener('pointerdown',e=>{if(!started)return;const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;if(pointer.x>W*.42){pointer.fire=true;pointer.aimId=e.pointerId;canvas.setPointerCapture(e.pointerId);}},{passive:false});
  canvas.addEventListener('pointerup',e=>{if(e.pointerId===pointer.aimId){pointer.fire=false;pointer.aimId=null;}});canvas.addEventListener('pointercancel',()=>{pointer.fire=false;pointer.aimId=null;});
  function setMove(e){const r=uiMove.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let x=(e.clientX-cx)/(r.width*.33),y=(e.clientY-cy)/(r.height*.33);const d=Math.hypot(x,y);if(d>1){x/=d;y/=d;}pointer.moveX=x;pointer.moveY=y;document.querySelector('#stick').style.transform=`translate(${x*30}px,${y*30}px)`;}
  const uiMove=document.querySelector('#move-zone');uiMove.addEventListener('pointerdown',e=>{pointer.moveId=e.pointerId;uiMove.setPointerCapture(e.pointerId);setMove(e);});uiMove.addEventListener('pointermove',e=>{if(e.pointerId===pointer.moveId)setMove(e);});function endMove(e){if(e.pointerId===pointer.moveId){pointer.moveId=null;pointer.moveX=pointer.moveY=0;document.querySelector('#stick').style.transform='';}}uiMove.addEventListener('pointerup',endMove);uiMove.addEventListener('pointercancel',endMove);
  ui.fire.addEventListener('pointerdown',e=>{pointer.fire=true;ui.fire.setPointerCapture(e.pointerId);e.preventDefault();});for(const type of ['pointerup','pointercancel','pointerleave'])ui.fire.addEventListener(type,()=>pointer.fire=false);ui.dash.addEventListener('pointerdown',e=>{dash(game?.player);e.preventDefault();});
  // A quiet animated arena behind the title screen makes the launch screen feel alive.
  newMatch(); render();
})();
