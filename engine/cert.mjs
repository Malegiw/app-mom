import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir, findBinary, lanAddresses, localHostname } from "./config.mjs";

/**
 * Phones and tablets only allow the microphone on pages loaded over HTTPS, so the Wi-Fi listener
 * needs a certificate. This makes a self-signed one for this computer's own names and addresses.
 * Browsers show a warning for it the first time; the certificate still encrypts the connection.
 */
export function loadCertificate() {
  ensureDataDir();
  const keyFile = path.join(DATA_DIR, "lan-key.pem");
  const certFile = path.join(DATA_DIR, "lan-cert.pem");
  const namesFile = path.join(DATA_DIR, "lan-cert.names");

  const names = [`DNS:${localHostname()}`, "DNS:localhost", "IP:127.0.0.1", ...lanAddresses().map((address) => `IP:${address}`)];
  const wanted = names.join(",");

  // Make a new certificate when there is none, or when the computer's address has changed since.
  const current = existsSync(namesFile) ? readFileSync(namesFile, "utf8").trim() : "";
  if (!existsSync(keyFile) || !existsSync(certFile) || current !== wanted) {
    const openssl = findBinary("openssl");
    if (!openssl) throw new Error("openssl tidak ditemukan, jadi sambungan aman untuk Wi-Fi tidak bisa dibuat.");
    execFileSync(
      openssl,
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "820",
        "-keyout", keyFile,
        "-out", certFile,
        "-subj", "/CN=Notula di komputer ini",
        "-addext", `subjectAltName=${wanted}`,
        "-addext", "extendedKeyUsage=serverAuth",
      ],
      { stdio: "ignore" },
    );
    writeFileSync(namesFile, `${wanted}\n`);
  }
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}
