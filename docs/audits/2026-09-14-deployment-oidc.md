# C# deployment OIDC failure — 2026-09-14

The first deployment workflow run (34887413432) failed at AssumeRoleWithWebIdentity.
The live API still serves image `5f083f0`; merging application code has not deployed it.

Read-only diagnosis found that GitHub reports `use_default=true`,
`use_immutable_subject=true`, and the subject prefix
`repo:TIMSInternational@305569681/tims-ats@1301900745`.
AWS instead trusted the old name-only prefix `repo:TIMSInternational/tims-ats`.
The role exists, so creating another role or adding access keys does not solve this mismatch.

The bootstrap now obtains live GitHub settings and validates the exact immutable repository
identity before any IAM mutation. Its generated policy uses StringEquals for both the AWS
audience and the main-branch subject. Unexpected/custom/mutable identities fail without
producing a policy. Readback compares the entire trust document, not a substring.
The deployment permissions are unchanged.

Local regression fixtures exercise the generated policy and invalid settings. The exact trust correction was applied to the existing IAM role and verified by full-document
readback. Production workflow dispatch was blocked by automatic approval review pending explicit
rollout authorization; no deployment was started.
Before frontend/backend acceptance, verify the shared relay signing secret and Redis readiness;
a successful public health check alone does not prove authenticated relay requests work.

Validation: API and web typechecks passed; 3,277 Vitest tests across 331 files passed,
including eight trust-policy cases. Bash syntax and ShellCheck passed.
