import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import fs from "fs";
import { createServer } from "http";
import path from "path";
import { STATIC_OBJECT_REGISTRY } from "../shared/staticObjects";
import { GameRoom } from "./GameRoom";

const PORT = Number(process.env.PORT ?? 3000);

// ── HTTP server (serves the Phaser client) ────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Resolve the public directory relative to the compiled output location
// (dist/server/index.js → ../../public)
const publicDir = path.resolve(__dirname, "../../public");
app.use(express.static(publicDir));
app.use(express.json({ limit: "2mb" }));

// ── Map designer endpoints (must come before the catch-all) ──────────────────

// Serve the designer HTML page
app.get("/design", (_req, res) => {
  res.sendFile(path.join(publicDir, "designer/index.html"));
});

// Expose the static object registry so designer JS needs no TypeScript import
app.get("/design/objects", (_req, res) => {
  res.json(STATIC_OBJECT_REGISTRY);
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
