"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import type { QueryClient } from "@tanstack/react-query";
import { getCreditBalance, getCreditQuote, resolveQuoteTotal, type CreditBalance } from "@/lib/api/credits";
import { getProjectBillingBalance } from "@/lib/api/projects";
import { useCanvasStore } from "@/stores/canvasStore";
import { estimateCreditFromPricing } from "@/lib/canvas/generationCreditHelpers";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";
import type { GenerationOptions } from "@/types/generationPresets";

function stableOptionsKey(options: GenerationOptions | undefined): string {
  if (!options) return "";
  return JSON.stringify(
    Object.keys(options)
      .sort()
      .map((key) => [key, options[key]])
  );
}

export function useCreditBalance(enabled = true) {
  return useQuery<CreditBalance, Error>({
    queryKey: ["credits", "balance"],
    queryFn: (): Promise<CreditBalance> => getCreditBalance(),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Owner balance on canvas; collaborators see project billing pool. */
export function useCanvasCreditBalance(projectId?: string, projectRole?: "owner" | "editor" | null) {
  const personal = useCreditBalance();
  const isCollaborator = projectRole === "editor" && Boolean(projectId);

  const projectBilling = useQuery({
    queryKey: ["projects", projectId, "billing-balance"],
    queryFn: () => getProjectBillingBalance(projectId!),
    enabled: isCollaborator,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  if (!isCollaborator) {
    return {
      ...personal,
      ownerDisplayName: null as string | null,
      isCollaborator: false,
    };
  }

  const billing = projectBilling.data;
  return {
    data: billing
      ? {
          balance: billing.balance,
          availableForModel: billing.availableForModel ?? billing.balance,
          creditsEnabled: billing.creditsEnabled,
        }
      : undefined,
    isLoading: projectBilling.isLoading,
    isError: projectBilling.isError,
    refetch: projectBilling.refetch,
    ownerDisplayName: billing?.ownerDisplayName ?? null,
    isCollaborator: true,
  };
}

export function useCanvasStoreCreditBalance() {
  const projectId = useCanvasStore((s) => s.projectId);
  const projectRole = useCanvasStore((s) => s.projectRole);
  return useCanvasCreditBalance(projectId, projectRole);
}

/** Refresh personal and project-scoped credit balances after generation. */
export function invalidateCanvasCreditQueries(
  queryClient: QueryClient,
  projectId?: string | null
) {
  void queryClient.invalidateQueries({ queryKey: ["credits", "balance"] });
  if (projectId) {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "billing-balance"] });
  }
}

export function useGenerationCreditQuote(params: {
  model: string | undefined;
  category?: ModelCategory | "tool";
  generationOptions?: GenerationOptions;
  pricing?: Record<string, unknown>;
  pricingVersion?: number;
  canvasTool?: string;
  enabled?: boolean;
}) {
  const optionsKey = stableOptionsKey(params.generationOptions);
  const enabled = Boolean(params.enabled !== false && params.model);
  const pricingVersion =
    params.pricingVersion ?? Math.max(Number(params.pricing?.version) || 0, 0);

  const fallbackTotal = useMemo(
    () => estimateCreditFromPricing(params.pricing, params.generationOptions ?? {}),
    [params.pricing, params.generationOptions]
  );

  const query = useQuery({
    queryKey: [
      "credits",
      "quote",
      params.model,
      params.category,
      optionsKey,
      pricingVersion,
      params.canvasTool ?? "",
    ],
    queryFn: () =>
      getCreditQuote({
        model: params.model!,
        category: params.category,
        generationOptions: params.generationOptions,
        canvasTool: params.canvasTool,
      }),
    staleTime: 30_000,
    enabled,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        return false;
      }
      return failureCount < 1;
    },
    refetchOnWindowFocus: false,
  });

  const apiTotal =
    query.isSuccess && query.data ? resolveQuoteTotal(query.data) : null;
  // 画布工具固定价：无 API 时勿回落到模型档位价，避免顶栏误导
  const total = params.canvasTool
    ? (apiTotal ?? 0)
    : (apiTotal ?? fallbackTotal);

  return {
    quote: query.data,
    quoteToken: query.data?.quoteToken,
    pricingVersion: query.data?.pricingVersion,
    total,
    fallbackTotal,
    usingFallback: apiTotal == null && !params.canvasTool && fallbackTotal > 0,
    creditsEnabled: query.data?.creditsEnabled ?? true,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
