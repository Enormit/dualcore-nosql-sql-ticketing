-- ============================================================================
-- PolyFlash - Sample Seed Data
-- ============================================================================

INSERT INTO events (id, name, venue, start_time, total_seats)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'PolyFlash Live Concert 2026',
    'Saigon Exhibition and Convention Center (SECC)',
    '2026-12-20T19:30:00+07:00',
    100
  )
ON CONFLICT (id) DO NOTHING;
