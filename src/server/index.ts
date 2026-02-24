import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import fs from "fs";
import { createServer } from "http";
import path from "path";
import { OBJECT_REGISTRY, loadObjectRegistry, StaticObjectDef } from "../shared/objects";
import { MOB_REGISTRY } from "../shared/mobs";
import { ENEMY_REGISTRY, loadEnemyRegistry, EnemyDef } from "../shared/enemies";
import { WEAPON_REGISTRY, loadWeaponRegistry, WeaponDef } from "../shared/weapons";
import { GameRoom } from "./GameRoom";

const PORT = Number(process.env.PORT ?? 3000);

// ── HTTP server (serves the Phaser client) ────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Resolve the public directory relative to the compiled output location
// (dist/server/index.js → ../../public)
const publicDir = path.resolve(__dirname, "../../public");
app.use(express.static(publicDir));
app.use(express.json({ limit: "4mb" }));  // raised to 4 mb for spritesheet base64 payloads

// ── Load registries from JSON (must happen before any route uses them) ────────
const objectsJsonPath = path.join(publicDir, "assets/entities/objects.json");
loadObjectRegistry(objectsJsonPath);

const enemiesJsonPath = path.join(publicDir, "assets/enemies/enemies.json");
loadEnemyRegistry(enemiesJsonPath);

const weaponsJsonPath = path.join(publicDir, "assets/weapons/weapons.json");
loadWeaponRegistry(weaponsJsonPath);

// ── Map designer endpoints (must come before the catch-all) ──────────────────

// Serve the designer HTML page
app.get("/design", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/index.html"));
});

// Serve the enemy builder page
app.get("/design/enemy-builder", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/enemy-builder.html"));
});

// Serve the object builder page
app.get("/design/object-builder", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/object-builder.html"));
});

// Serve the enemy editor page
app.get("/design/enemy-editor", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/enemy-editor.html"));
});

// Serve the weapon builder page
app.get("/design/weapon-builder", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/weapon-builder.html"));
});

// Serve the weapon editor page
app.get("/design/weapon-editor", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/weapon-editor.html"));
});

// Expose the full object registry (built-ins + user-added)
app.get("/design/objects", (_req, res) => {
  res.json(OBJECT_REGISTRY);
});

// Expose the weapon registry
app.get("/design/weapons", (_req, res) => {
  res.json(WEAPON_REGISTRY);
});

// Expose the mob registry for the designer
app.get("/design/mobs", (_req, res) => {
  res.json(MOB_REGISTRY);
});

// Expose the enemy registry for the designer
app.get("/design/enemies", (_req, res) => {
  res.json(ENEMY_REGISTRY);
});

// Save a map JSON file
app.post("/design/save", (req, res) => {
  const { name, data } = req.body as { name: string; data: unknown };
  if (!name || !/^[\w-]+$/.test(name)) {
    res.status(400).json({ error: "Invalid map name (alphanumeric, _ and - only)" });
    return;
  }
  const filePath = path.join(publicDir, "assets/maps/placement", `${name}.json`);
  fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ ok: true, path: filePath });
  });
});

