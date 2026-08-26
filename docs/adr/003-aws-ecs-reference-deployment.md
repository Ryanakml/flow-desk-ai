# ADR-003: AWS ECS Fargate reference deployment

- Status: Accepted
- Date: 2026-08-26
- Owners: FlowDesk engineering and platform
- Requirement: OPS-DEPLOY-001

## Context

The initial team needs isolated environments, managed persistence, immutable containers, and a credible high-availability path without operating Kubernetes.

## Decision

Use CloudFront/WAF and an ALB at the public edge; ECS Fargate for application roles; RDS PostgreSQL, ElastiCache Redis, S3/KMS, ECR, Secrets Manager, CloudWatch/OpenTelemetry, Route 53, and ACM. Provision environments through Terraform with remote encrypted state and protected apply. Docker Compose is local development infrastructure, not the production HA reference.

## Consequences

The platform inherits AWS operational patterns and cost. Process-role images remain portable, while infrastructure modules are AWS-specific. Kubernetes is considered only with demonstrated scheduling requirements and an operating team able to own it.

## Reversal

Deploy the same immutable OCI images on a new target after database, queue, storage, secret, network, observability, backup, and rollback parity is demonstrated.
