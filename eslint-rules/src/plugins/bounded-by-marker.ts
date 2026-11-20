import type { TSESTree } from '@typescript-eslint/utils';

export type MarkerContext = {
  sourceCode: { getCommentsBefore: (node: TSESTree.Node) => Array<TSESTree.Comment> },
};

const BOUNDED_MARKER = 'bounded-by:';
const MEMBERS = new Set<string>(['Property', 'MethodDefinition', 'PropertyDefinition']);

/** A marker is a claim about the data rather than a silencer, so one with no reason is none. */
const isMarker = (comment: TSESTree.Comment, marker: string): boolean => {
  const markerAt = comment.value.indexOf(marker);
  return markerAt !== -1 && comment.value.slice(markerAt + marker.length).trim().length > 0;
};

export const isBoundedByMarker = (comment: TSESTree.Comment): boolean => isMarker(comment, BOUNDED_MARKER);

/**
 * A marker counts only in the comments directly above the member or statement holding the node, doc
 * comment included. Going no higher keeps one marker from vouching for its siblings.
 */
export const hasMarker = (context: MarkerContext, node: TSESTree.Node, marker: string): boolean => {
  for (let at: TSESTree.Node | undefined = node; at !== undefined && at.type !== 'Program'; at = at.parent) {
    if (context.sourceCode.getCommentsBefore(at).some((comment) => isMarker(comment, marker))) {
      return true;
    }
    if (at.type.endsWith('Statement') || MEMBERS.has(at.type)) {
      return false;
    }
  }
  return false;
};

export const hasBoundedByMarker = (context: MarkerContext, node: TSESTree.Node): boolean => hasMarker(context, node, BOUNDED_MARKER);
