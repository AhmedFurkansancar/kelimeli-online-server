const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateGuess,
  startMatch,
  startNextRound,
  submitGuess,
  requestHint,
  undoLastGuess,
  surrender,
  finishRound,
  finishMatch
} = require("./matchEngine");

function room(){return {status:"waiting",players:new Map(),match:null,countdownEndsAt:null}}
const set = new Set(["kalem","araba","kitap","deniz"]);

test("tekrarlı harfler Wordle mantığıyla değerlendirilir",()=>{
  assert.deepEqual(evaluateGuess("kalem","kelle"),["correct","present","correct","absent","absent"])
});

test("5 turluk seri başlar ve ilk tur açılır",()=>{
  const r=room();
  const m=startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}], ["kalem","araba"], {wordCount:5,durationSec:200});
  assert.equal(m.totalRounds,5); assert.equal(m.durationMs,200000); assert.equal(m.currentRoundNumber,1); assert.equal(r.status,"playing");
});

test("doğru tahmin oyuncuyu o turda bitirir",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:3,durationSec:200});
  const answer=r.match.currentRound.answer;
  const x=submitGuess(r,"1",answer,new Set([answer]));
  assert.equal(x.solved,true); assert.equal(x.finished,true);
});

test("tek bilen 55 puan alır",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:3,durationSec:200});
  const answer=r.match.currentRound.answer;
  submitGuess(r,"1",answer,new Set([answer])); surrender(r,"2");
  const round=finishRound(r);
  const a=round.breakdown.find(x=>x.playerId==="1");
  assert.equal(a.points,55);
  assert.deepEqual(a.bonuses.map(x=>x.points),[20,15,20]);
});

test("iki bilen için ilk 40 ikinci 30 puan alır",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:3,durationSec:200});
  const answer=r.match.currentRound.answer;
  submitGuess(r,"1",answer,new Set([answer]));
  submitGuess(r,"2",answer,new Set([answer]));
  const round=finishRound(r);
  assert.equal(round.breakdown.find(x=>x.playerId==="1").points,40);
  assert.equal(round.breakdown.find(x=>x.playerId==="2").points,30);
});

test("puanlar turlar arasında birikir",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem","araba"],{wordCount:3,durationSec:200});
  let answer=r.match.currentRound.answer;
  submitGuess(r,"1",answer,new Set([answer])); surrender(r,"2"); finishRound(r);
  assert.equal(r.match.scores.get("1"),55);
  startNextRound(r,["kalem","araba"]); answer=r.match.currentRound.answer;
  submitGuess(r,"1",answer,new Set([answer])); submitGuess(r,"2",answer,new Set([answer])); finishRound(r);
  assert.equal(r.match.scores.get("1"),95); assert.equal(r.match.scores.get("2"),30);
});

test("final sıralama toplam puana göre oluşur",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const answer=r.match.currentRound.answer;
  submitGuess(r,"1",answer,new Set([answer])); surrender(r,"2"); finishRound(r); finishMatch(r);
  assert.equal(r.match.standings[0].playerId,"1"); assert.equal(r.status,"results");
});


test("harf ipucu yalnız bilinmeyen konumu açar",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const hint=requestHint(r,"1");
  assert.equal(hint.ok,true); assert.equal(typeof hint.position,"number"); assert.equal(hint.letter,Array.from(r.match.currentRound.answer)[hint.position]);
  const hint2=requestHint(r,"1"); assert.notEqual(hint2.position,hint.position);
});

test("yanlış tahmin geri alınınca deneme hakkı geri gelir",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const dict=new Set(["kalem","araba"]);
  const answer=r.match.currentRound.answer; const wrong=answer==="kalem"?"araba":"kalem";
  submitGuess(r,"1",wrong,dict); assert.equal(r.match.currentRound.participants.get("1").guesses.length,1);
  const undone=undoLastGuess(r,"1"); assert.equal(undone.ok,true); assert.equal(undone.removed.word,wrong); assert.equal(r.match.currentRound.participants.get("1").guesses.length,0);
});


test("ipucu mevcut yeşil konumu tekrar satmaz",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const answer=r.match.currentRound.answer;
  const chars=[...answer];
  let wrong="araba"; if(wrong===answer) wrong="deniz";
  const dict=new Set([answer,wrong]);
  const submitted=submitGuess(r,"1",wrong,dict);
  const greens=new Set(submitted.result.map((v,i)=>v==="correct"?i:-1).filter(i=>i>=0));
  const hint=requestHint(r,"1");
  assert.equal(hint.ok,true);
  assert.equal(greens.has(hint.position),false);
});

test("undo ipuçlarını korur",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const hint=requestHint(r,"1");
  const answer=r.match.currentRound.answer; const wrong=answer==="kalem"?"araba":"kalem";
  submitGuess(r,"1",wrong,new Set([answer,wrong]));
  undoLastGuess(r,"1");
  assert.equal(r.match.currentRound.participants.get("1").hints.has(hint.position),true);
});

test("doğru tahmin jokerle geri alınamaz",()=>{
  const r=room(); startMatch(r,[{id:"1",name:"A"},{id:"2",name:"B"}],["kalem"],{wordCount:1,durationSec:200});
  const answer=r.match.currentRound.answer; submitGuess(r,"1",answer,new Set([answer]));
  assert.equal(undoLastGuess(r,"1").error,"CANNOT_UNDO_SOLVED");
});
