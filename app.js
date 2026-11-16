import { Chess } from "https://esm.sh/chess.js@1.4.0";

const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const FILES = "abcdefgh";

const game = new Chess();
const boardElement = document.querySelector("#board");
const welcomeScreen = document.querySelector("#welcome-screen");
const sideScreen = document.querySelector("#side-screen");
const gameScreen = document.querySelector("#game-screen");
const playButton = document.querySelector("#play-button");
const backButton = document.querySelector("#back-button");
const exitGameButton = document.querySelector("#exit-game");
const engineDot = document.querySelector("#engine-dot");
const engineState = document.querySelector("#engine-state");
const gameStatus = document.querySelector("#game-status");
const statusSubtitle = document.querySelector("#status-subtitle");
const boardResult = document.querySelector("#board-result");
const boardResultMark = document.querySelector("#board-result-mark");
const boardResultTitle = document.querySelector("#board-result-title");
const boardResultSubtitle = document.querySelector("#board-result-subtitle");
const viewBoardButton = document.querySelector("#view-board-button");
const turnIndicator = document.querySelector("#turn-indicator");
const moveList = document.querySelector("#move-list");
const moveCount = document.querySelector("#move-count");

let botColor = "w";
let gameStarted = false;
let selectedSquare = null;
let lastMove = null;
let pendingAnimation = null;
let lastBotPlan = "";
let isEngineReady = false;
let isThinking = false;
let nextSearchId = 0;
let activeSearchId = null;
let workerReadyTimer = null;
let resultRevealTimer = null;
let pendingCheckmateFen = null;

const engineWorker = new Worker(new URL("./engine-worker.js", import.meta.url), {
  type: "module",
});

engineWorker.addEventListener("message", ({ data }) => {
  if (data.type === "ready") {
    window.clearTimeout(workerReadyTimer);
    isEngineReady = true;
    engineDot.classList.remove("error");
    engineDot.classList.add("ready");
    engineState.textContent = "Бот готов";
    render();
    if (gameStarted) requestEngineMove();
    return;
  }
  if (data.type === "progress") {
    if (data.id === activeSearchId && gameStarted && isThinking) {
      gameStatus.textContent = `Бот думает… · глубина ${data.depth}`;
      statusSubtitle.textContent = `Оценено позиций: ${data.nodes}`;
    }
    return;
  }
  if (data.type === "bestmove") {
    if (data.id !== activeSearchId || !gameStarted) return;
    finishSearch(data.result);
    return;
  }
  if (data.type === "error") {
    if (data.id !== activeSearchId || !gameStarted) return;
    activeSearchId = null;
    isThinking = false;
    gameStatus.textContent = "Ошибка при расчёте хода";
    statusSubtitle.textContent = data.message;
    updateControls();
  }
});

engineWorker.addEventListener("error", (event) => {
  window.clearTimeout(workerReadyTimer);
  isThinking = false;
  engineDot.classList.remove("ready");
  engineDot.classList.add("error");
  engineState.textContent = "Ошибка бота";
  gameStatus.textContent = "Не удалось запустить бота";
  statusSubtitle.textContent =
    event.message || "Проверьте подключение к интернету и перезагрузите страницу";
  turnIndicator.classList.add("error");
  updateControls();
});

workerReadyTimer = window.setTimeout(() => {
  if (!isEngineReady) {
    engineDot.classList.add("error");
    engineState.textContent = "Бот не отвечает";
    gameStatus.textContent = "Не удалось загрузить бота";
    statusSubtitle.textContent = "Проверьте подключение к интернету и перезагрузите страницу";
    updateControls();
  }
}, 20000);

playButton.addEventListener("click", () => {
  welcomeScreen.hidden = true;
  sideScreen.hidden = false;
});

backButton.addEventListener("click", () => {
  sideScreen.hidden = true;
  welcomeScreen.hidden = false;
});

