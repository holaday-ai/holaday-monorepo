import { z } from 'zod';

/**
 * SKILL.md manifest schema (frontmatter + the body is free-form Markdown
 * consumed by the commander's system prompt). Frontmatter is validated
 * strictly; unknown keys are rejected to keep authors honest.
 *
 * Slug convention: kebab-case segments, e.g. `taobao-qianniu-inbox`.
 * Version: semver-ish string stored in the DB uniquely with slug.
 */

const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/u, 'slug must be kebab-case')
  .min(3)
  .max(96);

export const skillManifestSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1).max(128),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u, 'version must be semver-like'),
    description: z.string().min(1).max(1024),
    occupationTag: z.string().min(1).max(64).optional(),
    entryUrls: z.array(z.string().url()).min(1),
    riskFloor: z.enum(['low', 'medium', 'high']).default('low'),
    /** Free-form hints for the commander; surfaces into the plan system prompt. */
    hints: z.array(z.string().min(1).max(512)).max(16).optional(),
    /** Execution caveats and known limitations; surfaces to the UI. */
    caveats: z.array(z.string().min(1).max(512)).max(16).optional(),
    /**
     * Origin allowlist the driver layer enforces. Supports `*.example.com`
     * wildcard subdomains. HOLA DAY relies on the user's already-logged-in
     * browser session — no OAuth, no password storage — so this list just
     * scopes which pages the Skill is permitted to touch.
     */
    allowedOrigins: z
      .array(
        z
          .string()
          .min(1)
          .max(128)
          .regex(
            /^\*?\.?[a-z0-9][a-z0-9.-]*[a-z0-9](:\d+)?$/i,
            'allowedOrigins entries look like "example.com" or "*.example.com"',
          ),
      )
      .max(32)
      .optional(),
  })
  .strict();

export type SkillManifest = z.infer<typeof skillManifestSchema>;
