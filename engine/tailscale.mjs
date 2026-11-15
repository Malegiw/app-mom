import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { findBinary } from "./config.mjs";

const run = promisify(execFile);
const APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/**
 * This computer's names on the owner's Tailscale network, such as "mac-mini.tail1234.ts.net".
 * Tailscale's own `serve` command puts a trusted HTTPS address in front of the engine under that
 * name, so a phone or tablet anywhere in the world can reach it without opening the router.
 * Also returns the Tailscale account that owns this computer. Requests that `tailscale serve` has
 * identified as coming from that account need no access code.
 * NOTULA_TAILSCALE_HOST and NOTULA_TAILSCALE_OWNER override the lookup (host names are comma separated).
 */
export async function tailscaleInfo() {
  const override = (process.env.NOTULA_TAILSCALE_HOST || "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const owner = (process.env.NOTULA_TAILSCALE_OWNER || "").trim().toLowerCase();
  if (override.length > 0) return { hosts: override, owner };
  const cli = findBinary("tailscale") || (existsSync(APP_CLI) ? APP_CLI : null);
  if (!cli) return { hosts: [], owner: "" };
  try {
    const { stdout } = await run(cli, ["status", "--json"], { timeout: 8000 });
    const status = JSON.parse(stdout);
    const name = status?.Self?.DNSName;
    // The account that signed this computer in to Tailscale: the person the engine belongs to.
    const login = status?.User?.[String(status?.Self?.UserID)]?.LoginName;
    return {
      hosts: typeof name === "string" && name ? [name.replace(/\.$/, "").toLowerCase()] : [],
      owner: typeof login === "string" ? login.toLowerCase() : "",
    };
  } catch {
    return { hosts: [], owner: "" };
  }
}
