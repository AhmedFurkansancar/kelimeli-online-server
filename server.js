const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { RoomManager, RoomError } = require("./roomManager");
const {
  canonicalize,
  startMatch,
  submitGuess,
  surrender,
  allParticipantsFinished,
  finishMatch
} = require("./matchEngine");

const VERSION = "0.2.0";
const PORT = Number(process.env.PORT || 3000);
const RECONNECT_GRACE_MS = Math.max(3000, Number(process.env.RECONNECT_GRACE_MS || 15000));
const MATCH_DURATION_MS = Math.max(30000, Number(process.env.MATCH_DURATION_MS || 120000));
const PUBLIC_COUNTDOWN_MS = Math.max(3000, Number(process.env.PUBLIC_COUNTDOWN_MS || 10000));
const DUEL_COUNTDOWN_MS = Math.max(2000, Number(process.env.DUEL_COUNTDOWN_MS || 3000));
const PRIVATE_COUNTDOWN_MS = Math.max(2000, Number(process.env.PRIVATE_COUNTDOWN_MS || 3000));
const RESULTS_HOLD_MS = Math.max(3000, Number(process.env.RESULTS_HOLD_MS || 10000));
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString("hex");
const EPHEMERAL_SECRET = !process.env.SESSION_SECRET?.trim();
const TEST_HTML = path.join(__dirname, "test.html");
const WORDS = JSON.parse(fs.readFileSync(path.join(__dirname, "words.json"), "utf8"))
  .map(canonicalize)
  .filter(Boolean);
const WORD_SET = new Set(WORDS);

