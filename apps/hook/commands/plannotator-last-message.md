---
description: Open the last assistant message in plan review UI
allowed-tools: Bash(plannotator:*)
disable-model-invocation: true
---

## Plan Review of Last Message

!`plannotator last-message`

## Your task

The output above will be one of:

1. The exact text `The user approved.`, OR a JSON object with `"decision": "approved"`. The user approved your last message. Acknowledge with a single sentence ("Approved.") and stop. Do not begin any work.
2. Empty, OR a JSON object with `"decision": "dismissed"`. The user closed the session without action. Acknowledge with a single sentence ("Plan review closed.") and stop. Do not begin any work.
3. Plaintext feedback, OR a JSON object with `"decision": "denied"` and a `"feedback"` field. Address the feedback. The user has reviewed your last message and requested changes.
