import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function secretPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error("bad account name");
  return join(process.env.HAVEN_SECRETS_DIR ?? join(homedir(), ".haven"), `${name}.env`);
}

/** Write a new secret. Refuses to overwrite one that already exists. */
export function writeSecret(name: string, mnemonic: string): void {
  const dir = join(homedir(), ".haven");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = secretPath(name);
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  writeFileSync(path, `MNEMONIC=${JSON.stringify(mnemonic)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

export function readMnemonic(name: string): string {
  const text = readFileSync(secretPath(name), "utf8");
  const match = text.match(/^MNEMONIC=(?:"([^"]+)"|(\S+))\s*$/m);
  const mnemonic = match?.[1] ?? match?.[2];
  if (!mnemonic) throw new Error(`no MNEMONIC for ${name}`);
  return mnemonic;
}
