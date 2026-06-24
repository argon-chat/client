/**
 * Renders the Windows taskbar overlay-icon badge as a PNG data URL.
 *
 * The overlay icon is the small image Windows composites onto the bottom-right of the taskbar
 * button, so the whole image *is* the badge. We draw it in the renderer (where a canvas exists)
 * and hand the data URL to the host, which sets it via BrowserWindow.setOverlayIcon.
 *
 *  • count > 0           → solid red circle with the number ("9+" past nine)
 *  • count 0, hasUnread  → small red dot (something unread, but nothing pinging you)
 *  • otherwise           → null (clear the overlay)
 */
export function renderOverlayBadge(count: number, hasUnread: boolean): string | null {
  if (count <= 0 && !hasUnread) return null;

  const size = 32; // generous so Windows can scale the tiny overlay slot down crisply
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const red = "#ed4245";

  if (count > 0) {
    const label = count > 9 ? "9+" : String(count);
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${label.length > 1 ? 17 : 22}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, size / 2, size / 2 + 1);
  } else {
    // Unread, but no specific ping count — just a dot.
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL("image/png");
}
