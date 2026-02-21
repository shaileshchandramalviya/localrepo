// ═══════════════════════════════════════════════════════════════
//  RUN! — Godzilla City Chase  |  game.js
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ─── Cross-browser roundRect helper ────────────────────────────
function drawRoundRect(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ─── DOM refs ───────────────────────────────────────────────────
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const hud = document.getElementById('hud');
const heartsEl = document.getElementById('hearts');
const scoreValEl = document.getElementById('scoreVal');
const bestValEl = document.getElementById('bestVal');
const finalScoreEl = document.getElementById('finalScore');
const highScoreEl = document.getElementById('highScore');
const flameWarning = document.getElementById('flameWarning');

// ─── Add hit-flash div ──────────────────────────────────────────
const hitFlash = document.createElement('div');
hitFlash.id = 'hitFlash';
document.body.appendChild(hitFlash);

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════
const LANES = 3;           // number of lanes
const LANE_FRAC = [0.50, 0.72, 0.88]; // y as fraction of canvas height (top, mid, bot)
const GROUND_FRAC = 0.90;        // ground line y fraction

const JUMP_FORCE = -22;
const GRAVITY = 0.9;
const DUCK_FRAMES = 45;

const OBSTACLE_TYPES = ['car', 'barrier', 'rubble', 'vent'];
const BASE_SPEED = 5;
const MAX_SPEED = 16;

// ─── Godzilla flame cooldown ────────────────────────────────────
const FLAME_WARN_DURATION = 1400; // ms warning banner shown
const FLAME_ACTIVE_DURATION = 1600; // ms beam is active
const FLAME_BASE_COOLDOWN = 9000; // ms between attacks at start
const FLAME_MIN_COOLDOWN = 4500;

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
let state = 'START'; // START | PLAYING | GAMEOVER
let score = 0;
let highScore = parseInt(localStorage.getItem('gzHighScore') || '0');
let lives = 3;
let speed = BASE_SPEED;
let frameCount = 0;
let lastTime = 0;
let animId = null;

// ─── Input ──────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'Enter') {
        if (state === 'START') startGame();
        if (state === 'GAMEOVER') restartGame();
        if (state === 'PLAYING') tryJump();
        e.preventDefault();
    }
    if ((e.code === 'ArrowUp') && state === 'PLAYING') { tryJump(); e.preventDefault(); }
    if ((e.code === 'KeyW') && state === 'PLAYING') { tryJump(); e.preventDefault(); }
    if ((e.code === 'ArrowDown' || e.code === 'KeyS') && state === 'PLAYING') { startDuck(); e.preventDefault(); }
    if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && state === 'PLAYING') { changeLane(-1); e.preventDefault(); }
    if ((e.code === 'ArrowRight' || e.code === 'KeyD') && state === 'PLAYING') { changeLane(1); e.preventDefault(); }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// ─── Global mutable state (declared early to avoid TDZ errors) ─
let bgLayers = [];
const obstacles = [];
let spawnTimer = 0;

// ═══════════════════════════════════════════════════════════════
//  CANVAS RESIZE
// ═══════════════════════════════════════════════════════════════
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    buildBackground();
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════════════════
//  PARALLAX BACKGROUND
// ═══════════════════════════════════════════════════════════════

function buildBackground() {
    bgLayers = [];
    const W = canvas.width, H = canvas.height;

    // Layer 0: Sky gradient — static
    // Layer 1: Far skyline (silhouette buildings)
    // Layer 2: Mid buildings
    // Layer 3: Near street details
    bgLayers.push({ type: 'sky' });
    bgLayers.push({ type: 'buildings', count: 18, minH: 0.22, maxH: 0.55, w: 80, x: 0, spd: 0.15, rnd: seededArr(18, 0) });
    bgLayers.push({ type: 'buildings', count: 12, minH: 0.15, maxH: 0.35, w: 110, x: 0, spd: 0.35, rnd: seededArr(12, 42) });
    bgLayers.push({ type: 'street' });
}

function seededArr(n, seed) {
    const arr = [];
    let s = seed;
    for (let i = 0; i < n * 4; i++) {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        arr.push((s >>> 0) / 0xffffffff);
    }
    return arr;
}

