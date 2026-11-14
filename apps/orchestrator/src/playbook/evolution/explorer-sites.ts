/**
 * Batch 06 — site list for the BullMQ-scheduled explorer.
 *
 * Intentionally EMPTY: a scheduled exploration spends money (Firecrawl / browse
 * model turns) and touches third-party sites, so sites are added here only by
 * an explicit, reviewed change. Even with sites listed, the job needs
 * PLAYBOOK_EXPLORER_SCHEDULE_ENABLED=true AND the explorer's own
 * EXPLORER_ENABLED=true, and stays inside the explorer budget breakers.
 */
export const EXPLORER_SCHEDULED_SITES: readonly string[] = [];
