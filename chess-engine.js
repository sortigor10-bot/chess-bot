import { Chess } from "https://esm.sh/chess.js@1.4.0";

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE_SCORE = 100000;
const SEARCH_ABORT = {};
const SEARCH_CANCELLED = {};
const MAX_DEPTH = 4;
const MAX_NODES = 120000;
const MAX_THINK_TIME_MS = 4000;

export async function chooseMove(fen, color, onProgress = () => {}, isCancelled = () => false) {
  const game = new Chess(fen);
  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return { move: null, plan: "Партия завершена" };

  const context = {
    color,
    deadline: Date.now() + MAX_THINK_TIME_MS,
    maxNodes: MAX_NODES,
    nodes: 0,
    isCancelled,
  };
  let completedSearch = null;

  for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
    if (isCancelled()) return { move: null, cancelled: true };
    try {
      completedSearch = searchRoot(game, depth, context);
    } catch (error) {
      if (error === SEARCH_CANCELLED) return { move: null, cancelled: true };
      if (error !== SEARCH_ABORT) throw error;
      break;
    }

    onProgress({ depth, nodes: context.nodes });
    if (Math.abs(completedSearch.score) >= MATE_SCORE - 100) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (Date.now() >= context.deadline || context.nodes >= context.maxNodes) break;
  }

  const result = completedSearch || {
    move: toMove(legalMoves[0]),
    score: evaluate(game, color),
    candidates: [],
    depth: 0,
  };
  const plannedSacrifice = findPlannedSacrifice(result, fen);
  const move = plannedSacrifice || result.move;
  const plan = plannedSacrifice
    ? "Жертва рассчитана: бот видит продолжение с сохранением выигрышного перевеса"
    : describePlan(game, move, color, result.score);

  return {
    move: toMove(move),
    plan,
    score: result.score,
    depth: result.depth,
    nodes: context.nodes,
  };
}

function searchRoot(game, depth, context) {
  const candidates = [];
  const moves = orderMoves(game.moves({ verbose: true }));
  let bestMove = moves[0];
  let bestScore = -Infinity;

  for (const move of moves) {
    checkSearchLimits(context);
    game.move(toMove(move));
    let child;
    try {
      child = search(game, depth - 1, -Infinity, Infinity, 1, context);
    } finally {
      game.undo();
    }

    const candidate = {
      move,
      score: child.score,
      line: [move, ...child.line],
    };
    candidates.push(candidate);
    if (candidate.score > bestScore) {
      bestScore = candidate.score;
      bestMove = move;
    }
  }

  return { move: bestMove, score: bestScore, candidates, depth };
}

function search(game, depth, alpha, beta, ply, context) {
  countNode(context);
  const terminal = getTerminalScore(game, context.color, ply);
  if (terminal !== null) return { score: terminal, line: [] };
  if (depth <= 0) return { score: quiescence(game, alpha, beta, ply, 3, context), line: [] };

  const maximizing = game.turn() === context.color;
  const moves = orderMoves(game.moves({ verbose: true }));
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestLine = [];

  for (const move of moves) {
    game.move(toMove(move));
    let child;
    try {
      child = search(game, depth - 1, alpha, beta, ply + 1, context);
    } finally {
      game.undo();
    }

    if (
      (maximizing && child.score > bestScore) ||
      (!maximizing && child.score < bestScore)
    ) {
      bestScore = child.score;
      bestLine = [move, ...child.line];
    }

    if (maximizing) {
      alpha = Math.max(alpha, bestScore);
    } else {
      beta = Math.min(beta, bestScore);
    }
    if (alpha >= beta) break;
  }

  return { score: bestScore, line: bestLine };
}

function quiescence(game, alpha, beta, ply, remainingDepth, context) {
  countNode(context);
  const terminal = getTerminalScore(game, context.color, ply);
  if (terminal !== null) return terminal;

  const inCheck = game.isCheck();
  const maximizing = game.turn() === context.color;
  const standPat = evaluate(game, context.color);
  if (remainingDepth === 0) return standPat;

  if (!inCheck) {
    if (maximizing) {
      if (standPat >= beta) return beta;
      alpha = Math.max(alpha, standPat);
    } else {
      if (standPat <= alpha) return alpha;
      beta = Math.min(beta, standPat);
    }
  }

  const legalMoves = game.moves({ verbose: true });
  if (legalMoves.length === 0) return inCheck ? -MATE_SCORE + ply : standPat;
  const moves = orderMoves(
    inCheck ? legalMoves : legalMoves.filter((move) => move.captured || move.promotion),
  );
  if (moves.length === 0) return standPat;

  let bestScore = inCheck ? (maximizing ? -Infinity : Infinity) : standPat;
  for (const move of moves) {
    game.move(toMove(move));
    let score;
    try {
      score = quiescence(game, alpha, beta, ply + 1, remainingDepth - 1, context);
    } finally {
      game.undo();
    }

    if (maximizing) {
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
    } else {
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, bestScore);
    }
    if (alpha >= beta) break;
  }
  return bestScore;
}

function getTerminalScore(game, color, ply) {
  if (game.isCheckmate()) {
    return game.turn() === color ? -MATE_SCORE + ply : MATE_SCORE - ply;
  }
  if (game.isDraw()) return 0;
  return null;
}

function checkSearchLimits(context) {
  if (context.isCancelled()) throw SEARCH_CANCELLED;
  if (context.nodes >= context.maxNodes || Date.now() >= context.deadline) {
    throw SEARCH_ABORT;
  }
}

function countNode(context) {
  context.nodes += 1;
  if ((context.nodes & 255) === 0) checkSearchLimits(context);
}

function orderMoves(moves) {
  return moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
}

