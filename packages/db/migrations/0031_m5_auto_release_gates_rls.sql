-- Migration 0031: standardize auto_release_gates RLS policy to flowdesk.current_organization_id() (#179)

DROP POLICY IF EXISTS auto_release_gates_tenant ON flowdesk.auto_release_gates;
CREATE POLICY auto_release_gates_tenant ON flowdesk.auto_release_gates
    FOR ALL
    TO PUBLIC
    USING (organization_id = flowdesk.current_organization_id())
    WITH CHECK (organization_id = flowdesk.current_organization_id());
