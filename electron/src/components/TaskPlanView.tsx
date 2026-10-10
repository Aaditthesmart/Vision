import React from "react";
import type { TaskPlan, ActionStep } from "../hooks/useVisionOS";

interface TaskPlanViewProps {
  plan: TaskPlan | null;
}

export const TaskPlanView: React.FC<TaskPlanViewProps> = ({ plan }) => {
  if (!plan || plan.steps.length === 0) return null;

  const getStatusBadge = (status: ActionStep["status"]) => {
    switch (status) {
      case "PLANNED":
        return <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300 font-medium">Planned</span>;
      case "WAITING_FOR_APPROVAL":
        return <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold animate-pulse">Approval Needed</span>;
      case "EXECUTING":
        return <span className="px-2 py-0.5 rounded text-xs bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold animate-pulse">Executing...</span>;
      case "VERIFYING":
        return <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-300 font-semibold">Verifying State</span>;
      case "SUCCEEDED":
        return <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">Verified ✔</span>;
      case "FAILED":
        return <span className="px-2 py-0.5 rounded text-xs bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold">Failed ✖</span>;
      case "CANCELLED":
        return <span className="px-2 py-0.5 rounded text-xs bg-slate-600 text-slate-400 font-medium">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">{status}</span>;
    }
  };

  return (
    <div
      role="region"
      aria-label="Active Task Plan"
      className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 my-2 text-white shadow-lg backdrop-blur-md"
    >
      <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-sky-400">
          Gemma 4 Task Plan
        </h2>
        <span className="text-[11px] text-slate-400">
          Goal: <span className="text-slate-200">{plan.userGoal}</span>
        </span>
      </div>

      <ol className="space-y-2 list-none p-0 m-0">
        {plan.steps.map((step, idx) => (
          <li
            key={step.id || idx}
            className={`p-2 rounded-lg text-xs border transition-colors ${
              step.status === "EXECUTING" || step.status === "VERIFYING"
                ? "bg-sky-950/40 border-sky-500/50"
                : step.status === "SUCCEEDED"
                ? "bg-emerald-950/30 border-emerald-500/30"
                : step.status === "FAILED"
                ? "bg-rose-950/40 border-rose-500/40"
                : "bg-slate-800/50 border-slate-700/50"
            }`}
          >
            <div className="flex justify-between items-center gap-2">
              <span className="font-medium text-slate-200">
                {idx + 1}. {step.description}
              </span>
              {getStatusBadge(step.status)}
            </div>

            {step.verificationEvidence && (
              <p className="mt-1 text-[11px] text-emerald-300/90 font-mono bg-emerald-950/60 px-1.5 py-0.5 rounded">
                ✔ {step.verificationEvidence}
              </p>
            )}

            {step.error && (
              <p className="mt-1 text-[11px] text-rose-300 font-mono bg-rose-950/60 px-1.5 py-0.5 rounded">
                ✖ {step.error}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
};
