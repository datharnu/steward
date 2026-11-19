import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `npm run cbom`: a CycloneDX CBOM of Steward's contracts + haven-pq-kit (and, with
 * --chain, of the live owner account on testnet) through QoreScan, plus a strict
 * source check: contracts reach ML-DSA only through pqcKeyStatus and pqcVerify,
 * and never use ecrecover for authorisation.
 */

const QORESCAN = resolve("node_modules/.bin/qorescan");
const ALLOWED_FAMILIES = new Set(["Keccak", "ML-DSA"]);
const ALLOWED_ML_DSA_SYMBOLS = new Set(["import", "pqcVerify", "pqcKeyStatus"]);
const PRECOMPILES = new Set([
  "0x0000000000000000000000000000000000000a01",
  "0x0000000000000000000000000000000000000a02",
]);

type Component = {
  name: string;
  properties?: { name: string; value: string }[];
  evidence?: { occurrences?: { location: string; line?: number; symbol: string }[] };
};

function property(component: Component, name: string): string[] {
  return (component.properties ?? []).filter((p) => p.name === name).map((p) => p.value);
}

function solidityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return solidityFiles(path);
    return path.endsWith(".sol") ? [path] : [];
  });
}

function checkCbom(components: Component[]): string[] {
  const findings: string[] = [];
  let mlDsaSeen = false;
  for (const component of components) {
    if (!property(component, "qorescan:source").includes("solidity")) continue;
    const family = property(component, "qorescan:family")[0];
    if (family === undefined) continue;
    const inContracts = (component.evidence?.occurrences ?? []).filter((o) => o.location.endsWith(".sol"));
    if (inContracts.length === 0) continue;
    if (!ALLOWED_FAMILIES.has(family)) {
      const where = inContracts.map((o) => `${o.location}:${o.line ?? "?"} ${o.symbol}`);
      findings.push(`${component.name} (${family}) in contracts: ${where.join(", ")}`);
    }
    if (family === "ML-DSA") {
      mlDsaSeen = true;
      for (const occurrence of inContracts) {
        if (!ALLOWED_ML_DSA_SYMBOLS.has(occurrence.symbol)) {
          findings.push(`ML-DSA reached through ${occurrence.symbol} at ${occurrence.location}:${occurrence.line ?? "?"}`);
        }
      }
    }
  }
  if (!mlDsaSeen) findings.push("QoreScan found no ML-DSA use in the contracts");
  return findings;
}

function checkSources(dirs: string[]): string[] {
  const findings: string[] = [];
  for (const dir of dirs) {
    for (const file of solidityFiles(dir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const where = `${file}:${i + 1}`;
        if (/\becrecover\s*\(/.test(line)) findings.push(`ecrecover at ${where}`);
        for (const match of line.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) {
          if (!PRECOMPILES.has(match[0].toLowerCase())) findings.push(`address literal ${match[0]} at ${where}`);
        }
        for (const match of line.matchAll(/(\w+)\s*\.\s*(staticcall|call|delegatecall)\s*\(/g)) {
          const target = match[1];
          const kind = match[2];
          const allowedTokenTransfer =
            file.endsWith("PayGate.sol") &&
            target === "token" &&
            kind === "call" &&
            line.includes("abi.encodeCall(IERC20Minimal.transfer");
          if (target !== "PQC_VERIFY" && target !== "PQC_STATUS" && !allowedTokenTransfer) {
            findings.push(`low-level ${kind} on ${target} at ${where}`);
          }
        }
      });
    }
  }
  return findings;
}

function scan(dirs: string[], out: string, chainAddress?: string): Component[] {
  const args = ["scan", "--name", "steward"];
  if (chainAddress) {
    args.push("--network", "testnet", "--address", chainAddress);
  }
  for (const dir of dirs) args.push("--solidity", dir);
  args.push("--out", out);
  execFileSync(QORESCAN, args, { stdio: ["ignore", "ignore", "inherit"] });
  return (JSON.parse(readFileSync(out, "utf8")) as { components?: Component[] }).components ?? [];
}

function run(dirs: string[], out: string, chainAddress?: string): string[] {
  return [...checkCbom(scan(dirs, out, chainAddress)), ...checkSources(dirs)];
}

const chain = process.argv.includes("--chain");
const ownerFlagIndex = process.argv.indexOf("--address");
const ownerAddress =
  ownerFlagIndex >= 0 && process.argv[ownerFlagIndex + 1]
    ? process.argv[ownerFlagIndex + 1]
    : "qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl";

const out = chain ? "cbom.json" : join(mkdtempSync(join(tmpdir(), "steward-cbom-")), "cbom.json");
const dirs = ["src", "lib/haven-pq-kit/src"];
const findings = run(dirs, out, chain ? ownerAddress : undefined);
if (findings.length > 0) {
  console.error(`CBOM check failed:\n- ${findings.join("\n- ")}`);
  process.exit(1);
}
console.log(`CBOM check passed for ${dirs.join(", ")} (${out})`);

const fixture = run(
  ["scripts/fixtures/ecrecover"],
  join(mkdtempSync(join(tmpdir(), "steward-cbom-")), "cbom.json"),
);
if (fixture.length === 0) {
  console.error("self-test failed: the ecrecover fixture was not caught");
  process.exit(1);
}
console.log(`self-test caught the ecrecover fixture (${fixture.length} findings)`);
