const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { RoomManager, RoomError } = require("./roomManager");

const PORT = Number(process.env.PORT || 3000);
const RECONNECT_GRACE_MS = Math.max(3000, Number(process.env.RECONNECT_GRACE_MS || 15000));
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString("hex");
const EPHEMERAL_SECRET = !process.env.SESSION_SECRET?.trim();
const TEST_HTML = path.join(__dirname, "test.html");

const rooms = new RoomManager();
const disconnectTimers = new Map();
const playerSockets = new Map();

function applyCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, payload) {
  applyCommonHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendText(res, status, contentType, body) {
  applyCommonHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function readJsonBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("BODY_TOO_LARGE"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("INVALID_JSON"), { statusCode: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function sanitizeDisplayName(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim().slice(0, 20);
  return cleaned.length >= 2 ? cleaned : `Oyuncu ${Math.floor(1000 + Math.random() * 9000)}`;
}

function b64(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(encoded) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
}

function issueSession(name) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    playerId: crypto.randomUUID(),
    name,
    iat: now,
    exp: now + 60 * 60 * 24 * 30
  };
  const encoded = b64(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded)}`,
    playerId: payload.playerId,
    name: payload.name,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

function verifySession(token) {
  if (typeof token !== "string" || !token.includes(".")) throw new Error("INVALID_TOKEN");

  const [encoded, provided] = token.split(".");
  const expected = sign(encoded);
  const a = Buffer.from(provided || "");
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("INVALID_TOKEN");

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_TOKEN");
  }

  if (!payload.playerId || !payload.name || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("EXPIRED_OR_INVALID_TOKEN");
  }
  return payload;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      applyCommonHeaders(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      sendJson(res, 200, {
        ok: true,
        service: "kelimeli-online",
        version: "0.1.0",
        testPage: "/test"
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "kelimeli-online",
        version: "0.1.0",
        uptimeSeconds: Math.floor(process.uptime()),
        fixedRooms: rooms.listFixedRooms().map((r) => ({
          id: r.id,
          players: r.playerCount,
          maxPlayers: r.maxPlayers
        }))
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/rooms") {
      sendJson(res, 200, { ok: true, rooms: rooms.listFixedRooms() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session") {
      const body = await readJsonBody(req);
      const session = issueSession(sanitizeDisplayName(body?.name));
      sendJson(res, 201, { ok: true, ...session });
      return;
    }

    if (req.method === "GET" && url.pathname === "/test") {
      const html = fs.readFileSync(TEST_HTML);
      sendText(res, 200, "text/html; charset=utf-8", html);
      return;
    }

    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  } catch (error) {
    const status = Number(error.statusCode || 500);
    sendJson(res, status, {
      ok: false,
      error: status === 500 ? "SERVER_ERROR" : error.message
    });
  }
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

function ackOk(ack, data = {}) {
  if (typeof ack === "function") ack({ ok: true, ...data });
}

function ackError(ack, error) {
  const payload = error instanceof RoomError
    ? { code: error.code, message: error.message }
    : { code: "SERVER_ERROR", message: "Sunucu işlemi tamamlayamadı." };

  if (typeof ack === "function") ack({ ok: false, error: payload });
}

function emitFixedRooms() {
  io.emit("rooms:update", rooms.listFixedRooms());
}

function emitRoomState(room) {
  if (room) io.to(room.id).emit("room:state", rooms.serializeRoom(room));
}

function clearDisconnectTimer(playerId) {
  const timer = disconnectTimers.get(playerId);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(playerId);
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token ||
      String(socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = verifySession(token);
    socket.data.playerId = session.playerId;
    socket.data.playerName = sanitizeDisplayName(session.name);
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

io.on("connection", (socket) => {
  const playerId = socket.data.playerId;
  const playerName = socket.data.playerName;

  clearDisconnectTimer(playerId);

  const previousSocketId = playerSockets.get(playerId);
  if (previousSocketId && previousSocketId !== socket.id) {
    io.sockets.sockets.get(previousSocketId)?.disconnect(true);
  }
  playerSockets.set(playerId, socket.id);

  const restoredRoom = rooms.reconnectPlayer({
    id: playerId,
    name: playerName,
    socketId: socket.id
  });

  if (restoredRoom) {
    socket.join(restoredRoom.id);
    emitRoomState(restoredRoom);
    emitFixedRooms();
  }

  socket.emit("session:ready", {
    playerId,
    name: playerName,
    reconnectGraceMs: RECONNECT_GRACE_MS,
    room: restoredRoom ? rooms.serializeRoom(restoredRoom) : null
  });

  socket.on("rooms:get", (ack) => {
    ackOk(ack, { rooms: rooms.listFixedRooms() });
  });

  socket.on("room:create-private", (payload, ack) => {
    try {
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const room = rooms.createPrivateRoom(
        { id: playerId, name: playerName, socketId: socket.id },
        payload?.maxPlayers
      );

      if (oldRoomId && oldRoomId !== room.id) socket.leave(oldRoomId);
      socket.join(room.id);
      emitRoomState(room);
      emitFixedRooms();
      ackOk(ack, { room: rooms.serializeRoom(room), code: room.code });
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("room:join", (payload, ack) => {
    try {
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const room = rooms.joinRoom(payload?.roomId || payload?.code, {
        id: playerId,
        name: playerName,
        socketId: socket.id
      });

      if (oldRoomId && oldRoomId !== room.id) socket.leave(oldRoomId);
      socket.join(room.id);
      emitRoomState(room);
      emitFixedRooms();
      ackOk(ack, { room: rooms.serializeRoom(room) });
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("room:leave", (ack) => {
    try {
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const result = rooms.leaveRoom(playerId);

      if (oldRoomId) socket.leave(oldRoomId);
      if (result.room && !result.deleted) emitRoomState(result.room);
      emitFixedRooms();
      ackOk(ack);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("player:ready", (payload, ack) => {
    try {
      const room = rooms.setReady(playerId, payload?.ready);
      emitRoomState(room);
      ackOk(ack, { room: rooms.serializeRoom(room) });
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("disconnect", () => {
    if (playerSockets.get(playerId) === socket.id) playerSockets.delete(playerId);

    const room = rooms.markDisconnected(playerId);
    if (!room) return;

    emitRoomState(room);
    emitFixedRooms();
    clearDisconnectTimer(playerId);

    const timer = setTimeout(() => {
      disconnectTimers.delete(playerId);
      if (!rooms.isDisconnected(playerId)) return;

      const result = rooms.leaveRoom(playerId);
      if (result.room && !result.deleted) emitRoomState(result.room);
      emitFixedRooms();
    }, RECONNECT_GRACE_MS);

    disconnectTimers.set(playerId, timer);
  });
});

function startServer() {
  return server.listen(PORT, "0.0.0.0", () => {
    console.log(`[kelimeli-online] v0.1.0 listening on :${PORT}`);
    console.log(`[kelimeli-online] reconnect grace: ${RECONNECT_GRACE_MS}ms`);
    if (EPHEMERAL_SECRET) {
      console.warn("[kelimeli-online] SESSION_SECRET yok; bu açılış için rastgele güvenli anahtar kullanılıyor.");
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
