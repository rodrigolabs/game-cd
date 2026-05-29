// ====================================================
// CONFIG
// ====================================================
const TILE = 48;
const PLAYER_SPEED = 3;
const MAX_ENERGY = 5;
const POINTS_PER_ORDER = 100;
const POINTS_PER_HIGH_VALUE_ORDER = 300;

// High-value items — only found inside the vault
const HIGH_VALUE_ITEMS = [
    { name: 'Diamante',        shape: 'diamond', color: '#00e5ff', highValue: true },
    { name: 'Estrela Dourada', shape: 'star',    color: '#ffd700', highValue: true },
    { name: 'Cristal Rosa',    shape: 'diamond', color: '#ff80ab', highValue: true },
];

// Difficulty levels — indexed by wave (0-based)
// Each wave triggers every WAVE_DURATION ms
const WAVE_DURATION = 60000; // 60s por wave
const DIFFICULTY = [
    // wave 0 — intro
    { maxItems: 1, itemPool: 2, intervalMin: 20000, intervalMax: 30000, timeMin: 55000, timeMax: 70000, maxOrders: 1 },
    // wave 1
    { maxItems: 1, itemPool: 3, intervalMin: 18000, intervalMax: 26000, timeMin: 50000, timeMax: 65000, maxOrders: 2 },
    // wave 2
    { maxItems: 2, itemPool: 3, intervalMin: 15000, intervalMax: 22000, timeMin: 45000, timeMax: 60000, maxOrders: 2 },
    // wave 3
    { maxItems: 2, itemPool: 4, intervalMin: 13000, intervalMax: 20000, timeMin: 40000, timeMax: 55000, maxOrders: 2 },
    // wave 4
    { maxItems: 3, itemPool: 4, intervalMin: 12000, intervalMax: 18000, timeMin: 35000, timeMax: 50000, maxOrders: 3 },
    // wave 5
    { maxItems: 3, itemPool: 5, intervalMin: 10000, intervalMax: 15000, timeMin: 30000, timeMax: 45000, maxOrders: 3 },
    // wave 6+ — máxima dificuldade
    { maxItems: 4, itemPool: 6, intervalMin:  8000, intervalMax: 13000, timeMin: 25000, timeMax: 40000, maxOrders: 3 },
];

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
//   5 = vault wall (blocked, gold)
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

    // Vault (high-value locked area) — bottom-right corner
    // Left wall at col 19, top wall at row 13 (door gap at col 21)
    for (let r = 13; r <= MAP_ROWS - 2; r++) m[r][19] = 5;
    for (let c = 19; c <= MAP_COLS - 2; c++) {
        if (c !== 21) m[13][c] = 5;
    }

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
// VAULT CONSTANTS
// ====================================================
const DOOR = { row: 13, col: 21, open: false };
const KEY_SPOT = { row: 17, col: 11 }; // just right of the caixa counter
const VAULT_ITEM_SPOTS = [
    { row: 15, col: 20, itemType: HIGH_VALUE_ITEMS[0] },
    { row: 15, col: 22, itemType: HIGH_VALUE_ITEMS[1] },
    { row: 17, col: 21, itemType: HIGH_VALUE_ITEMS[2] },
];

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
let particles = []; // visual feedback particles
let elapsedTime = 0;
let wave = 0;
let hasKey = false;
let keyPickedUp = false;

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

function getDifficulty() {
    return DIFFICULTY[Math.min(wave, DIFFICULTY.length - 1)];
}

function generateOrder() {
    const diff = getDifficulty();
    if (orders.length >= diff.maxOrders) return;
    const count = randomInt(1, diff.maxItems);
    const regularPool = ITEM_TYPES.slice(0, diff.itemPool);
    const items = [];
    const includeHighValue = wave >= 3 && Math.random() < 0.4;
    for (let i = 0; i < count; i++) {
        if (includeHighValue && i === count - 1) {
            items.push(HIGH_VALUE_ITEMS[randomInt(0, HIGH_VALUE_ITEMS.length - 1)]);
        } else {
            items.push(regularPool[randomInt(0, regularPool.length - 1)]);
        }
    }
    const isHighValue = items.some(it => it.highValue);
    orders.push({
        id: ++orderIdCounter,
        items,
        collected: [],
        timeLeft: randomInt(diff.timeMin, diff.timeMax),
        done: false,
        highValue: isHighValue,
    });
    scheduleNextOrder();
}

