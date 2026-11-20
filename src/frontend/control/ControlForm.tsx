"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ControlResult } from "@/domain/control";

export type ControlActionFn = (prev: ControlResult | null, form: FormData) => Promise<ControlResult>;

interface LogEntry {
  id: string;
  label: string;
  result: ControlResult;
}
const LogContext = createContext<((label: string, r: ControlResult) => void) | null>(null);

/**
 * Keeps every server verdict visible, even when the form that produced it
 * disappears because the page re-rendered from the database (e.g. "Pause"
 * becomes "Resume" after the server accepted the pause).
 */
export function ControlLogProvider({ children }: { children: React.ReactNode }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const push = useCallback((label: string, result: ControlResult) => setLog((l) => [{ id: crypto.randomUUID(), label, result }, ...l].slice(0, 8)), []);
  return (
    <LogContext.Provider value={push}>
      {children}
      {log.length > 0 && (
        <aside aria-label="Server responses" className="fixed right-3 bottom-3 z-40 w-[min(26rem,calc(100vw-1.5rem))] rounded-xl bg-slate-950/95 p-3 shadow-2xl ring-1 ring-slate-700">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Server responses</p>
            <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setLog([])}>
              Clear
            </button>
          </div>
          <ol className="max-h-64 space-y-1.5 overflow-y-auto" data-testid="server-log">
            {log.map((e) => (
              <li key={e.id}>
                <p className="text-[11px] text-slate-400">{e.label}</p>
                <ServerVerdict result={e.result} pending={false} />
              </li>
            ))}
          </ol>
        </aside>
      )}
    </LogContext.Provider>
  );
}

function newKey() {
  return `ctl-${crypto.randomUUID()}`;
}

/**
 * A control-center form. Shows ONLY what the server answered: "Accepted by
 * the server" with the audit entry, "Already handled" for a repeated request,
 * or "Rejected by the server" with the reason. While a request is pending
 * the button is disabled; nothing is shown as done before the server says so.
 *
 * Each submission carries a request key. The key changes only after the
 * server answered, so a double-click or a network retry can never apply an
 * action twice.
 */
export function ControlForm({
  action,
  op,
  fields = {},
  label,
  pendingLabel = "Sending…",
  tone = "default",
  confirm,
  children,
  className = "",
  onResult,
}: {
  action: ControlActionFn;
  op: string;
  fields?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: "default" | "danger" | "primary";
  confirm?: string;
  children?: React.ReactNode;
  className?: string;
  onResult?: (r: ControlResult) => void;
}) {
  const log = useContext(LogContext);
  const labelAtSubmit = useRef(label);
  const callbacks = useRef({ log, onResult });
  useEffect(() => {
    callbacks.current = { log, onResult };
  });
  // Record the server's answer the moment it arrives - before the page
  // re-renders from the database and possibly removes this form.
  const reporting = useCallback(
    async (prev: ControlResult | null, form: FormData) => {
      const result = await action(prev, form);
      callbacks.current.log?.(labelAtSubmit.current, result);
      callbacks.current.onResult?.(result);
      return result;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState(reporting, null);
  const [key, setKey] = useState(newKey);
  const seen = useRef<ControlResult | null>(null);
  useEffect(() => {
    if (state && state !== seen.current) {
      seen.current = state;
      setKey(newKey()); // the next click is a new request
    }
  }, [state]);

  const btn =
    tone === "danger"
      ? "bg-red-600 text-white hover:bg-red-500"
      : tone === "primary"
        ? "bg-sky-600 text-white hover:bg-sky-500"
        : "bg-slate-800 text-slate-100 ring-1 ring-slate-700 hover:bg-slate-700";
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        labelAtSubmit.current = label;
      }}
    >
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="requestKey" value={key} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <button type="submit" disabled={pending} className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${btn}`}>
          {pending ? pendingLabel : label}
        </button>
      </div>
      <ServerVerdict result={state} pending={pending} />
    </form>
  );
}

export function ServerVerdict({ result, pending }: { result: ControlResult | null; pending: boolean }) {
  if (pending) return <p className="mt-1 text-xs text-slate-400" role="status">Waiting for the server…</p>;
  if (!result) return null;
  const time = result.at.slice(11, 19);
  if (result.duplicate) {
    return (
      <p role="status" data-verdict="duplicate" className="mt-1 text-xs text-sky-200">
        Already handled by the server (same request): nothing was applied again. {result.message}
      </p>
    );
  }
  return result.accepted ? (
    <p role="status" data-verdict="accepted" className="mt-1 text-xs text-emerald-300">
      ✓ Accepted by the server at {time} UTC{result.auditId ? ` · audit #${result.auditId}` : ""}. {result.message}
    </p>
  ) : (
    <p role="alert" data-verdict="rejected" className="mt-1 text-xs text-red-300">
      ✕ Rejected by the server at {time} UTC{result.code ? ` (${result.code})` : ""}{result.auditId ? ` · audit #${result.auditId}` : ""}: {result.message}
    </p>
  );
}

/**
 * An approval-token proposal card: approve (the server returns the token
 * once), then execute with that token and the exact payload. The payload
 * sent is the stored one shown here, byte for byte.
 */
export function ProposalActions({
  action,
  proposalId,
  status,
  payloadJson,
  executable,
}: {
  action: ControlActionFn;
  proposalId: string;
  status: string;
  payloadJson: string;
  executable: boolean;
}) {
  const [token, setToken] = useState<string>("");
  const [expires, setExpires] = useState<string | null>(null);
  const [approval, setApproval] = useState<ControlResult | null>(null);
  return (
    <div className="space-y-2">
      <ServerVerdict result={approval} pending={false} />
      {status === "pending" && (
        <div className="flex flex-wrap gap-2">
          <ControlForm
            action={action}
            op="approve"
            fields={{ proposalId }}
            label="Approve exactly this action"
            tone="primary"
            onResult={(r) => {
              setApproval(r);
              if (r.accepted && r.approvalToken) {
                setToken(r.approvalToken);
                setExpires(r.tokenExpiresAt ?? null);
              }
            }}
          />
          <ControlForm action={action} op="reject" fields={{ proposalId }} label="Reject" />
        </div>
      )}
      {(status === "approved" || token) && (
        <ControlForm action={action} op="execute" fields={{ proposalId, payload: payloadJson }} label={executable ? "Execute with token" : "Try to execute"} tone={executable ? "primary" : "default"}>
          <label className="block text-[11px] text-slate-400">
            Approval token{expires ? ` (expires ${expires.slice(11, 16)} UTC, single use)` : ""}
            <input
              name="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="apv_…"
              autoComplete="off"
              spellCheck={false}
              className="mt-0.5 block w-64 max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-100"
            />
          </label>
        </ControlForm>
      )}
    </div>
  );
}
