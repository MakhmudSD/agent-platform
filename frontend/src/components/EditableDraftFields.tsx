"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

const FIELD_LABELS: Record<string, string> = {
  category: "Category",
  amount: "Amount",
  date: "Date",
  justification: "Justification",
  cost_center: "Cost center",
};

interface EditableDraftFieldsProps {
  draft: Record<string, any>;
  // Client-only UI state, not a readiness gate -- the backend's
  // required-fields check (nodes.py's intake_node) only cares whether a
  // field is present, not whether the requester explicitly confirmed it.
  // This just controls the dashed (AI-proposed) vs solid (confirmed)
  // border so a proposed value reads differently from a typed-and-set one.
  confirmedFields: Set<string>;
  busy: boolean;
  onPatch: (field: string, value: string) => void;
}

// Renders whichever REQUIRED_FIELDS the draft already has as inline,
// editable chips instead of only ever arriving as chat prose -- per
// claude.ai's design pattern (dashed border = AI-proposed/unconfirmed,
// solid = accepted or user-set). Both Accept and Edit resolve through the
// same field_patch WS action (see page.tsx's handleFieldPatch): the graph
// stays the only writer of the draft, but intake_node short-circuits the
// LLM call for a structured patch, so neither costs a token.
export function EditableDraftFields(props: EditableDraftFieldsProps) {
  const { draft, confirmedFields, busy, onPatch } = props;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const fields = Object.keys(FIELD_LABELS).filter((f) => draft[f] != null && draft[f] !== "");
  if (fields.length === 0) return null;

  function submitEdit(field: string) {
    onPatch(field, editValue);
    setEditingField(null);
  }

  return (
    <div className="bg-card rounded-2xl px-5 py-[14px] shadow-card flex flex-col gap-2 max-w-[480px]">
      {fields.map((field) => {
        const confirmed = confirmedFields.has(field);
        const isEditing = editingField === field;
        return (
          <div
            key={field}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors ${
              confirmed ? "border border-hairline-soft" : "border border-dashed border-placeholder"
            }`}
          >
            <span className="text-[12.5px] text-text-tertiary shrink-0">{FIELD_LABELS[field]}</span>
            {isEditing ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => submitEdit(field)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitEdit(field);
                  if (e.key === "Escape") setEditingField(null);
                }}
                className="flex-1 min-w-0 text-[13.5px] text-ink bg-transparent outline-none text-right"
              />
            ) : (
              <span className={`flex-1 min-w-0 text-right text-[13.5px] truncate ${confirmed ? "text-ink font-medium" : "text-ink-2"}`}>
                {String(draft[field])}
              </span>
            )}
            {!isEditing && (
              <div className="flex items-center gap-1 shrink-0">
                {!confirmed && (
                  <button
                    onClick={() => onPatch(field, String(draft[field]))}
                    disabled={busy}
                    title="Accept"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-accent hover:bg-accent-tint transition-colors disabled:opacity-50"
                  >
                    <Icon name="check" size={14} />
                  </button>
                )}
                <button
                  onClick={() => { setEditingField(field); setEditValue(String(draft[field])); }}
                  disabled={busy}
                  title="Edit"
                  className="w-6 h-6 rounded-md flex items-center justify-center text-text-tertiary hover:bg-neutral-fill/50 transition-colors disabled:opacity-50"
                >
                  <Icon name="edit" size={13} filled={false} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
