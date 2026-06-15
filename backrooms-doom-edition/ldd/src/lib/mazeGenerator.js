// ============================================================================
//  Maze + rooms generator for the Backrooms.
//  Starts from a perfect maze (recursive backtracker) then carves open rooms
//  and extra openings so the result reads like the Backrooms — large yellow
//  rooms studded with pillars and connected by corridors — rather than a thin
//  hedge maze. Removing walls from a connected maze can never disconnect it,
//  so every layout stays fully solvable.
// ============================================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateMaze(width, height) {
  const w = width % 2 === 0 ? width + 1 : width;
  const h = height % 2 === 0 ? height + 1 : height;

  const grid = Array.from({ length: h }, () => Array(w).fill(1));
  const visited = Array.from({ length: h }, () => Array(w).fill(false));

  // ---- perfect maze via iterative backtracker (no deep recursion) --------
  const stack = [[1, 1]];
  visited[1][1] = true;
  grid[1][1] = 0;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = shuffle([[0, -2], [0, 2], [-2, 0], [2, 0]]);
    let advanced = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 0;
        grid[ny][nx] = 0;
        visited[ny][nx] = true;
        stack.push([nx, ny]);
        advanced = true;
        break;
      }
    }
    if (!advanced) stack.pop();
  }

  // ---- carve open rooms --------------------------------------------------
  const area = w * h;
  const roomCount = Math.max(3, Math.floor(area / 120));
  for (let i = 0; i < roomCount; i++) {
    const rw = 3 + ((Math.random() * 3) | 0);       // 3..5 wide
    const rh = 3 + ((Math.random() * 3) | 0);       // 3..5 tall
    const rx = 1 + ((Math.random() * (w - rw - 2)) | 0);
    const ry = 1 + ((Math.random() * (h - rh - 2)) | 0);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        // Pillars only in the STRICT interior (never on the room border), so the
        // room always keeps a fully-open perimeter ring and can't sever a path.
        const interior = x > rx && x < rx + rw - 1 && y > ry && y < ry + rh - 1;
        const pillar = interior && (x - rx) % 2 === 1 && (y - ry) % 2 === 1 && Math.random() < 0.5;
        grid[y][x] = pillar ? 1 : 0;
      }
    }
  }

  // ---- punch extra openings so corridors form loops (less claustrophobic,
  //      more "endless open space") ---------------------------------------
  const extraOpenings = Math.floor(area / 60);
  for (let i = 0; i < extraOpenings; i++) {
    const x = 1 + ((Math.random() * (w - 2)) | 0);
    const y = 1 + ((Math.random() * (h - 2)) | 0);
    if (grid[y][x] === 1) {
      // only remove a wall that has open space on opposite sides (keeps structure sane)
      const horiz = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
      const vert = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
      if (horiz || vert) grid[y][x] = 0;
    }
  }

  // ---- start + exit ------------------------------------------------------
  grid[1][1] = 0; grid[1][2] = 0; grid[2][1] = 0;
  const playerStart = { x: 1.5, y: 1.5 };

  const exitPos = { x: w - 2, y: h - 2 };
  grid[h - 2][w - 2] = 0;
  grid[h - 3][w - 2] = 0;
  grid[h - 2][w - 3] = 0;
  grid[h - 3][w - 3] = 0;

  return { grid, width: w, height: h, playerStart, exitPos };
}

// Find a random empty cell at least minDist from a given point.
export function findRandomEmptyCell(grid, excludeX, excludeY, minDist = 5) {
  const cells = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === 0) {
        const dist = Math.sqrt((x - excludeX) ** 2 + (y - excludeY) ** 2);
        if (dist >= minDist) cells.push({ x, y });
      }
    }
  }
  if (cells.length === 0) return { x: excludeX + 3, y: excludeY };
  return cells[(Math.random() * cells.length) | 0];
}
