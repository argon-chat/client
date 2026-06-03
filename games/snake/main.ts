/**
 * Snake — PlayFrame game.
 *
 * Wires the framework-agnostic Snake engine (ported from the app's
 * `useSnakeGame` composable) to the real @argon/playframe-sdk: high score is
 * persisted through `createGameStorage`. Pause is owned by the game (the engine
 * handles P/Esc and tab-hidden itself); host terminate maps to the engine.
 * Runs standalone (no host) when opened directly.
 */

import {
  PlayFrameClient,
  createGameStorage,
  isInPlayFrame,
} from "@argon/playframe-sdk";
import { createSnakeEngine } from "./engine";

const ENGINE_W = 1000;
const ENGINE_H = 680;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const loading = document.getElementById("loading");

/** Scale the fixed-resolution canvas to fit the viewport (letterboxed). */
function fitCanvas(): void {
  const scale = Math.min(window.innerWidth / ENGINE_W, window.innerHeight / ENGINE_H);
  canvas.style.width = `${ENGINE_W * scale}px`;
  canvas.style.height = `${ENGINE_H * scale}px`;
}

function start(): void {
  if (loading) loading.style.display = "none";

  fitCanvas();
  window.addEventListener("resize", fitCanvas);

  const storage = createGameStorage("snake");
  const engine = createSnakeEngine(canvas, { storage });

  if (isInPlayFrame()) {
    void connectToHost(engine);
  }
}

async function connectToHost(engine: ReturnType<typeof createSnakeEngine>): Promise<void> {
  const client = new PlayFrameClient({
    game: { id: "snake", version: "1.0.0", title: "Snake" },
    permissions: ["keyboard"],
    layout: { mode: "responsive" },
  });

  client.on("terminate", () => engine.destroy());

  try {
    const ctx = await client.connect();
    client.log("info", "Snake connected", { space: ctx.space?.name });
    // Solo game: advertise non-joinable presence so the channel shows it as such.
    client.updateSession({
      state: "playing",
      mode: "solo",
      joinable: false,
      spectatable: false, // no netcode → not watchable
      playerCount: 1,
      maxPlayers: 1,
    });
  } catch (e) {
    console.warn("[snake] PlayFrame connect failed, running standalone:", e);
  }
}

start();