function drawBackground(dt) {
    if (!bgLayers.length) return;
    const W = canvas.width, H = canvas.height;
    const groundY = H * GROUND_FRAC;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#050515');
    sky.addColorStop(0.5, '#0a0520');
    sky.addColorStop(1, '#18082a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY);

    // Moon
    ctx.save();
    ctx.globalAlpha = 0.9;
    const grad = ctx.createRadialGradient(W * 0.82, H * 0.1, 2, W * 0.82, H * 0.1, 38);
    grad.addColorStop(0, '#fffde7');
    grad.addColorStop(0.6, '#fff9c4');
    grad.addColorStop(1, 'rgba(255,249,196,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(W * 0.82, H * 0.1, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Stars
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    const starSeed = [0.12, 0.34, 0.56, 0.78, 0.23, 0.65, 0.91, 0.07, 0.45, 0.83, 0.38, 0.62];
    for (let i = 0; i < 12; i++) {
        const sx = starSeed[i] * W;
        const sy = starSeed[(i + 3) % 12] * groundY * 0.7;
        const ss = starSeed[(i + 6) % 12] * 2 + 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy, ss, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Smoke / atmosphere particles
    drawSmoke(dt, W, groundY);

    // Far buildings (dark silhouettes with lit windows)
    drawBuildingLayer(bgLayers[1], W, H, groundY, '#1a0a2e', '#2d1b4e', dt);
    drawBuildingLayer(bgLayers[2], W, H, groundY, '#0f0a1a', '#1a1030', dt);

    // Ground
    const roadGrad = ctx.createLinearGradient(0, groundY, 0, H);
    roadGrad.addColorStop(0, '#1a1a2e');
    roadGrad.addColorStop(0.3, '#16213e');
    roadGrad.addColorStop(1, '#0f0f1e');
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, groundY, W, H - groundY);

    // Road lines (dashes)
    drawRoadLines(dt, W, H, groundY);
}

const smokeParticles = [];
function drawSmoke(dt, W, groundY) {
    if (Math.random() < 0.03) {
        smokeParticles.push({ x: Math.random() * W, y: groundY * 0.5, r: 20 + Math.random() * 30, vx: -0.3, vy: -0.5, alpha: 0.06 + Math.random() * 0.06 });
    }
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.x += p.vx * speed * 0.15;
        p.y += p.vy;
        p.r += 0.3;
        p.alpha -= 0.0008;
        if (p.alpha <= 0 || p.x < -p.r) { smokeParticles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#9090b0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function drawBuildingLayer(layer, W, H, groundY, colorA, colorB, dt) {
    if (!layer.rnd) return;
    const rnd = layer.rnd;
    const count = layer.count;
    const totalW = W * 1.5;
    // scroll
    if (state === 'PLAYING') layer.x = (layer.x - speed * layer.spd * dt * 60 / 1000 + totalW) % totalW;

    ctx.save();
    for (let i = 0; i < count; i++) {
        const bw = layer.w * (0.7 + rnd[i * 4] * 0.8);
        const bh = (layer.minH + rnd[i * 4 + 1] * (layer.maxH - layer.minH)) * groundY;
        const bx = ((i / count) * totalW - layer.x + W) % (W + bw * 2) - bw;
        const by = groundY - bh;

        // Building body
        const blg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        blg.addColorStop(0, colorB);
        blg.addColorStop(1, colorA);
        ctx.fillStyle = blg;
        ctx.fillRect(bx, by, bw, bh);

        // Windows
        const rows = Math.floor(bh / 22);
        const cols = Math.floor(bw / 16);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // deterministic "lit" check
                const lit = rnd[(i * 4 + r * 3 + c * 7) % rnd.length] > 0.55;
                if (lit) {
                    const wx = bx + c * 16 + 4;
                    const wy = by + r * 22 + 6;
                    const wc = rnd[(i * 4 + r + c * 2) % rnd.length] > 0.7 ? '#ffe082' : '#80deea';
                    ctx.fillStyle = wc;
                    ctx.globalAlpha = 0.7;
                    ctx.fillRect(wx, wy, 7, 9);
                    ctx.globalAlpha = 1;
                }
            }
        }

        // Rooftop detail (antenna / water tower)
        if (rnd[i * 4 + 3] > 0.6) {
            ctx.strokeStyle = colorB;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(bx + bw / 2, by);
            ctx.lineTo(bx + bw / 2, by - 18);
            ctx.stroke();
        }
    }
    ctx.restore();
}

let roadOffset = 0;
function drawRoadLines(dt, W, H, groundY) {
    if (state === 'PLAYING') roadOffset = (roadOffset + speed * dt * 60 / 1000) % 80;
    // Dashed center lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,50,0.35)';
    ctx.lineWidth = 3;
    ctx.setLineDash([40, 40]);
    ctx.lineDashOffset = -roadOffset;

    const laneYs = LANE_FRAC.map(f => f * H);
    for (let l = 0; l < laneYs.length - 1; l++) {
        ctx.beginPath();
        ctx.moveTo(0, (laneYs[l] + laneYs[l + 1]) / 2);
        ctx.lineTo(W, (laneYs[l] + laneYs[l + 1]) / 2);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Sidewalk stripe at top
    ctx.fillStyle = 'rgba(80,60,120,0.35)';
    ctx.fillRect(0, groundY - 4, W, 4);
}

// ═══════════════════════════════════════════════════════════════
//  PLAYER
// ═══════════════════════════════════════════════════════════════
const player = {
    lane: 1,          // 0 top, 1 mid, 2 bottom
    x: 0,
    y: 0,
    w: 40,
    h: 72,
    vy: 0,
    isGrounded: true,
    isDucking: false,
    duckTimer: 0,
    invincible: false,
    invTimer: 0,
    INV_DURATION: 2200, // ms
    runFrame: 0,
    runTimer: 0,
    hitThisBeam: false
};

function getPlayerLaneY(laneIndex) {
    return canvas.height * LANE_FRAC[laneIndex] - player.h;
}

function tryJump() {
    if (player.isGrounded && !player.isDucking) {
        player.vy = JUMP_FORCE;
        player.isGrounded = false;
    }
}

function startDuck() {
    if (player.isGrounded) {
        player.isDucking = true;
        player.duckTimer = DUCK_FRAMES;
    }
}

function changeLane(dir) {
    const newLane = player.lane + dir;
    if (newLane >= 0 && newLane < LANES) {
        player.lane = newLane;
    }
}

function updatePlayer(dt) {
    // Lane Y target
    const targetY = getPlayerLaneY(player.lane);

    if (!player.isGrounded) {
        player.vy += GRAVITY;
        player.y += player.vy;
        if (player.y >= targetY) {
            player.y = targetY;
            player.vy = 0;
            player.isGrounded = true;
        }
    } else {
        player.y = targetY;
    }

    // Ducking
    if (player.isDucking) {
        player.duckTimer--;
        if (player.duckTimer <= 0) player.isDucking = false;
    }

    // Invincibility timer
    if (player.invincible) {
        player.invTimer -= dt * 1000;
        if (player.invTimer <= 0) {
            player.invincible = false;
            player.hitThisBeam = false;
        }
    }

    // Run animation
    player.runTimer += dt * speed;
    if (player.runTimer > 6) { player.runTimer = 0; player.runFrame = (player.runFrame + 1) % 4; }
}

function drawPlayer() {
    const px = player.x;
    const py = player.y;
    const pw = player.w;
    const ph = player.isDucking ? player.h * 0.55 : player.h;
    const duckY = player.isDucking ? py + player.h - ph : py;

    // Blink if invincible
    if (player.invincible && Math.floor(Date.now() / 120) % 2 === 0) return;

    ctx.save();
    ctx.translate(px, duckY + ph);

    // Shadow
    ctx.save();
    ctx.scale(1, 0.25);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(pw / 2, 4, pw * 0.6, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Legs animation
    const legSwing = Math.sin(player.runFrame * Math.PI / 2) * 8;
    const bodyColor = '#00e5ff';
    const darkColor = '#0097a7';
    const suitColor = '#1a237e';

    if (player.isDucking) {
        // Crouched body
        ctx.fillStyle = suitColor;
        ctx.fillRect(4, -ph, pw - 8, ph);
        ctx.fillStyle = bodyColor;
        ctx.fillRect(8, -ph + 2, pw - 16, 18);
        // helmet
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pw / 2, -ph + 8, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(pw / 2, -ph + 8, 7, Math.PI * 0.2, Math.PI * 0.8); ctx.fill();
    } else {
        // Body torso
        ctx.fillStyle = suitColor;
        ctx.fillRect(6, -ph + 24, pw - 12, ph - 40);

        // Chest highlight
        ctx.fillStyle = bodyColor;
        ctx.fillRect(10, -ph + 28, pw - 20, 16);

        // Helmet/head
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pw / 2, -ph + 14, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(pw / 2, -ph + 14, 9, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
        ctx.strokeStyle = darkColor; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pw / 2, -ph + 14, 13, 0, Math.PI * 2); ctx.stroke();

        // Arms
        ctx.strokeStyle = suitColor; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(6, -ph + 28);
        ctx.lineTo(0, -ph + 44 + legSwing * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pw - 6, -ph + 28);
        ctx.lineTo(pw, -ph + 44 - legSwing * 0.5);
        ctx.stroke();

        // Legs
        ctx.strokeStyle = darkColor; ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(pw / 2 - 4, -ph + ph - 16);
        ctx.lineTo(pw / 2 - 6, -4 + legSwing);
        ctx.lineTo(pw / 2 - 12, -0 + legSwing * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pw / 2 + 4, -ph + ph - 16);
        ctx.lineTo(pw / 2 + 6, -4 - legSwing);
        ctx.lineTo(pw / 2 + 12, -0 - legSwing * 0.3);
        ctx.stroke();
    }

    // Speed lines behind player
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 5; i++) {
        const ly = -ph * (0.3 + i * 0.12);
        const llen = 20 + i * 8;
        ctx.beginPath();
        ctx.moveTo(-llen, ly);
        ctx.lineTo(-6, ly);
        ctx.stroke();
    }

    ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  OBSTACLES
// ═══════════════════════════════════════════════════════════════

function getSpawnInterval() {
    return Math.max(600, 1800 - score * 0.4);
}

function spawnObstacle() {
    const lane = Math.floor(Math.random() * LANES);
    const type = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    const W = canvas.width, H = canvas.height;

    let w, h, color;
    switch (type) {
        case 'car': w = 88; h = 38; color = '#e53935'; break;
        case 'barrier': w = 42; h = 52; color = '#f57f17'; break;
        case 'rubble': w = 56; h = 30; color = '#6d4c41'; break;
        case 'vent': w = 36; h = 60; color = '#455a64'; break;
    }

    obstacles.push({
        type, lane, w, h, color,
        x: W + w,
        y: H * LANE_FRAC[lane] - h,
        scored: false
    });
}

function updateObstacles(dt) {
    spawnTimer += dt * 1000;
    if (spawnTimer >= getSpawnInterval()) {
        spawnTimer = 0;
        spawnObstacle();
        // Sometimes spawn a second in a different lane for challenge
        if (Math.random() < 0.3) spawnObstacle();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= speed * dt * 60;
        if (obs.x + obs.w < 0) { obstacles.splice(i, 1); continue; }

        // Collision with player
        if (!player.invincible && collides(player, obs)) {
            takeDamage();
        }
    }
}

function collides(p, obs) {
    const pw = p.w - 8;
    const ph = p.isDucking ? p.h * 0.55 : p.h;
    const pdy = p.isDucking ? p.y + p.h - ph : p.y;

    if (p.lane !== obs.lane) return false;
    return p.x + 4 < obs.x + obs.w &&
        p.x + 4 + pw > obs.x &&
        pdy < obs.y + obs.h &&
        pdy + ph > obs.y;
}

function drawObstacle(obs) {
    ctx.save();
    const { x, y, w, h, type, color } = obs;

    switch (type) {
        case 'car': {
            // Body
            ctx.fillStyle = color;
            ctx.beginPath();
            drawRoundRect(x, y + 12, w, h - 12, 4);
            ctx.fill();
            // Roof
            ctx.fillStyle = '#ef9a9a';
            ctx.beginPath();
            drawRoundRect(x + 14, y + 2, w - 28, 16, 4);
            ctx.fill();
            // Windshields
            ctx.fillStyle = 'rgba(150,220,255,0.6)';
            ctx.fillRect(x + 16, y + 4, 20, 12);
            ctx.fillRect(x + w - 36, y + 4, 20, 12);
            // Wheels
            ctx.fillStyle = '#222';
            [x + 12, x + w - 20].forEach(wx => {
                ctx.beginPath(); ctx.arc(wx + 8, y + h, 9, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(wx + 8, y + h, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#222';
            });
            // Headlights glow
            ctx.save();
            ctx.globalAlpha = 0.7;
            const headGrad = ctx.createRadialGradient(x + w, y + h - 10, 2, x + w, y + h - 10, 24);
            headGrad.addColorStop(0, 'rgba(255,255,180,0.9)');
            headGrad.addColorStop(1, 'rgba(255,255,180,0)');
            ctx.fillStyle = headGrad;
            ctx.fillRect(x + w - 24, y + h - 22, 24, 24);
            ctx.restore();
            break;
        }
        case 'barrier': {
            // Concrete barrier
            ctx.fillStyle = '#bbb';
            ctx.beginPath(); drawRoundRect(x, y + h * 0.35, w, h * 0.65, 3); ctx.fill();
            ctx.fillStyle = '#999';
            ctx.beginPath(); drawRoundRect(x + 4, y, w - 8, h * 0.42, 4); ctx.fill();
            // Stripes
            ctx.fillStyle = color;
            for (let i = 0; i < 3; i++) {
                ctx.fillRect(x + 6 + i * 10, y + 4, 6, h * 0.35);
            }
            break;
        }
        case 'rubble': {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + 10, y + h * 0.4);
            ctx.lineTo(x + 22, y + h * 0.7);
            ctx.lineTo(x + 34, y + h * 0.2);
            ctx.lineTo(x + 48, y + h * 0.5);
            ctx.lineTo(x + w, y + h);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#a1887f';
            ctx.beginPath();
            ctx.moveTo(x + 6, y + h);
            ctx.lineTo(x + 16, y + h * 0.5);
            ctx.lineTo(x + 28, y + h * 0.75);
            ctx.lineTo(x + 40, y + h * 0.35);
            ctx.lineTo(x + 52, y + h * 0.6);
            ctx.lineTo(x + w - 4, y + h);
            ctx.closePath(); ctx.fill();
            break;
        }
        case 'vent': {
            // Steam vent / pipe
            ctx.fillStyle = '#607d8b';
            ctx.fillRect(x + 8, y, w - 16, h);
            ctx.fillStyle = color;
            ctx.fillRect(x, y + h * 0.5, w, h * 0.15);
            ctx.fillStyle = '#90a4ae';
            ctx.fillRect(x + 4, y + 2, w - 8, 10);
            // Steam puff
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x + w / 2, y - 8, 10, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x + w / 2 + 6, y - 18, 7, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            break;
        }
    }

    ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  KONG
// ═══════════════════════════════════════════════════════════════
const kong = {
    x: 0,
    y: 0,
    w: 160,
    h: 300,
    bobOffset: 0,
    chestAnim: 0,      // 0‑1 chest-beat ripple
    armSwing: 0,
    roarAnim: 0
};

function positionKong() {
    const H = canvas.height;
    const groundY = H * GROUND_FRAC;
    kong.x = -kong.w * 0.18;           // partially off-screen left
    kong.y = groundY - kong.h * 0.94;  // feet at ground
}

function updateKong(dt) {
    positionKong();
    kong.bobOffset = Math.sin(Date.now() / 450) * 5;
    kong.chestAnim = (Date.now() % 700) / 700;   // 0→1 loop
    kong.armSwing = Math.sin(Date.now() / 320) * 12;
    kong.roarAnim = Math.max(0, kong.roarAnim - dt * 60);
}

function drawKong() {
    const kx = kong.x;
    const ky = kong.y + kong.bobOffset;
    const kw = kong.w;
    const kh = kong.h;

    ctx.save();

    // Body aura — deep amber glow when attacking
    const isAttacking = kongJump.state === 'jumping' || kongJump.state === 'landing';
    const glowColor = isAttacking ? 'rgba(255,140,0,0.18)' : 'rgba(120,60,0,0.10)';
    const aura = ctx.createRadialGradient(kx + kw * 0.5, ky + kh * 0.4, 10,
        kx + kw * 0.5, ky + kh * 0.4, 130);
    aura.addColorStop(0, glowColor);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(kx - 60, ky, 240, kh);

    const fur = '#2d1a0e';
    const furLight = '#4a2f14';
    const furDark = '#1a0d05';
    const skinColor = '#3e2010';
    const chestCol = '#5c3018';

    // ── Legs ─────────────────────────────────────────────────────
    const legBob = Math.sin(Date.now() / 400) * 5;
    // Left thigh
    ctx.strokeStyle = fur; ctx.lineWidth = 36; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.30, ky + kh * 0.74);
    ctx.lineTo(kx + kw * 0.24, ky + kh * 0.94 + legBob);
    ctx.stroke();
    // Right thigh
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.62, ky + kh * 0.74);
    ctx.lineTo(kx + kw * 0.68, ky + kh * 0.94 - legBob);
    ctx.stroke();
    // Feet
    ctx.fillStyle = furDark;
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.22, ky + kh * 0.96, 22, 11, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.70, ky + kh * 0.96, 22, 11, 0.1, 0, Math.PI * 2); ctx.fill();

    // ── Hips / lower body ────────────────────────────────────────
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.46, ky + kh * 0.72, kw * 0.29, kh * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Torso (barrel chest) ─────────────────────────────────────
    const torsoGrad = ctx.createLinearGradient(kx, ky + kh * 0.35, kx + kw, ky + kh * 0.72);
    torsoGrad.addColorStop(0, furDark);
    torsoGrad.addColorStop(0.5, furLight);
    torsoGrad.addColorStop(1, furDark);
    ctx.fillStyle = torsoGrad;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.46, ky + kh * 0.53, kw * 0.31, kh * 0.22, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Chest patch (lighter fur area)
    ctx.fillStyle = chestCol;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.44, ky + kh * 0.54, kw * 0.15, kh * 0.16, -0.05, 0, Math.PI * 2);
    ctx.fill();

    // Chest-beat ripple rings
    if (kong.chestAnim < 0.6) {
        const r = kong.chestAnim * kw * 0.28;
        ctx.save();
        ctx.globalAlpha = (0.6 - kong.chestAnim) * 0.55;
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(kx + kw * 0.44, ky + kh * 0.54, r, r * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // ── Right arm (long, reaching forward — menacing) ─────────────
    ctx.strokeStyle = fur; ctx.lineWidth = 22; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.72, ky + kh * 0.40);
    ctx.quadraticCurveTo(kx + kw * 1.05, ky + kh * 0.52 + kong.armSwing,
        kx + kw * 0.98, ky + kh * 0.70 + kong.armSwing);
    ctx.stroke();
    // Right knuckles on ground
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.98, ky + kh * 0.71 + kong.armSwing, 18, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // ── Left arm ─────────────────────────────────────────────────
    ctx.strokeStyle = fur; ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.20, ky + kh * 0.41);
    ctx.quadraticCurveTo(kx - kw * 0.10, ky + kh * 0.55 - kong.armSwing * 0.5,
        kx - kw * 0.04, ky + kh * 0.72 - kong.armSwing * 0.5);
    ctx.stroke();
    // Left knuckles
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.ellipse(kx - kw * 0.04, ky + kh * 0.73 - kong.armSwing * 0.5, 15, 9, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // ── Neck ─────────────────────────────────────────────────────
    ctx.strokeStyle = fur; ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.47, ky + kh * 0.28);
    ctx.lineTo(kx + kw * 0.45, ky + kh * 0.40);
    ctx.stroke();

    // ── Head ─────────────────────────────────────────────────────
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.46, ky + kh * 0.19, kw * 0.21, kh * 0.115, 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Sagittal crest (skull ridge on top)
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.moveTo(kx + kw * 0.35, ky + kh * 0.12);
    ctx.quadraticCurveTo(kx + kw * 0.46, ky + kh * 0.055, kx + kw * 0.58, ky + kh * 0.12);
    ctx.quadraticCurveTo(kx + kw * 0.46, ky + kh * 0.095, kx + kw * 0.35, ky + kh * 0.12);
    ctx.closePath(); ctx.fill();

    // Brow ridge (heavy)
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.46, ky + kh * 0.145, kw * 0.185, kh * 0.032, 0, 0, Math.PI * 2);
    ctx.fill();

    // Face / muzzle (lighter)
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(kx + kw * 0.50, ky + kh * 0.215, kw * 0.12, kh * 0.068, 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Nostrils
    ctx.fillStyle = furDark;
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.46, ky + kh * 0.208, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.54, ky + kh * 0.208, 4, 3, 0, 0, Math.PI * 2); ctx.fill();

    // Mouth (open when roaring/attacking)
    const jawO = (kong.roarAnim > 0 || isAttacking) ? (isAttacking ? 8 : kong.roarAnim * 2) : 0;
    if (jawO > 0) {
        ctx.fillStyle = '#8b1a1a';
        ctx.beginPath();
        ctx.ellipse(kx + kw * 0.50, ky + kh * 0.240 + jawO * 0.3, kw * 0.09, jawO * 0.7 + 3, 0.05, 0, Math.PI * 2);
        ctx.fill();
        // Teeth
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(kx + kw * 0.44, ky + kh * 0.232);
        ctx.lineTo(kx + kw * 0.46, ky + kh * 0.232 + jawO * 0.55);
        ctx.lineTo(kx + kw * 0.48, ky + kh * 0.232);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(kx + kw * 0.52, ky + kh * 0.232);
        ctx.lineTo(kx + kw * 0.54, ky + kh * 0.232 + jawO * 0.55);
        ctx.lineTo(kx + kw * 0.56, ky + kh * 0.232);
        ctx.closePath(); ctx.fill();
    }

    // Eyes (deep-set, glowing amber)
    ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.38, ky + kh * 0.163, 8, 6, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.54, ky + kh * 0.163, 8, 6, 0.2, 0, Math.PI * 2); ctx.fill();
    // Iris
    const eyeColor = isAttacking ? '#ff5722' : '#e65100';
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.38, ky + kh * 0.163, 5, 4, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(kx + kw * 0.54, ky + kh * 0.163, 5, 4, 0.2, 0, Math.PI * 2); ctx.fill();
    // Pupils
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(kx + kw * 0.38, ky + kh * 0.163, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(kx + kw * 0.54, ky + kh * 0.163, 2.5, 0, Math.PI * 2); ctx.fill();
    // Eye shine
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(kx + kw * 0.37, ky + kh * 0.159, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(kx + kw * 0.53, ky + kh * 0.159, 1.2, 0, Math.PI * 2); ctx.fill();

    // "KONG" label
    ctx.globalAlpha = 0.65;
    ctx.font = 'bold 11px Orbitron, sans-serif';
    ctx.fillStyle = isAttacking ? '#ff9800' : '#a5d6a7';
    ctx.textAlign = 'center';
    ctx.fillText('KONG', kx + kw * 0.46, ky - 10);
    ctx.globalAlpha = 1;

    ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
//  KONG JUMP ATTACK
//  Kong periodically leaps toward a random lane.
//  A pulsing shadow shows the target lane during the warning.
//  If the player stays in that lane when Kong lands → -1 life.
//  Avoidable: player must SWITCH LANES before landing.
// ═══════════════════════════════════════════════════════════════
const KONG_WARN_MS = 1800;  // warning shadow shown
const KONG_JUMP_MS = 800;   // arc in air
const KONG_LAND_MS = 500;   // impact freeze on ground
const KONG_CD_BASE = 9000;  // starting cooldown ms
const KONG_CD_MIN = 4000;

const kongJump = {
    state: 'idle',    // idle | warning | jumping | landing
    timer: 0,
    cooldownTimer: KONG_CD_BASE,
    targetLane: 1,    // lane Kong will land on
    hitThisJump: false,
    // Jump arc data
    startX: 0, startY: 0,
    endX: 0, endY: 0,
    drawX: 0, drawY: 0
};

function getKongCooldown() {
    return Math.max(KONG_CD_MIN, KONG_CD_BASE - score * 0.7);
}

function getLaneScreenPos(lane) {
    // Returns {x,y} centre of that lane on the road for Kong to land on
    const H = canvas.height;
    const laneY = H * LANE_FRAC[lane] - 20;
    return { x: canvas.width * 0.22 + 20, y: laneY };
}

function updateKongJump(dt) {
    const ms = dt * 1000;

    if (kongJump.state === 'idle') {
        kongJump.cooldownTimer -= ms;
        if (kongJump.cooldownTimer <= 0) {
            // Pick a random target lane
            kongJump.targetLane = Math.floor(Math.random() * LANES);
            kongJump.state = 'warning';
            kongJump.timer = KONG_WARN_MS;
            kongJump.hitThisJump = false;
            kong.roarAnim = 14;
            flameWarning.classList.remove('hidden');
        }
    } else if (kongJump.state === 'warning') {
        kongJump.timer -= ms;
        kong.roarAnim = Math.max(kong.roarAnim, 6);
        if (kongJump.timer <= 0) {
            // Begin the jump arc
            kongJump.state = 'jumping';
            kongJump.timer = KONG_JUMP_MS;
            flameWarning.classList.add('hidden');
            // Arc: from off-screen left, fly to player lane position
            const dest = getLaneScreenPos(kongJump.targetLane);
            kongJump.startX = kong.x + kong.w * 0.5;
            kongJump.startY = kong.y + kong.h * 0.2;
            kongJump.endX = dest.x;
            kongJump.endY = dest.y;
            kongJump.drawX = kongJump.startX;
            kongJump.drawY = kongJump.startY;
        }
    } else if (kongJump.state === 'jumping') {
        kongJump.timer -= ms;
        const t = 1 - kongJump.timer / KONG_JUMP_MS;  // 0→1
        // Parabolic arc: lerp X linearly, Y follows a sine arc (up then down)
        kongJump.drawX = kongJump.startX + (kongJump.endX - kongJump.startX) * t;
        const arcHeight = canvas.height * 0.45;
        kongJump.drawY = kongJump.startY
            + (kongJump.endY - kongJump.startY) * t
            - Math.sin(t * Math.PI) * arcHeight;
        if (kongJump.timer <= 0) {
            // Land!
            kongJump.state = 'landing';
            kongJump.timer = KONG_LAND_MS;
            kongJump.drawX = kongJump.endX;
            kongJump.drawY = kongJump.endY;
            kong.roarAnim = 18;
            // Check hit
            if (!player.invincible && !kongJump.hitThisJump) {
                if (player.lane === kongJump.targetLane) {
                    kongJump.hitThisJump = true;
                    takeDamage();
                }
            }
        }
    } else if (kongJump.state === 'landing') {
        kongJump.timer -= ms;
        if (kongJump.timer <= 0) {
            kongJump.state = 'idle';
            kongJump.cooldownTimer = getKongCooldown();
        }
    }
}

function drawKongJumpEffect() {
    // Draw landing shadow indicator on target lane during warning
    if (kongJump.state === 'warning') {
        const pulse = 0.5 + Math.sin(Date.now() / 100) * 0.5; // 0‑1 fast pulse
        const dest = getLaneScreenPos(kongJump.targetLane);
        const H = canvas.height;
        const laneY = H * LANE_FRAC[kongJump.targetLane];

        // Shadow oval on the road
        ctx.save();
        ctx.globalAlpha = 0.25 + pulse * 0.45;
        const sGrad = ctx.createRadialGradient(dest.x, laneY, 5, dest.x, laneY, 85);
        sGrad.addColorStop(0, 'rgba(130,60,0,0.95)');
        sGrad.addColorStop(0.5, 'rgba(200,100,0,0.5)');
        sGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sGrad;
        ctx.beginPath();
        ctx.ellipse(dest.x, laneY, 85, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        // Warning X mark
        ctx.globalAlpha = 0.6 + pulse * 0.4;
        ctx.strokeStyle = '#ff6d00';
        ctx.lineWidth = 4;
        const s = 22;
        ctx.beginPath();
        ctx.moveTo(dest.x - s, laneY - 10); ctx.lineTo(dest.x + s, laneY + 10);
        ctx.moveTo(dest.x + s, laneY - 10); ctx.lineTo(dest.x - s, laneY + 10);
        ctx.stroke();
        ctx.restore();

        // Edge pulses
        const ep = pulse;
        ctx.save();
        ctx.globalAlpha = 0.12 * ep;
        ctx.fillStyle = '#ff6d00';
        ctx.fillRect(0, 0, 10, H);
        ctx.fillRect(canvas.width - 10, 0, 10, H);
        ctx.restore();
    }

    // Draw flying Kong silhouette during jump arc
    if (kongJump.state === 'jumping') {
        const t = 1 - kongJump.timer / KONG_JUMP_MS;
        const fx = kongJump.drawX;
        const fy = kongJump.drawY;
        const sc = 0.55 + t * 0.4; // grows as it approaches

        ctx.save();
        ctx.translate(fx, fy);
        ctx.scale(sc, sc);

        // Simple flying gorilla silhouette
        ctx.fillStyle = '#2d1a0e';
        // Body
        ctx.beginPath(); ctx.ellipse(0, 0, 38, 28, -0.3, 0, Math.PI * 2); ctx.fill();
        // Head
        ctx.beginPath(); ctx.ellipse(30, -18, 20, 16, 0.3, 0, Math.PI * 2); ctx.fill();
        // Arms spread wide
        ctx.strokeStyle = '#2d1a0e'; ctx.lineWidth = 16; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-55, -24); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, -5); ctx.lineTo(60, -20); ctx.stroke();
        // Legs trailing
        ctx.beginPath(); ctx.moveTo(-15, 18); ctx.lineTo(-28, 44); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, 20); ctx.lineTo(8, 46); ctx.stroke();
        // Eyes glowing red while airborne
        ctx.fillStyle = '#ff5722';
        ctx.beginPath(); ctx.arc(24, -20, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(36, -20, 4, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
    }

    // Landing shockwave
    if (kongJump.state === 'landing') {
        const t = 1 - kongJump.timer / KONG_LAND_MS; // 0→1
        const dest = getLaneScreenPos(kongJump.targetLane);
        const H = canvas.height;
        const laneY = H * LANE_FRAC[kongJump.targetLane];

        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.7;
        const r = 30 + t * 120;
        const shockGrad = ctx.createRadialGradient(dest.x, laneY, 5, dest.x, laneY, r);
        shockGrad.addColorStop(0, 'rgba(255,200,50,0.9)');
        shockGrad.addColorStop(0.5, 'rgba(255,100,0,0.5)');
        shockGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shockGrad;
        ctx.beginPath();
        ctx.ellipse(dest.x, laneY, r, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Screen shake-flash
        ctx.globalAlpha = (1 - t) * 0.14;
        ctx.fillStyle = '#ff6d00';
        ctx.fillRect(0, 0, canvas.width, H);
        ctx.restore();
    }
}


// ═══════════════════════════════════════════════════════════════
//  LIVES & DAMAGE
// ═══════════════════════════════════════════════════════════════
function takeDamage() {
    if (player.invincible) return;
    lives--;
    updateHeartsUI();
    player.invincible = true;
    player.invTimer = player.INV_DURATION;
    kong.roarAnim = 15;

    // Red flash
    hitFlash.style.display = 'block';
    setTimeout(() => { hitFlash.style.display = 'none'; }, 250);

    if (lives <= 0) {
        endGame();
    }
}

function updateHeartsUI() {
    const filled = Math.max(0, lives);
    const hearts = '❤️'.repeat(filled) + '🖤'.repeat(Math.max(0, 3 - filled));
    heartsEl.textContent = hearts;
}

// ═══════════════════════════════════════════════════════════════
//  SCORE & DIFFICULTY
// ═══════════════════════════════════════════════════════════════
function updateScore(dt) {
    score += dt * speed * 1.8;
    const displayScore = Math.floor(score);
    scoreValEl.textContent = displayScore;
    bestValEl.textContent = Math.max(highScore, displayScore);

    // Difficulty scaling: every 300 score points
    const level = Math.floor(score / 300);
    speed = Math.min(MAX_SPEED, BASE_SPEED + level * 0.6);
}

// ═══════════════════════════════════════════════════════════════
//  GAME STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function startGame() {
    state = 'PLAYING';
    score = 0;
    lives = 3;
    speed = BASE_SPEED;
    frameCount = 0;
    obstacles.length = 0;
    smokeParticles.length = 0;
    spawnTimer = 0;

    kongJump.state = 'idle';
    kongJump.cooldownTimer = KONG_CD_BASE;
    kongJump.hitThisJump = false;
    flameWarning.classList.add('hidden');
    player.lane = 1;
    player.vy = 0;
    player.isGrounded = true;
    player.isDucking = false;
    player.invincible = false;
    player.hitThisJump = false;
    player.runFrame = 0;

    const W = canvas.width, H = canvas.height;
    player.x = W * 0.22;
    player.w = 40;
    player.h = 72;
    player.y = getPlayerLaneY(1);

    updateHeartsUI();
    scoreValEl.textContent = '0';
    bestValEl.textContent = highScore;
    bestValEl.classList.add('gold');

    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    flameWarning.classList.add('hidden');
    hud.classList.remove('hidden');

    if (animId) cancelAnimationFrame(animId);
    lastTime = performance.now();
    animId = requestAnimationFrame(gameLoop);
}

function endGame() {
    state = 'GAMEOVER';
    flameWarning.classList.add('hidden');

    const displayScore = Math.floor(score);
    if (displayScore > highScore) {
        highScore = displayScore;
        localStorage.setItem('gzHighScore', highScore);
    }

    finalScoreEl.textContent = displayScore;
    highScoreEl.textContent = highScore;

    hud.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
}

function restartGame() {
    gameOverScreen.classList.add('hidden');
    startGame();
}

// ═══════════════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════════════
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    frameCount++;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state === 'PLAYING') {
        drawBackground(dt);
        updateObstacles(dt);
        obstacles.forEach(drawObstacle);
        updateKong(dt);
        drawKong();
        updateKongJump(dt);
        drawKongJumpEffect();
        updatePlayer(dt);
        drawPlayer();
        updateScore(dt);
    } else {
        // Just draw background on idle screens
        drawBackground(0);
        drawKong();
    }

    animId = requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════════════
//  INIT — Start the rendering loop even on start screen
// ═══════════════════════════════════════════════════════════════
(function init() {
    positionKong();
    player.x = canvas.width * 0.22;
    player.w = 40;
    player.h = 72;
    player.y = getPlayerLaneY(1);
    highScoreEl && (highScoreEl.textContent = highScore);
    lastTime = performance.now();
    animId = requestAnimationFrame(gameLoop);
})();
