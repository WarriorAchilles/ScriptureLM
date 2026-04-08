-- Credentials auth (Step 05) + operator role for future scripts.

CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

ALTER TABLE "users" ADD COLUMN "password_hash" TEXT,
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user';
