import React, { useState, useEffect, useCallback, useId } from "react";
import type { MembershipMember } from "@flowdesk/contracts";
import { type RoleKey, hasPermission } from "@flowdesk/domain";
import { listMembers, inviteMember, updateMemberRole, revokeMember } from "../../api.js";
import { useAuth } from "../auth/context.js";

export interface TeamViewProps {
  initialShowInviteModal?: boolean;
}

export function TeamView({ initialShowInviteModal = false }: TeamViewProps = {}) {
  const { selectedOrgId, activeOrg, currentRole, showToast } = useAuth();
  const [members, setMembers] = useState<MembershipMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(initialShowInviteModal);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleKey>("agent");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (initialShowInviteModal) {
      setShowInviteModal(true);
    }
  }, [initialShowInviteModal]);

  const inviteEmailId = useId();
  const inviteRoleId = useId();

  const canInvite = hasPermission(currentRole, "membership:invite");
  const canModifyRole = hasPermission(currentRole, "membership:modify");
  const canRevokeMember = hasPermission(currentRole, "membership:revoke");

  const loadMembers = useCallback(
    async (orgId: string) => {
      try {
        setLoadingMembers(true);
        const res = await listMembers(orgId);
        setMembers(res.members);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load members", true);
      } finally {
        setLoadingMembers(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (selectedOrgId) {
      void loadMembers(selectedOrgId);
    }
  }, [selectedOrgId, loadMembers]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !inviteEmail.trim()) return;

    try {
      setInviting(true);
      const idempotencyKey = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await inviteMember(
        selectedOrgId,
        { email: inviteEmail.trim(), role: inviteRole },
        idempotencyKey
      );
      showToast(`Invitation sent to ${inviteEmail}!`);
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("agent");
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to invite member", true);
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: RoleKey) => {
    if (!selectedOrgId) return;
    try {
      const idempotencyKey = `role-${memberId}-${Date.now()}`;
      await updateMemberRole(selectedOrgId, memberId, newRole, idempotencyKey);
      showToast("Role updated successfully!");
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update role", true);
    }
  };

  const handleRevoke = async (memberId: string, displayName: string) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Are you sure you want to remove ${displayName} from the team?`)) return;

    try {
      const idempotencyKey = `revoke-${memberId}-${Date.now()}`;
      await revokeMember(selectedOrgId, memberId, idempotencyKey);
      showToast(`${displayName} was removed from the team.`);
      void loadMembers(selectedOrgId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove member", true);
    }
  };

  return (
    <>
      <div className="glass-card">
        <div className="section-header">
          <div>
            <h2 className="section-title">Team Members</h2>
            <p className="section-subtitle">
              Manage members and role permissions for {activeOrg?.name}.
            </p>
          </div>
          {canInvite && (
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="btn btn-primary btn-sm"
              id="invite-member-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Invite Member
            </button>
          )}
        </div>

        {loadingMembers ? (
          <div style={{ textAlign: "center", padding: "2rem" }}>Loading team…</div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  {canRevokeMember && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.displayName}</strong>
                    </td>
                    <td>{member.email}</td>
                    <td>
                      {canModifyRole ? (
                        <select
                          value={member.roleKey}
                          onChange={(e) =>
                            void handleRoleChange(member.id, e.target.value as RoleKey)
                          }
                          className="form-select"
                          style={{ width: "auto", padding: "0.2rem 0.5rem" }}
                          aria-label={`Change role for ${member.displayName}`}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="supervisor">Supervisor</option>
                          <option value="agent">Agent</option>
                          <option value="analyst">Analyst</option>
                          <option value="billing_admin">Billing Admin</option>
                        </select>
                      ) : (
                        <span className={`role-pill ${member.roleKey}`}>
                          {member.roleKey.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          textTransform: "capitalize",
                          color:
                            member.status === "active"
                              ? "var(--color-success)"
                              : "var(--color-warning)"
                        }}
                      >
                        {member.status}
                      </span>
                    </td>
                    {canRevokeMember && (
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(member.id, member.displayName)}
                          className="btn btn-danger btn-sm"
                          aria-label={`Remove ${member.displayName}`}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInviteModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="glass-card modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Invite Team Member</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="btn btn-secondary btn-sm"
              >
                ✕
              </button>
            </div>
            <form onSubmit={(e) => void handleInviteSubmit(e)}>
              <div className="form-group">
                <label className="form-label" htmlFor={inviteEmailId}>
                  Email Address
                </label>
                <input
                  id={inviteEmailId}
                  type="email"
                  required
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={inviteRoleId}>
                  Role
                </label>
                <select
                  id={inviteRoleId}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as RoleKey)}
                  className="form-select"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="agent">Agent</option>
                  <option value="analyst">Analyst</option>
                  <option value="billing_admin">Billing Admin</option>
                </select>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "flex-end",
                  marginTop: "1.5rem"
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="btn btn-primary"
                  id="send-invitation-btn"
                >
                  {inviting ? "Sending…" : "Send Invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
