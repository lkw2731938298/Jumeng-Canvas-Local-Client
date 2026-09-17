import { create } from "zustand";
import type { User } from "@/types";
import { clearSessionCookie, setSessionCookie } from "@/lib/authCookie";

interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  sessionToken: null,
  isAuthenticated: false,

  login: (token, user) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("jm_canvas_session_token", token);
      localStorage.setItem("jm_canvas_user", JSON.stringify(user));
      setSessionCookie(token);
    }
    set({ user, sessionToken: token, isAuthenticated: true });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("jm_canvas_session_token");
      localStorage.removeItem("jm_canvas_user");
      clearSessionCookie();
    }
    set({ user: null, sessionToken: null, isAuthenticated: false });
  },

  setUser: (user) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("jm_canvas_user", JSON.stringify(user));
    }
    set({ user });
  },

  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const token = localStorage.getItem("jm_canvas_session_token");
      const userRaw = localStorage.getItem("jm_canvas_user");
      if (token && userRaw) {
        const user = JSON.parse(userRaw) as User;
        setSessionCookie(token);
        set({ user, sessionToken: token, isAuthenticated: true });
      }
    } catch {
      localStorage.removeItem("jm_canvas_session_token");
      localStorage.removeItem("jm_canvas_user");
    }
  },
}));
