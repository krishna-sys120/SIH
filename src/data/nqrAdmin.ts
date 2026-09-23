/** NQR admin RPC typing (supabase/nqr-migration.sql §5). */
export interface NqrAdminSummary {
  total: number;
  active: number;
  expired: number;
  archived: number;
  uncertain: number;
  duplicates: number;
  last_import: string | null;
  import_runs: number;
  last_verified: string | null;
}
