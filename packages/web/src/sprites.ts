// Pixel art role icons using CSS box-shadow pixel technique
// Each "pixel" is a 4x4 box-shadow

type PixelColor = string;
type PixelGrid = (PixelColor | null)[][];

const G = '#00ff41'; // green
const D = '#00cc33'; // dark green
const A = '#ffb000'; // amber
const C = '#00e5ff'; // cyan
const R = '#ff3333'; // red
const P = '#b388ff'; // purple
const W = '#cccccc'; // white/gray
const _ = null;     // transparent

// 8x8 pixel art for each role
const sprites: Record<string, PixelGrid> = {
  coder: [
    [_, _, G, G, G, G, _, _],
    [_, G, D, D, D, D, G, _],
    [G, D, G, D, D, G, D, G],
    [G, D, D, D, D, D, D, G],
    [_, G, D, G, G, D, G, _],
    [_, _, G, D, D, G, _, _],
    [_, G, G, G, G, G, G, _],
    [G, G, _, G, G, _, G, G],
  ],
  reviewer: [
    [_, _, C, C, C, C, _, _],
    [_, C, W, W, W, W, C, _],
    [C, W, C, W, W, C, W, C],
    [C, W, W, W, W, W, W, C],
    [_, C, W, W, W, W, C, _],
    [_, _, C, C, C, C, _, _],
    [_, _, C, _, _, C, _, _],
    [_, C, C, C, C, C, C, _],
  ],
  researcher: [
    [_, _, A, A, A, A, _, _],
    [_, A, _, _, _, _, A, _],
    [A, _, A, _, _, A, _, A],
    [A, _, _, _, _, _, _, A],
    [_, A, _, _, _, _, A, _],
    [_, _, A, A, A, A, _, _],
    [_, _, _, A, A, _, _, _],
    [_, _, A, A, A, A, _, _],
  ],
  architect: [
    [_, _, _, P, P, _, _, _],
    [_, _, P, P, P, P, _, _],
    [_, P, P, W, W, P, P, _],
    [_, P, W, P, P, W, P, _],
    [P, P, P, P, P, P, P, P],
    [_, _, P, P, P, P, _, _],
    [_, P, P, _, _, P, P, _],
    [P, P, _, _, _, _, P, P],
  ],
  foreman: [
    [_, R, R, R, R, R, R, _],
    [R, R, R, R, R, R, R, R],
    [R, _, R, R, R, R, _, R],
    [_, _, R, R, R, R, _, _],
    [_, _, _, R, R, _, _, _],
    [_, _, R, R, R, R, _, _],
    [_, R, R, _, _, R, R, _],
    [R, R, _, _, _, _, R, R],
  ],
};

export function getSpriteCSS(role: string, pixelSize: number = 4): string {
  const grid = sprites[role];
  if (!grid) return '';

  const shadows: string[] = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const color = grid[y][x];
      if (color) {
        shadows.push(`${x * pixelSize}px ${y * pixelSize}px 0 0 ${color}`);
      }
    }
  }
  return shadows.join(', ');
}

export function getSpriteDimensions(pixelSize: number = 4): { width: number; height: number } {
  return { width: 8 * pixelSize, height: 8 * pixelSize };
}
