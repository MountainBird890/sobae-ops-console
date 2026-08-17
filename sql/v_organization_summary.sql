-- Read model for the Ops Console's list/dashboard screens. Matches exactly
-- what backend/src/routes/organizations.ts already queries — if you change
-- the column list here, update that file too (or vice versa).
-- Requires: organization_columns.sql.

create or replace view v_organization_summary as
select
  id,
  name,
  management_number,
  status,
  contract_start_date,
  contract_end_date
from organization;
