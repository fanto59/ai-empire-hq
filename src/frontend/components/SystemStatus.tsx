import { StatusBadge } from "./StatusBadge";

export interface SystemStatusProps {
  appEnv: string;
  agentExecutionEnabled: boolean;
  providers: { id: string; label: string; enabled: boolean }[];
}

export function SystemStatus({ appEnv, agentExecutionEnabled, providers }: SystemStatusProps) {
  return (
    <dl className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-slate-400">Environment</dt>
        <dd>
          <StatusBadge tone="off">{appEnv}</StatusBadge>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-slate-400">Agent execution</dt>
        <dd>
          <StatusBadge tone={agentExecutionEnabled ? "warn" : "off"}>
            {agentExecutionEnabled ? "enabled" : "disabled"}
          </StatusBadge>
        </dd>
      </div>
      {providers.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-4">
          <dt className="text-slate-400">{p.label}</dt>
          <dd>
            <StatusBadge tone={p.enabled ? "on" : "off"}>{p.enabled ? "enabled" : "not connected"}</StatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}
