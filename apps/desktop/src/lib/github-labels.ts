/**
 * Colours for a GitHub label chip. GitHub stores label colours as 6-digit hex
 * without `#`; text colour is picked from the background's luminance so every
 * label stays readable, like on github.com.
 */
export function labelColors(hex: string) {
  const value = /^[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "ededed";
  const [r, g, b] = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  return {
    backgroundColor: `#${value}`,
    color: luminance > 0.4 ? "#1f2328" : "#ffffff",
  };
}
