/**
 * Share cards drawn in the browser: a 1080x1350 PNG with a title, a 100-square
 * grid and a list of rows, for Pick'em sheets and parlays. Uses the phone's
 * share sheet when it can take files, otherwise downloads the image.
 */
export type ShareCard = {
  eyebrow: string;
  title: string;
  /** Squares out of 100 to fill, and the caption beside the grid. */
  grid?: { wins: number; caption: string };
  rows: Array<{ left: string; right: string }>;
  footer: string;
};

const W = 1080;
const H = 1350;
const BG = '#11151f';
const INK = '#f4f5f8';
const MUTED = '#9aa3b5';
const ACCENT = '#ff7a2f';
const EMPTY = '#2a3142';
const DISPLAY = "600 {size}px 'Barlow Condensed', 'Arial Narrow', sans-serif";
const font = (size: number) => DISPLAY.replace('{size}', String(size));

export function drawShareCard(card: ShareCard) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 12);

  let y = 110;
  ctx.fillStyle = MUTED;
  ctx.font = font(34);
  ctx.fillText(card.eyebrow.toUpperCase(), 72, y);
  y += 76;
  ctx.fillStyle = INK;
  ctx.font = font(72);
  ctx.fillText(card.title, 72, y);
  y += 60;

  if (card.grid) {
    const cell = 30;
    const gap = 6;
    for (let index = 0; index < 100; index += 1) {
      ctx.fillStyle = index < card.grid.wins ? ACCENT : EMPTY;
      ctx.fillRect(72 + (index % 10) * (cell + gap), y + Math.floor(index / 10) * (cell + gap), cell, cell);
    }
    ctx.fillStyle = INK;
    ctx.font = font(120);
    ctx.fillText(String(card.grid.wins), 480, y + 150);
    ctx.fillStyle = MUTED;
    ctx.font = font(36);
    ctx.fillText(card.grid.caption, 480, y + 205);
    y += 10 * (cell + gap) + 60;
  }

  const rowHeight = Math.min(64, Math.floor((H - 140 - y) / Math.max(1, card.rows.length)));
  ctx.font = font(Math.max(26, Math.round(rowHeight * 0.6)));
  for (const row of card.rows) {
    ctx.fillStyle = INK;
    ctx.fillText(row.left, 72, y, 760);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(row.right, W - 72, y);
    ctx.textAlign = 'left';
    y += rowHeight;
  }

  ctx.fillStyle = ACCENT;
  ctx.font = font(36);
  ctx.fillText(card.footer, 72, H - 72);
  return canvas;
}

export async function shareCardImage(card: ShareCard, filename: string) {
  const canvas = drawShareCard(card);
  if (!canvas) return;
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.title });
      return;
    } catch {
      // Cancelled or refused: fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
