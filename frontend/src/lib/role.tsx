"use client";

import { createContext, useContext, useState } from "react";

export type Role = "requester" | "approver";

// No real identity system yet — this is the name every request is submitted
// under, and what the Requester's own list is filtered by.
export const REQUESTER_NAME = "Alice";

type RoleContextValue = { role: Role; setRole: (role: Role) => void };

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role>("requester");
  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
