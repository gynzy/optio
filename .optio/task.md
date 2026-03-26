# feat: Slack integration

feat: Slack integration

## Problem

Teams use Slack for coordination. No way to get Optio notifications in Slack or take quick actions from there.

## Features

- **Incoming notifications**: Post to a Slack channel on task events (completed, failed, needs_attention, PR opened)
- **Rich formatting**: Slack Block Kit messages with task details, cost, PR link
- **Quick actions**: Buttons in Slack messages (Retry, View Logs, Cancel)
- **Configuration**: Per-repo or global Slack webhook URL in settings

## Implementation

- Build on top of the webhook/notification system (#49)
- Slack-specific payload formatter
- Action endpoint for Slack interactive components

## Acceptance Criteria

- [ ] Slack channel receives formatted notifications on task events
- [ ] Messages include task details, cost, and PR link
- [ ] Quick action buttons work (retry, view)
- [ ] Configurable per-repo or globally

---

_Optio Task ID: 6f7d42e2-7920-4b7f-96b4-4f472e718cb9_
