// ====================================================
// CONFIG
// ====================================================
const TILE = 48;
const PLAYER_SPEED = 3;
const MAX_ENERGY = 5;
const ORDER_INTERVAL_MIN = 15000; // ms
const ORDER_INTERVAL_MAX = 30000;
const ORDER_TIME_MIN = 40000;
const ORDER_TIME_MAX = 70000;
const MAX_SIMULTANEOUS_ORDERS = 3;
const POINTS_PER_ORDER = 100;

// Item types
const ITEM_TYPES = [
    { name: 'Quadrado Azul',    shape: 'square',   color: '#3a7bd5' },
    { name: 'Triângulo Verde',  shape: 'triangle',  color: '#27ae60' },
    { name: 'Bola Vermelha',    shape: 'circle',    color: '#e74c3c' },
    { name: 'Bola Amarela',     shape: 'circle',    color: '#f1c40f' },
    { name: 'Quadrado Roxo',    shape: 'square',   color: '#8e44ad' },
    { name: 'Triângulo Laranja',shape: 'triangle',  color: '#e67e22' },
];

// ====================================================
// MAP LAYOUT
// Legend:
//   0 = floor (walkable)
//   1 = wall/shelf (blocked)
//   2 = item spawn (shelf front — walkable, has item)
//   3 = checkout counter (caixa)
//   4 = dock (doca)
// ====================================================
const MAP_COLS = 25;
const MAP_ROWS = 20;

function buildMap() {
    // Fill with floor
    const m = Array.from({ length: MAP_ROWS }, () => new Array(MAP_COLS).fill(0));

    // Outer walls
    for (let c = 0; c < MAP_COLS; c++) { m[0][c] = 1; m[MAP_ROWS-1][c] = 1; }
    for (let r = 0; r < MAP_ROWS; r++) { m[r][0] = 1; m[r][MAP_COLS-1] = 1; }

    // Shelf rows (3 aisles, each 2 tiles wide with a gap corridor)
    const shelfRows = [
        [3, 4], [3, 5],
        [7, 4], [7, 5],
        [11,4], [11,5],
    ];
    const shelfColStart = 3;
    const shelfColEnd = 18;
    shelfRows.forEach(([r]) => {
        for (let c = shelfColStart; c <= shelfColEnd; c++) {
            m[r][c] = 1; // back wall of shelf
        }
    });
    // Item spawn tiles in front of each shelf row
    const itemRows = [5, 9, 13];
    const shelfGroupRows = [[3,4],[7,8],[11,12]];
    shelfGroupRows.forEach(([wallRow]) => {
        for (let c = shelfColStart; c <= shelfColEnd; c += 3) {
            if (c < shelfColEnd) {
                m[wallRow][c] = 1;
                if (wallRow+1 < MAP_ROWS) m[wallRow+1][c] = 2; // item spot in front
            }
        }
    });

    // Checkout counter row (near bottom-right)
    for (let c = 3; c <= 10; c++) m[MAP_ROWS-3][c] = 3;

    // Dock row (rightmost open area)
    for (let r = 2; r <= 10; r++) m[r][MAP_COLS-3] = 4;

    return m;
}

const MAP = buildMap();

// Assign item types to item spots
const ITEM_SPOTS = []; // { row, col, itemType }
for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
        if (MAP[r][c] === 2) {
            ITEM_SPOTS.push({ row: r, col: c, itemType: ITEM_TYPES[ITEM_SPOTS.length % ITEM_TYPES.length] });
        }
    }
}

// ====================================================
// CANVAS SETUP
// ====================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Camera
const camera = { x: 0, y: 0 };

// ====================================================
// GAME STATE
// ====================================================
let state = 'start'; // start | playing | gameover
let score = 0;
let energy = MAX_ENERGY;
let inventory = []; // items picked up (not yet boxed)
let box = [];       // items in the box (after boxing, before checkout)
let hasBox = false; // player is carrying a box
let checkedOut = false; // box has been checked out at caixa
let orders = [];    // active orders
let nextOrderTimer = 0;
let orderIdCounter = 0;
let lastTime = 0;

const player = {
    x: TILE * 12,
    y: TILE * 15,
    w: 30,
    h: 30,
    vx: 0,
    vy: 0,
};

const keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup',   e => { keys[e.key.toLowerCase()] = false; });