const rooms = new RoomManager();
const disconnectTimers = new Map();
const playerSockets = new Map();
const countdownTimers = new Map();
const matchTimers = new Map();
const resultTimers = new Map();

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
    req.on("data", chunk => {
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

function b64(input) { return Buffer.from(input).toString("base64url"); }
function sign(encoded) { return crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url"); }

function issueSession(name, playerId = null) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { playerId: playerId || crypto.randomUUID(), name, iat: now, exp: now + 60 * 60 * 24 * 30 };
  const encoded = b64(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded)}`, playerId: payload.playerId, name: payload.name, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

function verifySession(token) {
  if (typeof token !== "string" || !token.includes(".")) throw new Error("INVALID_TOKEN");
  const [encoded, provided] = token.split(".");
  const expected = sign(encoded);
  const a = Buffer.from(provided || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("INVALID_TOKEN");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new Error("INVALID_TOKEN"); }
  if (!payload.playerId || !payload.name || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("EXPIRED_OR_INVALID_TOKEN");
  return payload;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") { applyCommonHeaders(res); res.statusCode = 204; res.end(); return; }

    if (req.method === "GET" && url.pathname === "/") {
      sendJson(res, 200, { ok: true, service: "kelimeli-online", version: VERSION, testPage: "/test" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true, service: "kelimeli-online", version: VERSION,
        uptimeSeconds: Math.floor(process.uptime()), words: WORDS.length,
        fixedRooms: rooms.listFixedRooms().map(r => ({ id: r.id, status: r.status, players: r.playerCount, maxPlayers: r.maxPlayers }))
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
      sendText(res, 200, "text/html; charset=utf-8", fs.readFileSync(TEST_HTML));
      return;
    }
    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  } catch (error) {
    const status = Number(error.statusCode || 500);
    sendJson(res, status, { ok: false, error: status === 500 ? "SERVER_ERROR" : error.message });
  }
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

function ackOk(ack, data = {}) { if (typeof ack === "function") ack({ ok: true, ...data }); }
function ackError(ack, error) {
  const payload = error instanceof RoomError
    ? { code: error.code, message: error.message }
    : { code: error?.code || "SERVER_ERROR", message: error?.message || "Sunucu işlemi tamamlayamadı." };
  if (typeof ack === "function") ack({ ok: false, error: payload });
}
function emitFixedRooms() { io.emit("rooms:update", rooms.listFixedRooms()); }
function emitRoomState(room) { if (room) io.to(room.id).emit("room:state", rooms.serializeRoom(room)); }
function clearTimer(map, key) { const timer = map.get(key); if (timer) clearTimeout(timer); map.delete(key); }
function clearDisconnectTimer(playerId) { clearTimer(disconnectTimers, playerId); }

function connectedReadyPlayers(room) {
  return rooms.readyPlayers(room);
}

function startCountdown(room, ms, reason) {
  if (!room || !["waiting", "countdown"].includes(room.status)) return;
  clearTimer(countdownTimers, room.id);
  room.status = "countdown";
  room.countdownEndsAt = new Date(Date.now() + ms).toISOString();
  io.to(room.id).emit("match:countdown", { endsAt: room.countdownEndsAt, reason });
  emitRoomState(room);
  emitFixedRooms();

  countdownTimers.set(room.id, setTimeout(() => {
    countdownTimers.delete(room.id);
    const fresh = rooms.getRoom(room.id);
    if (!fresh || fresh.status !== "countdown") return;

    const participants = connectedReadyPlayers(fresh);
    if (participants.length < 2 || (fresh.type === "duel" && participants.length !== 2)) {
      cancelCountdown(fresh, "Yeterli hazır oyuncu kalmadı.");
      return;
    }

    beginMatch(fresh, participants);
  }, ms));
}

function cancelCountdown(room, message = "Geri sayım iptal edildi.") {
  if (!room) return;
  clearTimer(countdownTimers, room.id);
  room.status = "waiting";
  room.countdownEndsAt = null;
  io.to(room.id).emit("match:countdown-cancelled", { message });
  emitRoomState(room);
  emitFixedRooms();
}

function reevaluateAutoStart(room) {
  if (!room || room.type === "private" || room.status === "playing" || room.status === "results") return;
  const ready = connectedReadyPlayers(room);

  if (room.type === "duel") {
    if (ready.length === 2 && room.players.size === 2) {
      if (room.status !== "countdown") startCountdown(room, DUEL_COUNTDOWN_MS, "duel-ready");
    } else if (room.status === "countdown") cancelCountdown(room);
    return;
  }

  if (room.type === "public") {
    if (ready.length >= 2) {
      if (room.status !== "countdown") startCountdown(room, PUBLIC_COUNTDOWN_MS, "public-ready");
    } else if (room.status === "countdown") cancelCountdown(room);
  }
}

function beginMatch(room, participants) {
  clearTimer(countdownTimers, room.id);
  const match = startMatch(room, participants, WORDS, MATCH_DURATION_MS);
  io.to(room.id).emit("match:started", {
    matchId: match.id,
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    maxAttempts: match.maxAttempts,
    durationMs: match.durationMs,
    room: rooms.serializeRoom(room)
  });
  emitRoomState(room);
  emitFixedRooms();

  clearTimer(matchTimers, room.id);
  matchTimers.set(room.id, setTimeout(() => finishRoomMatch(room.id, "timeout"), MATCH_DURATION_MS + 60));
}

function finishRoomMatch(roomId, reason) {
  const room = rooms.getRoom(roomId);
  if (!room || !room.match || room.match.finishedAt) return;
  clearTimer(matchTimers, room.id);
  const match = finishMatch(room, reason);
  io.to(room.id).emit("match:finished", {
    matchId: match.id,
    answer: match.answer,
    reason: match.finishReason,
    rankings: match.rankings,
    room: rooms.serializeRoom(room)
  });
  emitRoomState(room);
  emitFixedRooms();

  clearTimer(resultTimers, room.id);
  resultTimers.set(room.id, setTimeout(() => {
    resultTimers.delete(room.id);
    const fresh = rooms.getRoom(room.id);
    if (!fresh || fresh.status !== "results") return;
    rooms.resetToWaiting(fresh);
    io.to(fresh.id).emit("match:reset", { room: rooms.serializeRoom(fresh) });
    emitRoomState(fresh);
    emitFixedRooms();
  }, RESULTS_HOLD_MS));
}

function maybeFinishMatch(room) {
  if (room?.status === "playing" && allParticipantsFinished(room)) finishRoomMatch(room.id, "completed");
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || String(socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = verifySession(token);
    socket.data.playerId = session.playerId;
    socket.data.playerName = sanitizeDisplayName(session.name);
    next();
  } catch { next(new Error("UNAUTHORIZED")); }
});

io.on("connection", socket => {
  const playerId = socket.data.playerId;
  const playerName = socket.data.playerName;
  clearDisconnectTimer(playerId);

  const previousSocketId = playerSockets.get(playerId);
  if (previousSocketId && previousSocketId !== socket.id) io.sockets.sockets.get(previousSocketId)?.disconnect(true);
  playerSockets.set(playerId, socket.id);

  const restoredRoom = rooms.reconnectPlayer({ id: playerId, name: playerName, socketId: socket.id });
  if (restoredRoom) {
    socket.join(restoredRoom.id);
    emitRoomState(restoredRoom);
    emitFixedRooms();
  }

  socket.emit("session:ready", {
    playerId, name: playerName, reconnectGraceMs: RECONNECT_GRACE_MS,
    room: restoredRoom ? rooms.serializeRoom(restoredRoom) : null
  });

  socket.on("rooms:get", ack => ackOk(ack, { rooms: rooms.listFixedRooms() }));

  socket.on("room:create-private", (payload, ack) => {
    try {
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const room = rooms.createPrivateRoom({ id: playerId, name: playerName, socketId: socket.id }, payload?.maxPlayers);
      if (oldRoomId && oldRoomId !== room.id) socket.leave(oldRoomId);
      socket.join(room.id);
      emitRoomState(room); emitFixedRooms();
      ackOk(ack, { room: rooms.serializeRoom(room), code: room.code });
    } catch (error) { ackError(ack, error); }
  });

  socket.on("room:join", (payload, ack) => {
    try {
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const room = rooms.joinRoom(payload?.roomId || payload?.code, { id: playerId, name: playerName, socketId: socket.id });
      if (oldRoomId && oldRoomId !== room.id) socket.leave(oldRoomId);
      socket.join(room.id);
      emitRoomState(room); emitFixedRooms();
      ackOk(ack, { room: rooms.serializeRoom(room) });
    } catch (error) { ackError(ack, error); }
  });

  socket.on("room:leave", ack => {
    try {
      const room = rooms.getPlayerRoom(playerId);
      if (room?.status === "playing") {
        surrender(room, playerId);
        maybeFinishMatch(room);
      }
      const oldRoomId = rooms.getPlayerRoomId(playerId);
      const result = rooms.leaveRoom(playerId);
      if (oldRoomId) socket.leave(oldRoomId);
      if (result.room && !result.deleted) {
        if (result.room.status === "countdown") reevaluateAutoStart(result.room);
        emitRoomState(result.room);
      }
      emitFixedRooms();
      ackOk(ack);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("player:ready", (payload, ack) => {
    try {
      const room = rooms.setReady(playerId, payload?.ready);
      emitRoomState(room); emitFixedRooms();
      ackOk(ack, { room: rooms.serializeRoom(room) });
      reevaluateAutoStart(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("match:start-private", (_payload, ack) => {
    try {
      const room = rooms.getPlayerRoom(playerId);
      if (!room || room.type !== "private") throw new RoomError("NOT_PRIVATE_ROOM", "Bu oda özel oda değil.");
      if (room.hostPlayerId !== playerId) throw new RoomError("HOST_ONLY", "Karşılaşmayı yalnızca oda kurucusu başlatabilir.");
      if (room.status !== "waiting") throw new RoomError("ROOM_NOT_WAITING", "Oda şu an başlatılamıyor.");
      const connected = rooms.connectedPlayers(room);
      if (connected.length < 2) throw new RoomError("NOT_ENOUGH_PLAYERS", "Başlamak için en az 2 oyuncu gerekli.");
      if (connected.some(p => !p.ready)) throw new RoomError("PLAYERS_NOT_READY", "Odadaki tüm oyuncular hazır olmalı.");
      startCountdown(room, PRIVATE_COUNTDOWN_MS, "private-host");
      ackOk(ack, { room: rooms.serializeRoom(room) });
    } catch (error) { ackError(ack, error); }
  });

  socket.on("match:self-state", (_payload, ack) => {
    try {
      const room = rooms.getPlayerRoom(playerId);
      const match = room?.match;
      const participant = match?.participants?.get(playerId);
      if (!room || !match || !participant) throw new RoomError("MATCH_NOT_ACTIVE", "Aktif karşılaşma bulunamadı.");
      ackOk(ack, {
        matchId: match.id,
        endsAt: match.endsAt,
        status: room.status,
        finished: Boolean(participant.finishedAt),
        surrendered: Boolean(participant.surrendered),
        guesses: participant.guesses.map(g => ({ word: g.word, result: g.result })),
        answer: room.status === "results" || participant.surrendered ? match.answer : null
      });
    } catch (error) { ackError(ack, error); }
  });

  socket.on("match:guess", (payload, ack) => {
    try {
      const room = rooms.getPlayerRoom(playerId);
      const result = submitGuess(room, playerId, payload?.word, WORD_SET);
      if (result.error) {
        const map = {
          MATCH_NOT_ACTIVE: "Aktif karşılaşma yok.", NOT_A_PARTICIPANT: "Bu karşılaşmada oyuncu değilsin.",
          PLAYER_FINISHED: "Bu karşılaşmayı zaten bitirdin.", MATCH_TIME_OVER: "Süre doldu.",
          INVALID_WORD: "5 harfli geçerli bir kelime yaz.", WORD_NOT_FOUND: "Bu kelime oyun sözlüğünde yok.",
          NO_ATTEMPTS_LEFT: "Tahmin hakkın kalmadı."
        };
        throw new RoomError(result.error, map[result.error] || "Tahmin kabul edilmedi.");
      }
      ackOk(ack, result);
      emitRoomState(room);
      io.to(room.id).emit("match:progress", { room: rooms.serializeRoom(room) });
      maybeFinishMatch(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("match:surrender", (_payload, ack) => {
    try {
      const room = rooms.getPlayerRoom(playerId);
      const result = surrender(room, playerId);
      if (result.error) throw new RoomError(result.error, "Pes etme işlemi yapılamadı.");
      ackOk(ack, { answer: result.answer });
      emitRoomState(room);
      io.to(room.id).emit("match:progress", { room: rooms.serializeRoom(room) });
      maybeFinishMatch(room);
    } catch (error) { ackError(ack, error); }
  });

  socket.on("disconnect", () => {
    if (playerSockets.get(playerId) === socket.id) playerSockets.delete(playerId);
    const room = rooms.markDisconnected(playerId);
    if (!room) return;
    if (room.status === "countdown") reevaluateAutoStart(room);
    emitRoomState(room); emitFixedRooms(); clearDisconnectTimer(playerId);

    disconnectTimers.set(playerId, setTimeout(() => {
      disconnectTimers.delete(playerId);
      if (!rooms.isDisconnected(playerId)) return;
      const liveRoom = rooms.getPlayerRoom(playerId);
      if (liveRoom?.status === "playing") {
        surrender(liveRoom, playerId);
        maybeFinishMatch(liveRoom);
      }
      const result = rooms.leaveRoom(playerId);
      if (result.room && !result.deleted) emitRoomState(result.room);
      emitFixedRooms();
    }, RECONNECT_GRACE_MS));
  });
});

function startServer() {
  return server.listen(PORT, "0.0.0.0", () => {
    console.log(`[kelimeli-online] v${VERSION} listening on :${PORT}`);
    console.log(`[kelimeli-online] words=${WORDS.length} match=${MATCH_DURATION_MS}ms reconnect=${RECONNECT_GRACE_MS}ms`);
    if (EPHEMERAL_SECRET) console.warn("[kelimeli-online] SESSION_SECRET yok; yeniden başlatmada oturum tokenları yenilenir.");
  });
}

if (require.main === module) startServer();
module.exports = { startServer };
