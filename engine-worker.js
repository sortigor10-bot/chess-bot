import { chooseMove } from "./chess-engine.js";

let searchGeneration = 0;

self.postMessage({ type: "ready" });
self.addEventListener("message", async ({ data }) => {
  if (data.type === "cancel") {
    searchGeneration += 1;
    return;
  }
  if (data.type !== "search") return;

  const generation = ++searchGeneration;
  try {
    const result = await chooseMove(data.fen, data.color, (progress) => {
      self.postMessage({ type: "progress", id: data.id, ...progress });
    }, () => generation !== searchGeneration);
    if (generation !== searchGeneration || result.cancelled) return;
    self.postMessage({ type: "bestmove", id: data.id, result });
  } catch (error) {
    if (generation !== searchGeneration) return;
    self.postMessage({
      type: "error",
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