// ====================================================
// ORDER GENERATION
// ====================================================
function randomInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateOrder() {
    if (orders.length >= MAX_SIMULTANEOUS_ORDERS) return;
    const count = randomInt(1, 3);
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push(ITEM_TYPES[randomInt(0, ITEM_TYPES.length - 1)]);
    }
    orders.push({
        id: ++orderIdCounter,
        items, // array of item types needed
        collected: [], // item names collected
        timeLeft: randomInt(ORDER_TIME_MIN, ORDER_TIME_MAX),
        done: false,
    });
    scheduleNextOrder();
}

function scheduleNextOrder() {
    nextOrderTimer = randomInt(ORDER_INTERVAL_MIN, ORDER_INTERVAL_MAX);
}

// ====================================================
// COLLISION & INTERACTION HELPERS
// ====================================================
function tileAt(px, py) {
    const col = Math.floor(px / TILE);
    const row = Math.floor(py / TILE);
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return 1;
    return MAP[row][col];
}

function playerTiles() {
    // corners of player rect
    const { x, y, w, h } = player;
    return [
        tileAt(x + 2, y + 2),
        tileAt(x + w - 2, y + 2),
        tileAt(x + 2, y + h - 2),
        tileAt(x + w - 2, y + h - 2),
    ];
}

function collidesWithBlocked(nx, ny) {
    const { w, h } = player;
    const corners = [
        [nx + 2, ny + 2],
        [nx + w - 2, ny + 2],
        [nx + 2, ny + h - 2],
        [nx + w - 2, ny + h - 2],
    ];
    return corners.some(([cx, cy]) => {
        const t = tileAt(cx, cy);
        return t === 1; // only walls block
    });
}

function playerNearTileType(type) {
    // check tiles slightly around player
    const { x, y, w, h } = player;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const reach = TILE * 1.2;
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (MAP[r][c] === type) {
                const tx = c * TILE + TILE / 2;
                const ty = r * TILE + TILE / 2;
                if (Math.abs(tx - cx) < reach && Math.abs(ty - cy) < reach) return { row: r, col: c };
            }
        }
    }
    return null;
}

function playerNearItemSpot() {
    const { x, y, w, h } = player;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const reach = TILE * 1.2;
    for (const spot of ITEM_SPOTS) {
        const tx = spot.col * TILE + TILE / 2;
        const ty = spot.row * TILE + TILE / 2;
        if (Math.abs(tx - cx) < reach && Math.abs(ty - cy) < reach) return spot;
    }
    return null;
}

// ====================================================
// INTERACTION (E key)
// ====================================================
window.addEventListener('keydown', e => {
    if (state !== 'playing') return;
    if (e.key.toLowerCase() !== 'e') return;
    handleInteract();
});

function handleInteract() {
    // 1. Pick up item from shelf
    const spot = playerNearItemSpot();
    if (spot && !hasBox) {
        const item = spot.itemType;
        inventory.push(item);
        showMessage(`Pegou: ${item.name}`);
        updateUI();
        return;
    }

    // 2. Box items if near checkout and have inventory
    const caixaTile = playerNearTileType(3);
    if (caixaTile) {
        if (!hasBox && inventory.length > 0) {
            box = [...inventory];
            inventory = [];
            hasBox = true;
            checkedOut = false;
            showMessage('Itens colocados na caixa!');
            updateUI();
        } else if (hasBox && !checkedOut) {
            // Emit nota fiscal = check out
            const matched = tryCheckout();
            if (matched) {
                checkedOut = true;
                showMessage('Nota fiscal emitida! Leve para a doca.');
            } else {
                showMessage('Nenhum pedido corresponde a esta caixa!');
            }
        }
        return;
    }

    // 3. Deliver to dock
    const docaTile = playerNearTileType(4);
    if (docaTile && hasBox && checkedOut) {
        deliverBox();
        return;
    }
}

function boxItemNames() {
    return box.map(i => i.name).sort().join(',');
}

function tryCheckout() {
    // Find an active order whose items match the box exactly
    const boxSorted = box.map(i => i.name).sort().join(',');
    for (let i = 0; i < orders.length; i++) {
        const ord = orders[i];
        if (ord.done) continue;
        const ordSorted = ord.items.map(it => it.name).sort().join(',');
        if (ordSorted === boxSorted) {
            ord.matched = true;
            ord.matchedId = ord.id;
            return ord;
        }
    }
    return null;
}

