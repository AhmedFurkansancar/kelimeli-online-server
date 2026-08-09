const crypto = require("crypto");

const TURKISH_LETTERS = "abcçdefgğhıijklmnoöprsştuüvyz";
const POWERUP_COSTS = Object.freeze({ hint: 1, undo: 3 });

function canonicalize(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function isFiveLetterWord(value) {
  const word = canonicalize(value);
  return Array.from(word).length === 5 && new RegExp(`^[${TURKISH_LETTERS}]+$`, "u").test(word);
}

function evaluateGuess(answerValue, guessValue) {
  const answer = Array.from(canonicalize(answerValue));
  const guess = Array.from(canonicalize(guessValue));
  if (answer.length !== 5 || guess.length !== 5) throw new Error("INVALID_WORD_LENGTH");

  const result = Array(5).fill("absent");
  const remaining = new Map();
  for (let i = 0; i < 5; i += 1) {
    if (guess[i] === answer[i]) result[i] = "correct";
    else remaining.set(answer[i], (remaining.get(answer[i]) || 0) + 1);
  }
  for (let i = 0; i < 5; i += 1) {
    if (result[i] === "correct") continue;
    const count = remaining.get(guess[i]) || 0;
    if (count > 0) {
      result[i] = "present";
      remaining.set(guess[i], count - 1);
    }
  }
  return result;
}

function chooseAnswer(words, usedAnswers = new Set()) {
  const pool = words.filter(word => !usedAnswers.has(word));
  const source = pool.length ? pool : words;
  return source[crypto.randomInt(0, source.length)];
}

function makeRoundParticipant(player) {
  return {
    id: player.id,
    name: player.name,
    guesses: [],
    hints: new Set(),
    solvedAt: null,
    finishedAt: null,
    surrendered: false
  };
}

function buildStandings(match) {
  const rows = [...match.roster.values()].map(player => {
    const stats = match.stats.get(player.id) || { solved: 0, firsts: 0, elapsedMs: 0 };
    return {
      playerId: player.id,
      name: player.name,
      score: Number(match.scores.get(player.id) || 0),
      solved: stats.solved,
      firsts: stats.firsts,
      elapsedMs: stats.elapsedMs
    };
  });
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.firsts !== a.firsts) return b.firsts - a.firsts;
    if (b.solved !== a.solved) return b.solved - a.solved;
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    return a.name.localeCompare(b.name, "tr");
  });
  return rows.map((row, index) => ({ ...row, place: index + 1 }));
}

function beginRound(room, words) {
  const match = room?.match;
  if (!match) throw new Error("MATCH_NOT_ACTIVE");
  const now = Date.now();
  const answer = chooseAnswer(words, match.usedAnswers);
  match.usedAnswers.add(answer);
  match.currentRoundNumber += 1;

  const participants = new Map();
  for (const player of match.roster.values()) {
    if (match.activeIds.has(player.id)) participants.set(player.id, makeRoundParticipant(player));
  }

  match.currentRound = {
    number: match.currentRoundNumber,
    answer,
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    endsAt: new Date(now + match.durationMs).toISOString(),
    endsAtMs: now + match.durationMs,
    participants,
    finishedAt: null,
    finishReason: null,
    breakdown: null,
    standings: null
  };
  room.status = "playing";
  return match.currentRound;
}

function startMatch(room, participantPlayers, words, settings = {}) {
  if (!room || participantPlayers.length < 2) throw new Error("NOT_ENOUGH_PLAYERS");
  const now = Date.now();
  const totalRounds = Math.max(1, Number(settings.wordCount || 5));
  const durationSec = Math.max(30, Number(settings.durationSec || 200));
  const roster = new Map();
  const scores = new Map();
  const stats = new Map();

  for (const player of participantPlayers) {
    roster.set(player.id, { id: player.id, name: player.name });
    scores.set(player.id, 0);
    stats.set(player.id, { solved: 0, firsts: 0, elapsedMs: 0 });
  }

  room.status = "playing";
  room.countdownEndsAt = null;
  room.match = {
    id: crypto.randomUUID(),
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    totalRounds,
    durationSec,
    durationMs: durationSec * 1000,
    maxAttempts: 6,
    currentRoundNumber: 0,
    currentRound: null,
    usedAnswers: new Set(),
    roster,
    scores,
    stats,
    activeIds: new Set(roster.keys()),
    rounds: [],
    standings: null,
    finishedAt: null,
    finishReason: null
  };

  for (const player of room.players.values()) player.ready = false;
  beginRound(room, words);
  return room.match;
}

