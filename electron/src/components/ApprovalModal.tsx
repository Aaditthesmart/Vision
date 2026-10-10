import React, { useEffect, useRef } from "react";
import type { ApprovalRequest } from "../hooks/useVisionOS";

interface ApprovalModalProps {
  request: ApprovalRequest | null;
  onApprove: (stepId: string) => void;
  onDecline: (stepId: string) => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  request,
  onApprove,
  onDecline,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) {
      confirmBtnRef.current?.focus();
    }
  }, [request]);

  if (!request) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      aria-describedby="approval-desc"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl p-5 max-w-md w-full text-white shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-2 mb-3 text-amber-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 id="approval-title" className="text-base font-bold text-amber-300">
            Consequential Action Approval
          </h2>
        </div>

        <p id="approval-desc" className="text-sm text-slate-200 mb-2 leading-relaxed">
          Gemma 4 has paused execution for safety:
        </p>

        <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg mb-4 text-xs font-mono text-amber-200/90">
          <strong>Intended Action:</strong> {request.description}
          {request.expectedOutcome && (
            <div className="mt-1 text-slate-400">
              <strong>Expected Outcome:</strong> {request.expectedOutcome}
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 mb-5">
          This action may submit data, purchase items, or modify settings. Do you grant permission?
        </p>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onDecline(request.stepId)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 focus:ring-2 focus:ring-slate-400 transition"
          >
            Decline & Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={() => onApprove(request.stepId)}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 focus:ring-2 focus:ring-amber-300 transition"
          >
            Confirm & Proceed
          </button>
        </div>
      </div>
    </div>
  );
};