function deliverBox() {
    // Complete the matched order
    for (let i = orders.length - 1; i >= 0; i--) {
        if (orders[i].matched) {
            score += POINTS_PER_ORDER;
            orders.splice(i, 1);
            break;
        }
    }
    box = [];
    hasBox = false;
    checkedOut = false;
    showMessage(`+${POINTS_PER_ORDER} pontos! Pedido entregue!`);
    updateUI();
}

// ====================================================
// MESSAGE
// ====================================================
let msgTimer = 0;
const msgBox = document.getElementById('message-box');
function showMessage(text, duration = 2500) {
    msgBox.textContent = text;
    msgBox.style.display = 'block';
    msgTimer = duration;
}

// ====================================================
// UI UPDATE
// ====================================================
function updateUI() {
    // Energy
    const hearts = '❤️'.repeat(energy) + '🖤'.repeat(MAX_ENERGY - energy);
    document.getElementById('energy-display').textContent = hearts;

    // Score
    document.getElementById('score-display').textContent = `Pontos: ${score}`;

    // Orders
    const ordersList = document.getElementById('orders-list');
    ordersList.innerHTML = '';
    orders.forEach(ord => {
        const div = document.createElement('div');
        div.className = 'order-entry' + (ord.timeLeft < 10000 ? ' urgent' : '');
        const secs = Math.ceil(ord.timeLeft / 1000);
        const timerClass = secs < 10 ? 'order-timer low' : 'order-timer';
        div.innerHTML = `<strong>#${ord.id}</strong> ${ord.items.map(i => i.name).join(', ')}<br><span class="${timerClass}">${secs}s</span>`;
        ordersList.appendChild(div);
    });

    // Inventory / Box
    const invList = document.getElementById('inventory-list');
    invList.innerHTML = '';
    const displayItems = hasBox ? box : inventory;
    const label = hasBox ? (checkedOut ? '📦✅ ' : '📦 ') : '🎒 ';
    displayItems.forEach(item => {
        const d = document.createElement('div');
        d.className = 'inv-item';
        d.textContent = label + item.name;
        invList.appendChild(d);
    });
    if (displayItems.length === 0) {
        const d = document.createElement('div');
        d.className = 'inv-item';
        d.textContent = '(vazio)';
        invList.appendChild(d);
    }
}