function scheduleNextOrder() {
    const diff = getDifficulty();
    nextOrderTimer = randomInt(diff.intervalMin, diff.intervalMax);
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
        if (t === 1 || t === 5) return true;
        const dc = Math.floor(cx / TILE);
        const dr = Math.floor(cy / TILE);
        if (!DOOR.open && dc === DOOR.col && dr === DOOR.row) return true;
        return false;
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

function playerNearVaultItemSpot() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    const reach = TILE * 1.2;
    for (const spot of VAULT_ITEM_SPOTS) {
        const tx = spot.col * TILE + TILE / 2;
        const ty = spot.row * TILE + TILE / 2;
        if (Math.abs(tx - cx) < reach && Math.abs(ty - cy) < reach) return spot;
    }
    return null;
}

function playerNearDoor() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    return Math.abs(DOOR.col * TILE + TILE / 2 - cx) < TILE * 1.4
        && Math.abs(DOOR.row * TILE + TILE / 2 - cy) < TILE * 1.4;
}

function playerNearKeySpot() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    return !keyPickedUp
        && Math.abs(KEY_SPOT.col * TILE + TILE / 2 - cx) < TILE * 1.2
        && Math.abs(KEY_SPOT.row * TILE + TILE / 2 - cy) < TILE * 1.2;
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
    const pcx = player.x + player.w / 2;

    // KEY PICKUP
    if (playerNearKeySpot()) {
        hasKey = true;
        keyPickedUp = true;
        showMessage('🔑 Chave do cofre pega! Vá até a porta e pressione E.');
        addParticle(pcx, player.y - 10, '🔑 Chave!', '#ffd700');
        updateUI();
        return;
    }

    // VAULT DOOR
    if (playerNearDoor()) {
        if (!DOOR.open) {
            if (hasKey) {
                DOOR.open = true;
                showMessage('Porta aberta! Pegue o item e saia — ela fecha ao sair.');
                addTileFlash(DOOR.col, DOOR.row, '#ffd700');
                addParticle(pcx, player.y - 10, '🔓 Aberta!', '#ffd700');
            } else {
                showMessage('🔒 Porta trancada! Pegue a chave no caixa.');
                addParticle(pcx, player.y - 10, '🔒 Trancado', '#e74c3c');
            }
        }
        return;
    }

    // VAULT ITEM PICKUP
    const vaultSpot = playerNearVaultItemSpot();
    if (vaultSpot) {
        if (!DOOR.open) {
            showMessage('Abra a porta primeiro!');
            return;
        }
        if (!hasBox) {
            inventory.push(vaultSpot.itemType);
            showMessage(`💎 Pegou: ${vaultSpot.itemType.name} — item de alto valor!`);
            addParticle(pcx, player.y - 10, `💎 ${vaultSpot.itemType.name}`, vaultSpot.itemType.color);
            addTileFlash(vaultSpot.col, vaultSpot.row, vaultSpot.itemType.color);
            updateUI();
        }
        return;
    }

    // REGULAR ITEM PICKUP
    const spot = playerNearItemSpot();
    if (spot && !hasBox) {
        const item = spot.itemType;
        inventory.push(item);
        showMessage(`Pegou: ${item.name}`);
        addParticle(pcx, player.y - 10, `+${item.name}`, item.color);
        addTileFlash(spot.col, spot.row, item.color);
        updateUI();
        return;
    }

    // CAIXA (checkout)
    const caixaTile = playerNearTileType(3);
    if (caixaTile) {
        // Return key if player has it
        if (hasKey) {
            hasKey = false;
            keyPickedUp = false;
            showMessage('🔑 Chave devolvida ao caixa.');
            addParticle(pcx, player.y - 10, '🔑 Devolvida', '#ffd700');
            updateUI();
        }
        if (hasBox && checkedOut) {
            showMessage('Leve a caixa para a DOCA!');
            addParticle(pcx, player.y - 10, '→ DOCA', '#7ec8e3');
            return;
        }
        if (hasBox && !checkedOut) {
            const matched = tryCheckout();
            if (matched) {
                checkedOut = true;
                showMessage('Nota fiscal emitida! Leve para a doca.');
                addParticle(pcx, player.y - 10, '📦 NF emitida!', '#ffe066');
                addTileFlash(caixaTile.col, caixaTile.row, '#ffe066');
            } else {
                showMessage('Itens não correspondem a nenhum pedido!');
                addParticle(pcx, player.y - 10, '❌ Sem pedido', '#e74c3c');
            }
            updateUI();
            return;
        }
        if (!hasBox && inventory.length > 0) {
            box = [...inventory];
            inventory = [];
            hasBox = true;
            checkedOut = false;
            const matched = tryCheckout();
            if (matched) {
                checkedOut = true;
                showMessage('Nota fiscal emitida! Leve para a doca.');
                addParticle(pcx, player.y - 10, '📦 NF emitida!', '#ffe066');
                addTileFlash(caixaTile.col, caixaTile.row, '#ffe066');
            } else {
                inventory = [...box];
                box = [];
                hasBox = false;
                showMessage('Itens não correspondem a nenhum pedido aberto!');
                addParticle(pcx, player.y - 10, '❌ Sem pedido', '#e74c3c');
            }
            updateUI();
        } else if (inventory.length === 0 && !hasBox && !hasKey) {
            showMessage('Pegue os itens do pedido primeiro!');
        }
        return;
    }

    // DOCK delivery
    const docaTile = playerNearTileType(4);
    if (docaTile) {
        if (hasBox && checkedOut) {
            if (hasKey) {
                showMessage('🔑 Devolva a chave ao caixa antes de entregar!');
                addParticle(pcx, player.y - 10, '🔑 → CAIXA', '#e74c3c');
                return;
            }
            deliverBox();
        } else if (hasBox && !checkedOut) {
            showMessage('Leve a caixa ao CAIXA primeiro!');
            addParticle(pcx, player.y - 10, '→ CAIXA', '#f39c12');
        } else {
            showMessage('Você não tem caixa faturada para entregar.');
        }
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
    const pcx = player.x + player.w / 2;
    let points = POINTS_PER_ORDER;
    let isHV = false;
    for (let i = orders.length - 1; i >= 0; i--) {
        if (orders[i].matched) {
            isHV = !!orders[i].highValue;
            points = isHV ? POINTS_PER_HIGH_VALUE_ORDER : POINTS_PER_ORDER;
            score += points;
            orders.splice(i, 1);
            break;
        }
    }
    box = [];
    hasBox = false;
    checkedOut = false;
    const ptColor = isHV ? '#ffd700' : '#a8e6a3';
    showMessage(`+${points} pontos! Pedido${isHV ? ' de ALTO VALOR' : ''} entregue!`);
    addParticle(pcx, player.y - 10, `+${points} pts!`, ptColor);
    addParticle(pcx, player.y - 32, isHV ? '💎 Entregue!' : '✓ Entregue!', isHV ? '#ffd700' : '#27ae60');
    const dock = playerNearTileType(4);
    if (dock) addTileFlash(dock.col, dock.row, isHV ? '#ffd700' : '#27ae60');
    updateUI();
}

