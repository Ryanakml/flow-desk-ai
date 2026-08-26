# Role matrix draft

This is an M0 decision input, not implemented authorization. M1 converts permissions into tested policy code.

| Capability                     | Owner | Admin | Supervisor |                 Agent |    Analyst |  Billing admin |
| ------------------------------ | ----: | ----: | ---------: | --------------------: | ---------: | -------------: |
| Organization security settings | allow | allow |       deny |                  deny |       deny |           deny |
| Invite and change membership   | allow | allow |       deny |                  deny |       deny |           deny |
| Assign/resolve conversations   | allow | allow |      allow |              own/team |       read |           deny |
| Send messages                  | allow | allow |      allow | assigned/queue policy |       deny |           deny |
| Publish automation             | allow | allow |    propose |                  deny |       deny |           deny |
| View analytics                 | allow | allow |      allow |                scoped |      allow |         scoped |
| Manage billing                 | allow |  deny |       deny |                  deny | read usage |          allow |
| View audit log                 | allow | allow |     scoped |                  deny |       read | billing events |

No tenant role grants platform support access or bypasses tenant isolation.
