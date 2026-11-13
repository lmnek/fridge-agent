"""Levná analýza snímků bez AI: jas a místa, kde se něco změnilo.

Používá se ke dvěma věcem:
1. Poznat, jestli jsou dveře otevřené (rozsvícené světlo = vysoký jas),
   a hlídat, jestli nezůstaly otevřené moc dlouho.
2. Najít oblasti, kde se oproti minulému snímku něco pohnulo. Inventář pak
   odebere jen věci, které v té oblasti stály, a ne všechno, co model zrovna
   přehlédl.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from ..schemas import BBox

GRID_W, GRID_H = 64, 40


def to_gray(jpeg: bytes, size: tuple[int, int] = (GRID_W, GRID_H)) -> np.ndarray:
    with Image.open(io.BytesIO(jpeg)) as img:
        small = img.convert("L").resize(size, Image.Resampling.BILINEAR)
        return np.asarray(small, dtype=np.float32) / 255.0


def to_rgb(jpeg: bytes, size: tuple[int, int] = (GRID_W, GRID_H)) -> np.ndarray:
    with Image.open(io.BytesIO(jpeg)) as img:
        small = img.convert("RGB").resize(size, Image.Resampling.BOX)
        return np.asarray(small, dtype=np.float32) / 255.0


def brightness(jpeg: bytes) -> float:
    return float(to_gray(jpeg).mean())


def changed_regions(
    prev_jpeg: bytes | None,
    new_jpeg: bytes,
    *,
    threshold: float = 0.08,
    min_cells: int = 4,
    strong: float = 0.3,
    min_strong_cells: int = 2,
) -> list[BBox]:
    """Vrátí obdélníky (normalizované 0..1), kde se snímky liší.

    Snímky se nejdřív srovnají na stejný průměrný jas, aby změna osvětlení
    (otevřené dveře, ranní slunce) nevypadala jako pohyb všech věcí.
    Malá oblast (česnek, úzká lahev kefíru) stačí, když je změna v ní výrazná (`strong`).
    """
    if prev_jpeg is None:
        return []
    a, b = to_rgb(prev_jpeg), to_rgb(new_jpeg)
    a = a - a.mean(axis=(0, 1)) + b.mean(axis=(0, 1))
    # barevně, ne v odstínech šedi: oranžový džus a prázdná lahev mají skoro stejný jas
    diff = np.abs(a - b).max(axis=2)
    mask = diff > threshold
    if mask.sum() < min_strong_cells:
        return []
    return _components(mask, diff, min_cells=min_cells, strong=strong, min_strong_cells=min_strong_cells)


def _components(
    mask: np.ndarray, diff: np.ndarray, *, min_cells: int, strong: float, min_strong_cells: int
) -> list[BBox]:
    """Spojité oblasti v masce (4-sousedství) -> obalové obdélníky."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    boxes: list[BBox] = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            ys, xs = [], []
            while stack:
                cy, cx = stack.pop()
                ys.append(cy)
                xs.append(cx)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(ys) < min_cells and not (len(ys) >= min_strong_cells and diff[ys, xs].max() >= strong):
                continue
            x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
            boxes.append(BBox(x=x0 / w, y=y0 / h, w=(x1 - x0) / w, h=(y1 - y0) / h))
    return _merge(boxes)


def _merge(boxes: list[BBox], gap: float = 0.02) -> list[BBox]:
    merged = list(boxes)
    changed = True
    while changed:
        changed = False
        for i in range(len(merged)):
            for j in range(i + 1, len(merged)):
                a, b = merged[i], merged[j]
                if (
                    a.x - gap <= b.x + b.w
                    and b.x - gap <= a.x + a.w
                    and a.y - gap <= b.y + b.h
                    and b.y - gap <= a.y + a.h
                ):
                    x0, y0 = min(a.x, b.x), min(a.y, b.y)
                    x1, y1 = max(a.x + a.w, b.x + b.w), max(a.y + a.h, b.y + b.h)
                    merged[i] = BBox(x=x0, y=y0, w=x1 - x0, h=y1 - y0)
                    merged.pop(j)
                    changed = True
                    break
            if changed:
                break
    return merged
