import { AgentInfo } from "@/components/AgentGuideModal";

// The real fixed pipeline (orchestrator/graph.py), not a marketing list --
// these are the actual node names a run passes through, same ones
// RunProgress and NODE_LABELS (lib/progress.ts) use. Shared by the home
// page's agent cards (with a click-to-open modal, in context) and /help
// (the full text, standalone) so the copy has one source of truth.
export const AGENT_INFO: AgentInfo[] = [
  {
    icon: "chat",
    name: "Intake",
    purpose: "Gathers the details your request needs -- amount, cost center, date, justification -- by asking only for what's missing.",
    guide: "Runs the moment you send your first message.\n\nHow to use it: just describe what you need in plain language, the way you'd tell a coworker -- \"$400 conference ticket for the SF summit next month.\" If anything required is missing, it asks one follow-up question at a time; answer it like a normal chat reply and it picks up where it left off.\n\nYou'll know it's done when the conversation moves on to policy checking without asking anything further.",
  },
  {
    icon: "policy",
    name: "Policy Research",
    purpose: "Checks your request against real company policy documents and cites what applies.",
    guide: "Runs automatically once Intake has enough detail -- there's nothing to trigger.\n\nHow to use it: nothing to do while it runs. Read the citations and rule checklist it posts -- that's the actual policy text your request is being checked against, not a summary, so if a cap or rule looks wrong it's worth flagging before you submit rather than after.\n\nIf no policy matches your request, it says so explicitly rather than showing an empty checklist.",
  },
  {
    icon: "edit_note",
    name: "Drafting",
    purpose: "Turns the gathered details and policy findings into the structured request that gets sent for approval.",
    guide: "Runs after policy research, automatically.\n\nHow to use it: check the fields it produces against what you actually meant -- amount, category, dates. If something's off, say so in the chat (\"actually the date should be the 12th\") rather than editing after the fact; Drafting will redo the field from your correction so the policy evaluation stays consistent with what's actually being requested.",
  },
  {
    icon: "alt_route",
    name: "Escalation & Routing",
    purpose: "Decides whether your request needs a standard approver or a specialist reviewer, based on policy rules.",
    guide: "Runs once your request is fully drafted -- fully automatic, no input from you.\n\nHow to use it: nothing to do. It reads the policy rules that matched and picks exactly one destination -- your regular approver, or a specialist reviewer (finance/legal/IT) when a rule specifically calls for one. The reasoning it shows is the real basis for that decision, not a generic explanation, so it's worth reading if you're wondering why a routine-looking request got escalated.",
  },
  {
    icon: "summarize",
    name: "Approval Summary",
    purpose: "Writes the decision brief your approver sees -- what you're asking for and why it's routed the way it is.",
    guide: "Runs last, right before your request reaches the approval queue.\n\nHow to use it: this is the one worth double-checking -- it's the brief your approver actually reads to decide, not the full conversation, so if it misrepresents what you're asking for or why, that's the moment to say something in chat before it goes out, since editing after submission means restarting the approval.",
  },
];
