/**
 * Local SDK/SFU encoder comparison, without a camera, microphone or production load.
 * bun scripts/benchmark-vp9.ts [output.json] [sample-seconds]
 * Start LiveKit >=1.13.7 locally on port 17980. Its config must include:
 *   bind_addresses: [127.0.0.1]
 *   rtc: { node_ip: 127.0.0.1, enable_loopback_candidate: true,
 *          tcp_port: 17981, udp_port: 17982, use_external_ip: false }
 *   keys: { benchmark: local-benchmark-secret-at-least-32-characters }
 * Set VP9_BENCH_URL, VP9_BENCH_KEY and VP9_BENCH_SECRET to override defaults.
 * The room has two synthetic participants and is disconnected after each sample.
 *
 * Compares our current camera L3T3_KEY / screen L1T3 with three VP9 simulcast
 * encodings (L1T3 each), using the same synthetic source and aggregate bitrate cap.
 * This measures browser encoding cost through an SFU, not adaptation or visual quality.
 * Low-quality-only and real screen readability still need a multi-client SFU test.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHmac } from "node:crypto";

const output = process.argv[2] ?? ".temp/vp9-comparison.json";
const seconds = Number(process.argv[3] ?? 8);
if (!Number.isFinite(seconds) || seconds < 3 || seconds > 60) {
  throw new Error("sample-seconds must be between 3 and 60");
}
const url = process.env.VP9_BENCH_URL ?? "ws://127.0.0.1:17980";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("This benchmark only accepts a local SFU");
}
const key = process.env.VP9_BENCH_KEY ?? "benchmark";
const secret = process.env.VP9_BENCH_SECRET ?? "local-benchmark-secret-at-least-32-characters";
function token(room: string, identity: string) {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const data = enc({ alg: "HS256", typ: "JWT" }) + "." + enc({
    iss: key, sub: identity, nbf: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 600,
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
  });
  return data + "." + createHmac("sha256", secret).update(data).digest("base64url");
}
const browser = await chromium.launch({ headless: true, args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
try {
  const page = await browser.newPage();
  await page.goto(url.replace(/^ws/, "http"));
  await page.addScriptTag({ path: resolve("node_modules/livekit-client/dist/livekit-client.umd.js") });
  const results = [];
  for (const source of ["camera", "screen"] as const) {
    // Reverse the order for screen content to reduce ordering bias.
    for (const mode of source === "camera" ? ["svc", "simulcast"] : ["simulcast", "svc"]) {
      console.log(`Sampling ${source} / ${mode} (${seconds}s)…`);
      const roomName = `vp9-benchmark-${Date.now()}`;
      const publisherToken = token(roomName, "publisher");
      const subscriberToken = token(roomName, "subscriber");
      const result = await page.evaluate(async ({ source, mode, seconds, url, publisherToken, subscriberToken }) => {
        const sdk = (window as any).LivekitClient;
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d")!;
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = "#152033";
          ctx.fillRect(0, 0, 1280, 720);
          if (source === "screen") {
            ctx.font = "18px monospace";
            for (let y = 28; y < 720; y += 28) {
              ctx.fillStyle = y % 56 ? "#ffffff" : "#70d6ff";
              ctx.fillText(`function render_${y}() { return value + ${Math.floor(frame / 30)}; }`, 24, y);
            }
            ctx.fillStyle = "#f7b733";
            ctx.fillRect((frame * 7) % 1200, 350, 50, 24);
          } else {
            for (let i = 0; i < 60; i++) {
              ctx.fillStyle = `hsl(${(i * 23 + frame) % 360} 60% 50%)`;
              ctx.beginPath();
              ctx.arc((i * 137 + frame * (i % 5 + 1)) % 1280,
                (i * 91 + Math.sin(frame / 30 + i) * 80 + 720) % 720, 35, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          frame++;
        };
        draw();
        const timer = setInterval(draw, 1000 / 30);
        const stream = canvas.captureStream(30);
        const track = stream.getVideoTracks()[0]!;
        track.contentHint = source === "screen" ? "detail" : "motion";
        const publisher = new sdk.Room({ dynacast: false, adaptiveStream: false });
        const subscriber = new sdk.Room({ adaptiveStream: false });
        const video = document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        document.body.append(video);
        subscriber.on(sdk.RoomEvent.TrackSubscribed, (remote: any) => { remote.attach(video); });
        const cap = source === "screen" ? 5_000_000 : 1_700_000;
        let local: any;
        try {
          await publisher.connect(url, publisherToken);
          await subscriber.connect(url, subscriberToken);
          local = new sdk.LocalVideoTrack(track);
          local.source = source === "screen" ? sdk.Track.Source.ScreenShare : sdk.Track.Source.Camera;
          await publisher.localParticipant.publishTrack(local, {
            videoCodec: "vp9", backupCodec: false, simulcast: mode === "simulcast",
            scalabilityMode: mode === "simulcast" || source === "screen" ? "L1T3" : "L3T3_KEY",
            videoEncoding: { maxBitrate: mode === "simulcast" ? Math.round(cap * 0.65) : cap, maxFramerate: 30 },
            screenShareEncoding: { maxBitrate: mode === "simulcast" ? Math.round(cap * 0.65) : cap, maxFramerate: 30 },
            videoSimulcastLayers: [
              { width: 320, height: 180, encoding: { maxBitrate: Math.round(cap * 0.1), maxFramerate: 30 } },
              { width: 640, height: 360, encoding: { maxBitrate: Math.round(cap * 0.25), maxFramerate: 30 } },
            ],
            screenShareSimulcastLayers: [
              { width: 320, height: 180, encoding: { maxBitrate: Math.round(cap * 0.1), maxFramerate: 30 } },
              { width: 640, height: 360, encoding: { maxBitrate: Math.round(cap * 0.25), maxFramerate: 30 } },
            ],
          });
          const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
          const negotiated = local.sender.getParameters().encodings;
          if (mode === "simulcast" && negotiated.length !== 3) {
            throw new Error(`Invalid comparison: negotiated ${negotiated.length} of 3 simulcast encodings`);
          }
          if (mode === "svc" && negotiated.length !== 1) throw new Error("SVC must use one encoding");
          await wait(4000);
          const sample = async () => {
            const stats: RTCStatsReport = await local.sender.getStats();
            const rows: Record<string, any>[] = [];
            stats.forEach((row) => { if (row.type === "outbound-rtp" && row.kind === "video") rows.push(row); });
            return rows;
          };
          const before = await sample();
          await wait(seconds * 1000);
          const after = await sample();
          const layers = after.map((row) => {
            const start = before.find((b) => b.id === row.id);
            const frames = row.framesEncoded - (start?.framesEncoded ?? 0);
            const elapsed = (row.timestamp - (start?.timestamp ?? row.timestamp - seconds * 1000)) / 1000;
            return {
              rid: row.rid ?? null, codec: row.codecId, scalabilityMode: row.scalabilityMode,
              width: row.frameWidth, height: row.frameHeight, frames,
              // For SVC this counts spatial-layer frames, not source frames.
              encodedFramesPerSecond: frames / elapsed,
              bitrateKbps: 8 * (row.bytesSent - (start?.bytesSent ?? 0)) / elapsed / 1000,
              encodeMs: 1000 * (row.totalEncodeTime - (start?.totalEncodeTime ?? 0)),
              qualityLimitationReason: row.qualityLimitationReason,
              encoder: row.encoderImplementation,
            };
          });
          return {
            source, mode, layers, sourceFrames: frame,
            serverVersion: publisher.engine.serverVersion,
            configuredAggregateCap: cap,
            totalBitrateKbps: layers.reduce((sum, layer) => sum + layer.bitrateKbps, 0),
            encodeMsPerSecond: layers.reduce((sum, layer) => sum + layer.encodeMs, 0) / seconds,
            negotiatedEncodings: local.sender.getParameters().encodings,
          };
        } finally {
          clearInterval(timer);
          await publisher.disconnect();
          await subscriber.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          video.remove();
        }
      }, { source, mode, seconds, url, publisherToken, subscriberToken });
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, JSON.stringify({
    measuredAt: new Date().toISOString(), browser: browser.version(),
    platform: process.platform, arch: process.arch, sdkVersion: JSON.parse(await Bun.file("node_modules/livekit-client/package.json").text()).version, seconds, width: 1280, height: 720,
    scope: "Synthetic source, local SDK/SFU, all layers active. Not congestion adaptation or visual quality.",
    results,
  }, null, 2) + "\n");
  console.log(`Saved ${output}`);
} finally {
  await browser.close();
}