// ====================================================
// PARTICLES
// ====================================================
function addParticle(x, y, text, color) {
    particles.push({ x, y, text, color, life: 1.0, vy: -0.7 });
}

let tileFlashes = []; // { col, row, color, life }
function addTileFlash(col, row, color) {
    tileFlashes.push({ col, row, color, life: 1.0 });
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
    document.getElementById('score-display').textContent = `Pontos: ${score}  |  Wave ${wave + 1}`;

    // Orders
    const ordersList = document.getElementById('orders-list');
    ordersList.innerHTML = '';
    orders.forEach(ord => {
        const div = document.createElement('div');
        div.className = 'order-entry' + (ord.timeLeft < 10000 ? ' urgent' : '') + (ord.highValue ? ' high-value' : '');
        const secs = Math.ceil(ord.timeLeft / 1000);
        const timerClass = secs < 10 ? 'order-timer low' : 'order-timer';
        const hvMark = ord.highValue ? ' 💎' : '';
        div.innerHTML = `<strong>#${ord.id}${hvMark}</strong> ${ord.items.map(i => i.name).join(', ')}<br><span class="${timerClass}">${secs}s</span>`;
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
        d.textContent = label + (item.highValue ? '💎 ' : '') + item.name;
        invList.appendChild(d);
    });
    if (displayItems.length === 0) {
        const d = document.createElement('div');
        d.className = 'inv-item';
        d.textContent = '(vazio)';
        invList.appendChild(d);
    }
    if (hasKey) {
        const d = document.createElement('div');
        d.className = 'inv-item';
        d.style.color = '#ffd700';
        d.textContent = '🔑 Chave do cofre';
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
    } else if (shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(cx, cy - size/2);
        ctx.lineTo(cx + size/2, cy);
        ctx.lineTo(cx, cy + size/2);
        ctx.lineTo(cx - size/2, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (shape === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const angle = (i * Math.PI) / 5 - Math.PI / 2;
            const r = i % 2 === 0 ? size / 2 : size / 4;
            if (i === 0) ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
            else ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        }
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
            } else if (t === 5) {
                // vault wall
                ctx.fillStyle = '#3a2800';
                ctx.fillRect(tx, ty, TILE, TILE);
                ctx.fillStyle = '#7a5200';
                ctx.fillRect(tx+2, ty+2, TILE-4, TILE-4);
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(tx+1, ty+1, TILE-2, TILE-2);
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

    // Draw door tile
    {
        const dtx = DOOR.col * TILE;
        const dty = DOOR.row * TILE;
        if (!DOOR.open) {
            ctx.fillStyle = '#3a2800';
            ctx.fillRect(dtx, dty, TILE, TILE);
            ctx.fillStyle = '#7a3800';
            ctx.fillRect(dtx+3, dty+3, TILE-6, TILE-6);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2;
            ctx.strokeRect(dtx+1, dty+1, TILE-2, TILE-2);
            // lock shackle
            ctx.beginPath();
            ctx.arc(dtx + TILE/2, dty + TILE/2 - 4, 6, Math.PI, 0);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            // lock body
            ctx.fillStyle = '#ffd700';
            ctx.fillRect(dtx + TILE/2 - 6, dty + TILE/2 - 4, 12, 10);
        } else {
            ctx.fillStyle = '#1a3a1a';
            ctx.fillRect(dtx, dty, TILE, TILE);
            ctx.strokeStyle = '#27ae60';
            ctx.lineWidth = 1;
            ctx.strokeRect(dtx, dty, TILE, TILE);
        }
    }

    // Draw vault item spots
    VAULT_ITEM_SPOTS.forEach(spot => {
        // vault floor background
        ctx.fillStyle = '#0f0f05';
        ctx.fillRect(spot.col * TILE, spot.row * TILE, TILE, TILE);
        ctx.save();
        ctx.shadowColor = spot.itemType.color;
        ctx.shadowBlur = 16;
        drawShape(spot.col * TILE + TILE/2, spot.row * TILE + TILE/2, 26, spot.itemType.shape, spot.itemType.color);
        ctx.restore();
    });

    // Draw key at key spot if not picked up
    if (!keyPickedUp) {
        const kx = KEY_SPOT.col * TILE + TILE/2;
        const ky = KEY_SPOT.row * TILE + TILE/2;
        ctx.font = '24px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔑', kx, ky);
        ctx.textBaseline = 'alphabetic';
    }

    // Vault label
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('COFRE', 21 * TILE + TILE/2, 13 * TILE - 6);

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

    // Draw tile flashes (world space, inside camera transform)
    tileFlashes.forEach(f => {
        ctx.save();
        ctx.globalAlpha = f.life * 0.55;
        ctx.fillStyle = f.color;
        ctx.fillRect(f.col * TILE, f.row * TILE, TILE, TILE);
        ctx.restore();
    });

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
    if (hasKey) {
        ctx.font = '14px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔑', px - 14, py - 20);
        ctx.textBaseline = 'alphabetic';
    }

    ctx.restore(); // end camera transform

    // Draw particles in screen space
    particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.font = 'bold 15px Courier New';
        ctx.textAlign = 'center';
        const sx = p.x - camera.x;
        const sy = p.y - camera.y;
        ctx.strokeText(p.text, sx, sy);
        ctx.fillText(p.text, sx, sy);
        ctx.restore();
    });
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

    // Auto-close vault door when player leaves vault zone
    if (DOOR.open) {
        const pr = Math.floor((player.y + player.h / 2) / TILE);
        if (pr < DOOR.row) DOOR.open = false;
    }

    // Wave progression
    elapsedTime += dt;
    const newWave = Math.min(Math.floor(elapsedTime / WAVE_DURATION), DIFFICULTY.length - 1);
    if (newWave > wave) {
        wave = newWave;
        const pcx = player.x + player.w / 2;
        showMessage(`Wave ${wave + 1}! Pedidos mais complexos!`, 3500);
        addParticle(pcx, player.y - 10, `⬆ Wave ${wave + 1}`, '#ffe066');
        updateUI();
    }

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

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].y += particles[i].vy;
        particles[i].life -= 0.016;
        if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // Update tile flashes
    for (let i = tileFlashes.length - 1; i >= 0; i--) {
        tileFlashes[i].life -= 0.03;
        if (tileFlashes[i].life <= 0) tileFlashes.splice(i, 1);
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
    hasKey = false;
    keyPickedUp = false;
    DOOR.open = false;
    orders = [];
    particles = [];
    tileFlashes = [];
    orderIdCounter = 0;
    elapsedTime = 0;
    wave = 0;
    player.x = TILE * 12;
    player.y = TILE * 15;
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('gameover-screen').style.display = 'none';
    generateOrder();
    scheduleNextOrder();
    updateUI();
    showMessage('WASD=mover  E=interagir (prateleira/caixa/doca)', 5000);
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
