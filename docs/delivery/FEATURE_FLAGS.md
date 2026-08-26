# Feature-flag registry

| Flag                           | Owner      | Default | Environments | Purpose                                                       | Removal gate                              |
| ------------------------------ | ---------- | ------: | ------------ | ------------------------------------------------------------- | ----------------------------------------- |
| `BOT_AUTOSEND_DEFAULT_ENABLED` | Automation | `false` | all          | Fail-safe global default; does not itself authorize auto-send | Replaced only by a stricter policy system |

Every new flag records owner, type, safe default, targeting boundary, audit need, rollout metric, kill-switch behavior, and expiry/removal issue. Client flags cannot authorize server behavior.
