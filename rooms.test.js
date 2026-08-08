const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomManager, RoomError } = require("./roomManager");
function player(id) { return { id, name:id, socketId:`socket-${id}` }; }

test("4 sabit oda 5 kelime 200 saniye kuralıyla oluşturulur",()=>{
  const m=new RoomManager(); const list=m.listFixedRooms();
  assert.deepEqual(list.map(r=>[r.id,r.maxPlayers]),[["PUBLIC-1",4],["PUBLIC-2",4],["DUEL-1",2],["DUEL-2",2]]);
  assert.ok(list.every(r=>r.settings.wordCount===5&&r.settings.durationSec===200));
});

test("özel oda custom ayarlarla oluşur",()=>{
  const m=new RoomManager(); const r=m.createPrivateRoom(player("p1"),3,{wordCount:7,durationSec:150});
  assert.match(r.code,/^\d{6}$/); assert.equal(r.settings.wordCount,7); assert.equal(r.settings.durationSec,150);
});

test("geçersiz özel oda süresi reddedilir",()=>{
  const m=new RoomManager();
  assert.throws(()=>m.createPrivateRoom(player("p1"),4,{wordCount:5,durationSec:123}),e=>e instanceof RoomError&&e.code==="INVALID_DURATION");
});

test("özel odada son oyuncu çıkınca silinir",()=>{
  const m=new RoomManager(); const r=m.createPrivateRoom(player("p1"),4,{wordCount:5,durationSec:200});
  assert.equal(m.leaveRoom("p1").deleted,true); assert.equal(m.getRoom(r.id),null);
});

test("birebir oda üçüncü oyuncuyu kabul etmez",()=>{
  const m=new RoomManager(); m.joinRoom("DUEL-1",player("p1")); m.joinRoom("DUEL-1",player("p2"));
  assert.throws(()=>m.joinRoom("DUEL-1",player("p3")),e=>e instanceof RoomError&&e.code==="ROOM_FULL");
});

test("quick join doluya en yakın odayı seçer",()=>{
  const m=new RoomManager(); m.joinRoom("PUBLIC-2",player("p1")); m.joinRoom("PUBLIC-2",player("p2"));
  const chosen=m.quickJoin("public",player("p3")); assert.equal(chosen.id,"PUBLIC-2");
});

test("public countdown sırasında yeni oyuncu katılabilir",()=>{
  const m=new RoomManager(); const r=m.joinRoom("PUBLIC-1",player("p1")); r.status="countdown";
  assert.doesNotThrow(()=>m.joinRoom("PUBLIC-1",player("p2")));
});
