ALTER TABLE "users"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deletionScheduledAt" TIMESTAMP(3);

CREATE INDEX "users_deletionScheduledAt_idx" ON "users"("deletionScheduledAt");
