-- ============================================================================
-- PolyFlash - User Profiles Schema (Neon DB)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    user_id         VARCHAR(128) PRIMARY KEY,
    full_name       VARCHAR(255) NOT NULL DEFAULT '',
    email           VARCHAR(255) NOT NULL UNIQUE,
    phone           VARCHAR(32)  NOT NULL DEFAULT '',
    address         TEXT         NOT NULL DEFAULT '',
    role            VARCHAR(32)  NOT NULL DEFAULT 'USER'
                    CHECK (role IN ('USER', 'ADMIN')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
