-- Track verified contact points on first-party users.
ALTER TABLE "users"
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

UPDATE "users"
SET "emailVerifiedAt" = "updatedAt"
WHERE "isEmailVerified" = true
  AND "emailVerifiedAt" IS NULL;

CREATE INDEX "users_phone_idx" ON "users"("phone");

-- Store the provider identity snapshot used for account linking and profile sync.
ALTER TABLE "oauth_accounts"
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "oauth_accounts_email_idx" ON "oauth_accounts"("email");
CREATE INDEX "oauth_accounts_phone_idx" ON "oauth_accounts"("phone");
