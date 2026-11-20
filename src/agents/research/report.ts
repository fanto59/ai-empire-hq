/**
 * STRUCTURED RESEARCH REPORT
 *
 * The agent must finish by calling the `submit_report` tool (strict JSON
 * schema). We then validate it again here and VERIFY sources: a source counts
 * as verified only if its URL was actually returned by a web search or fetch
 * during this run. Unverified sources, low-confidence findings and findings
 * without verified sources are surfaced as uncertain.
 */
export const REPORT_TOOL_NAME = "submit_report";

export const REPORT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "findings", "uncertainties", "sources"],
  properties: {
    title: { type: "string", description: "Short title for the report." },
    summary: { type: "string", description: "Answer to the question in 2-5 sentences." },
    findings: {
      type: "array",
      description: "Key findings, each backed by source ids where possible.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "confidence", "source_ids"],
        properties: {
          statement: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          source_ids: { type: "array", items: { type: "integer" } },
        },
      },
    },
    uncertainties: {
      type: "array",
      description: "Open questions, conflicting information, or claims you could not verify.",
      items: { type: "string" },
    },
    sources: {
      type: "array",
      description: "Only pages you actually retrieved with web_search or web_fetch in this run.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "url"],
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
} as const;

export interface ReportFinding {
  statement: string;
  confidence: "high" | "medium" | "low";
  source_ids: number[];
}

export interface ReportSource {
  id: number;
  title: string;
  url: string;
}

export interface SubmittedReport {
  title: string;
  summary: string;
  findings: ReportFinding[];
  uncertainties: string[];
  sources: ReportSource[];
}

export interface VerifiedReport extends SubmittedReport {
  sources: (ReportSource & { verified: boolean })[];
  /** Findings that are low-confidence or lack a verified source. */
  uncertainFindings: ReportFinding[];
}

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

const str = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string" || v.trim() === "") throw new ReportValidationError(`Report field "${field}" must be non-empty text.`);
  return v.trim().slice(0, max);
};

/** Re-validates the tool input (never trust it blindly) and checks sources. */
export function verifyReport(input: unknown, retrievedUrls: ReadonlySet<string>): VerifiedReport {
  if (typeof input !== "object" || input === null) throw new ReportValidationError("Report must be an object.");
  const r = input as Record<string, unknown>;
  const arr = (v: unknown, field: string) => {
    if (!Array.isArray(v)) throw new ReportValidationError(`Report field "${field}" must be a list.`);
    return v.slice(0, 50);
  };

  const sources = arr(r.sources, "sources").map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const url = str(o.url, `sources[${i}].url`, 2000);
    if (!/^https?:\/\//i.test(url)) throw new ReportValidationError(`Source ${i} has a non-web URL.`);
    const id = typeof o.id === "number" && Number.isInteger(o.id) ? o.id : i + 1;
    return { id, title: str(o.title, `sources[${i}].title`, 300), url, verified: retrievedUrls.has(normalizeUrl(url)) };
  });
  const verifiedIds = new Set(sources.filter((s) => s.verified).map((s) => s.id));

  const findings = arr(r.findings, "findings").map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const confidence = o.confidence;
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
      throw new ReportValidationError(`Finding ${i} has an invalid confidence.`);
    }
    const ids = Array.isArray(o.source_ids) ? o.source_ids.filter((x): x is number => Number.isInteger(x)) : [];
    return { statement: str(o.statement, `findings[${i}].statement`, 2000), confidence, source_ids: ids } as ReportFinding;
  });
  if (findings.length === 0) throw new ReportValidationError("Report has no findings.");

  return {
    title: str(r.title, "title", 200).replace(/[\r\n]+/g, " "),
    summary: str(r.summary, "summary", 4000),
    findings,
    uncertainties: arr(r.uncertainties, "uncertainties").map((u, i) => str(u, `uncertainties[${i}]`, 1000)),
    sources,
    uncertainFindings: findings.filter((f) => f.confidence === "low" || !f.source_ids.some((id) => verifiedIds.has(id))),
  };
}

/** Normalizes URLs for comparison (scheme/host case, trailing slash, fragment). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** Renders the report as Markdown for the knowledge vault. Model text is plain text, not trusted markup. */
export function renderReportMarkdown(
  report: VerifiedReport,
  meta: { question: string; model: string; taskId: string; costLabel: string; completedAt: string },
): string {
  const esc = (s: string) => s.replace(/\[\[/g, "[ [").replace(/<\/?[a-z][^>]*>/gi, "");
  const srcLabel = (ids: number[]) =>
    ids.length === 0 ? " _(no source)_" : ` (${ids.map((id) => `[${id}]`).join(", ")})`;
  const lines = [
    `# ${esc(report.title)}`,
    "",
    `> [!info] AI-generated research report`,
    `> Produced by the Research Agent with ${meta.model}. Review before relying on it. Cost: ${meta.costLabel}.`,
    "",
    `**Question:** ${esc(meta.question)}`,
    "",
    `**Linked task:** \`${meta.taskId}\` · **Completed:** ${meta.completedAt}`,
    "",
    "## Summary",
    esc(report.summary),
    "",
    "## Findings",
    ...report.findings.map((f) => `- **${f.confidence}** — ${esc(f.statement)}${srcLabel(f.source_ids)}`),
    "",
    "## Uncertain or unverified",
  ];
  const uncertain = [
    ...report.uncertainFindings.map((f) => `Finding needs checking (${f.confidence} confidence${f.source_ids.length ? "" : ", no source"}): ${esc(f.statement)}`),
    ...report.uncertainties.map(esc),
    ...report.sources.filter((s) => !s.verified).map((s) => `Source [${s.id}] was not retrieved during this run and is unverified: ${esc(s.url)}`),
  ];
  lines.push(...(uncertain.length ? uncertain.map((u) => `- ${u}`) : ["- None reported."]));
  lines.push("", "## Sources", "| # | Source | Verified |", "| --- | --- | --- |");
  for (const s of report.sources) lines.push(`| ${s.id} | [${esc(s.title).replace(/\|/g, "/")}](${s.url}) | ${s.verified ? "yes" : "no"} |`);
  return lines.join("\n");
}