function submitGuess(room, playerId, guessValue, wordSet) {
  const match = room?.match;
  const round = match?.currentRound;
  if (!room || room.status !== "playing" || !match || !round) return { error: "MATCH_NOT_ACTIVE" };
  const participant = round.participants.get(playerId);
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.finishedAt) return { error: "PLAYER_FINISHED" };
  if (Date.now() >= round.endsAtMs) return { error: "MATCH_TIME_OVER" };

  const guess = canonicalize(guessValue);
  if (!isFiveLetterWord(guess)) return { error: "INVALID_WORD" };
  if (!wordSet.has(guess)) return { error: "WORD_NOT_FOUND" };
  if (participant.guesses.length >= match.maxAttempts) return { error: "NO_ATTEMPTS_LEFT" };

  const result = evaluateGuess(round.answer, guess);
  const now = Date.now();
  participant.guesses.push({ word: guess, result, at: now });
  const solved = result.every(v => v === "correct");
  if (solved) {
    participant.solvedAt = now;
    participant.finishedAt = now;
  } else if (participant.guesses.length >= match.maxAttempts) {
    participant.finishedAt = now;
  }

  return {
    ok: true,
    guess,
    result,
    attempt: participant.guesses.length,
    solved,
    finished: Boolean(participant.finishedAt),
    round: round.number
  };
}


function requestHint(room, playerId) {
  const match = room?.match;
  const round = match?.currentRound;
  if (!room || room.status !== "playing" || !match || !round) return { error: "MATCH_NOT_ACTIVE" };
  const participant = round.participants.get(playerId);
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.finishedAt) return { error: "PLAYER_FINISHED" };
  if (Date.now() >= round.endsAtMs) return { error: "MATCH_TIME_OVER" };

  if (!(participant.hints instanceof Set)) participant.hints = new Set(participant.hints || []);
  const known = new Set(participant.hints);
  for (const guess of participant.guesses) {
    (guess.result || []).forEach((state, index) => {
      if (state === "correct") known.add(index);
    });
  }

  const candidates = [0, 1, 2, 3, 4].filter(index => !known.has(index));
  if (!candidates.length) return { error: "NO_HINT_AVAILABLE" };

  const position = candidates[crypto.randomInt(0, candidates.length)];
  participant.hints.add(position);
  const letter = Array.from(round.answer)[position];
  return {
    ok: true,
    position,
    letter,
    hints: [...participant.hints].sort((a, b) => a - b).map(index => ({
      position: index,
      letter: Array.from(round.answer)[index]
    }))
  };
}

function undoLastGuess(room, playerId) {
  const match = room?.match;
  const round = match?.currentRound;
  if (!room || room.status !== "playing" || !match || !round) return { error: "MATCH_NOT_ACTIVE" };
  const participant = round.participants.get(playerId);
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.surrendered) return { error: "PLAYER_SURRENDERED" };
  if (participant.solvedAt) return { error: "CANNOT_UNDO_SOLVED" };
  if (!participant.guesses.length) return { error: "NO_GUESSES" };
  if (Date.now() >= round.endsAtMs) return { error: "MATCH_TIME_OVER" };

  const removed = participant.guesses.pop();
  participant.finishedAt = null;
  return {
    ok: true,
    removed: { word: removed.word, result: removed.result },
    attempt: participant.guesses.length,
    guesses: participant.guesses.map(g => ({ word: g.word, result: g.result }))
  };
}

function surrender(room, playerId) {
  const match = room?.match;
  const round = match?.currentRound;
  const participant = round?.participants.get(playerId);
  if (!match || !round || room.status !== "playing") return { error: "MATCH_NOT_ACTIVE" };
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.finishedAt) return { error: "PLAYER_FINISHED" };
  participant.surrendered = true;
  participant.finishedAt = Date.now();
  return { ok: true, answer: round.answer };
}

function allParticipantsFinished(room) {
  const values = [...(room?.match?.currentRound?.participants?.values() || [])];
  return values.length > 0 && values.every(p => Boolean(p.finishedAt));
}

