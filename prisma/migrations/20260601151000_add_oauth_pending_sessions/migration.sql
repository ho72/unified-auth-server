CREATE TABLE "oauth_pending_sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_pending_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_pending_sessions_tokenHash_key" ON "oauth_pending_sessions"("tokenHash");
CREATE INDEX "oauth_pending_sessions_expiresAt_idx" ON "oauth_pending_sessions"("expiresAt");

ALTER TABLE "oauth_pending_sessions"
ADD CONSTRAINT "oauth_pending_sessions_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