document.querySelectorAll("[data-bot-color]").forEach((button) => {
  button.addEventListener("click", () => startGame(button.dataset.botColor));
});

exitGameButton.addEventListener("click", exitGame);
viewBoardButton.addEventListener("click", () => {
  boardResult.hidden = true;
});

function startGame(color) {
  botColor = color;
  gameStarted = true;
  welcomeScreen.hidden = true;
  sideScreen.hidden = true;
  gameScreen.hidden = false;
  document.querySelector("#bot-color-label").textContent =
    botColor === "w" ? "Белыми" : "Чёрными";
  game.reset();
  resetBoardResult();
  selectedSquare = null;
  lastMove = null;
  pendingAnimation = null;
  lastBotPlan = "";
  render();
  requestEngineMove();
}

function exitGame() {
  if (isThinking) engineWorker.postMessage({ type: "cancel" });
  activeSearchId = null;
  isThinking = false;
  gameStarted = false;
  game.reset();
  resetBoardResult();
  selectedSquare = null;
  lastMove = null;
  pendingAnimation = null;
  lastBotPlan = "";
  gameScreen.hidden = true;
  sideScreen.hidden = true;
  welcomeScreen.hidden = false;
  render();
}

function render() {
  renderBoard();
  renderStatus();
  renderMoves();
  updateControls();
}

