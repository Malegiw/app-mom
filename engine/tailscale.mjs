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
 * NOTULA_TAILSCALE_HOST overrides the lookup (comma separated).
 */
export async function tailscaleHosts() {
  const override = (process.env.NOTULA_TAILSCALE_HOST || "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  if (override.length > 0) return override;
  const cli = findBinary("tailscale") || (existsSync(APP_CLI) ? APP_CLI : null);
  if (!cli) return [];
  try {
    const { stdout } = await run(cli, ["status", "--json"], { timeout: 8000 });
    const name = JSON.parse(stdout)?.Self?.DNSName;
    return typeof name === "string" && name ? [name.replace(/\.$/, "").toLowerCase()] : [];
  } catch {
    return [];
  }
}
