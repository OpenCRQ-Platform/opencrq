/**
 * Addresses are stored as the matcher reads them — MACs stripped of separators, everything
 * lower-cased — so they are formatted back for display here rather than kept twice. The shapes
 * mirror OpenAEV's own (`formatMacAddress`), so the same machine reads alike in both products.
 */
export const formatMacAddress = (mac: string): string =>
  (mac.toUpperCase().match(/.{1,2}/g) ?? [mac]).join(':');

/** Hex digits are case-insensitive in IPv6, and lower case is the canonical spelling (RFC 5952). */
export const formatIpAddress = (ip: string): string => ip.toLowerCase();

/** Past this length an IPv6 address no longer fits a half-width field on one line. */
const ABBREVIATE_IPV6_FROM = 25;

/** How many of these groups hold the first two that carry digits, a `::`'s empty one counted among them. */
const keptGroupCount = (groups: ReadonlyArray<string>): number => {
  let kept = 0;
  let withDigits = 0;
  while (kept < groups.length && withDigits < 2) {
    if (groups[kept] !== '') {
      withDigits += 1;
    }
    kept += 1;
  }
  return kept;
};

/**
 * A long IPv6 address shortened in its middle, its first two and last two groups kept: the prefix
 * names the network and the suffix the interface, which is what a reader compares. A `::` is not a
 * group, so the kept ones reach past it rather than leaving it beside the ellipsis, where the two
 * would read as two elisions. An IPv4 address, or a compressed IPv6 one short enough, is returned whole.
 */
export const abbreviateIpAddress = (ip: string): string => {
  const formatted = formatIpAddress(ip);
  if (!formatted.includes(':') || formatted.length < ABBREVIATE_IPV6_FROM) {
    return formatted;
  }
  const groups = formatted.split(':');
  const head = keptGroupCount(groups);
  const tail = keptGroupCount([...groups].reverse());
  if (head + tail >= groups.length) {
    return formatted;
  }
  return `${groups.slice(0, head).join(':')}:…:${groups.slice(-tail).join(':')}`;
};
