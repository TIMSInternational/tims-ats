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

## Authorized rollout attempt

Run 34890050767 authenticated successfully and built/pushed image `1657b2f`, but
UpdateService was denied by the existing iam:PassRole condition. The policy incorrectly
used `build.apprunner.amazonaws.com` (the ECR access role's trust principal).
AWS's [managed App Runner policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSAppRunnerFullAccess.html)
uses `apprunner.amazonaws.com` for iam:PassedToService. The proposed repair changes only
that condition, retaining the exact existing ECR role ARN and all other statements.
The repair is committed in the bootstrap, but the production permission update was blocked
by automatic approval review pending explicit authorization. It has NOT been applied;
production remains on its previous image. The OIDC trust change is applied and proven.

## Follow-up: the managed-policy example was insufficient

The user approved the `apprunner.amazonaws.com` condition; it was applied and verified
by exact readback. Deployment run 34890050767 (retry) still failed at UpdateService
with the same PassRole denial. No permissions boundary is attached to the deploy role.

The operation-specific [AWS service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_apprunner.html)
lists **bullet.amazonaws.com** as UpdateService's iam:PassedToService value. This differs
from the AWSAppRunnerFullAccess example cited above. The bootstrap and regression now
use that operation-specific value. This further IAM change is proposed, not applied,
and awaits explicit approval. The exact allowed ECR role ARN remains unchanged.
