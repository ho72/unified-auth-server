CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "iconUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_services" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "firstUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loginCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_key_key" ON "services"("key");
CREATE UNIQUE INDEX "services_origin_key" ON "services"("origin");
CREATE UNIQUE INDEX "user_services_userId_serviceId_key" ON "user_services"("userId", "serviceId");
CREATE INDEX "user_services_lastUsedAt_idx" ON "user_services"("lastUsedAt");

ALTER TABLE "user_services"
ADD CONSTRAINT "user_services_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_services"
ADD CONSTRAINT "user_services_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "services" ("id", "key", "name", "origin", "iconUrl", "enabled")
VALUES
  ('svc_nook', 'nook', 'Nook', 'http://localhost:5173', NULL, true),
  ('svc_ouri', 'ouri', 'Ouri', 'http://localhost:5174', NULL, true)
ON CONFLICT ("key") DO NOTHING;
