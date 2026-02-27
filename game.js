const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GROUND_Y = HEIGHT - 70;
const GRAVITY = 0.45;

const state = {
  screen: "title",
  titleY: -140,
  selectedCharacter: 0,
  mapSelection: 0,
  unlockedLevel: 1,
  clearedLevels: new Set(),
  winTimer: 0,
  inputCooldown: 0,
};

const keys = new Set();
let mouse = { x: 0, y: 0 };

const characterTemplates = [
  {
    id: "rogue",
    label: "Female Rogue",
    subtitle: "Fast daggers • 2 dmg",
    color: "#f06ac8",
    attackCooldown: 250,
    damage: 2,
    hasReload: false,
  },
  {
    id: "crossbow",
    label: "Heavy Archer",
    subtitle: "Slow crossbow • 5 dmg",
    color: "#8ec8ff",
    attackCooldown: 200,
    damage: 5,
    hasReload: true,
    reloadDuration: 1800,
  },
];

const mapNodes = [
  { x: 210, y: 350, level: 1, boss: false },
  { x: 390, y: 300, level: 2, boss: false },
  { x: 560, y: 345, level: 3, boss: false },
  { x: 735, y: 280, level: 4, boss: false },
  { x: 925, y: 220, level: 5, boss: true },
];

const levels = {
  1: {
    name: "World 1 - Trial Grounds",
    goalKills: 10,
    enemyHealth: 10,
    spawnTimeline: [
      { time: 0, side: "right" },
      { time: 5000, side: "left" },
      { time: 13000, side: "both" },
      { time: 17000, side: "right" },
      { time: 22500, side: "left" },
      { time: 30000, side: "both" },
      { time: 36000, side: "right" },
      { time: 43000, side: "left" },
    ],
  },
  2: { name: "World 2 - Crag Lift", goalKills: 14, enemyHealth: 12, burstEvery: 9000 },
  3: { name: "World 3 - Hollow Spires", goalKills: 18, enemyHealth: 14, burstEvery: 8000 },
  4: { name: "World 4 - Ember Steps", goalKills: 23, enemyHealth: 16, burstEvery: 7000 },
  5: { name: "Boss - Goblin Warchief", goalKills: 28, enemyHealth: 20, burstEvery: 6000, bossish: true },
};

let currentLevel = null;
let player = null;
let enemies = [];