// Save a new enemy: write PNG + update enemies.json + hot-reload in-memory registry
app.post("/design/save-enemy", (req, res) => {
  const body = req.body as {
    type:               string;
    label:              string;
    level:              number;
    hp:                 number;
    damage:             number;
    xpReward:           number;
    goldAmount:         number;
    goldChance:         number;
    defaultRespawnTime: number;
    speed:              number;
    aggroRange:         number;
    attackRange:        number;
    attackCooldownMs:   number;
    frameWidth:         number;
    frameHeight:        number;
    framesPerState:     number;
    hitbox:             { x: number; y: number; width: number; height: number };
    spriteBase64:       string;   // full data:image/png;base64,… URL
  };

  if (!body.type || !/^[a-z0-9_]+$/.test(body.type)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }

  const numericFields = [
    "level", "hp", "damage", "xpReward", "goldAmount", "goldChance",
    "defaultRespawnTime", "speed", "aggroRange", "attackRange", "attackCooldownMs",
    "frameWidth", "frameHeight", "framesPerState",
  ];
  for (const f of numericFields) {
    if (typeof (body as Record<string, unknown>)[f] !== "number") {
      res.status(400).json({ error: `Missing or invalid field: ${f}` });
      return;
    }
  }

  if (!body.spriteBase64) {
    res.status(400).json({ error: "Missing spriteBase64" });
    return;
  }

  const base64    = body.spriteBase64.replace(/^data:image\/png;base64,/, "");
  const pngBuffer = Buffer.from(base64, "base64");
  const pngPath   = path.join(publicDir, "assets/enemies", `${body.type}.png`);

  fs.writeFile(pngPath, pngBuffer, (pngErr) => {
    if (pngErr) {
      res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
      return;
    }

    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(enemiesJsonPath, "utf-8"));
    } catch {
      // File doesn't exist yet — create fresh
    }

    const spritePath = `/assets/enemies/${body.type}.png`;
    const entry: EnemyDef = {
      type:               body.type,
      label:              body.label,
      level:              body.level,
      hp:                 body.hp,
      damage:             body.damage,
      xpReward:           body.xpReward,
      goldAmount:         body.goldAmount,
      goldChance:         body.goldChance,
      defaultRespawnTime: body.defaultRespawnTime,
      speed:              body.speed,
      aggroRange:         body.aggroRange,
      attackRange:        body.attackRange,
      attackCooldownMs:   body.attackCooldownMs,
      frameWidth:         body.frameWidth,
      frameHeight:        body.frameHeight,
      framesPerState:     body.framesPerState,
      spritePath,
      hitbox:             body.hitbox,
    };
    existing[body.type] = entry;

    fs.writeFile(enemiesJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Saved PNG but failed to update enemies.json: ${jsonErr.message}` });
        return;
      }

      // Hot-reload: new enemy immediately visible in GET /design/enemies
      ENEMY_REGISTRY[body.type] = entry;

      res.json({ ok: true, type: body.type, spritePath });
    });
  });
});

// Save a new static object: write PNG + update objects.json + hot-reload in-memory registry
app.post("/design/save-object", (req, res) => {
  const body = req.body as {
    type:        string;
    imageWidth:  number;
    imageHeight: number;
    frameCount?: number;
    frameRate?:  number;
    collision?:  { x0: number; y0: number; x1: number; y1: number };
    imageBase64: string;
  };

  if (!body.type || !/^[a-z0-9_]+$/.test(body.type)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }

  if (OBJECT_REGISTRY[body.type]) {
    res.status(409).json({ error: `Type '${body.type}' already exists` });
    return;
  }

  if (typeof body.imageWidth !== "number" || typeof body.imageHeight !== "number") {
    res.status(400).json({ error: "Missing or invalid imageWidth / imageHeight" });
    return;
  }

  if (!body.imageBase64) {
    res.status(400).json({ error: "Missing imageBase64" });
    return;
  }

  const base64    = body.imageBase64.replace(/^data:image\/png;base64,/, "");
  const pngBuffer = Buffer.from(base64, "base64");
  const spritePath = `/assets/entities/${body.type}.png`;
  const pngPath   = path.join(publicDir, spritePath);

  fs.writeFile(pngPath, pngBuffer, (pngErr) => {
    if (pngErr) {
      res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
      return;
    }

    const entry: StaticObjectDef = {
      type:        body.type,
      imageWidth:  body.imageWidth,
      imageHeight: body.imageHeight,
      spritePath,
      ...(body.frameCount && body.frameCount > 1 ? { frameCount: body.frameCount } : {}),
      ...(body.frameRate  ? { frameRate: body.frameRate }  : {}),
      ...(body.collision  ? { collision: body.collision }  : {}),
    };

    // Hot-reload into in-memory registry
    OBJECT_REGISTRY[body.type] = entry;

    // Persist to objects.json
    const existing: Record<string, StaticObjectDef> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(objectsJsonPath, "utf-8")));
    } catch { /* file might not exist yet */ }
    existing[body.type] = entry;

    fs.writeFile(objectsJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Saved PNG but failed to update objects.json: ${jsonErr.message}` });
        return;
      }
      res.json({ ok: true, type: body.type, spritePath });
    });
  });
});

