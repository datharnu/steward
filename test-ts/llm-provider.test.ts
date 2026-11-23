import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLlmCredentials } from "../agent/planner.js";

const KEYS = ["HAVEN_SECRETS_DIR", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "STEWARD_LLM_PROVIDER", "STEWARD_OPENROUTER_MODEL", "STEWARD_ANTHROPIC_MODEL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setup(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "steward-llm-"));
  writeFileSync(join(dir, "llm.env"), "");
  for (const k of KEYS) delete process.env[k];
  process.env.HAVEN_SECRETS_DIR = dir;
  Object.assign(process.env, env);
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadLlmCredentials provider choice", () => {
  it("prefers anthropic when both keys are set and no provider is chosen", () => {
    setup({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" });
    expect(loadLlmCredentials()?.provider).toBe("anthropic");
  });
  it("STEWARD_LLM_PROVIDER=openrouter uses openrouter even with an anthropic key", () => {
    setup({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o", STEWARD_OPENROUTER_MODEL: "google/gemma-4-31b-it:free", STEWARD_LLM_PROVIDER: "openrouter" });
    expect(loadLlmCredentials()).toMatchObject({ provider: "openrouter", apiKey: "o", model: "google/gemma-4-31b-it:free" });
  });
  it("STEWARD_LLM_PROVIDER=anthropic without an anthropic key does not silently use openrouter", () => {
    setup({ OPENROUTER_API_KEY: "o", STEWARD_LLM_PROVIDER: "anthropic" });
    expect(loadLlmCredentials()).toBeUndefined();
  });
  it("rejects an unknown provider", () => {
    setup({ STEWARD_LLM_PROVIDER: "gemini" });
    expect(() => loadLlmCredentials()).toThrow(/STEWARD_LLM_PROVIDER/);
  });
});
