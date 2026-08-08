const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, RoomError } = require("./roomManager");
function player(id) { return { id, name:id, socketId:`socket-${id}` }; }
test("4 sabit oda oluşturulur",()=>{const m=new RoomManager();assert.deepEqual(m.listFixedRooms().map(r=>[r.id,r.maxPlayers]),[["PUBLIC-1",4],["PUBLIC-2",4],["DUEL-1",2],["DUEL-2",2]])});
test("özel oda 6 haneli kodla oluşur",()=>{const m=new RoomManager();const r=m.createPrivateRoom(player("p1"),3);assert.match(r.code,/^\d{6}$/);assert.equal(r.players.size,1)});
test("özel odada son oyuncu çıkınca silinir",()=>{const m=new RoomManager();const r=m.createPrivateRoom(player("p1"),4);assert.equal(m.leaveRoom("p1").deleted,true);assert.equal(m.getRoom(r.id),null)});
test("birebir oda üçüncü oyuncuyu kabul etmez",()=>{const m=new RoomManager();m.joinRoom("DUEL-1",player("p1"));m.joinRoom("DUEL-1",player("p2"));assert.throws(()=>m.joinRoom("DUEL-1",player("p3")),e=>e instanceof RoomError&&e.code==="ROOM_FULL")});
test("public countdown sırasında yeni oyuncu katılabilir",()=>{const m=new RoomManager();const r=m.joinRoom("PUBLIC-1",player("p1"));r.status="countdown";assert.doesNotThrow(()=>m.joinRoom("PUBLIC-1",player("p2")))});
