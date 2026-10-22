(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $('score'), distance: $('distance'), goal: $('goalDistance'), hearts: $('hearts'), progress: $('progressFill'), pause: $('pauseBtn'), start: $('startScreen'),
    pauseScreen: $('pauseScreen'), over: $('gameOverScreen'), finish: $('finishScreen'), select: $('stageSelectScreen'), toast: $('toast'),
    finalScore: $('finalScore'), finalDistance: $('finalDistance'), best: $('bestText'),
    stageLabel: $('stageLabel'), stageBanner: $('stageBanner'), winScore: $('winScore'), stageGrid: $('stageGrid'),
    completeCode: $('completeCode'), completeTitle: $('completeTitle'), completeMessage: $('completeMessage'), stars: $('starResult'), collect: $('collectText'), next: $('nextStageBtn')
  };

  let W = 390, H = 760, dpr = 1;
  let state = 'menu';
  let score = 0, available = 0, distance = 0, speed = 240, spawnTimer = 0, last = 0, time = 0;
  let backgroundOffset = 0, hearts = 3, shake = 0, safeLane = 1;
  let currentStage = 0, stageBannerTimer = null;
  // 每顆心可承受一次石頭／木頭撞擊；改成 1 即回到「一撞就結束」
  const MAX_HEARTS = 3;
  // speed / gap：關卡開頭 → 終點的跑速與生成間隔；hazard：生成物中危險物比例；wall：一次擋住兩條路的機率
  const stages = [
    { code: 'STAGE 01', name: '森林入口', length: 90, speed: [170, 210], gap: [1.25, 1.05], hazard: .5, wall: 0 },
    { code: 'STAGE 02', name: '迷路的小徑', length: 110, speed: [185, 230], gap: [1.15, .95], hazard: .55, wall: .08 },
    { code: 'STAGE 03', name: '深林區域', length: 125, speed: [195, 250], gap: [1.08, .88], hazard: .58, wall: .14, snake: true },
    { code: 'STAGE 04', name: '敖尹的足跡', length: 140, speed: [205, 265], gap: [1.0, .82], hazard: .6, wall: .2, snake: true },
    { code: 'FINAL', name: '找到敖尹！', length: 160, speed: [215, 285], gap: [.95, .76], hazard: .62, wall: .26, snake: true }
  ];
  // 星等 = 本局拿到的分數 / 本局經過玩家身邊的道具總分
  const starRatios = [.4, .65, .85];
  const SAVE_KEY = 'forest-runner-progress', SOUND_KEY = 'forest-runner-sound';
  function loadProgress() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') saved = {};
    const list = (arr) => stages.map((_, i) => Math.max(0, Number(Array.isArray(arr) ? arr[i] : 0) || 0));
    return {
      unlocked: Math.max(0, Math.min(stages.length - 1, Number(saved.unlocked) || 0)),
      scores: list(saved.scores),
      stars: list(saved.stars).map(s => Math.min(3, s))
    };
  }
  function saveProgress() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); } catch (e) { /* 無法存檔時仍可繼續遊玩 */ }
  }
  const progress = loadProgress();
  let objects = [], particles = [], floaters = [], scenery = [], toastTimer = null;
  const art = {
    character: Object.assign(new Image(), { src: 'assets/character-sheet.png' }),
    objects: Object.assign(new Image(), { src: 'assets/object-sheet-v2.png' }),
    background: Object.assign(new Image(), { src: 'assets/forest-loop.png' })
  };
  const lanes = [-0.29, 0, 0.29];
  const player = { lane: 1, x: 0, y: 0, targetX: 0, hurt: 0 };
  const pickupDefs = {
    pancake: { score: 10, label: '+10' }, berry: { score: 5, label: '+5' }, acorn: { score: 1, label: '+1' }
  };
  const enemyDefs = {
    bear: { score: -5, label: '-5' }, snake: { score: -3, label: '-3' }, caterpillar: { score: -1, label: '-1' }
  };

  // 音效：用 WebAudio 即時合成，不需額外音檔
  const sound = { on: true, ac: null };
  try { sound.on = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* 預設開啟 */ }
  function tone(freq, dur, type = 'sine', vol = .06, slide = 0, delay = 0) {
    if (!sound.on) return;
    try {
      sound.ac = sound.ac || new (window.AudioContext || window.webkitAudioContext)();
      const ac = sound.ac, t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
    } catch (e) { /* 不支援音效時靜音遊玩 */ }
  }
  const sfx = {
    pickup: (big) => { tone(big ? 784 : 660, .08, 'triangle'); tone(big ? 1175 : 990, .12, 'triangle', .06, 0, .07); },
    enemy: () => tone(220, .22, 'sawtooth', .05, 90),
    crash: () => tone(150, .4, 'square', .07, 45),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'triangle', .06, 0, i * .11))
  };
  function renderSoundButtons() {
    document.querySelectorAll('.sound-toggle').forEach(b => { b.textContent = sound.on ? '🔊 音效：開' : '🔇 音效：關'; });
  }
  function toggleSound() {
    sound.on = !sound.on;
    try { localStorage.setItem(SOUND_KEY, sound.on ? 'on' : 'off'); } catch (e) { /* 只影響本次 */ }
    renderSoundButtons(); if (sound.on) sfx.pickup(false);
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = box.width; H = box.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.y = H * .73;
    player.targetX = laneX(player.lane);
    if (!player.x) player.x = player.targetX;
    initScenery();
  }
  function laneX(lane) { return W * (.5 + lanes[lane]); }
  function initScenery() {
    scenery = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random() < .5 ? Math.random() * W * .18 : W * (.82 + Math.random() * .18),
      y: i / 22 * H, size: 12 + Math.random() * 14, kind: Math.random() < .48 ? 'bush' : 'flower'
    }));
  }

  function reset(stageIndex = currentStage) {
    // 開場留 1.3 秒給關卡橫幅，避免一開始就撞上東西
    score = 0; available = 0; distance = 0; speed = stages[stageIndex].speed[0]; spawnTimer = 1.3; objects = []; particles = []; floaters = [];
    backgroundOffset = 0; hearts = MAX_HEARTS; shake = 0; safeLane = 1;
    currentStage = stageIndex; ui.stageLabel.textContent = stages[currentStage].code;
    player.lane = 1; player.x = player.targetX = laneX(1); player.hurt = 0;
    updateHUD();
  }
  function startGame(stageIndex = currentStage) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    reset(stageIndex); state = 'playing'; closeOverlays(); enterStage(stageIndex); last = performance.now();
  }
  function closeOverlays() { [ui.start, ui.pauseScreen, ui.over, ui.finish, ui.select].forEach(e => e.classList.remove('is-visible')); }
  function showHome() { state = 'menu'; closeOverlays(); renderStageSelect(); ui.start.classList.add('is-visible'); }
  function showStageSelect() { state = 'menu'; closeOverlays(); renderStageSelect(); ui.select.classList.add('is-visible'); }
  function pauseGame() { if (state !== 'playing') return; state = 'paused'; ui.pauseScreen.classList.add('is-visible'); }
  function resumeGame() { if (state !== 'paused') return; state = 'playing'; ui.pauseScreen.classList.remove('is-visible'); last = performance.now(); }
  function gameOver() {
    if (state !== 'dying') return;
    state = 'over';
    ui.finalScore.textContent = score; ui.finalDistance.textContent = Math.round(distance);
    const best = progress.scores[currentStage];
    ui.best.textContent = `${stages[currentStage].code}｜${stages[currentStage].name}${best ? `｜最高 ${best} 分` : ''}`;
    setTimeout(() => ui.over.classList.add('is-visible'), 450);
  }
  function enterStage(index) {
    currentStage = index;
    const stage = stages[index];
    ui.stageLabel.textContent = stage.code;
    ui.stageBanner.innerHTML = `<small>${stage.code}</small><br>${stage.name}` + (index === 0 ? '<br><small class="banner-tip">← 點左半邊　點右半邊 →</small>' : '');
    ui.stageBanner.classList.add('show');
    clearTimeout(stageBannerTimer);
    stageBannerTimer = setTimeout(() => ui.stageBanner.classList.remove('show'), 1700);
  }
  function finishGame() {
    if (state !== 'playing') return;
    state = 'won';
    const stage = stages[currentStage];
    const ratio = available > 0 ? score / available : 0;
    const earned = starRatios.filter(r => ratio >= r).length;
    const isRecord = score > (progress.scores[currentStage] || 0);
    progress.scores[currentStage] = Math.max(progress.scores[currentStage] || 0, score);
    progress.stars[currentStage] = Math.max(progress.stars[currentStage] || 0, earned);
    if (currentStage < stages.length - 1) progress.unlocked = Math.max(progress.unlocked, currentStage + 1);
    saveProgress();
    ui.winScore.textContent = score;
    ui.completeCode.textContent = `${stage.code} CLEAR`;
    ui.completeTitle.textContent = currentStage === 4 ? '找到敖尹了！' : `${stage.name}完成！`;
    ui.completeMessage.textContent = currentStage === 4 ? '敖尹在森林深處等著小煎餅。' : '下一段森林道路已經開啟。';
    ui.stars.textContent = `${'★'.repeat(earned)}${'☆'.repeat(3-earned)}`;
    const nextRatio = starRatios[earned];
    ui.collect.textContent = `收集率 ${Math.round(ratio * 100)}%` + (isRecord ? '｜新紀錄！' : '') + (nextRatio ? `｜${Math.round(nextRatio * 100)}% 可得 ${earned + 1} 星` : '');
    ui.next.hidden = currentStage >= stages.length - 1;
    burst(player.x, player.y - 35, '#ffe28b', 24);
    sfx.win();
    setTimeout(() => ui.finish.classList.add('is-visible'), 450);
  }
  function renderStageSelect() {
    ui.stageGrid.innerHTML = stages.map((stage, index) => {
      const locked = index > progress.unlocked;
      const stars = progress.stars[index] || 0;
      const scoreText = progress.scores[index] ? `最高 ${progress.scores[index]} 分` : `${stage.length} 公尺`;
      return `<button class="stage-option" data-stage="${index}" ${locked ? 'disabled' : ''}>
        <small>${stage.code}</small><strong>${stage.name}</strong>
        <span class="stage-meta"><span>${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</span><span>${locked ? '通過前一關解鎖' : scoreText}</span></span>
        ${locked ? '<span class="stage-lock">🔒</span>' : ''}
      </button>`;
    }).join('');
    ui.stageGrid.querySelectorAll('.stage-option:not(:disabled)').forEach(button => {
      button.onclick = () => startGame(Number(button.dataset.stage));
    });
  }

  function move(dir) {
    if (state !== 'playing') return;
    player.lane = Math.max(0, Math.min(2, player.lane + dir));
    player.targetX = laneX(player.lane);
  }
  function randomHazard(stage) {
    if (Math.random() < .5) { const r = Math.random(); return { type: 'enemy', kind: stage.snake && r < .3 ? 'snake' : r < .62 ? 'bear' : 'caterpillar' }; }
    return { type: 'obstacle', kind: Math.random() < .54 ? 'rock' : 'log' };
  }
  // 活路：safeLane 永遠不放危險物；每次最多往旁邊挪一格，兩排之間的距離足夠換線
  function spawnObject() {
    const stage = stages[currentStage];
    if (Math.random() < .3) safeLane = Math.max(0, Math.min(2, safeLane + (Math.random() < .5 ? -1 : 1)));
    const others = [0, 1, 2].filter(l => l !== safeLane);
    let lane;
    if (Math.random() < stage.hazard) {
      const hazardLanes = Math.random() < stage.wall ? others : [others[Math.floor(Math.random() * 2)]];
      hazardLanes.forEach(l => objects.push({ ...randomHazard(stage), lane: l, y: -90, hit: false, phase: 0 }));
      lane = hazardLanes[0];
    } else {
      const r = Math.random(); lane = Math.floor(Math.random() * 3);
      objects.push({ type: 'pickup', kind: r < .19 ? 'pancake' : r < .52 ? 'berry' : 'acorn', lane, y: -90, hit: false, phase: Math.random() * 6.28 });
    }
    if (Math.random() < .24) {
      const openLane = (lane + (Math.random() < .5 ? 1 : 2)) % 3;
      const pk = Math.random() < .3 ? 'berry' : 'acorn';
      objects.push({ type: 'pickup', kind: pk, lane: openLane, y: -150, hit: false, phase: 0 });
    }
  }

  function update(dt) {
    time += dt;
    shake = Math.max(0, shake - dt);
    if (state === 'dying') { player.hurt = Math.max(0, player.hurt - dt); updateParticles(dt); return; }
    if (state !== 'playing') return;
    const stage = stages[currentStage];
    const tileHeight = art.background.naturalWidth ? W * art.background.naturalHeight / art.background.naturalWidth : H;
    backgroundOffset += speed * dt * .38;
    while (backgroundOffset >= tileHeight) backgroundOffset -= tileHeight;
    distance += dt * speed * .032;
    const p = Math.min(1, distance / stage.length);
    speed = stage.speed[0] + (stage.speed[1] - stage.speed[0]) * p;
    if (distance >= stage.length) { finishGame(); return; }
    player.x += (player.targetX - player.x) * Math.min(1, dt * 13);
    player.hurt = Math.max(0, player.hurt - dt);
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnObject(); spawnTimer = stage.gap[0] + (stage.gap[1] - stage.gap[0]) * p + Math.random() * .3; }

    for (const o of objects) {
      o.y += speed * dt;
      o.phase += dt * 4;
      if (!o.hit && o.type !== 'decor' && o.lane === player.lane && Math.abs(o.y - player.y) < 43) collide(o);
      if (state !== 'playing') break;
      // 錯過的道具也算進本局可拿總分
      if (o.type === 'pickup' && !o.counted && o.y > player.y + 43) { o.counted = true; available += pickupDefs[o.kind].score; }
    }
    objects = objects.filter(o => o.y < H + 130 && !o.remove);
    updateParticles(dt);
    updateHUD();
  }
  function updateParticles(dt) {
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 170 * dt; p.life -= dt; });
    particles = particles.filter(p => p.life > 0);
    floaters.forEach(f => { f.y -= 55 * dt; f.life -= dt; });
    floaters = floaters.filter(f => f.life > 0);
  }

  function collide(o) {
    if (o.type === 'pickup') {
      o.hit = o.remove = o.counted = true; score += pickupDefs[o.kind].score; available += pickupDefs[o.kind].score;
      floatText(laneX(o.lane), o.y - 30, pickupDefs[o.kind].label, '#fff1b0'); burst(laneX(o.lane), o.y, '#ffe08b', 10); sfx.pickup(o.kind === 'pancake');
    } else {
      o.hit = true;
      if (player.hurt > 0) return; // 受傷後短暫無敵，閃爍期間直接穿過
      if (o.type === 'enemy') {
        score = Math.max(0, score + enemyDefs[o.kind].score); floatText(player.x, player.y - 70, enemyDefs[o.kind].label, '#ffb3a6');
        player.hurt = .75; shake = .18; burst(player.x, player.y, '#ef9181', 8); sfx.enemy();
      } else {
        hearts--; shake = .35; player.hurt = 1.2; burst(player.x, player.y, '#ef9181', 12); sfx.crash();
        if (navigator.vibrate) navigator.vibrate(hearts > 0 ? 80 : 200);
        updateHUD();
        if (hearts <= 0) {
          // 立刻進入 dying，避免在延遲期間暫停或過關而躲掉這次死亡
          state = 'dying'; showToast('撞到障礙物！', true); setTimeout(gameOver, 240);
        } else showToast(hearts === 1 ? '小心！只剩最後一顆心' : '撞到了！換條路走', true);
      }
    }
  }
  function updateHUD() {
    const stage = stages[currentStage];
    ui.score.textContent = score; ui.distance.textContent = Math.min(stage.length, Math.round(distance)); ui.goal.textContent = stage.length;
    ui.progress.style.width = `${Math.min(100, distance / stage.length * 100)}%`;
    ui.hearts.textContent = '❤'.repeat(Math.max(0, hearts)) + '♡'.repeat(Math.max(0, MAX_HEARTS - hearts));
    ui.hearts.hidden = MAX_HEARTS <= 1;
  }
  function showToast(text, bad) {
    clearTimeout(toastTimer); ui.toast.textContent = text; ui.toast.style.color = bad ? '#9f433b' : '#48683e'; ui.toast.classList.add('show');
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1100);
  }
  function floatText(x, y, text, color) { floaters.push({ x, y, text, color, life: .8 }); }
  function burst(x, y, color, count) { for (let i = 0; i < count; i++) particles.push({ x, y, color, vx: (Math.random()-.5)*150, vy: -50-Math.random()*120, life: .45+Math.random()*.3, size: 3+Math.random()*4 }); }

  function roundedRect(x,y,w,h,r,fill) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill(); }
  function drawGround() {
    if (art.background.complete && art.background.naturalWidth) {
      const tileHeight = W * art.background.naturalHeight / art.background.naturalWidth;
      ctx.imageSmoothingEnabled = false;
      for (let j = -2; j <= Math.ceil(H / tileHeight); j++) {
        const y = backgroundOffset + j * tileHeight;
        ctx.drawImage(art.background, 0, y, W, tileHeight);
      }
    } else {
      ctx.fillStyle = '#91a876'; ctx.fillRect(0,0,W,H);
    }
    const grad = ctx.createLinearGradient(0,0,W,0); grad.addColorStop(0,'rgba(24,53,35,.14)'); grad.addColorStop(.22,'rgba(255,255,220,0)'); grad.addColorStop(.5,'rgba(245,238,180,.05)'); grad.addColorStop(.78,'rgba(255,255,220,0)'); grad.addColorStop(1,'rgba(24,53,35,.14)'); ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(247,240,195,.11)'; ctx.lineWidth=2; ctx.setLineDash([5,22]);
    for (let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(W*(.5+(i-1.5)*.29),0);ctx.lineTo(W*(.5+(i-1.5)*.29),H);ctx.stroke();} ctx.setLineDash([]);
  }
  function drawScenery(s) {
    ctx.save(); ctx.globalAlpha = s.kind === 'bush' ? .48 : .72;
    if(s.kind==='bush') { ctx.fillStyle='#315943'; ctx.beginPath(); ctx.arc(s.x,s.y,s.size*.6,0,7);ctx.arc(s.x+s.size*.55,s.y+3,s.size*.55,0,7);ctx.arc(s.x+s.size*.25,s.y-s.size*.35,s.size*.55,0,7);ctx.fill(); ctx.fillStyle='#6f9165';ctx.beginPath();ctx.arc(s.x+s.size*.1,s.y-s.size*.3,s.size*.25,0,7);ctx.fill(); }
    else { ctx.strokeStyle='#527451';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(s.x,s.y+8);ctx.lineTo(s.x,s.y-6);ctx.stroke();ctx.fillStyle=Math.sin(s.x)>0?'#f3e7b6':'#e9a58d';for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(s.x+Math.cos(i*1.57)*4,s.y-8+Math.sin(i*1.57)*4,3,0,7);ctx.fill();}ctx.fillStyle='#f0c96e';ctx.beginPath();ctx.arc(s.x,s.y-8,2,0,7);ctx.fill(); }
    ctx.restore();
  }
  function drawObject(o) {
    const x=laneX(o.lane), y=o.y + (o.type==='pickup'?Math.sin(o.phase)*5:0); ctx.save(); ctx.translate(x,y);
    if(o.hit) ctx.globalAlpha=.3;
    const spriteIndex = { pancake:0, berry:1, acorn:2, bear:3, snake:4, caterpillar:5, rock:6, log:7 }[o.kind];
    if (art.objects.complete && art.objects.naturalWidth && spriteIndex !== undefined) {
      const sw = art.objects.naturalWidth / 3, sh = art.objects.naturalHeight / 3;
      const sx = (spriteIndex % 3) * sw, sy = Math.floor(spriteIndex / 3) * sh;
      let dw = o.type === 'pickup' ? 112 : o.type === 'enemy' ? 142 : 155;
      let dh = dw * sh / sw;
      if (o.kind === 'bear') { dw = 150; dh = 112; }
      if (o.kind === 'snake') { dw = 150; dh = 100; }
      if (o.kind === 'caterpillar') { dw = 164; dh = 102; }
      if (o.kind === 'log') { dw = 175; dh = 108; }
      ctx.drawImage(art.objects, sx, sy, sw, sh, -dw/2, -dh/2, dw, dh);
      ctx.restore();
      return;
    }
    if(o.kind==='pancake'){for(let i=0;i<3;i++)roundedRect(-25,-6-i*7,50,13,7,i===2?'#efb35f':'#bd7441');ctx.fillStyle='#f8d67c';ctx.beginPath();ctx.arc(3,-23,6,0,7);ctx.fill();}
    if(o.kind==='berry'){ctx.fillStyle='#674b9b';[[-12,-4],[1,-8],[13,-1],[-4,7],[9,9]].forEach(([a,b])=>{ctx.beginPath();ctx.arc(a,b,10,0,7);ctx.fill();});ctx.strokeStyle='#496347';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,-14);ctx.lineTo(7,-23);ctx.stroke();}
    if(o.kind==='acorn'){ctx.fillStyle='#985d38';ctx.beginPath();ctx.ellipse(0,2,14,18,0,0,7);ctx.fill();ctx.fillStyle='#59432f';ctx.beginPath();ctx.ellipse(0,-9,16,7,0,0,7);ctx.fill();ctx.fillRect(-2,-20,4,7);}
    if(o.kind==='bear'){ctx.fillStyle='#70523d';ctx.beginPath();ctx.arc(-17,-21,10,0,7);ctx.arc(17,-21,10,0,7);ctx.fill();roundedRect(-28,-24,56,54,20,'#765840');ctx.fillStyle='#d5b695';ctx.beginPath();ctx.ellipse(0,5,15,12,0,0,7);ctx.fill();ctx.fillStyle='#292820';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();ctx.fillRect(-12,-12,4,5);ctx.fillRect(8,-12,4,5);}
    if(o.kind==='caterpillar'||o.kind==='snake'){[-22,-10,2,14,25].forEach((a,i)=>{ctx.fillStyle=i===4?'#9cad67':'#c0ca78';ctx.beginPath();ctx.arc(a,Math.sin(i)*5,11,0,7);ctx.fill();});ctx.fillStyle='#3a3c31';ctx.fillRect(22,-5,3,4);ctx.fillRect(29,-5,3,4);}
    if(o.kind==='rock'){ctx.fillStyle='#727c78';ctx.beginPath();ctx.moveTo(-31,21);ctx.lineTo(-24,-4);ctx.lineTo(-7,-24);ctx.lineTo(18,-18);ctx.lineTo(32,20);ctx.closePath();ctx.fill();ctx.fillStyle='#9aa39b';ctx.beginPath();ctx.moveTo(-20,-2);ctx.lineTo(-7,-18);ctx.lineTo(5,-14);ctx.closePath();ctx.fill();}
    if(o.kind==='log'){roundedRect(-36,-17,72,34,12,'#79583f');ctx.strokeStyle='#4f3e31';ctx.lineWidth=4;ctx.beginPath();ctx.arc(-25,0,11,0,7);ctx.stroke();ctx.beginPath();ctx.moveTo(-5,-15);ctx.lineTo(5,15);ctx.moveTo(18,-15);ctx.lineTo(28,12);ctx.stroke();}
    ctx.restore();
  }
  function drawPlayer() {
    ctx.save();ctx.translate(player.x,player.y);if(player.hurt>0&&Math.floor(player.hurt*12)%2===0)ctx.globalAlpha=.35;
    ctx.fillStyle='rgba(34,49,38,.22)';ctx.beginPath();ctx.ellipse(0,35,27,8,0,0,7);ctx.fill();
    const bob=state==='playing'?Math.sin(time*10)*2:0;ctx.translate(0,bob);
    if (art.character.complete && art.character.naturalWidth) {
      const sw = art.character.naturalWidth / 4, sh = art.character.naturalHeight;
      const delta = player.targetX - player.x;
      // 素材第 2、4 格都朝左；往右時把朝左的側面水平翻轉
      const frame = Math.abs(delta) > 3 ? 1 : 2;
      if (delta > 3) ctx.scale(-1, 1);
      const dh = 112, dw = dh * sw / sh;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(art.character, frame * sw, 0, sw, sh, -dw/2, -dh + 36, dw, dh);
      ctx.restore();
      return;
    }
    ctx.strokeStyle='#222a27';ctx.lineWidth=8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-10,18);ctx.lineTo(-13,31);ctx.moveTo(10,18);ctx.lineTo(13,31);ctx.stroke();
    roundedRect(-18,-5,36,29,8,'#e9e4d6');roundedRect(-18,11,36,14,3,'#333b38');
    ctx.fillStyle='#242b2c';ctx.beginPath();ctx.arc(0,-24,27,0,7);ctx.fill();ctx.beginPath();ctx.moveTo(-24,-28);ctx.quadraticCurveTo(-37,-3,-25,8);ctx.lineTo(-14,-16);ctx.fill();ctx.beginPath();ctx.moveTo(19,-36);ctx.quadraticCurveTo(38,-25,29,10);ctx.quadraticCurveTo(20,2,12,-12);ctx.fill();
    ctx.fillStyle='#f2cfbf';ctx.beginPath();ctx.ellipse(0,-19,18,16,0,0,7);ctx.fill();ctx.fillStyle='#282c2c';ctx.fillRect(-8,-21,3,5);ctx.fillRect(6,-21,3,5);ctx.fillStyle='#31383a';ctx.beginPath();ctx.arc(0,-47,13,0,7);ctx.fill();
    ctx.restore();
  }
  function drawFloaters() {
    ctx.save(); ctx.textAlign='center'; ctx.font='900 24px ui-rounded, "Noto Sans TC", "Microsoft JhengHei", sans-serif'; ctx.lineWidth=5; ctx.strokeStyle='rgba(30,43,35,.75)';
    floaters.forEach(f=>{ctx.globalAlpha=Math.min(1,f.life*2.5);ctx.strokeText(f.text,f.x,f.y);ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);});
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0,0,W,H); ctx.save();
    if (shake > 0) ctx.translate((Math.random()-.5)*shake*30, (Math.random()-.5)*shake*30);
    drawGround();const tints=['rgba(226,191,112,.02)','rgba(102,132,104,.05)','rgba(25,55,43,.13)','rgba(82,55,79,.10)','rgba(247,210,115,.08)'];ctx.fillStyle=tints[currentStage];ctx.fillRect(-20,-20,W+40,H+40);objects.slice().sort((a,b)=>a.y-b.y).forEach(drawObject);drawPlayer();particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life*2);ctx.fillStyle=p.color;ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);});ctx.globalAlpha=1;drawFloaters();
    ctx.restore();
  }
  function loop(now) { const dt=Math.min(.035,(now-last)/1000||0);last=now;update(dt);draw();requestAnimationFrame(loop); }

  $('continueBtn').onclick=()=>startGame(progress.unlocked);
  $('stageSelectBtn').onclick=showStageSelect;
  $('stageBackBtn').onclick=showHome;
  $('restartBtn').onclick=()=>startGame(currentStage);
  $('restartPauseBtn').onclick=()=>startGame(currentStage);
  $('pauseHomeBtn').onclick=showStageSelect;
  $('gameOverHomeBtn').onclick=showStageSelect;
  $('finishHomeBtn').onclick=showStageSelect;
  $('nextStageBtn').onclick=()=>startGame(Math.min(stages.length-1,currentStage+1));
  $('resumeBtn').onclick=resumeGame;ui.pause.onclick=()=>state==='paused'?resumeGame():pauseGame();
  document.querySelectorAll('.sound-toggle').forEach(b=>b.onclick=toggleSound); renderSoundButtons();
  addEventListener('keydown',e=>{
    const k=e.key.length===1?e.key.toLowerCase():e.key;
    if(['ArrowLeft','ArrowRight',' '].includes(k))e.preventDefault();
    if(k==='ArrowLeft'||k==='a')move(-1);if(k==='ArrowRight'||k==='d')move(1);
    if(k==='Escape'||k==='p')state==='paused'?resumeGame():pauseGame();
    // 選單畫面按 Enter 直接按下該畫面的主要按鈕
    if(k==='Enter'&&state!=='playing'){const btn=document.querySelector('.overlay.is-visible .primary-button:not([hidden])');if(btn){e.preventDefault();btn.click();}}
  });
  // 點畫面左半邊往左一格、右半邊往右一格；按下瞬間就移動
  canvas.addEventListener('pointerdown',e=>{e.preventDefault();const box=canvas.getBoundingClientRect();move(e.clientX-box.left<box.width/2?-1:1);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseGame();});
  addEventListener('resize',resize);resize();renderStageSelect();requestAnimationFrame(loop);
})();
