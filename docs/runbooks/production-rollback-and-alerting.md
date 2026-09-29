# Production rollback and alerting

Covers the C# platform API (AWS App Runner `tims-platform-api`, account `747814092517`, **us-west-2**)
and the web app (Vercel project `tims-ats`, production domain `tims-ats.vercel.app`).

Command blocks are paste-safe: they contain no comments, and each one is a single command.

---

## 1. How the API reaches production

`.github/workflows/deploy-platform-api.yml` runs **only after `.NET Platform CI` succeeds** for a push
to `main` (it runs on `workflow_run`). It deploys the exact commit the tests passed on. It skips when:

- the tests failed or were cancelled, or the CI run came from a pull request or a fork;
- production already runs that commit, or a **newer** one (CI runs can finish out of order);
- nothing under `services/Tims.Platform` changed since the running image (for example a CI run caused
  only by `packages/db` or `scripts/**`);
- the repository variable `PLATFORM_API_AUTODEPLOY_PAUSED` is `true` (see 2.1). This blocks manual
  deploys too.

The deploy's build-and-update job and the rollback job share one concurrency lock
(`platform-api-mutation`, a first-in-first-out queue that never replaces a waiting run). Only one of
them can run `update-service` at a time. Failed or cancelled CI runs never join that queue, so they
cannot push out a valid deploy that is waiting.

Right before `update-service`, the deploy also runs `scripts/deploy/apprunner-preflight.sh --deploy`.
It refuses if any **Roll back platform API** run is queued or in progress, or if **any** rollback run
(including a finished or cancelled one) was requested after the deploy run started. If another deploy
moved production while this one waited in the queue, it deploys only when production runs an **older**
commit; if production already runs this commit or a newer one, it skips (the summary says so). Any
other change to the live image makes it refuse.

The run's job summary says which rule applied. A manual deploy is still available as
**Actions → Deploy platform API → Run workflow** (branch `main`, reason required).

---

## 2. Roll back the API

Order matters: **pause → roll back → verify → fix → unpause**. The rollback workflow refuses to
start until step 2.1 is done.

### 2.1 Pause deploys FIRST

```bash
gh variable set PLATFORM_API_AUTODEPLOY_PAUSED --repo TIMSInternational/tims-ats --body true
```

While the variable is `true`, every deploy decides "skip". That includes a CI run that finishes during
or after the rollback, which would otherwise put the bad commit straight back.

A deploy that had already decided before you paused cannot see the new value: GitHub reads
repository variables when a job starts. The shared lock and the preflight cover that case:

- If the deploy is **building or rolling out**, it holds the lock. Your rollback waits in the queue and
  runs after it, so the rollback is applied last. To avoid waiting out a build, cancel that **Deploy
  platform API** run while it is still building. After `update-service` has started, cancelling does
  not stop App Runner. The rollback then refuses until the service is `RUNNING`, and you re-run it.
- If the deploy is **still waiting** in the queue, its preflight refuses, because your rollback run was
  requested after the deploy run started.
- If a **Roll back platform API** run shows as **cancelled** without anyone cancelling it, re-dispatch
  it. The queue holds 100 waiting runs, and GitHub cancels new arrivals beyond that.

Changes made outside these workflows (console or CLI `update-service`) take no lock. The preflight
checks narrow that window but cannot close it, because App Runner's `UpdateService` has no
expected-image precondition. Do not change the service by hand while a workflow is running.

### 2.2 Pick the tag

Image tags are 7-character short SHAs. Production today runs one of the most recent tags. List the
last ten images, newest last:

```bash
aws ecr describe-images --profile tims-ats --region us-west-2 --repository-name tims-platform-api --query 'sort_by(imageDetails,&imagePushedAt)[-10:].[imageTags[0],imagePushedAt]' --output text
```

To see which tag is running now:

```bash
aws apprunner describe-service --profile tims-ats --region us-west-2 --service-arn arn:aws:apprunner:us-west-2:747814092517:service/tims-platform-api/fe199157979c4a53a0a4ad2ffd9935c5 --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier' --output text
```

