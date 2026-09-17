import type { QueryClient } from "@tanstack/react-query";
import * as authApi from "@/lib/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { useCanvasStore } from "@/stores/canvasStore";

let boundQueryClient: QueryClient | null = null;

export function bindQueryClient(client: QueryClient) {
  boundQueryClient = client;
}

export function clearUserScopedClientState(queryClient?: QueryClient) {
  const client = queryClient ?? boundQueryClient;
  client?.clear();
  useCanvasStore.getState().resetForLogout();
}

export async function performLogout(queryClient?: QueryClient) {
  try {
    await authApi.logout();
  } catch {
    // Token may already be invalid; still clear client state.
  }
  clearUserScopedClientState(queryClient);
  useAuthStore.getState().logout();
}
