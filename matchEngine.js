const crypto = require("crypto");

const TURKISH_LETTERS = "abcçdefgğhıijklmnoöprsştuüvyz";

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
    if (guess[i] === answer[i]) {
      result[i] = "correct";
    } else {
      remaining.set(answer[i], (remaining.get(answer[i]) || 0) + 1);
    }
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

function chooseAnswer(words, previousAnswer = null) {
  const pool = previousAnswer && words.length > 1 ? words.filter(w => w !== previousAnswer) : words;
  return pool[crypto.randomInt(0, pool.length)];
}

function startMatch(room, participantPlayers, words, durationMs = 120000) {
  if (!room || participantPlayers.length < 2) throw new Error("NOT_ENOUGH_PLAYERS");
  const now = Date.now();
  const answer = chooseAnswer(words, room.match?.answer || null);
  const participants = new Map();

  for (const player of participantPlayers) {
    participants.set(player.id, {
      id: player.id,
      name: player.name,
      guesses: [],
      solvedAt: null,
      finishedAt: null,
      surrendered: false
    });
  }

  room.status = "playing";
  room.countdownEndsAt = null;
  room.match = {
    id: crypto.randomUUID(),
    answer,
    startedAt: new Date(now).toISOString(),
    startedAtMs: now,
    endsAt: new Date(now + durationMs).toISOString(),
    endsAtMs: now + durationMs,
    durationMs,
    maxAttempts: 6,
    participants,
    finishedAt: null,
    rankings: null
  };

  for (const player of room.players.values()) player.ready = false;
  return room.match;
}

function submitGuess(room, playerId, guessValue, wordSet) {
  const match = room?.match;
  if (!room || room.status !== "playing" || !match) return { error: "MATCH_NOT_ACTIVE" };
  const participant = match.participants.get(playerId);
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.finishedAt) return { error: "PLAYER_FINISHED" };
  if (Date.now() >= match.endsAtMs) return { error: "MATCH_TIME_OVER" };

  const guess = canonicalize(guessValue);
  if (!isFiveLetterWord(guess)) return { error: "INVALID_WORD" };
  if (!wordSet.has(guess)) return { error: "WORD_NOT_FOUND" };
  if (participant.guesses.length >= match.maxAttempts) return { error: "NO_ATTEMPTS_LEFT" };

  const result = evaluateGuess(match.answer, guess);
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
    finished: Boolean(participant.finishedAt)
  };
}

function surrender(room, playerId) {
  const match = room?.match;
  const participant = match?.participants.get(playerId);
  if (!match || room.status !== "playing") return { error: "MATCH_NOT_ACTIVE" };
  if (!participant) return { error: "NOT_A_PARTICIPANT" };
  if (participant.finishedAt) return { error: "PLAYER_FINISHED" };

  participant.surrendered = true;
  participant.finishedAt = Date.now();
  return { ok: true, answer: match.answer };
}

function allParticipantsFinished(room) {
  const values = [...(room?.match?.participants?.values() || [])];
  return values.length > 0 && values.every(p => Boolean(p.finishedAt));
}

function finishMatch(room, reason = "completed") {
  const match = room?.match;
  if (!match || match.finishedAt) return match;

  const now = Date.now();
  for (const p of match.participants.values()) {
    if (!p.finishedAt) p.finishedAt = now;
  }

  const scoreOf = p => {
    const last = p.guesses[p.guesses.length - 1]?.result || [];
    return {
      correct: last.filter(x => x === "correct").length,
      present: last.filter(x => x === "present").length,
      attempts: p.guesses.length
    };
  };

  const ranked = [...match.participants.values()].sort((a, b) => {
    const aSolved = Boolean(a.solvedAt), bSolved = Boolean(b.solvedAt);
    if (aSolved !== bSolved) return aSolved ? -1 : 1;
    if (aSolved && bSolved) {
      if (a.solvedAt !== b.solvedAt) return a.solvedAt - b.solvedAt;
      if (a.guesses.length !== b.guesses.length) return a.guesses.length - b.guesses.length;
    }
    if (a.surrendered !== b.surrendered) return a.surrendered ? 1 : -1;
    const as = scoreOf(a), bs = scoreOf(b);
    if (as.correct !== bs.correct) return bs.correct - as.correct;
    if (as.present !== bs.present) return bs.present - as.present;
    if (as.attempts !== bs.attempts) return bs.attempts - as.attempts;
    return a.name.localeCompare(b.name, "tr");
  });

  match.rankings = ranked.map((p, index) => ({
    place: index + 1,
    playerId: p.id,
    name: p.name,
    solved: Boolean(p.solvedAt),
    surrendered: Boolean(p.surrendered),
    attempts: p.guesses.length,
    elapsedMs: p.solvedAt ? Math.max(0, p.solvedAt - match.startedAtMs) : null
  }));
  match.finishedAt = new Date(now).toISOString();
  match.finishReason = reason;
  room.status = "results";
  return match;
}

module.exports = {
  canonicalize,
  isFiveLetterWord,
  evaluateGuess,
  startMatch,
  submitGuess,
  surrender,
  allParticipantsFinished,
  finishMatch
};
