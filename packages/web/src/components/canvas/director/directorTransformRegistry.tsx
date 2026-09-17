"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Group } from "three";

interface DirectorTransformRegistryValue {
  registerTransformGroup: (id: string, group: Group | null) => void;
  getTransformGroup: (id: string) => Group | null;
}

const DirectorTransformRegistryContext = createContext<DirectorTransformRegistryValue | null>(
  null
);

/** 注册场景物件 group，供 TransformControls 在场景缩放组外绑定 */
export function DirectorTransformRegistryProvider({ children }: { children: ReactNode }) {
  const registryRef = useRef(new Map<string, Group>());
  const [version, setVersion] = useState(0);

  const registerTransformGroup = useCallback((id: string, group: Group | null) => {
    const prev = registryRef.current.get(id);
    if (group) {
      // 同一 group 引用不重复触发渲染，避免 React #185 无限更新
      if (prev === group) return;
      registryRef.current.set(id, group);
    } else {
      if (prev === undefined) return;
      registryRef.current.delete(id);
    }
    setVersion((v) => v + 1);
  }, []);

  const getTransformGroup = useCallback((id: string) => {
    void version;
    return registryRef.current.get(id) ?? null;
  }, [version]);

  const value = useMemo(
    () => ({ registerTransformGroup, getTransformGroup }),
    [getTransformGroup, registerTransformGroup]
  );

  return (
    <DirectorTransformRegistryContext.Provider value={value}>
      {children}
    </DirectorTransformRegistryContext.Provider>
  );
}

export function useDirectorTransformRegistry(): DirectorTransformRegistryValue {
  const ctx = useContext(DirectorTransformRegistryContext);
  if (!ctx) {
    throw new Error("useDirectorTransformRegistry must be used within DirectorTransformRegistryProvider");
  }
  return ctx;
}
