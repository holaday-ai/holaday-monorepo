import { newExternalId } from '@holaday/shared-types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { type NewSite, type Site, sites } from '../db/schema/sites.js';

/**
 * Phase 1 指令 #3 — `SiteRepository` (Pack A storage foundation).
 *
 * The single place that touches the `sites` table. Skeleton scope: CRUD
 * + the runtime/seed lookups the later packs need (resolve a site by
 * domain for ExecutionRouter, list for admin/seed). NOT wired into any
 * runtime path in Pack A.
 *
 * Global-site dedup is enforced HERE, not by a unique index: MySQL does
 * not treat multiple `owner_user_id IS NULL` rows as conflicting, so
 * `create()` checks-then-inserts inside a transaction (with a row lock
 * on the matching global row) and throws `SiteDomainConflictError` if a
 * global site already exists for the domain. Private (owner-scoped)
 * sites are not deduped here — that path is deferred.
 */

/** Thrown when creating a global site for a domain that already has one. */
export class SiteDomainConflictError extends Error {
  constructor(public readonly canonicalDomain: string) {
    super(`a global site already exists for domain ${JSON.stringify(canonicalDomain)}`);
    this.name = 'SiteDomainConflictError';
  }
}

export interface CreateSiteInput {
  /** NULL / omitted = system-global site (BOSS/admin). */
  ownerUserId?: number | null;
  canonicalDomain: string;
  displayName: string;
  homepageUrl: string;
  purposeSummary?: string | null;
  category?: string | null;
  language?: string | null;
  region?: string | null;
  siteStatus?: string;
  defaultAuthPolicy?: string;
  riskLevel?: string;
  antiBotLevel?: string;
  metadataJson?: unknown;
}

export class SiteRepository {
  constructor(private readonly db: DB) {}

  /**
   * Insert a site. For a global site (ownerUserId null) the unique
   * "one row per domain" rule is enforced in the app layer inside a
   * transaction. Returns the created row.
   */
  async create(input: CreateSiteInput): Promise<Site> {
    const ownerUserId = input.ownerUserId ?? null;
    const externalId = newExternalId('site');
    const values: NewSite = {
      externalId,
      ownerUserId,
      canonicalDomain: input.canonicalDomain,
      displayName: input.displayName,
      homepageUrl: input.homepageUrl,
      purposeSummary: input.purposeSummary ?? null,
      category: input.category ?? null,
      language: input.language ?? null,
      region: input.region ?? null,
      ...(input.siteStatus ? { siteStatus: input.siteStatus } : {}),
      ...(input.defaultAuthPolicy ? { defaultAuthPolicy: input.defaultAuthPolicy } : {}),
      ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      ...(input.antiBotLevel ? { antiBotLevel: input.antiBotLevel } : {}),
      ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
    };

    const id = await this.db.transaction(async (tx) => {
      if (ownerUserId === null) {
        const existing = await tx
          .select({ id: sites.id })
          .from(sites)
          .where(and(eq(sites.canonicalDomain, input.canonicalDomain), isNull(sites.ownerUserId)))
          .for('update')
          .limit(1);
        if (existing[0]) {
          throw new SiteDomainConflictError(input.canonicalDomain);
        }
      }
      const insert = await tx.insert(sites).values(values);
      return readInsertId(insert);
    });

    return { ...(values as Site), id };
  }

  async findByExternalId(externalId: string): Promise<Site | null> {
    const [row] = await this.db
      .select()
      .from(sites)
      .where(eq(sites.externalId, externalId))
      .limit(1);
    return row ?? null;
  }

  /** The single global site for a domain, if any. */
  async findGlobalByDomain(canonicalDomain: string): Promise<Site | null> {
    const [row] = await this.db
      .select()
      .from(sites)
      .where(and(eq(sites.canonicalDomain, canonicalDomain), isNull(sites.ownerUserId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Resolve the site to use for a domain at runtime: a caller's private
   * site wins over the global one. Returns null when neither exists.
   */
  async resolveForDomain(
    canonicalDomain: string,
    ownerUserId?: number | null,
  ): Promise<Site | null> {
    if (ownerUserId != null) {
      const [priv] = await this.db
        .select()
        .from(sites)
        .where(and(eq(sites.canonicalDomain, canonicalDomain), eq(sites.ownerUserId, ownerUserId)))
        .limit(1);
      if (priv) return priv;
    }
    return this.findGlobalByDomain(canonicalDomain);
  }

  /** Update a site's lifecycle status. Returns true when a row changed. */
  async updateStatus(externalId: string, siteStatus: string): Promise<boolean> {
    const res = await this.db
      .update(sites)
      .set({ siteStatus })
      .where(eq(sites.externalId, externalId));
    return readAffectedRows(res) > 0;
  }

  /**
   * List sites, newest first. `ownerUserId: null` lists the global
   * catalogue; a number lists that owner's private sites; omit to list
   * everything (admin/seed tooling).
   */
  async list(opts: { ownerUserId?: number | null } = {}): Promise<Site[]> {
    const base = this.db.select().from(sites);
    const scoped =
      opts.ownerUserId === undefined
        ? base
        : opts.ownerUserId === null
          ? base.where(isNull(sites.ownerUserId))
          : base.where(eq(sites.ownerUserId, opts.ownerUserId));
    return scoped.orderBy(desc(sites.createdAt));
  }
}
