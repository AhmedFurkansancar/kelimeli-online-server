const crypto = require("crypto");

const FIXED_ROOMS = [
  { id: "PUBLIC-1", type: "public", name: "Online Oda 1", maxPlayers: 4 },
  { id: "PUBLIC-2", type: "public", name: "Online Oda 2", maxPlayers: 4 },
  { id: "DUEL-1", type: "duel", name: "Birebir Oda 1", maxPlayers: 2 },
  { id: "DUEL-2", type: "duel", name: "Birebir Oda 2", maxPlayers: 2 }
];

class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRoom = new Map();
    for (const def of FIXED_ROOMS) {
      this.rooms.set(def.id, this.makeRoom({ ...def, fixed: true, code: null }));
    }
  }

  makeRoom({ id, code, type, name, maxPlayers, fixed }) {
    return {
      id, code, type, name, maxPlayers, fixed,
      status: "waiting",
      hostPlayerId: null,
      createdAt: new Date().toISOString(),
      players: new Map()
    };
  }

  normalizeRoomId(roomId) {
    return String(roomId || "").trim().toUpperCase();
  }

  makePrivateCode() {
    for (let i = 0; i < 1000; i += 1) {
      const code = String(crypto.randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("CODE_GENERATION_FAILED", "Yeni oda kodu üretilemedi.");
  }

  playerRecord(player) {
    return {
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      connected: true,
      ready: false,
      joinedAt: new Date().toISOString()
    };
  }

  listFixedRooms() {
    return FIXED_ROOMS.map(({ id }) => this.serializeRoom(this.rooms.get(id)));
  }

  getRoom(roomId) {
    return this.rooms.get(this.normalizeRoomId(roomId)) || null;
  }

  getPlayerRoomId(playerId) {
    return this.playerRoom.get(playerId) || null;
  }

  createPrivateRoom(player, maxPlayers = 4) {
    const size = Number(maxPlayers);
    if (![2, 3, 4].includes(size)) {
      throw new RoomError("INVALID_ROOM_SIZE", "Özel oda 2, 3 veya 4 kişilik olabilir.");
    }

    this.leaveRoom(player.id);
    const code = this.makePrivateCode();
    const room = this.makeRoom({
      id: code, code, type: "private", name: "Özel Oda", maxPlayers: size, fixed: false
    });

    room.hostPlayerId = player.id;
    room.players.set(player.id, this.playerRecord(player));
    this.playerRoom.set(player.id, room.id);
    this.rooms.set(room.id, room);
    return room;
  }

  joinRoom(roomId, player) {
    const id = this.normalizeRoomId(roomId);
    const room = this.rooms.get(id);
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "Oda bulunamadı.");

    const existingRoomId = this.playerRoom.get(player.id);
    if (existingRoomId === room.id && room.players.has(player.id)) {
      const existing = room.players.get(player.id);
      existing.socketId = player.socketId;
      existing.connected = true;
      existing.name = player.name;
      return room;
    }

    if (room.status !== "waiting") {
      throw new RoomError("ROOM_IN_MATCH", "Bu odada karşılaşma devam ediyor.");
    }
    if (room.players.size >= room.maxPlayers) {
      throw new RoomError("ROOM_FULL", "Bu oda dolu.");
    }

    if (existingRoomId) this.leaveRoom(player.id);
    if (!room.hostPlayerId) room.hostPlayerId = player.id;

    room.players.set(player.id, this.playerRecord(player));
    this.playerRoom.set(player.id, room.id);
    return room;
  }

  leaveRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return { room: null, deleted: false };

    const room = this.rooms.get(roomId);
    this.playerRoom.delete(playerId);
    if (!room) return { room: null, deleted: false };

    room.players.delete(playerId);

    if (room.hostPlayerId === playerId) {
      const nextHost = [...room.players.values()]
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
      room.hostPlayerId = nextHost?.id || null;
    }

    if (!room.fixed && room.players.size === 0) {
      this.rooms.delete(room.id);
      return { room, deleted: true };
    }

    if (room.fixed && room.players.size === 0) {
      room.status = "waiting";
      room.hostPlayerId = null;
    }

    return { room, deleted: false };
  }

  setReady(playerId, ready) {
    const roomId = this.playerRoom.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) throw new RoomError("NOT_IN_ROOM", "Önce bir odaya katılmalısın.");

    const player = room.players.get(playerId);
    if (!player) throw new RoomError("NOT_IN_ROOM", "Oyuncu odada bulunamadı.");

    player.ready = Boolean(ready);
    return room;
  }

  markDisconnected(playerId) {
    const roomId = this.playerRoom.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;

    player.connected = false;
    player.socketId = null;
    player.ready = false;
    return room;
  }

  reconnectPlayer(player) {
    const roomId = this.playerRoom.get(player.id);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) return null;
    const record = room.players.get(player.id);

    if (!record) {
      this.playerRoom.delete(player.id);
      return null;
    }

    record.socketId = player.socketId;
    record.connected = true;
    record.name = player.name;
    return room;
  }

  isDisconnected(playerId) {
    const roomId = this.playerRoom.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : null;
    const player = room?.players.get(playerId);
    return Boolean(player && !player.connected);
  }

  serializeRoom(room) {
    if (!room) return null;

    const players = [...room.players.values()]
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        ready: p.ready,
        isHost: room.hostPlayerId === p.id
      }));

    return {
      id: room.id,
      code: room.code,
      type: room.type,
      name: room.name,
      fixed: room.fixed,
      status: room.status,
      maxPlayers: room.maxPlayers,
      playerCount: players.length,
      connectedCount: players.filter((p) => p.connected).length,
      players
    };
  }
}

module.exports = { RoomManager, RoomError, FIXED_ROOMS };
