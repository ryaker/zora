# Zora v0.6 - Async Steering Protocol

This document defines message schemas and routing contracts for steering across UI and gateways.

## SteerMessage

```json
{
  "type": "steer",
  "job_id": "job_123",
  "source": "web" ,
  "author": "user_abc",
  "message": "Focus on the API layer, skip CSS.",
  "timestamp": "2026-02-12T12:34:56Z"
}
```

## FlagDecision

```json
{
  "type": "flag_decision",
  "job_id": "job_123",
  "flag_id": "flag_7",
  "decision": "approve",
  "reason": "Proceed",
  "source": "telegram",
  "author": "user_abc",
  "timestamp": "2026-02-12T12:34:56Z"
}
```

## SteerAck

```json
{
  "type": "steer_ack",
  "job_id": "job_123",
  "steer_id": "steer_456",
  "status": "accepted",
  "timestamp": "2026-02-12T12:34:57Z"
}
```

## JobStatus (read‑only)

```json
{
  "type": "job_status",
  "job_id": "job_123",
  "state": "running",
  "provider": "claude",
  "progress": "45%",
  "timestamp": "2026-02-12T12:35:10Z"
}
```

## Constraints

- `source` is one of `web`, `telegram`, `cli`, `system`
- Messages are append‑only in audit log
- Steer messages never update policy or config

