ALTER TABLE "users"
ADD COLUMN "phoneCountry" TEXT;

DROP INDEX IF EXISTS "users_phone_idx";

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