function moveOrderScore(move) {
  let score = 0;
  if (move.captured) {
    score += 10000 + PIECE_VALUES[move.captured] * 10 - PIECE_VALUES[move.piece];
  }
  if (move.promotion) score += 9000 + PIECE_VALUES[move.promotion];
  if (move.flags?.includes("k") || move.flags?.includes("q")) score += 50;
  return score;
}

function evaluate(game, color) {
  const board = game.board();
  const pawnFiles = { w: Array(8).fill(0), b: Array(8).fill(0) };
  const pawns = { w: [], b: [] };
  const bishops = { w: 0, b: 0 };
  let nonPawnMaterial = 0;
  let score = 0;
  let kings = { w: null, b: null };

  board.forEach((row, rowIndex) => {
    row.forEach((piece, file) => {
      if (piece?.type === "p") {
        pawnFiles[piece.color][file] += 1;
        pawns[piece.color].push({ file, rank: 7 - rowIndex });
      }
    });
  });

  board.forEach((row, rowIndex) => {
    row.forEach((piece, file) => {
      if (!piece) return;
      const rank = 7 - rowIndex;
      const sign = piece.color === color ? 1 : -1;
      const center = 7 - (Math.abs(file - 3.5) + Math.abs(rank - 3.5));
      score += sign * PIECE_VALUES[piece.type];

      if (piece.type === "p") {
        const progress = piece.color === "w" ? rank - 1 : 6 - rank;
        score += sign * (progress * 7 + (3.5 - Math.abs(file - 3.5)) * 3);
      } else if (piece.type === "n") {
        score += sign * center * 8;
        nonPawnMaterial += PIECE_VALUES.n;
      } else if (piece.type === "b") {
        score += sign * center * 4;
        bishops[piece.color] += 1;
        nonPawnMaterial += PIECE_VALUES.b;
      } else if (piece.type === "r") {
        const ownPawnsOnFile = pawnFiles[piece.color][file];
        const allPawnsOnFile = pawnFiles.w[file] + pawnFiles.b[file];
        score += sign * (allPawnsOnFile === 0 ? 16 : ownPawnsOnFile === 0 ? 8 : 0);
        nonPawnMaterial += PIECE_VALUES.r;
      } else if (piece.type === "q") {
        score += sign * center * 2;
        nonPawnMaterial += PIECE_VALUES.q;
      } else if (piece.type === "k") {
        kings[piece.color] = { file, rank };
      }
    });
  });

  for (const side of ["w", "b"]) {
    const sign = side === color ? 1 : -1;
    const ownPawns = pawns[side];
    const enemyPawns = pawns[side === "w" ? "b" : "w"];
    if (bishops[side] >= 2) score += sign * 25;

    ownPawns.forEach(({ file, rank }) => {
      if (pawnFiles[side][file] > 1) score -= sign * 13;
      if ((pawnFiles[side][file - 1] || 0) === 0 && (pawnFiles[side][file + 1] || 0) === 0) {
        score -= sign * 12;
      }
      const passed = !enemyPawns.some(
        (enemy) =>
          Math.abs(enemy.file - file) <= 1 &&
          (side === "w" ? enemy.rank > rank : enemy.rank < rank),
      );
      if (passed) {
        const progress = side === "w" ? rank - 1 : 6 - rank;
        score += sign * (12 + progress * progress * 3);
      }
    });

    const king = kings[side];
    if (king) {
      if (nonPawnMaterial <= 2600) {
        const center = 7 - (Math.abs(king.file - 3.5) + Math.abs(king.rank - 3.5));
        score += sign * center * 7;
      } else {
        const shield = ownPawns.filter(
          (pawn) =>
            Math.abs(pawn.file - king.file) <= 1 &&
            (side === "w"
              ? pawn.rank > king.rank && pawn.rank <= king.rank + 2
              : pawn.rank < king.rank && pawn.rank >= king.rank - 2),
        ).length;
        score += sign * (shield * 8 - 12);
      }
    }
  }

  if (game.isCheck()) score += game.turn() === color ? -35 : 35;
  return score;
}

function findPlannedSacrifice(result, fen) {
  if (result.score < 550 || hashString(fen) % 4 !== 0) return null;
  return (
    result.candidates.find((candidate) => {
      if (candidate.move === result.move || PIECE_VALUES[candidate.move.piece] < 300) return false;
      if (candidate.score < Math.max(400, result.score - 130)) return false;
      const opponentTakes = candidate.line[1];
      const botReply = candidate.line[2];
      return (
        opponentTakes?.to === candidate.move.to &&
        opponentTakes.captured === candidate.move.piece &&
        botReply?.captured &&
        PIECE_VALUES[botReply.captured] >= PIECE_VALUES[candidate.move.piece] - 100
      );
    })?.move || null
  );
}

function describePlan(game, move, color, score) {
  const piece = game.get(move.from);
  if (!piece) return "Улучшить позицию и подготовить следующий ход";

  game.move(toMove(move));
  const givesCheck = game.isCheck();
  game.undo();
  if (givesCheck) return "Продолжить атаку на короля";
  if (move.promotion) return "Провести проходную пешку в ферзи";
  if (move.flags?.includes("k") || move.flags?.includes("q")) {
    return "Увести короля в безопасность и подключить ладьи";
  }
  if (move.captured) return "Разменять фигуры и сохранить позиционное преимущество";
  if (piece.type === "p") return "Укрепить центр и подготовить продвижение пешек";
  if (score > 150) return "Улучшить фигуры и постепенно усилить давление";
  if (score < -150) return "Укрепить оборону и искать контригру";
  return "Развить фигуры и бороться за центр";
}

function toMove(move) {
  const result = { from: move.from, to: move.to };
  if (move.promotion) result.promotion = move.promotion;
  return result;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
