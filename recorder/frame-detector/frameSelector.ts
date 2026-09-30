import type { IframeFact } from '../types';

/**
 * A flattened candidate frame: the node itself plus its full ancestor chain
 * (root-first, not including the node itself). Shared by every provider so
 * selector/path construction stays identical regardless of which provider
 * found the candidate.
 */
export interface FlatFrameCandidate {
  readonly node: IframeFact;
  readonly ancestors: readonly IframeFact[];
}

/**
 * Builds a stable CSS selector for one iframe fact: id first, then name,
 * then src, then a positional fallback that always works even when an
 * iframe has none of the above.
 */
export function selectorForFrameNode(node: IframeFact): string {
  if (node.id) return `#${node.id}`;
  if (node.name) return `iframe[name="${node.name}"]`;
  if (node.src) return `iframe[src="${node.src}"]`;
  return `iframe:nth-of-type(${node.index + 1})`;
}

/** Full chain of selectors from the outermost iframe down to the candidate itself. */
export function framePathFor(candidate: FlatFrameCandidate): string[] {
  return [...candidate.ancestors, candidate.node].map(selectorForFrameNode);
}

/**
 * Flattens the recursive iframe tree into one list, each entry carrying its
 * own ancestor chain — so any provider can consider every iframe at any
 * depth as a candidate, with no fixed nesting-depth assumption.
 */
export function flattenFrameHierarchy(roots: readonly IframeFact[]): FlatFrameCandidate[] {
  const result: FlatFrameCandidate[] = [];

  const walk = (nodes: readonly IframeFact[], ancestors: readonly IframeFact[]): void => {
    for (const node of nodes) {
      result.push({ node, ancestors });
      if (node.children.length > 0) {
        walk(node.children, [...ancestors, node]);
      }
    }
  };

  walk(roots, []);
  return result;
}
