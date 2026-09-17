"use client";

import { QueryClient, QueryClientProvider as TanStackProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { bindQueryClient } from "@/lib/auth/session";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30000, retry: 2 } } }));

  useEffect(() => {
    bindQueryClient(client);
  }, [client]);

  return <TanStackProvider client={client}>{children}</TanStackProvider>;
}