function roundBreakdown(match, round) {
  const participants = [...round.participants.values()];
  const solvers = participants
    .filter(p => Boolean(p.solvedAt))
    .sort((a, b) => a.solvedAt - b.solvedAt || a.guesses.length - b.guesses.length || a.name.localeCompare(b.name, "tr"));
  const solverIndex = new Map(solvers.map((p, index) => [p.id, index]));
  const rarityPoints = solvers.length === 1 ? 20 : solvers.length === 2 ? 5 : 0;

  const rows = participants.map(p => {
    const bonuses = [];
    let points = 0;
    const solved = Boolean(p.solvedAt);
    if (solved) {
      bonuses.push({ type: "solved", label: "Kelimeyi bildi", points: 20 });
      points += 20;
      const order = solverIndex.get(p.id);
      if (order === 0) {
        bonuses.push({ type: "first", label: "İlk bilen bonusu", points: 15 });
        points += 15;
      } else if (order === 1) {
        bonuses.push({ type: "second", label: "İkinci bilen bonusu", points: 5 });
        points += 5;
      }
      if (rarityPoints > 0) {
        bonuses.push({
          type: solvers.length === 1 ? "solo" : "shared-two",
          label: solvers.length === 1 ? "Tek bilen bonusu" : "İki kişi bildi bonusu",
          points: rarityPoints
        });
        points += rarityPoints;
      }
    }

    const oldScore = Number(match.scores.get(p.id) || 0);
    const totalScore = oldScore + points;
    match.scores.set(p.id, totalScore);

    const stats = match.stats.get(p.id) || { solved: 0, firsts: 0, elapsedMs: 0 };
    if (solved) {
      stats.solved += 1;
      if (solverIndex.get(p.id) === 0) stats.firsts += 1;
      stats.elapsedMs += Math.max(0, p.solvedAt - round.startedAtMs);
    }
    match.stats.set(p.id, stats);

    return {
      playerId: p.id,
      name: p.name,
      solved,
      surrendered: Boolean(p.surrendered),
      attempts: p.guesses.length,
      elapsedMs: solved ? Math.max(0, p.solvedAt - round.startedAtMs) : null,
      points,
      previousScore: oldScore,
      totalScore,
      bonuses: bonuses.length ? bonuses : [{
        type: p.surrendered ? "surrendered" : "missed",
        label: p.surrendered ? "Pes etti" : "Kelimeyi bilemedi",
        points: 0
      }]
    };
  });

  const standings = buildStandings(match);
  const placeById = new Map(standings.map(s => [s.playerId, s.place]));
  rows.forEach(row => { row.place = placeById.get(row.playerId); });
  rows.sort((a, b) => a.place - b.place);
  return { rows, standings, solverCount: solvers.length };
}

function finishRound(room, reason = "completed") {
  const match = room?.match;
  const round = match?.currentRound;
  if (!match || !round || round.finishedAt) return round;

  const now = Date.now();
  for (const p of round.participants.values()) {
    if (!p.finishedAt) p.finishedAt = now;
  }

  const scored = roundBreakdown(match, round);
  round.breakdown = scored.rows;
  round.standings = scored.standings;
  round.solverCount = scored.solverCount;
  round.finishedAt = new Date(now).toISOString();
  round.finishReason = reason;
  match.standings = scored.standings;
  match.rounds.push({
    number: round.number,
    answer: round.answer,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    finishReason: reason,
    breakdown: scored.rows,
    standings: scored.standings,
    solverCount: scored.solverCount
  });
  room.status = "round-results";
  return round;
}

function canStartNextRound(room) {
  const match = room?.match;
  return Boolean(match && match.activeIds.size >= 2 && match.currentRoundNumber < match.totalRounds && !match.finishedAt);
}

function deactivatePlayer(room, playerId) {
  const match = room?.match;
  if (!match) return;
  match.activeIds.delete(playerId);
  const participant = match.currentRound?.participants?.get(playerId);
  if (participant && !participant.finishedAt) {
    participant.surrendered = true;
    participant.finishedAt = Date.now();
  }
}

function startNextRound(room, words) {
  if (!canStartNextRound(room)) return null;
  return beginRound(room, words);
}

function finishMatch(room, reason = "completed") {
  const match = room?.match;
  if (!match || match.finishedAt) return match;
  const now = Date.now();
  match.standings = buildStandings(match);
  match.finishedAt = new Date(now).toISOString();
  match.finishReason = reason;
  room.status = "results";
  return match;
}

module.exports = {
  POWERUP_COSTS,
  canonicalize,
  isFiveLetterWord,
  evaluateGuess,
  startMatch,
  startNextRound,
  submitGuess,
  requestHint,
  undoLastGuess,
  surrender,
  allParticipantsFinished,
  finishRound,
  finishMatch,
  canStartNextRound,
  buildStandings,
  deactivatePlayer
};