// Save a new weapon: write PNG + update weapons.json + hot-reload registry
app.post("/design/save-weapon", (req, res) => {
  const body = req.body as {
    type:        string;
    label:       string;
    damage:      number;
    cost:        number;
    hitRadius:   number;
    orbitRadius: number;
    imageBase64: string;
  };

  if (!body.type || !/^[a-z0-9_]+$/.test(body.type)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }
  if (WEAPON_REGISTRY[body.type]) {
    res.status(409).json({ error: `Type '${body.type}' already exists` });
    return;
  }
  if (!body.imageBase64) {
    res.status(400).json({ error: "Missing imageBase64" });
    return;
  }

  const base64      = body.imageBase64.replace(/^data:image\/png;base64,/, "");
  const pngBuffer   = Buffer.from(base64, "base64");
  const spritePath  = `/assets/weapons/${body.type}.png`;
  const pngPath     = path.join(publicDir, spritePath);

  fs.writeFile(pngPath, pngBuffer, (pngErr) => {
    if (pngErr) {
      res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
      return;
    }

    const entry: WeaponDef = {
      type:        body.type,
      label:       body.label,
      damage:      body.damage,
      cost:        body.cost,
      hitRadius:   body.hitRadius,
      orbitRadius: body.orbitRadius,
      spritePath,
    };

    const existing: Record<string, WeaponDef> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(weaponsJsonPath, "utf-8")));
    } catch { /* file missing */ }
    existing[body.type]       = entry;
    WEAPON_REGISTRY[body.type] = entry;

    fs.writeFile(weaponsJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Saved PNG but failed to update weapons.json: ${jsonErr.message}` });
        return;
      }
      res.json({ ok: true, type: body.type, spritePath });
    });
  });
});

// Update an existing weapon: optional image, optional rename, update weapons.json
app.post("/design/update-weapon", (req, res) => {
  const body = req.body as {
    originalType: string;
    type:         string;
    label:        string;
    damage:       number;
    cost:         number;
    hitRadius:    number;
    orbitRadius:  number;
    imageBase64?: string;
  };

  const { originalType, type: newType } = body;

  if (!originalType || !WEAPON_REGISTRY[originalType]) {
    res.status(404).json({ error: `Weapon type '${originalType}' not found` });
    return;
  }
  if (!newType || !/^[a-z0-9_]+$/.test(newType)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }
  if (newType !== originalType && WEAPON_REGISTRY[newType]) {
    res.status(409).json({ error: `Type '${newType}' already exists` });
    return;
  }

  const existingDef = WEAPON_REGISTRY[originalType];

  const finalize = (spritePath: string) => {
    const entry: WeaponDef = {
      type:        newType,
      label:       body.label,
      damage:      body.damage,
      cost:        body.cost,
      hitRadius:   body.hitRadius,
      orbitRadius: body.orbitRadius,
      spritePath,
    };

    const existing: Record<string, WeaponDef> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(weaponsJsonPath, "utf-8")));
    } catch { /* file missing */ }

    if (newType !== originalType) {
      delete existing[originalType];
      delete WEAPON_REGISTRY[originalType];
    }
    existing[newType]        = entry;
    WEAPON_REGISTRY[newType] = entry;

    fs.writeFile(weaponsJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Failed to update weapons.json: ${jsonErr.message}` });
        return;
      }
      res.json({ ok: true, type: newType, spritePath });
    });
  };

  if (body.imageBase64) {
    const base64        = body.imageBase64.replace(/^data:image\/png;base64,/, "");
    const pngBuffer     = Buffer.from(base64, "base64");
    const newSpritePath = `/assets/weapons/${newType}.png`;
    const pngPath       = path.join(publicDir, newSpritePath);
    fs.writeFile(pngPath, pngBuffer, (pngErr) => {
      if (pngErr) {
        res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
        return;
      }
      finalize(newSpritePath);
    });
  } else {
    finalize(existingDef.spritePath);
  }
});