function renderBoard() {
  const previousRects = new Map(
    Array.from(boardElement.querySelectorAll(".square"), (square) => [
      square.dataset.square,
      square.getBoundingClientRect(),
    ]),
  );
  boardElement.replaceChildren();
  const board = game.board();
  const rows = botColor === "w" ? board : [...board].reverse().map((row) => [...row].reverse());
  const checkmatedColor = game.isCheckmate() ? game.turn() : null;
  const opponentColor = botColor === "w" ? "b" : "w";
  const legalTargets = new Map();
  if (selectedSquare && game.turn() === opponentColor && game.get(selectedSquare)?.color === opponentColor) {
    game.moves({ square: selectedSquare, verbose: true }).forEach((move) => {
      legalTargets.set(move.to, Boolean(move.captured));
    });
  }

  rows.forEach((row, rowIndex) => {
    row.forEach((piece, columnIndex) => {
      const fileIndex = botColor === "w" ? columnIndex : 7 - columnIndex;
      const rankIndex = botColor === "w" ? 7 - rowIndex : rowIndex;
      const squareName = `${FILES[fileIndex]}${rankIndex + 1}`;
      const isLight = (fileIndex + rankIndex) % 2 === 1;
      const square = document.createElement("button");
      square.type = "button";
      square.className = `square ${isLight ? "light" : "dark"}`;
      square.dataset.square = squareName;
      square.setAttribute("role", "gridcell");
      square.setAttribute(
        "aria-label",
        piece
          ? `${squareName}, ${piece.color === "w" ? "белая" : "чёрная"} фигура ${piece.type}`
          : squareName,
      );
      if (piece?.type === "k" && piece.color === checkmatedColor) {
        square.classList.add("king-checkmated");
      }
      if (lastMove?.from === squareName || lastMove?.to === squareName) {
        square.classList.add("last-move");
      }
      if (selectedSquare === squareName) square.classList.add("selected");
      if (legalTargets.has(squareName)) {
        square.classList.add("legal-move");
        if (legalTargets.get(squareName)) square.classList.add("legal-capture");
      }
      let movedPieceElement = null;
      if (piece) {
        const pieceElement = document.createElement("span");
        pieceElement.className = `piece ${piece.color === "w" ? "white" : "black"}`;
        pieceElement.textContent = PIECES[piece.color][piece.type];
        pieceElement.setAttribute("aria-hidden", "true");
        square.append(pieceElement);
        movedPieceElement = pieceElement;
      }
      if (columnIndex === 0) {
        const rank = document.createElement("span");
        rank.className = "coordinate rank";
        rank.textContent = squareName[1];
        square.append(rank);
      }
      if (rowIndex === 7) {
        const file = document.createElement("span");
        file.className = "coordinate file";
        file.textContent = squareName[0];
        square.append(file);
      }
      square.addEventListener("click", () => handleSquareClick(squareName));
      boardElement.append(square);
      if (pendingAnimation?.to === squareName) {
        const fromRect = previousRects.get(pendingAnimation.from);
        const toRect = square.getBoundingClientRect();
        if (fromRect && movedPieceElement && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const deltaX = fromRect.left - toRect.left;
          const deltaY = fromRect.top - toRect.top;
          const lift = piece.type === "p" ? -12 : -6;
          movedPieceElement.animate(
            [
              { transform: `translate(${deltaX}px, ${deltaY}px) scale(0.92)`, opacity: 0.7 },
              {
                transform: `translate(${deltaX * 0.38}px, ${deltaY * 0.38}px) translateY(${lift}px) scale(1.06)`,
                opacity: 1,
              },
              { transform: "translate(0, 0) scale(1)", opacity: 1 },
            ],
            { duration: 480, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
          );
        }
        pendingAnimation = null;
      }
    });
  });
}

function renderStatus() {
  document.querySelector("#player-label").textContent =
    botColor === "w" ? "Бот · белые" : "Бот · чёрные";
  document.querySelector("#opponent-label").textContent =
    botColor === "w" ? "Соперник · чёрные" : "Соперник · белые";

  turnIndicator.classList.toggle(
    "ready",
    game.turn() !== botColor && isEngineReady && !game.isGameOver(),
  );
  turnIndicator.classList.toggle("error", !isEngineReady && engineDot.classList.contains("error"));

  if (game.isCheckmate()) {
    const botWon = game.turn() !== botColor;
    scheduleCheckmateResult(
      game.fen(),
      botWon ? "win" : "loss",
      botWon ? "ПОБЕДА БОТА!" : "ПОРАЖЕНИЕ БОТА",
      botWon ? "Бот поставил мат" : "Соперник поставил мат",
      botWon ? "♛" : "♟",
    );
    gameStatus.textContent = "Партия завершена";
    statusSubtitle.textContent = "Результат появится через 2 секунды";
  } else if (game.isStalemate()) {
    showBoardResult(
      "draw",
      "ПАТ",
      game.turn() === botColor
        ? "Бот не под шахом, но не может сделать ход"
        : "Соперник не под шахом, но не может сделать ход",
      "½",
    );
    gameStatus.textContent = "Партия завершена";
    statusSubtitle.textContent = "Результат показан на доске";
  } else if (game.isDraw()) {
    showBoardResult("draw", "НИЧЬЯ", "Партия завершена вничью", "½");
    gameStatus.textContent = "Партия завершена";
    statusSubtitle.textContent = "Результат показан на доске";
  } else if (isThinking) {
    gameStatus.textContent = "Бот обдумывает ход…";
    statusSubtitle.textContent = "Оценивает позицию и строит план";
  } else if (!isEngineReady) {
    gameStatus.textContent = "Загружаю бота…";
    statusSubtitle.textContent = "Первый запуск может занять несколько секунд";
  } else if (game.turn() === botColor) {
    gameStatus.textContent = "Ход бота";
    statusSubtitle.textContent = "Бот готовит ход";
  } else {
    gameStatus.textContent = game.isCheck() ? "Шах боту — ход соперника" : "Ход соперника";
    statusSubtitle.textContent = lastBotPlan
      ? `План бота: ${lastBotPlan}. Покажите следующий ход.`
      : "Покажите ход кликами по клеткам";
  }
}

function showBoardResult(kind, title, subtitle, mark) {
  boardResult.hidden = false;
  boardResult.className = `board-result result-${kind}`;
  viewBoardButton.hidden = kind !== "win" && kind !== "loss";
  boardResultMark.textContent = mark;
  boardResultTitle.textContent = title;
  boardResultSubtitle.textContent = subtitle;
}

function scheduleCheckmateResult(fen, kind, title, subtitle, mark) {
  if (pendingCheckmateFen === fen) return;
  pendingCheckmateFen = fen;
  boardResult.hidden = true;
  viewBoardButton.hidden = true;
  resultRevealTimer = window.setTimeout(() => {
    resultRevealTimer = null;
    if (!gameStarted || !game.isCheckmate() || game.fen() !== fen) return;
    showBoardResult(kind, title, subtitle, mark);
    statusSubtitle.textContent = "Результат показан на доске";
  }, 2000);
}

function resetBoardResult() {
  if (resultRevealTimer !== null) {
    window.clearTimeout(resultRevealTimer);
    resultRevealTimer = null;
  }
  pendingCheckmateFen = null;
  boardResult.hidden = true;
  boardResult.className = "board-result";
  viewBoardButton.hidden = true;
}

function renderMoves() {
  const history = game.history();
  const rows = [];
  for (let index = 0; index < history.length; index += 2) {
    rows.push({ number: index / 2 + 1, white: history[index], black: history[index + 1] || "" });
  }
  moveList.replaceChildren();
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-moves";
    empty.textContent = "Пока нет ходов";
    moveList.append(empty);
  } else {
    rows.forEach((row) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = `${row.number}.`;
      const whiteMove = document.createElement("span");
      whiteMove.textContent = row.white;
      const blackMove = document.createElement("span");
      blackMove.textContent = row.black;
      item.append(number, whiteMove, blackMove);
      moveList.append(item);
    });
  }
  moveCount.textContent = `${rows.length} ${pluralize(rows.length, "ход", "хода", "ходов")}`;
}

