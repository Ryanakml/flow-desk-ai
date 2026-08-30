-- M4-10: bootstrap-safe organization discovery without weakening tenant RLS.

CREATE OR REPLACE FUNCTION flowdesk.list_user_organizations(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  role_key text,
  membership_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = flowdesk, pg_temp
AS $$
  SELECT o.id, o.slug, o.display_name, r.key, m.id
  FROM flowdesk.memberships AS m
  JOIN flowdesk.organizations AS o ON o.id = m.organization_id
  JOIN flowdesk.roles AS r ON r.id = m.role_id AND r.organization_id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND o.status = 'active'
    AND o.deleted_at IS NULL
  ORDER BY o.display_name ASC, o.id ASC
$$;

ALTER FUNCTION flowdesk.list_user_organizations(uuid) OWNER TO flowdesk_system;
REVOKE ALL ON FUNCTION flowdesk.list_user_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flowdesk.list_user_organizations(uuid) TO flowdesk_runtime;
