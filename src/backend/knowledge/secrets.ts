/**
 * SECRET GUARD - refuses to write anything that looks like a credential.
 *
 * Markdown notes are human-readable and may later be synced, so a secret in
 * a note is a leak. Detection is deliberately conservative (false positives
 * are acceptable; the writer can rephrase). Findings name the KIND of
 * secret only; the matched text is never echoed back or logged.
 */
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { kind: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/ },
  { kind: "xAI API key", re: /\bxai-[A-Za-z0-9]{20,}/ },
  { kind: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { kind: "private key", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { kind: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { kind: "credentials in a URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i },
  {
    kind: "password or secret assignment",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{6,}/i,
  },
];

export function findSecrets(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const { kind, re } of PATTERNS) if (re.test(text)) found.add(kind);
  }
  return [...found];
}