function pluralize(number, one, few, many) {
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function updateControls() {
  boardElement.setAttribute("aria-busy", String(isThinking));
}

function handleSquareClick(square) {
  const opponentColor = botColor === "w" ? "b" : "w";
  if (
    !gameStarted ||
    !isEngineReady ||
    isThinking ||
    game.turn() !== opponentColor ||
    game.isGameOver()
  ) {
    return;
  }

  const piece = game.get(square);
  if (selectedSquare && makeOpponentMove(selectedSquare, square)) return;
  selectedSquare = piece?.color === opponentColor ? square : null;
  renderBoard();
}

function makeOpponentMove(from, to) {
  const legalMove = game.moves({ verbose: true }).find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  if (!legalMove) return false;
  const move = game.move({
    from,
    to,
    promotion: legalMove.promotion ? "q" : undefined,
  });
  if (!move) return false;
  selectedSquare = null;
  lastMove = { from: move.from, to: move.to };
  pendingAnimation = { from: move.from, to: move.to };
  lastBotPlan = "";
  render();
  requestEngineMove();
  return true;
}

function requestEngineMove() {
  if (!gameStarted || !isEngineReady || isThinking || game.turn() !== botColor || game.isGameOver()) {
    return;
  }
  isThinking = true;
  activeSearchId = ++nextSearchId;
  engineWorker.postMessage({
    type: "search",
    id: activeSearchId,
    fen: game.fen(),
    color: botColor,
  });
  renderStatus();
  updateControls();
}

function finishSearch(result) {
  if (!gameStarted || !isThinking) return;
  activeSearchId = null;
  isThinking = false;
  if (!result?.move) {
    render();
    return;
  }

  const move = game.moves({ verbose: true }).find(
    (candidate) =>
      candidate.from === result.move.from &&
      candidate.to === result.move.to &&
      (candidate.promotion || "") === (result.move.promotion || ""),
  );
  if (!move) {
    gameStatus.textContent = "Бот выбрал некорректный ход";
    statusSubtitle.textContent = "Начните новую партию и попробуйте ещё раз";
    updateControls();
    return;
  }

  const played = game.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  lastMove = { from: played.from, to: played.to };
  pendingAnimation = { from: played.from, to: played.to };
  lastBotPlan = result.plan;
  render();
}

render();
