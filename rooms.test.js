const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, RoomError } = require("../roomManager");

function player(id) {
  return { id, name: id, socketId: `socket-${id}` };
}

test("4 sabit oda oluşturulur", () => {
  const manager = new RoomManager();
  const rooms = manager.listFixedRooms();
  assert.equal(rooms.length, 4);
  assert.deepEqual(rooms.map(r => [r.id, r.maxPlayers]), [
    ["PUBLIC-1", 4], ["PUBLIC-2", 4], ["DUEL-1", 2], ["DUEL-2", 2]
  ]);
});

test("özel oda 6 haneli kodla oluşur", () => {
  const manager = new RoomManager();
  const room = manager.createPrivateRoom(player("p1"), 3);
  assert.match(room.code, /^\d{6}$/);
  assert.equal(room.players.size, 1);
  assert.equal(room.hostPlayerId, "p1");
});

test("özel odada son oyuncu çıkınca oda silinir", () => {
  const manager = new RoomManager();
  const room = manager.createPrivateRoom(player("p1"), 4);
  assert.equal(manager.leaveRoom("p1").deleted, true);
  assert.equal(manager.getRoom(room.id), null);
});

test("birebir oda üçüncü oyuncuyu kabul etmez", () => {
  const manager = new RoomManager();
  manager.joinRoom("DUEL-1", player("p1"));
  manager.joinRoom("DUEL-1", player("p2"));
  assert.throws(
    () => manager.joinRoom("DUEL-1", player("p3")),
    err => err instanceof RoomError && err.code === "ROOM_FULL"
  );
});

test("oda değiştirince eski odadan çıkar", () => {
  const manager = new RoomManager();
  manager.joinRoom("PUBLIC-1", player("p1"));
  manager.joinRoom("PUBLIC-2", player("p1"));
  assert.equal(manager.getRoom("PUBLIC-1").players.size, 0);
  assert.equal(manager.getRoom("PUBLIC-2").players.size, 1);
});

test("disconnect sonrası slot korunur ve reconnect yapılabilir", () => {
  const manager = new RoomManager();
  manager.joinRoom("PUBLIC-1", player("p1"));
  manager.markDisconnected("p1");
  assert.equal(manager.isDisconnected("p1"), true);
  assert.equal(manager.getRoom("PUBLIC-1").players.size, 1);

  manager.reconnectPlayer({ id: "p1", name: "p1", socketId: "new" });
  assert.equal(manager.isDisconnected("p1"), false);
});