// ====================================================
// DRAW HELPERS
// ====================================================
function drawShape(cx, cy, size, shape, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else if (shape === 'square') {
        ctx.fillRect(cx - size/2, cy - size/2, size, size);
        ctx.strokeRect(cx - size/2, cy - size/2, size, size);
    } else if (shape === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(cx, cy - size/2);
        ctx.lineTo(cx + size/2, cy + size/2);
        ctx.lineTo(cx - size/2, cy + size/2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

// ====================================================
// DRAW
// ====================================================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Draw tiles
    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            const tx = c * TILE;
            const ty = r * TILE;
            const t = MAP[r][c];
            if (t === 1) {
                // shelf / wall
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(tx, ty, TILE, TILE);
                ctx.fillStyle = '#7f8c8d';
                ctx.fillRect(tx+2, ty+2, TILE-4, TILE-4);
            } else if (t === 2) {
                // item spot
                ctx.fillStyle = '#1a2634';
                ctx.fillRect(tx, ty, TILE, TILE);
            } else if (t === 3) {
                // checkout
                ctx.fillStyle = '#5d4037';
                ctx.fillRect(tx, ty, TILE, TILE);
                ctx.fillStyle = '#8d6e63';
                ctx.fillRect(tx+3, ty+3, TILE-6, TILE-6);
            } else if (t === 4) {
                // dock
                ctx.fillStyle = '#1b5e20';
                ctx.fillRect(tx, ty, TILE, TILE);
                ctx.fillStyle = '#388e3c';
                ctx.fillRect(tx+3, ty+3, TILE-6, TILE-6);
            } else {
                // floor
                ctx.fillStyle = '#1a1a2e';
                ctx.fillRect(tx, ty, TILE, TILE);
                ctx.strokeStyle = '#222240';
                ctx.strokeRect(tx, ty, TILE, TILE);
            }
        }
    }

    // Draw item icons on item spots
    ITEM_SPOTS.forEach(spot => {
        const tx = spot.col * TILE + TILE / 2;
        const ty = spot.row * TILE + TILE / 2;
        drawShape(tx, ty, 20, spot.itemType.shape, spot.itemType.color);
    });

    // Labels
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'center';
    // Checkout label
    for (let c = 3; c <= 10; c++) {
        if (c === 6) ctx.fillText('CAIXA', c*TILE+TILE/2, (MAP_ROWS-3)*TILE + TILE/2 + 4);
    }
    // Dock label
    for (let r = 2; r <= 10; r++) {
        if (r === 6) {
            ctx.save();
            ctx.translate((MAP_COLS-3)*TILE+TILE/2, r*TILE+TILE/2);
            ctx.rotate(-Math.PI/2);
            ctx.fillText('DOCA', 0, 4);
            ctx.restore();
        }
    }

    // Draw player
    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath();
    ctx.arc(px, py - 10, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hasBox ? '#f39c12' : '#3498db';
    ctx.fillRect(player.x + 3, player.y + 4, player.w - 6, player.h - 8);
    if (hasBox) {
        // draw a box on player
        ctx.fillStyle = '#f39c12';
        ctx.fillRect(player.x + 6, player.y - 6, 18, 14);
        ctx.strokeStyle = '#795548';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(player.x + 6, player.y - 6, 18, 14);
    }

    ctx.restore();
}

// ====================================================
// UPDATE
// ====================================================
function update(dt) {
    if (state !== 'playing') return;

    // Movement
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup'])    dy = -1;
    if (keys['s'] || keys['arrowdown'])  dy = 1;
    if (keys['a'] || keys['arrowleft'])  dx = -1;
    if (keys['d'] || keys['arrowright']) dx = 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    const nx = player.x + dx * PLAYER_SPEED;
    const ny = player.y + dy * PLAYER_SPEED;

    if (!collidesWithBlocked(nx, player.y)) player.x = nx;
    if (!collidesWithBlocked(player.x, ny)) player.y = ny;

    // Camera follow
    camera.x = player.x + player.w / 2 - canvas.width / 2;
    camera.y = player.y + player.h / 2 - canvas.height / 2;
    camera.x = Math.max(0, Math.min(camera.x, MAP_COLS * TILE - canvas.width));
    camera.y = Math.max(0, Math.min(camera.y, MAP_ROWS * TILE - canvas.height));

    // Order timers
    for (let i = orders.length - 1; i >= 0; i--) {
        const ord = orders[i];
        if (ord.done || ord.matched) continue;
        ord.timeLeft -= dt;
        if (ord.timeLeft <= 0) {
            orders.splice(i, 1);
            energy--;
            showMessage(`Pedido #${ord.id} expirou! -1 energia`, 3000);
            updateUI();
            if (energy <= 0) {
                startGameOver();
                return;
            }
        }
    }

    // Next order spawn
    nextOrderTimer -= dt;
    if (nextOrderTimer <= 0) {
        generateOrder();
        updateUI();
    }

    // Message timer
    if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) msgBox.style.display = 'none';
    }

    updateUI();
}

// ====================================================
// GAME LOOP
// ====================================================
function loop(ts) {
    const dt = ts - lastTime;
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

// ====================================================
// START / RESTART / GAMEOVER
// ====================================================
function startGame() {
    state = 'playing';
    score = 0;
    energy = MAX_ENERGY;
    inventory = [];
    box = [];
    hasBox = false;
    checkedOut = false;
    orders = [];
    orderIdCounter = 0;
    player.x = TILE * 12;
    player.y = TILE * 15;
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('gameover-screen').style.display = 'none';
    generateOrder();
    scheduleNextOrder();
    updateUI();
    showMessage('Separe os pedidos! Pressione E para interagir.', 4000);
}

function startGameOver() {
    state = 'gameover';
    document.getElementById('final-score').textContent = `Pontuação final: ${score}`;
    document.getElementById('gameover-screen').style.display = 'flex';
}

document.getElementById('start-btn').addEventListener('click', () => {
    lastTime = performance.now();
    startGame();
    requestAnimationFrame(loop);
});

document.getElementById('restart-btn').addEventListener('click', () => {
    startGame();
});
