/** Cuts on a full stop followed by whitespace, never on a colon, which is how a catalogue rung opens its comparison to the rung below. */
export const splitFirstSentence = (text: string): { first: string, rest: string } => {
  const trimmed = text.trim();
  const match = /^[\s\S]*?\.(?=\s|$)/.exec(trimmed);
  const first = match ? match[0] : trimmed;
  return { first, rest: trimmed.slice(first.length).trim() };
};
