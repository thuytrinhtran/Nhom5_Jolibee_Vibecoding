# Inventory (content-based mapping)

Original filenames retained. HIGH = column/content match; MEDIUM = compatible supplemental COUNT without its exact SQL. No missing file implies a query was not run.

| Original CSV filename | Query / original ordinal | Rows | Result | Confidence |
|---|---|---:|---|---|
| Supabase Snippet Untitled query (32).csv | S1 / 32 | 206 | 206/206; complete by total_rows | HIGH |
| Supabase Snippet Untitled query (33).csv | S2 / 33 | 18 | 18/18; complete by total_rows | HIGH |
| Supabase Snippet Untitled query (34).csv | S3 / 34 | 64 | 64/64; complete by total_rows | HIGH |
| Supabase Snippet Untitled query (35).csv | S4 / 35 | 54 | 54/54; complete by total_rows; identical to Supabase Snippet Untitled query (36).csv | HIGH |
| Supabase Snippet Untitled query (36).csv | S4 / 35 | 54 | 54/54; complete by total_rows; identical to Supabase Snippet Untitled query (35).csv | HIGH |
| Supabase Snippet Untitled query (37).csv | S6 / 37 | 60 | Existing employee/Auth bindings | HIGH |
| Supabase Snippet Untitled query (38).csv | D1.1 / 38 | 1 | Period and effective status | HIGH |
| Supabase Snippet Untitled query (39).csv | D1.2 / 39 | 1 | cells=63; positions=308; demand_evidence_md5=34ef45ab2d0038f49faf75c9958bca0e; identical to Supabase Snippet Untitled query (40).csv | HIGH |
| Supabase Snippet Untitled query (40).csv | D1.2 / 39 | 1 | cells=63; positions=308; demand_evidence_md5=34ef45ab2d0038f49faf75c9958bca0e; identical to Supabase Snippet Untitled query (39).csv | HIGH |
| Supabase Snippet Untitled query (41).csv | D2.1 / 41 | 4 | Employee skill counts | HIGH |
| Supabase Snippet Untitled query (42).csv | D2.2 / 42 | 1 | Branch supervisor | HIGH |
| Supabase Snippet Untitled query (43).csv | D2.3 / 43 | 3 | Branch profile counts | HIGH |
| Supabase Snippet Untitled query (44).csv | D3.1 / 44 | 1 | status=VALID; sample_batch_id=null; headers=2; recorded_after_close=0 | HIGH |
| Supabase Snippet Untitled query (45).csv | D3.2 / 45 | 7 | Daily registration counts | HIGH |
| Supabase Snippet Untitled query (46).csv | D4.1 COUNT variant / 46 | 1 | duplicate_open_requests=0 | MEDIUM |
| Supabase Snippet Untitled query (47).csv | D4.2 COUNT variant / 47 | 1 | duplicate_open_incidents=0 | MEDIUM |
| Supabase Snippet Untitled query (48).csv | D4.3 COUNT variant / 48 | 1 | overlapping_open_requests_incidents=0 | MEDIUM |
| Supabase Snippet Untitled query (49).csv | D4.4 / 49 | 2 | requests=0; incidents=0 legacy open without snapshot | HIGH |
| Supabase Snippet Untitled query (50).csv | D7.1 / 56 | 1 | singleton=true; timezone=Asia/Ho_Chi_Minh; open_iso_day=5; open_local_time=15:00:00; close_iso_day=7; close_local_time=12:00:00; reminder_minutes=30 | HIGH |
| Supabase Snippet Untitled query (51).csv | D7.2 / 57 | 1 | singleton=true; enabled=false | HIGH |
| Supabase Snippet Untitled query (52).csv | Auth check / outside 17-57 | 17 | 17 missing Auth/profile; 0 employee bindings | HIGH |
| Supabase Snippet Untitled query (53).csv | Dev-import SELECT 1 / outside 17-57 | 1 | current_database=postgres; current_user=postgres; statement_timestamp=2026-11-02 12:37:45.960434+00; current_setting=off | HIGH |
| Supabase Snippet Untitled query (54).csv | Dev-import SELECT 2 / outside 17-57 | 1 | registry=null; row_source=null; header_gate=null; row_gate=null | HIGH |
| Supabase Snippet Untitled query (55).csv | Dev-import SELECT 3-compatible / outside 17-57 | 1 | Catalog EXECUTE/checksum; execution provenance unconfirmed | HIGH |
