// @ts-check
import { isIP } from "node:net";

/** @param {string | undefined} value */
function canonicalIP(value) {
  if (!value) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes("%")) return null;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (!mapped) return normalized;
  return mapped
    .slice(1)
    .flatMap((part) => {
      const word = Number.parseInt(part, 16);
      return [word >> 8, word & 255];
    })
    .join(".");
}

/** @param {string} value */
export function trustedProxies(value = "") {
  if (!value.trim() || value === "0") return new Set();
  return new Set(
    value.split(",").map((entry) => {
      const address = canonicalIP(entry.trim());
      if (!address) {
        throw new Error(
          "TRUST_PROXY must contain explicit, comma-separated IP addresses.",
        );
      }
      return address;
    }),
  );
}

/**
 * @param {string | undefined} peer
 * @param {string | string[] | undefined} header
 * @param {Set<string>} proxies
 */
export function clientIP(peer, header, proxies) {
  const address = canonicalIP(peer) || peer || "local";
  return proxies.has(address) && typeof header === "string"
    ? canonicalIP(header) || address
    : address;
}
