/**
 * DEPTH ORDERING (painter's algorithm)
 *
 * Every depth-sorted object gets zIndex = key * 10 + bias, where `key` is
 * the sum of the grid coordinates of its tile CENTER (col + row + 1).
 * Large furniture is split into one piece per tile so a single scalar key
 * stays correct for characters walking around it.
 *
 * Biases resolve ties on the same key:
 *   2  chair seat (and a backrest that sits behind the sitter)
 *   3  partition segment (keyed on its grid line, i.e. key - 0.5)
 *   5  character
 *   6  furniture piece
 *   8  chair backrest that sits in front of the sitter
 */
export const BIAS = { seat: 2, partition: 3, character: 5, furniture: 6, backrestFront: 8 } as const;

export function tileKey(col: number, row: number): number {
  return col + row + 1;
}

export function zIndexFor(key: number, bias: number): number {
  return key * 10 + bias;
}
