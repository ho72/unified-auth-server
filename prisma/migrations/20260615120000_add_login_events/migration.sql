CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT,
    "serviceKey" TEXT,
    "serviceName" TEXT,
    "serviceOrigin" TEXT,
    "ip" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_events_userId_createdAt_idx" ON "login_events"("userId", "createdAt");
CREATE INDEX "login_events_createdAt_idx" ON "login_events"("createdAt");

ALTER TABLE "login_events"
ADD CONSTRAINT "login_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
