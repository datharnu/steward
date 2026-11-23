/**
 * `--provider anthropic|openrouter` and `--model <id>` for the LLM scripts. They set the same
 * environment variables loadLlmCredentials() reads, so flags win over .env / ~/.haven/llm.env.
 */
export function applyLlmFlags(provider: string | undefined, model: string | undefined): void {
  if (provider !== undefined) {
    if (provider !== "anthropic" && provider !== "openrouter") throw new Error(`--provider must be anthropic or openrouter, got ${provider}`);
    process.env.STEWARD_LLM_PROVIDER = provider;
  }
  if (model !== undefined) {
    const p = process.env.STEWARD_LLM_PROVIDER ?? "anthropic";
    if (p === "openrouter") process.env.STEWARD_OPENROUTER_MODEL = model;
    else process.env.STEWARD_ANTHROPIC_MODEL = model;
  }
}
