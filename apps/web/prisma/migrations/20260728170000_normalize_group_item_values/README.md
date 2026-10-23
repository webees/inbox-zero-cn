# Recover group item normalization

The original SQL used `\v`, which PostgreSQL 15 interprets as the literal letter
`v`. The corrected SQL uses the portable octal escape `\013` for vertical tab.

修改此文件不会重新运行已完成的迁移，也不会清除已记录的失败。对于受影响的数据库（包括原始迁移已成功完成的数据库），请使用此过程。

Run from `apps/web` with `DIRECT_URL` set to a writable, direct connection to the
affected database. Ensure Prisma's configured migration URL points to the same
database; preview URL variables take precedence over `DIRECT_URL`.

1. Check migration history with `pnpm exec prisma migrate status`.
2. Apply the corrected SQL atomically. The lock prevents concurrent pattern
   writes between deduplication and normalization; a lock timeout leaves the
   database unchanged and allows a later retry.

   ```sh
   (
     set -eu
     recovery_sql=$(mktemp)
     trap 'rm -f "$recovery_sql"' EXIT
     printf '%s\n' "SET LOCAL lock_timeout = '5s';" 'LOCK TABLE "GroupItem" IN SHARE ROW EXCLUSIVE MODE;' > "$recovery_sql"
     cat prisma/migrations/20260728170000_normalize_group_item_values/migration.sql >> "$recovery_sql"
     psql "$DIRECT_URL" -X --single-transaction -v ON_ERROR_STOP=1 -f "$recovery_sql"
   )
   ```

3. **Only if the SQL succeeds and Prisma recorded this migration as failed**, mark
   it applied:

   ```sh
   pnpm exec prisma migrate resolve --applied 20260728170000_normalize_group_item_values
   ```

   如果该迁移已成功应用，请跳过此步骤。
4. Run `pnpm exec prisma migrate status` again, then deploy normally to apply any
   pending migrations.

The corrected SQL is safe to rerun: it trims whitespace, removes empty values,
and deduplicates normalized patterns using the migration's ownership and recency
priorities. It cannot reconstruct letters stripped or records deleted by an
already-successful run of the original SQL. Recover those from a backup if needed;
do not guess original values. Do not delete migration history or mark a failed
migration applied before its SQL completes successfully.
