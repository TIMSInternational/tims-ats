# C# email delivery boundary — issue #217

Status: implemented locally, default disabled; no invitation writes ported or production email sent in this slice.
Date: 2026-09-14.

## Contract and implementation

`Tims.Application.Email.IEmailSender.SendEmailAsync(to, subject, html, ct)` returns true only after SES responds HTTP 200 with a nonempty message identifier. This means provider acceptance, not inbox delivery. Disabled delivery, invalid input, failure, cancellation, circuit-open and uncertain outcomes return false. Callers must not mark invitations sent on false or interpret it as proof that no message was delivered.

The infrastructure adapter uses the official AWS-owned `AWSSDK.SimpleEmail` package, pinned to 4.0.100.13 with transitive dependencies in committed lockfiles. Package provenance: [NuGet](https://www.nuget.org/packages/AWSSDK.SimpleEmail/4.0.100.13), [AWS SendEmail contract](https://docs.aws.amazon.com/sdkfornet/v4/apidocs/items/SimpleEmail/MISimpleEmailServiceSendEmailAsyncSendEmailRequestCancellationToken.html).

API and worker hosts register the same boundary. No public email endpoint is added. It is internal infrastructure: invoking workflows must authorize the recipient/tenant and encode user-controlled template values. A message contains one recipient, a plain ASCII mailbox of at most 254 characters, subject of at most 200 characters without control characters, and nonempty HTML of at most 256,000 characters. Separate recipients avoid cross-tenant address disclosure.

The configured 1–60 second deadline covers lazy SDK initialization and dispatch as well as waiting for a response. Cancellation is passed to SES. At most eight dispatches remain outstanding per sender/host; when full, new sends fail immediately. If initialization outlives its deadline, it cannot subsequently start a send. A transport already in flight may still accept a message after cancellation. Its slot remains occupied until it finishes.

There are no application retries. SDK `MaxErrorRetry` and the independent `MaxStaleConnectionRetries` allowance are both zero. A singleton Polly circuit breaker suppresses sends for 30 seconds when at least half of five or more sampled attempts fail within 30 seconds. Caller cancellation is excluded; provider deadlines contribute failures. Circuit state and dispatch limits are per process, not a distributed SES quota limiter.

Warnings use fixed outcome categories. Recipient, subject, HTML, provider exception objects/messages and credentials are not logged by this adapter. Provider response/metrics logging is disabled in its SDK configuration.

This boundary does not implement a durable outbox, automatic retry, bounce/complaint ingestion or invitation state transitions. Those belong to the subsequent invitation workflow slice. Timeout ambiguity requires reconciliation/explicit resend policy rather than a generic automatic retry of false.

## Runtime configuration and activation

Both hosts default to `Email:Enabled=false`. Disabled resolution does not construct an AWS client or require credentials. Enabled configuration is validated at startup; invalid region/sender/timeout fails startup. Credentials come from the SDK default chain (workload IAM role in production), never new application configuration keys.

| Environment variable    | Value                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| `Email__Enabled`        | `false` until the consuming workflow and release gates are ready                |
| `Email__Region`         | Region containing the verified SES identity, independently of App Runner region |
| `Email__FromAddress`    | Verified sender mailbox, matched to the existing deployment's sender choice     |
| `Email__TimeoutSeconds` | `10` by default; accepted range 1–60                                            |

Read-only infrastructure observations on 2026-09-14:

- Production API is RUNNING on image `1657b2f`, App Runner region `us-west-2`.
- Its instance role is `tims-platform-api-instance-role`; attached policies are empty and its only inline policy grants Secrets Manager reads. It has no SES send grant.
- The service has no `Email__*` configuration values inspected above.
- No SES identities were listed in this account's `us-west-2`. Verified domains exist in `us-east-1`, including `timsint.com`, `timssuite.com` and `nexadev.ai`.
- TS source defaults to region `us-east-1` and `noreply@nexadev.ai`; source defaults do not establish the current deployed sender override.

Before activation: verify the actual sender and SES account/sandbox status; grant only `ses:SendEmail` on its verified identity with an exact `ses:FromAddress` condition to the consuming workload role; add explicit nonsecret runtime configuration while preserving the full existing App Runner environment/secret maps. Do not give the ECR access role mail permissions. This slice makes no IAM or runtime mutation and sends no real message.

Then test a controlled authorized delivery, verify the provider acceptance/failure states in the invitation workflow and its audit trail, and only then enable its C# write routing. The sender alone is not closure of #217 or #75.

## Verification

Focused integration tests use a fake SES client for contract, validation, failure, cancellation, deadline, credential-resolution and circuit behavior. Separate tests drive the actual AWS SDK over an in-memory HTTP handler to verify serialization and a single transport attempt on success, throttling, server error and connection reset. No AWS credentials, live email recipients or external transport calls are used in these tests.

Required release evidence: locked restore/build, focused email tests, relevant host regression tests, both TS type checks, independent review and normal CI. Record the actual performed review tier; same-model review is not cross-model verification.