Pick the tag that ran before the bad release. The GitHub **Deploy platform API** run history lists
each deployed tag in its job summary.

### 2.3 Run the rollback workflow

In the GitHub UI: **Actions → Roll back platform API → Run workflow**, branch **`main`**, then enter
the `tag` and a `reason`.

From the CLI, replacing `a45c7b5` and the reason:

```bash
gh workflow run 'Roll back platform API' --repo TIMSInternational/tims-ats --ref main -f tag=a45c7b5 -f reason='5xx spike after release'
```

The workflow:

1. refuses unless `PLATFORM_API_AUTODEPLOY_PAUSED` is `true`;
2. refuses a tag that is not a SHA, or that does **not exist in ECR** (nothing is changed);
3. records the running image, then builds the payload from the **live** configuration and refuses if
   it changes anything except the image (`scripts/deploy/apprunner-image-payload.py`, the same guard
   the deploy uses);
4. right before `update-service`, refuses unless the service is `RUNNING` and still runs the image it
   recorded (`scripts/deploy/apprunner-preflight.sh`);
5. waits for the rollout, then checks that the running image is the tag, the env-var count is unchanged
   and `GET /health` returns 200;
6. writes the outcome to the job summary.

It shares the `platform-api-mutation` lock with the deploy (see section 1 and 2.1). The lock is a
queue that never replaces a waiting run, so a deploy that arrives later cannot cancel a waiting
rollback. Nothing is rebuilt, so a rollback does not depend on the build that just failed.

### 2.4 Verify

The job summary shows `from`, `to`, the env-var count and `/health`. Confirm the running tag
independently with the `describe-service` command in 2.2, and watch the alarms in section 4 return to OK.

### 2.5 Fix, then unpause

Merge the fix or revert to `main` while deploys are still paused. Then resume and deploy:

```bash
gh variable delete PLATFORM_API_AUTODEPLOY_PAUSED --repo TIMSInternational/tims-ats
```

```bash
gh workflow run 'Deploy platform API' --repo TIMSInternational/tims-ats --ref main -f reason='resume after rollback'
```

### 2.6 What a rollback does NOT undo

- **Database changes.** Rolling back the image leaves any DDL, backfill or data write in place. If the
  bad release changed the schema, check first that the older image can still run against it.
- **Flags and env vars.** The rollback keeps the live configuration exactly as it is. If a
  `Platform__*Enabled` flag flip caused the incident, turn the flag off instead. A rollback does not
  touch flags.
- **The web app.** Vercel is rolled back separately (section 3).

---

## 3. Roll back the web app (Vercel)

Production for `tims-ats` is on the Hobby plan (see `.claude/commands/ship.md`). On Hobby, **Instant
Rollback can only go back to the immediately previous production deployment**. Pro and Enterprise can
roll back to any deployment that was once production.

### 3.1 Dashboard

1. Open the `tims-ats` project **Overview**. On the **Production Deployment** tile, click
   **Instant Rollback**.
2. In the dialog, check the current and target deployments. On Pro you can use **Choose another
   deployment**. Click **Continue**.
3. Review the domains that will move, then click **Confirm Rollback**.

Or use **Deployments**, filter by the `main` branch, open the **⋮** menu on the row and choose
**Instant Rollback**.

### 3.2 CLI

List production deployments:

```bash
vercel list tims-ats --prod
```

Roll back to the previous production deployment, or to a given URL or ID:

```bash
vercel rollback
```

```bash
vercel rollback https://tims-ats-<hash>.vercel.app
```

```bash
vercel rollback status tims-ats --timeout 60s
```

### 3.3 After a Vercel rollback, deploys stop going live

After a rollback, Vercel turns off auto-assignment of production domains, so new production deploys
do **not** replace the rolled-back one. Environment variables and cron jobs are also those of the
rolled-back build. To return to normal, promote a good deployment. This is the same as **Undo
Rollback** on the production tile, and it turns auto-assignment back on:

