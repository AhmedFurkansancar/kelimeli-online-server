const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateGuess, startMatch, submitGuess, surrender, finishMatch } = require("./matchEngine");
function room(){return {status:"waiting",players:new Map(),match:null,countdownEndsAt:null}}
test("tekrarlı harfler Wordle mantığıyla değerlendirilir",()=>{assert.deepEqual(evaluateGuess("kalem","kelle"),["correct","present","correct","absent","absent"])});
test("server cevabı istemciye başlamada sızdırmaz yapıdadır",()=>{const r=room();const players=[{id:"1",name:"A"},{id:"2",name:"B"}];const m=startMatch(r,players,["kalem"],120000);assert.equal(m.answer,"kalem");assert.equal(r.status,"playing");assert.equal(m.participants.size,2)});
test("doğru tahmin oyuncuyu bitirir",()=>{const r=room();startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],120000);const x=submitGuess(r,"1","kalem",new Set(["kalem"]));assert.equal(x.solved,true);assert.equal(x.finished,true)});
test("6 yanlış tahminden sonra oyuncu biter",()=>{const r=room();startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],120000);const set=new Set(["araba"]);let x;for(let i=0;i<6;i++)x=submitGuess(r,"1","araba",set);assert.equal(x.finished,true);assert.equal(r.match.participants.get("1").guesses.length,6)});
test("pes eden oyuncuya cevap döner",()=>{const r=room();startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],120000);const x=surrender(r,"1");assert.equal(x.answer,"kalem");assert.equal(r.match.participants.get("1").surrendered,true)});
test("çözen oyuncu sıralamada çözmeyenden önce gelir",()=>{const r=room();startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],120000);submitGuess(r,"1","kalem",new Set(["kalem"]));surrender(r,"2");const m=finishMatch(r);assert.equal(m.rankings[0].playerId,"1");assert.equal(r.status,"results")});