const platforms = [
  { x: 690, y: 180, width: 250, height: 18, type: "right" },
  { x: WIDTH / 2 - 130, y: 285, width: 260, height: 18, type: "middle" },
  { x: 160, y: 310, width: 260, height: 18, type: "left" },
  { x: 0, y: GROUND_Y, width: WIDTH, height: HEIGHT - GROUND_Y, type: "ground" },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawText(text, x, y, size = 24, color = "#fff", align = "center") {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.font = `700 ${size}px Inter, sans-serif`;
  ctx.fillText(text, x, y);
}

function createPlayer(character) {
  return {
    x: WIDTH / 2 - 18,
    y: GROUND_Y - 56,
    width: 36,
    height: 56,
    vx: 0,
    vy: 0,
    speed: 3.7,
    jumpPower: 10,
    onGround: false,
    facing: 1,
    hp: 100,
    attackCooldownTimer: 0,
    reloadTimer: 0,
    character,
  };
}

function createEnemy(spawnSide) {
  const platform = platforms.find((p) => p.type === spawnSide);
  return {
    x: platform.x + platform.width / 2 - 16,
    y: platform.y - 42,
    width: 32,
    height: 42,
    vx: 0,
    vy: 0,
    hp: currentLevel.enemyHealth,
    speed: 1.25 + Math.random() * 0.4 + currentLevel.index * 0.15,
    attackTimer: 0,
  };
}

function aabb(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function resolvePhysics(entity) {
  entity.vy += GRAVITY;
  entity.x += entity.vx;
  entity.y += entity.vy;
  entity.onGround = false;

  for (const p of platforms) {
    const verticalHit = entity.x + entity.width > p.x && entity.x < p.x + p.width;
    if (!verticalHit) continue;

    const wasAbove = entity.y + entity.height - entity.vy <= p.y;
    const lands = entity.y + entity.height >= p.y && entity.y + entity.height <= p.y + p.height + 10;
    if (wasAbove && lands && entity.vy >= 0) {
      entity.y = p.y - entity.height;
      entity.vy = 0;
      entity.onGround = true;
    }
  }

  entity.x = clamp(entity.x, 0, WIDTH - entity.width);
  if (entity.y > HEIGHT + 200) {
    entity.y = GROUND_Y - entity.height;
    entity.vy = 0;
  }
}

function buildAutoTimeline(level) {
  const entries = [];
  let elapsed = 0;
  while (entries.length < level.goalKills) {
    const roll = Math.random();
    let side = "left";
    if (roll > 0.66) side = "right";
    if (roll > 0.85) side = "both";

    entries.push({ time: elapsed, side });
    elapsed += 2600 + Math.random() * 2300;

    if (entries.length < level.goalKills && entries.length % 4 === 0) {
      entries.push({ time: elapsed, side: "both" });
      elapsed += level.burstEvery;
    }
  }
  return entries;
}

function startLevel(levelNum) {
  const config = levels[levelNum];
  const timeline = config.spawnTimeline ? [...config.spawnTimeline] : buildAutoTimeline(config);
  currentLevel = {
    index: levelNum,
    name: config.name,
    goalKills: config.goalKills,
    enemyHealth: config.enemyHealth,
    bossish: Boolean(config.bossish),
    elapsed: 0,
    spawnTimeline: timeline,
    nextSpawnIndex: 0,
    kills: 0,
    spawned: 0,
  };

  player = createPlayer(characterTemplates[state.selectedCharacter]);
  enemies = [];
  state.screen = "game";
}

function attack() {
  if (!player) return;
  const c = player.character;

  if (c.hasReload && player.reloadTimer > 0) return;
  if (player.attackCooldownTimer > 0) return;

  player.attackCooldownTimer = c.attackCooldown;
  if (c.hasReload) {
    player.reloadTimer = c.reloadDuration;
  }

  const range = { x: player.x + (player.facing === 1 ? player.width : -45), y: player.y + 5, width: 45, height: player.height - 10 };
  enemies.forEach((enemy) => {
    if (aabb(range, enemy)) enemy.hp -= c.damage;
  });
}

function updateTitle(dt) {
  state.titleY += 0.17 * dt;
  if (state.titleY > HEIGHT + 80) {
    state.screen = "characterSelect";
  }
}

function updateCharacterSelect(dt) {
  if (state.inputCooldown > 0) state.inputCooldown -= dt;
  if (state.inputCooldown <= 0) {
    if (keys.has("a") || keys.has("arrowleft")) {
      state.selectedCharacter = 0;
      state.inputCooldown = 160;
    }
    if (keys.has("d") || keys.has("arrowright")) {
      state.selectedCharacter = 1;
      state.inputCooldown = 160;
    }
    if (keys.has(" ") || keys.has("enter")) {
      state.screen = "worldMap";
      state.inputCooldown = 200;
    }
  }
}

function updateWorldMap(dt) {
  if (state.inputCooldown > 0) state.inputCooldown -= dt;
  if (state.inputCooldown <= 0) {
    if (keys.has("a") || keys.has("arrowleft") || keys.has("w") || keys.has("arrowup")) {
      state.mapSelection = clamp(state.mapSelection - 1, 0, mapNodes.length - 1);
      state.inputCooldown = 140;
    }
    if (keys.has("d") || keys.has("arrowright") || keys.has("s") || keys.has("arrowdown")) {
      state.mapSelection = clamp(state.mapSelection + 1, 0, mapNodes.length - 1);
      state.inputCooldown = 140;
    }
    if (keys.has(" ") || keys.has("enter")) {
      const chosen = mapNodes[state.mapSelection].level;
      if (chosen <= state.unlockedLevel) {
        startLevel(chosen);
      }
      state.inputCooldown = 180;
    }
  }
}

function updateGame(dt) {
  currentLevel.elapsed += dt;

  while (currentLevel.nextSpawnIndex < currentLevel.spawnTimeline.length) {
    const next = currentLevel.spawnTimeline[currentLevel.nextSpawnIndex];
    if (currentLevel.elapsed < next.time) break;

    if (next.side === "both") {
      if (currentLevel.spawned < currentLevel.goalKills) {
        enemies.push(createEnemy("left"));
        currentLevel.spawned += 1;
      }
      if (currentLevel.spawned < currentLevel.goalKills) {
        enemies.push(createEnemy("right"));
        currentLevel.spawned += 1;
      }
    } else if (currentLevel.spawned < currentLevel.goalKills) {
      enemies.push(createEnemy(next.side));
      currentLevel.spawned += 1;
    }

    currentLevel.nextSpawnIndex += 1;
  }

  player.vx = 0;
  if (keys.has("a") || keys.has("arrowleft")) {
    player.vx = -player.speed;
    player.facing = -1;
  }
  if (keys.has("d") || keys.has("arrowright")) {
    player.vx = player.speed;
    player.facing = 1;
  }
  if ((keys.has("w") || keys.has(" ")) && player.onGround) {
    player.vy = -player.jumpPower;
  }

  if (player.attackCooldownTimer > 0) player.attackCooldownTimer -= dt;
  if (player.reloadTimer > 0) player.reloadTimer -= dt;

  resolvePhysics(player);

  enemies.forEach((enemy) => {
    const dir = Math.sign(player.x - enemy.x);
    enemy.vx = dir * enemy.speed;
    if (Math.abs(player.x - enemy.x) < 38 && Math.abs(player.y - enemy.y) < 42) {
      enemy.attackTimer -= dt;
      if (enemy.attackTimer <= 0) {
        player.hp -= 3;
        enemy.attackTimer = 1100;
      }
    }
    resolvePhysics(enemy);
  });

  enemies = enemies.filter((enemy) => {
    if (enemy.hp <= 0) {
      currentLevel.kills += 1;
      return false;
    }
    return true;
  });

  if (currentLevel.kills >= currentLevel.goalKills) {
    state.screen = "win";
    state.winTimer = 2100;
    state.clearedLevels.add(currentLevel.index);
    state.unlockedLevel = clamp(Math.max(state.unlockedLevel, currentLevel.index + 1), 1, mapNodes.length);
  }

  if (player.hp <= 0) {
    startLevel(currentLevel.index);
  }
}

function updateWin(dt) {
  state.winTimer -= dt;
  if (state.winTimer <= 0) {
    state.screen = "worldMap";
  }
}

function drawPlatforms() {
  platforms.forEach((p) => {
    ctx.fillStyle = p.type === "ground" ? "#1f2a55" : "#34488f";
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(p.x, p.y, p.width, 3);
  });
}

function drawTitle() {
  ctx.fillStyle = "#0f1538";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawText("SQUINKQUEST", WIDTH / 2, state.titleY, 84, "#8ec8ff");
  drawText("A tiny battle-platformer prototype", WIDTH / 2, state.titleY + 58, 24, "#d7e4ff");
}

function drawCharacterSelect() {
  drawText("Choose Your Hero", WIDTH / 2, 80, 48, "#fff");
  drawText("A/D or click to switch • Space/Enter to confirm", WIDTH / 2, 115, 18, "#cae2ff");

  characterTemplates.forEach((c, i) => {
    const x = 240 + i * 420;
    const y = 170;
    const selected = state.selectedCharacter === i;
    ctx.fillStyle = selected ? "rgba(104,158,255,0.35)" : "rgba(18,34,72,0.75)";
    ctx.fillRect(x, y, 260, 320);
    ctx.strokeStyle = selected ? "#8ec8ff" : "#3857a0";
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeRect(x, y, 260, 320);

    ctx.fillStyle = c.color;
    ctx.fillRect(x + 94, y + 60, 72, 120);
    drawText(c.label, x + 130, y + 220, 24, "#fff");
    drawText(c.subtitle, x + 130, y + 252, 18, "#d3dbff");
    drawText(c.id === "rogue" ? "Daggers" : "Large Crossbow", x + 130, y + 284, 18, "#c5e7ff");
  });
}

function drawWorldMap() {
  drawText("World Map", WIDTH / 2, 70, 56, "#fff");
  drawText("Select with WASD/Arrow + Space, or click", WIDTH / 2, 105, 18, "#cfe0ff");

  ctx.strokeStyle = "#7ca0ff";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 10]);
  for (let i = 0; i < mapNodes.length - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(mapNodes[i].x, mapNodes[i].y);
    ctx.lineTo(mapNodes[i + 1].x, mapNodes[i + 1].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  mapNodes.forEach((node, idx) => {
    const levelLocked = node.level > state.unlockedLevel;
    const cleared = state.clearedLevels.has(node.level);
    const selected = idx === state.mapSelection;
    const r = node.boss ? 32 : 22;

    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = cleared ? "#8e96a8" : levelLocked ? "#60242b" : "#cc2f49";
    ctx.fill();

    if (selected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    drawText(node.boss ? "B" : `${node.level}`, node.x, node.y + 7, 20, "#fff");
  });

  drawText(`Unlocked level: ${state.unlockedLevel}`, WIDTH / 2, 560, 22, "#fff");
}

function drawPlayer() {
  ctx.fillStyle = player.character.color;
  ctx.fillRect(player.x, player.y, player.width, player.height);

  if (player.character.id === "crossbow" && player.reloadTimer > 0) {
    const pct = 1 - clamp(player.reloadTimer / player.character.reloadDuration, 0, 1);
    ctx.fillStyle = "#112139";
    ctx.fillRect(player.x - 4, player.y - 16, player.width + 8, 8);
    ctx.fillStyle = "#6cf593";
    ctx.fillRect(player.x - 4, player.y - 16, (player.width + 8) * pct, 8);
  }
}

function drawEnemies() {
  enemies.forEach((enemy) => {
    ctx.fillStyle = currentLevel.bossish ? "#b3521d" : "#6bc253";
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
    ctx.fillStyle = "#142a11";
    ctx.fillRect(enemy.x, enemy.y - 7, enemy.width, 4);
    ctx.fillStyle = "#ff6767";
    const healthRatio = clamp(enemy.hp / currentLevel.enemyHealth, 0, 1);
    ctx.fillRect(enemy.x, enemy.y - 7, enemy.width * healthRatio, 4);
  });
}

function drawHUD() {
  drawText(currentLevel.name, 20, 38, 24, "#fff", "left");
  drawText(`Kills: ${currentLevel.kills}/${currentLevel.goalKills}`, 20, 64, 20, "#cbf6ff", "left");
  drawText(`HP: ${player.hp}`, WIDTH - 20, 38, 22, "#ffd4d4", "right");
}

function drawGame() {
  drawPlatforms();
  drawPlayer();
  drawEnemies();
  drawHUD();
}

function drawWin() {
  drawGame();
  ctx.fillStyle = "rgba(4,6,15,0.65)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawText("Conquered!", WIDTH / 2, HEIGHT / 2 - 10, 74, "#b6ffb6");
  drawText("Returning to map...", WIDTH / 2, HEIGHT / 2 + 34, 24, "#fff");
}

function update(dt) {
  switch (state.screen) {
    case "title":
      updateTitle(dt);
      break;
    case "characterSelect":
      updateCharacterSelect(dt);
      break;
    case "worldMap":
      updateWorldMap(dt);
      break;
    case "game":
      updateGame(dt);
      break;
    case "win":
      updateWin(dt);
      break;
  }
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  switch (state.screen) {
    case "title":
      drawTitle();
      break;
    case "characterSelect":
      drawCharacterSelect();
      break;
    case "worldMap":
      drawWorldMap();
      break;
    case "game":
      drawGame();
      break;
    case "win":
      drawWin();
      break;
  }
}

let previous = performance.now();
function loop(now) {
  const dt = Math.min(50, now - previous);
  previous = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  keys.add(key);

  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
    event.preventDefault();
  }

  if (state.screen === "game" && key === " ") {
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * WIDTH;
  mouse.y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
});

canvas.addEventListener("mousedown", () => {
  if (state.screen === "characterSelect") {
    state.selectedCharacter = mouse.x < WIDTH / 2 ? 0 : 1;
    state.screen = "worldMap";
    return;
  }

  if (state.screen === "worldMap") {
    mapNodes.forEach((node, i) => {
      const r = node.boss ? 32 : 22;
      const dist = Math.hypot(mouse.x - node.x, mouse.y - node.y);
      if (dist < r + 4) {
        state.mapSelection = i;
        if (node.level <= state.unlockedLevel) startLevel(node.level);
      }
    });
    return;
  }

  if (state.screen === "game") {
    attack();
  }
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (state.screen === "characterSelect" && (key === "enter" || key === " ")) {
    state.screen = "worldMap";
  }

});

requestAnimationFrame(loop);