```bash
vercel promote https://tims-ats-<hash>.vercel.app
```

Then smoke test:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tims-ats.vercel.app/login
```

---

## 4. Alerting: CloudWatch alarms to email

Decision (2026-09-29): CloudWatch alarms on the App Runner service's built-in metrics, sent by SNS to
`federico.tafur@altostrats.com`. No Sentry for the C# API. The nightly DB controls and backup-drill
workflows already alert by GitHub's failure email and are not covered here.

| Alarm                           | Metric (`AWS/AppRunner`)       | Fires when                                 |
| ------------------------------- | ------------------------------ | ------------------------------------------ |
| `tims-platform-api-5xx-count`   | `5xxStatusResponses` Sum       | ≥ 10 in a 5-minute period                  |
| `tims-platform-api-5xx-rate`    | 5xx ÷ `Requests` (metric math) | > 5 % in 2 of 3 periods with ≥ 20 requests |
| `tims-platform-api-latency-p95` | `RequestLatency` p95           | > 3000 ms for 15 minutes                   |
| `tims-platform-api-cpu-high`    | `CPUUtilization` Average       | > 85 % for 15 minutes                      |
| `tims-platform-api-memory-high` | `MemoryUtilization` Average    | > 85 % for 15 minutes                      |

Every alarm also sends an OK notification when it recovers. Missing data counts as not breaching,
because `5xxStatusResponses` is only emitted after the first 5xx.

There is no instance-count or health alarm. `ActiveInstances` reads 0 whenever the service is idle
(checked against live metrics on 2026-09-29), so it would alert every night. App Runner reports
failed health checks through the deploy status, and the deploy and rollback workflows check `/health`.

### 4.1 Create the alarms (live account)

The Terraform module in `services/Tims.Platform/deploy/terraform` has **never been applied** to this
account. Its state does not know the live service, so use the idempotent CLI script. It reads the
live ServiceID and runs as a dry run unless you pass `--apply`.

1. Make sure the `tims-ats` AWS profile works, for example with `aws sts get-caller-identity --profile tims-ats`.
2. Preview the changes. This only reads from AWS:

```bash
bash scripts/ops/create-alarms.sh
```

3. Apply:

```bash
bash scripts/ops/create-alarms.sh --apply
```

4. **Confirm the subscription.** AWS emails `federico.tafur@altostrats.com` with the subject
   "AWS Notification - Subscription Confirmation". Click **Confirm subscription**. **Until you
   do, no alarm reaches anyone.** Check the status:

```bash
aws sns list-subscriptions-by-topic --profile tims-ats --region us-west-2 --topic-arn arn:aws:sns:us-west-2:747814092517:tims-platform-api-alarms --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text
```

`PendingConfirmation` means you have not clicked the link yet. An ARN means the subscription is live.

5. Optionally, send a test notification through the whole path:

```bash
aws cloudwatch set-alarm-state --profile tims-ats --region us-west-2 --alarm-name tims-platform-api-5xx-count --state-value ALARM --state-reason 'manual test of the alert path'
```

The alarm goes back to OK at its next evaluation, within about 5 minutes, and sends the OK email.

To change a threshold, re-run with an environment override, for example
`ALARM_LATENCY_P95_MS=4000 bash scripts/ops/create-alarms.sh --apply`. The script uses
`put-metric-alarm`, which updates the alarm in place.

### 4.2 Terraform (once the module is reconciled with live)

The same resources are in `alarms.tf`, behind `enable_alarms` (default `false`). After the module's
state has been imported or reconciled (see the drift notice at the top of `main.tf`), set
`enable_alarms = true` in `terraform.tfvars`, and optionally `alarm_email`. Then run `terraform plan`
and `terraform apply`. If the script already created the resources, `terraform import` them first.
`put-metric-alarm`, `create-topic` and `subscribe` are all upserts, so an apply without importing
does not fail. It silently takes the resources over, and nothing records that. The email must be
confirmed exactly as in step 4.
`tests/governance/ops-alarms.test.ts` fails if the script and `alarms.tf` stop matching.