// Update an existing static object: optional image, optional rename, update objects.json
app.post("/design/update-object", (req, res) => {
  const body = req.body as {
    originalType: string;
    type:         string;
    imageWidth:   number;
    imageHeight:  number;
    frameCount?:  number;
    frameRate?:   number;
    collision?:   { x0: number; y0: number; x1: number; y1: number };
    imageBase64?: string;
  };

  const { originalType, type: newType } = body;

  if (!originalType || !OBJECT_REGISTRY[originalType]) {
    res.status(404).json({ error: `Type '${originalType}' not found` });
    return;
  }
  if (!newType || !/^[a-z0-9_]+$/.test(newType)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }
  if (newType !== originalType && OBJECT_REGISTRY[newType]) {
    res.status(409).json({ error: `Type '${newType}' already exists` });
    return;
  }

  const existingDef = OBJECT_REGISTRY[originalType];

  const finalize = (spritePath: string) => {
    const entry: StaticObjectDef = {
      type:        newType,
      imageWidth:  body.imageWidth,
      imageHeight: body.imageHeight,
      spritePath,
      ...(body.frameCount && body.frameCount > 1 ? { frameCount: body.frameCount } : {}),
      ...(body.frameRate  ? { frameRate: body.frameRate }  : {}),
      ...(body.collision  ? { collision: body.collision }  : {}),
    };

    const existing: Record<string, StaticObjectDef> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(objectsJsonPath, "utf-8")));
    } catch { /* file missing */ }

    if (newType !== originalType) {
      delete existing[originalType];
      delete OBJECT_REGISTRY[originalType];
    }
    existing[newType]       = entry;
    OBJECT_REGISTRY[newType] = entry;

    fs.writeFile(objectsJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Failed to update objects.json: ${jsonErr.message}` });
        return;
      }
      res.json({ ok: true, type: newType, spritePath });
    });
  };

  if (body.imageBase64) {
    const base64        = body.imageBase64.replace(/^data:image\/png;base64,/, "");
    const pngBuffer     = Buffer.from(base64, "base64");
    const newSpritePath = `/assets/entities/${newType}.png`;
    const pngPath       = path.join(publicDir, newSpritePath);
    fs.writeFile(pngPath, pngBuffer, (pngErr) => {
      if (pngErr) {
        res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
        return;
      }
      finalize(newSpritePath);
    });
  } else {
    // Keep the existing sprite path (no file rename needed)
    finalize(existingDef.spritePath ?? `/assets/entities/${originalType}.png`);
  }
});

// Update an existing enemy: optional image, optional rename, update enemies.json
app.post("/design/update-enemy", (req, res) => {
  const body = req.body as {
    originalType:       string;
    type:               string;
    label:              string;
    level:              number;
    hp:                 number;
    damage:             number;
    xpReward:           number;
    goldAmount:         number;
    goldChance:         number;
    defaultRespawnTime: number;
    speed:              number;
    aggroRange:         number;
    attackRange:        number;
    attackCooldownMs:   number;
    frameWidth:         number;
    frameHeight:        number;
    framesPerState:     number;
    hitbox:             { x: number; y: number; width: number; height: number };
    spriteBase64?:      string;
  };

  const { originalType, type: newType } = body;

  if (!originalType || !ENEMY_REGISTRY[originalType]) {
    res.status(404).json({ error: `Enemy type '${originalType}' not found` });
    return;
  }
  if (!newType || !/^[a-z0-9_]+$/.test(newType)) {
    res.status(400).json({ error: "Invalid type key (lowercase alphanumeric and _ only)" });
    return;
  }
  if (newType !== originalType && ENEMY_REGISTRY[newType]) {
    res.status(409).json({ error: `Type '${newType}' already exists` });
    return;
  }

  const existingDef = ENEMY_REGISTRY[originalType];

  const finalize = (spritePath: string) => {
    const entry: EnemyDef = {
      type:               newType,
      label:              body.label,
      level:              body.level,
      hp:                 body.hp,
      damage:             body.damage,
      xpReward:           body.xpReward,
      goldAmount:         body.goldAmount,
      goldChance:         body.goldChance,
      defaultRespawnTime: body.defaultRespawnTime,
      speed:              body.speed,
      aggroRange:         body.aggroRange,
      attackRange:        body.attackRange,
      attackCooldownMs:   body.attackCooldownMs,
      frameWidth:         body.frameWidth,
      frameHeight:        body.frameHeight,
      framesPerState:     body.framesPerState,
      spritePath,
      hitbox:             body.hitbox,
    };

    const existing: Record<string, unknown> = {};
    try {
      Object.assign(existing, JSON.parse(fs.readFileSync(enemiesJsonPath, "utf-8")));
    } catch { /* file missing */ }

    if (newType !== originalType) {
      delete existing[originalType];
      delete ENEMY_REGISTRY[originalType];
    }
    existing[newType]        = entry;
    ENEMY_REGISTRY[newType]  = entry;

    fs.writeFile(enemiesJsonPath, JSON.stringify(existing, null, 2), (jsonErr) => {
      if (jsonErr) {
        res.status(500).json({ error: `Failed to update enemies.json: ${jsonErr.message}` });
        return;
      }
      res.json({ ok: true, type: newType, spritePath });
    });
  };

  if (body.spriteBase64) {
    const base64        = body.spriteBase64.replace(/^data:image\/png;base64,/, "");
    const pngBuffer     = Buffer.from(base64, "base64");
    const newSpritePath = `/assets/enemies/${newType}.png`;
    const pngPath       = path.join(publicDir, "assets/enemies", `${newType}.png`);
    fs.writeFile(pngPath, pngBuffer, (pngErr) => {
      if (pngErr) {
        res.status(500).json({ error: `Failed to save PNG: ${pngErr.message}` });
        return;
      }
      finalize(newSpritePath);
    });
  } else {
    finalize(existingDef.spritePath);
  }
});

// Catch-all: always serve index.html for unknown routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ── Colyseus game server ──────────────────────────────────────────────────────
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

// ── Start ─────────────────────────────────────────────────────────────────────
gameServer
  .listen(PORT)
  .then(() => {
    console.log(`Game server running → http://localhost:${PORT}`);
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
