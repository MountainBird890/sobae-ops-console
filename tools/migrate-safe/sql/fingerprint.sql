-- Console schema fingerprint (SHA-256, single value).
--
-- Derived from Sobae_Works' db/migrate-safe/fingerprint.sql (fingerprint_version 2), re-scoped from
-- the `public` schema to the `console` schema, with these deliberate differences:
--   * built-in sha256() instead of pgcrypto's digest() (no extension dependency)
--   * views are included in the ownership and privilege lines (relkind 'v'/'m'); the Sobae_Works
--     original only covers relkind 'r' there, so a view's ACL could change unnoticed
--   * privilege lines use COALESCE(acl, acldefault(...)), so an object whose ACL was never touched
--     (default = PUBLIC EXECUTE for functions) still shows up as an explicit PUBLIC line
--   * the schema itself (owner + ACL) is part of the fingerprint
--
-- Returns NULL when the `console` schema does not exist (callers treat that as 'EMPTY').
-- Read-only: a single SELECT, no DDL/DML.

WITH ext_objects AS (
    SELECT classid, objid FROM pg_depend WHERE deptype = 'e'
),
lines AS (
    -- schema
    SELECT 'NSP|' || n.nspname || '|' || pg_get_userbyid(n.nspowner) AS line
    FROM pg_namespace n WHERE n.nspname = 'console'

    UNION ALL

    SELECT 'NSPACL|' || n.nspname || '|' ||
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || '|' || a.privilege_type
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'console'

    UNION ALL

    -- tables
    SELECT 'TBL|' || c.relname
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'console' AND c.relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=c.oid)

    UNION ALL

    -- columns (by name; the physical column position is not compared)
    SELECT 'COL|' || c.relname || '|' || a.attname || '|' ||
           tn.nspname || '.' || bt.typname || '|' ||
           format_type(a.atttypid, a.atttypmod) || '|' ||
           a.atttypmod::text || '|' ||
           (NOT a.attnotnull)::text || '|' ||
           COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') || '|' ||
           a.attidentity::text || '|' || a.attgenerated::text || '|' ||
           COALESCE(coll.collname, '') || '|' ||
           COALESCE(a.attcompression::text, '') || '|' ||
           a.attstorage::text
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_type bt ON a.atttypid = bt.oid
    JOIN pg_namespace tn ON bt.typnamespace = tn.oid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    LEFT JOIN pg_collation coll ON a.attcollation = coll.oid
    WHERE n.nspname = 'console' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=c.oid)

    UNION ALL

    -- column privileges
    SELECT 'COLPRIV|' || c.relname || '|' || a.attname || '|' ||
           (CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) || '|' || x.privilege_type
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE n.nspname = 'console' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=c.oid)

    UNION ALL

    -- constraints (including foreign keys into public tables)
    SELECT 'CON|' || rel.relname || '|' || con.conname || '|' || con.contype::text || '|' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class rel ON con.conrelid = rel.oid
    JOIN pg_namespace n ON rel.relnamespace = n.oid
    WHERE n.nspname = 'console'
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=rel.oid)

    UNION ALL

    -- indexes
    SELECT 'IDX|' || t.relname || '|' || i.relname || '|' || ix.indisunique::text || '|' || am.amname || '|' || pg_get_indexdef(ix.indexrelid)
    FROM pg_index ix
    JOIN pg_class i ON ix.indexrelid = i.oid
    JOIN pg_class t ON ix.indrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_am am ON i.relam = am.oid
    WHERE n.nspname = 'console'
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=i.oid)
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=t.oid)

    UNION ALL

    -- views
    SELECT 'VIEW|' || c.relname || '|' || regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g')
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'console' AND c.relkind IN ('v','m')
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=c.oid)

    UNION ALL

    -- functions (body hashed after whitespace normalisation)
    SELECT 'FUNC|' || p.proname || '|' || p.prokind::text || '|' || pg_get_function_identity_arguments(p.oid) || '|' ||
           pg_get_function_result(p.oid) || '|' ||
           (CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END) || '|' ||
           COALESCE((SELECT array_to_string(array_agg(cfg ORDER BY cfg COLLATE "C"), ';')
                     FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg WHERE cfg LIKE 'search_path=%'), '') || '|' ||
           pg_get_userbyid(p.proowner) || '|' ||
           md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'console' AND p.prokind IN ('f','p')
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_proc'::regclass AND eo.objid=p.oid)

    UNION ALL

    -- triggers
    SELECT 'TRG|' || c.relname || '|' || t.tgname || '|' ||
           (CASE WHEN (t.tgtype::int & 2) <> 0 THEN 'BEFORE' WHEN (t.tgtype::int & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END) || '|' ||
           (CASE WHEN (t.tgtype::int & 4) <> 0 THEN 'I' ELSE '' END) ||
           (CASE WHEN (t.tgtype::int & 8) <> 0 THEN 'D' ELSE '' END) ||
           (CASE WHEN (t.tgtype::int & 16) <> 0 THEN 'U' ELSE '' END) || '|' ||
           p.proname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE n.nspname = 'console' AND NOT t.tgisinternal

    UNION ALL

    -- row level security state and policies
    SELECT 'RLST|' || c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'console' AND c.relkind = 'r'

    UNION ALL

    SELECT 'RLSP|' || tablename || '|' || policyname || '|' || permissive || '|' ||
           array_to_string(roles, ',') || '|' || cmd || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, '')
    FROM pg_policies WHERE schemaname = 'console'

    UNION ALL

    -- owners (tables, views, functions)
    SELECT 'OWN|rel|' || c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'console' AND c.relkind IN ('r','v','m')

    UNION ALL

    SELECT 'OWN|function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || pg_get_userbyid(p.proowner)
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'console' AND p.prokind IN ('f','p')

    UNION ALL

    -- table / view privileges (default ACL included when the ACL was never changed)
    SELECT 'RELPRIV|' || c.relname || '|' ||
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || '|' || a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE n.nspname = 'console' AND c.relkind IN ('r','v','m')
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_class'::regclass AND eo.objid=c.oid)

    UNION ALL

    -- sequence privileges
    SELECT 'SEQPRIV|' || c.relname || '|' ||
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || '|' || a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('s', c.relowner))) a
    WHERE n.nspname = 'console' AND c.relkind = 'S'

    UNION ALL

    -- function EXECUTE privileges (default ACL included: an untouched function is PUBLIC-executable)
    SELECT 'FUNCPRIV|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || '|' || a.privilege_type
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'console' AND p.prokind IN ('f','p')
      AND NOT EXISTS (SELECT 1 FROM ext_objects eo WHERE eo.classid='pg_proc'::regclass AND eo.objid=p.oid)
)
SELECT encode(sha256(convert_to(string_agg(line, E'\n' ORDER BY line COLLATE "C"), 'UTF8')), 'hex') AS schema_fingerprint
FROM lines;
