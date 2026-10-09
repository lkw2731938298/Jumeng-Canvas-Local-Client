import { z } from "zod";

/**
 * Jumeng 本地剪辑台模式：不强制连 Postgres/Redis/Marble，仅校验公共 URL。
 * 正式 OpenCut SaaS 仍可用完整 schema（未设 NEXT_PUBLIC_JUMENG_MODE）。
 */
const jumengMode = process.env.NEXT_PUBLIC_JUMENG_MODE === "1";

const webEnvSchema = jumengMode
	? z.object({
			NODE_ENV: z.enum(["development", "production", "test"]),
			ANALYZE: z.string().optional(),
			NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
			NEXT_PUBLIC_SITE_URL: z.url().default("http://127.0.0.1:3100"),
			NEXT_PUBLIC_MARBLE_API_URL: z
				.url()
				.default("https://api.marblecms.com"),
			NEXT_PUBLIC_JUMENG_MODE: z.string().optional(),
			NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN: z
				.url()
				.default("http://127.0.0.1:3456"),
			DATABASE_URL: z.string().optional(),
			BETTER_AUTH_SECRET: z.string().optional(),
			UPSTASH_REDIS_REST_URL: z.string().optional(),
			UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
			MARBLE_WORKSPACE_KEY: z.string().optional(),
			FREESOUND_CLIENT_ID: z.string().optional(),
			FREESOUND_API_KEY: z.string().optional(),
		})
	: z.object({
			NODE_ENV: z.enum(["development", "production", "test"]),
			ANALYZE: z.string().optional(),
			NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
			NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
			NEXT_PUBLIC_MARBLE_API_URL: z.url(),
			DATABASE_URL: z.string().refine(
				(url) =>
					url.startsWith("postgres://") || url.startsWith("postgresql://"),
				"DATABASE_URL must be a postgres:// or postgresql:// URL",
			),
			BETTER_AUTH_SECRET: z.string(),
			UPSTASH_REDIS_REST_URL: z.url(),
			UPSTASH_REDIS_REST_TOKEN: z.string(),
			MARBLE_WORKSPACE_KEY: z.string(),
			FREESOUND_CLIENT_ID: z.string(),
			FREESOUND_API_KEY: z.string(),
		});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(process.env);
