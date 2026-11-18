# `terraform test` for the uptime canaries and alert recipients, with the AWS provider MOCKED: no AWS call,
# no credentials, no state. It covers what `terraform validate` cannot (validate only sees the defaults,
# where everything here is disabled): the enabled path's targets, alarm routing, log groups, recipient
# subscriptions and every refusal. Run from this directory:
#   terraform init -backend=false && terraform test
# The values below are placeholders (documentation account ID, .test hosts), never production ones.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_apprunner_auto_scaling_configuration_version" {
    defaults = { arn = "arn:aws:apprunner:us-west-2:111122223333:autoscalingconfiguration/mock/1/0123456789abcdef" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-west-2:111122223333:secret:mock-AbCdEf" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111122223333.dkr.ecr.us-west-2.amazonaws.com/tims-platform-api" }
  }
  mock_resource "aws_synthetics_canary" {
    defaults = { engine_arn = "arn:aws:lambda:us-west-2:111122223333:function:cwsyn-mock-0f1e2d3c:4" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock-artifacts", id = "mock-artifacts" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-west-2:111122223333:tims-platform-api-alarms" }
  }
}

variables {
  image_tag                      = "abc1234"
  supabase_jwt_issuer            = "https://auth.example.test/auth/v1"
  supabase_jwks_metadata_address = "https://auth.example.test/auth/v1/.well-known/jwks.json"
  enable_synthetics              = true
  synthetics_web_url             = "https://web.example.test/login"
  synthetics_suite_url           = "https://www.example.test/"
  synthetics_api_base_url        = "https://api.example.test/"
  synthetics_alarm_topic_arn     = "arn:aws:sns:us-west-2:111122223333:external-alarms"
  alarm_extra_recipients         = ["oncall@example.test", "+15555550100"]
}

run "enabled_external_topic" {
  command = apply

  # A distinct engine ARN per canary, so the log-group assertion below shows each group follows its own
  # canary (the mock_provider default alone would give all three the same function name).
  override_resource {
    target = aws_synthetics_canary.uptime["web"]
    values = { engine_arn = "arn:aws:lambda:us-west-2:111122223333:function:cwsyn-web-0a0a0a0a:1" }
  }
  override_resource {
    target = aws_synthetics_canary.uptime["suite"]
    values = { engine_arn = "arn:aws:lambda:us-west-2:111122223333:function:cwsyn-suite-0b0b0b0b:1" }
  }
  override_resource {
    target = aws_synthetics_canary.uptime["ready"]
    values = { engine_arn = "arn:aws:lambda:us-west-2:111122223333:function:cwsyn-ready-0c0c0c0c:1" }
  }

  assert {
    condition     = jsonencode(sort(keys(aws_synthetics_canary.uptime))) == jsonencode(["ready", "suite", "web"])
    error_message = "expected exactly web, suite, ready canaries"
  }
  assert {
    condition     = aws_synthetics_canary.uptime["ready"].run_config[0].environment_variables.TARGET_URL == "https://api.example.test/ready"
    error_message = "ready canary target wrong"
  }
  assert {
    condition     = aws_synthetics_canary.uptime["suite"].run_config[0].environment_variables.TARGET_URL == "https://www.example.test/"
    error_message = "suite canary target wrong"
  }
  assert {
    condition     = aws_synthetics_canary.uptime["web"].run_config[0].environment_variables.TARGET_URL == "https://web.example.test/login"
    error_message = "web canary target wrong"
  }
  assert {
    condition     = alltrue([for k, a in aws_cloudwatch_metric_alarm.synthetics : a.treat_missing_data == "breaching" && a.alarm_actions == toset(["arn:aws:sns:us-west-2:111122223333:external-alarms"])])
    error_message = "alarms must be breaching on missing data and publish to the external topic"
  }
  assert {
    condition     = jsonencode(sort([for a in aws_cloudwatch_metric_alarm.synthetics : a.alarm_name])) == jsonencode(["tims-platform-api-uptime-ready", "tims-platform-api-uptime-suite", "tims-platform-api-uptime-web"])
    error_message = "alarm names wrong"
  }
  assert {
    condition     = alltrue([for k, g in aws_cloudwatch_log_group.synthetics : g.retention_in_days == 90 && startswith(g.name, "/aws/lambda/cwsyn-${k}-")]) && length(distinct([for g in aws_cloudwatch_log_group.synthetics : g.name])) == 3
    error_message = "each canary's log group must be named from its own engine ARN, with 90-day retention"
  }
  assert {
    condition     = aws_sns_topic_subscription.alarm_extra["+15555550100"].protocol == "sms" && aws_sns_topic_subscription.alarm_extra["oncall@example.test"].protocol == "email"
    error_message = "recipient protocols wrong"
  }
  assert {
    condition     = alltrue([for s in aws_sns_topic_subscription.alarm_extra : s.topic_arn == "arn:aws:sns:us-west-2:111122223333:external-alarms"])
    error_message = "extra recipients must subscribe to the external topic"
  }
  assert {
    condition     = length(aws_sns_topic.alarms) == 0 && length(aws_sns_topic_subscription.alarm_email) == 0
    error_message = "override path must not create a topic or the primary subscription"
  }
}

run "enabled_module_topic" {
  command = apply
  variables {
    enable_alarms              = true
    synthetics_alarm_topic_arn = ""
  }
  assert {
    condition     = alltrue([for s in aws_sns_topic_subscription.alarm_extra : s.topic_arn == aws_sns_topic.alarms[0].arn])
    error_message = "extra recipients must subscribe to the module topic"
  }
  assert {
    condition     = length(aws_sns_topic_subscription.alarm_extra) == 2 && length(aws_sns_topic_subscription.alarm_email) == 1
    error_message = "expected primary + 2 extra subscriptions"
  }
}

run "no_topic_no_recipients" {
  command = plan
  variables {
    enable_synthetics          = false
    synthetics_alarm_topic_arn = ""
  }
  assert {
    condition     = length(aws_sns_topic_subscription.alarm_extra) == 0 && length(aws_synthetics_canary.uptime) == 0 && length(aws_cloudwatch_log_group.synthetics) == 0
    error_message = "nothing may be created when disabled and no topic is configured"
  }
}

run "missing_suite_url_refused" {
  command = plan
  variables {
    synthetics_suite_url = ""
  }
  expect_failures = [aws_synthetics_canary.uptime]
}

run "override_plus_enable_alarms_refused" {
  command = plan
  variables {
    enable_alarms = true
  }
  expect_failures = [aws_sns_topic_subscription.alarm_extra]
}

run "override_plus_enable_alarms_refused_on_alarms" {
  command = plan
  variables {
    enable_alarms          = true
    alarm_extra_recipients = []
  }
  expect_failures = [aws_cloudwatch_metric_alarm.synthetics]
}

run "recipient_repeating_alarm_email_refused" {
  command = plan
  variables {
    enable_alarms              = true
    synthetics_alarm_topic_arn = ""
    alarm_email                = "primary@example.test"
    alarm_extra_recipients     = ["primary@example.test"]
  }
  expect_failures = [aws_sns_topic_subscription.alarm_extra]
}

# The path the owner steps use: external topic, enable_alarms = false. alarm_email is on that topic too,
# so repeating it (in any letter case) must be refused here as well, not only with enable_alarms.
run "recipient_repeating_alarm_email_refused_on_external_topic" {
  command = plan
  variables {
    alarm_email            = "primary@example.test"
    alarm_extra_recipients = ["Primary@Example.test", "+15555550100"]
  }
  expect_failures = [aws_sns_topic_subscription.alarm_extra]
}

run "bad_recipient_refused" {
  command = plan
  variables {
    alarm_extra_recipients = ["+506 8888 7777"]
  }
  expect_failures = [var.alarm_extra_recipients]
}

run "duplicate_recipient_refused" {
  command = plan
  variables {
    alarm_extra_recipients = ["a@example.test", "a@example.test"]
  }
  expect_failures = [var.alarm_extra_recipients]
}

run "duplicate_recipient_other_case_refused" {
  command = plan
  variables {
    alarm_extra_recipients = ["a@example.test", "A@example.test"]
  }
  expect_failures = [var.alarm_extra_recipients]
}

run "bad_retention_refused" {
  command = plan
  variables {
    log_retention_days = 100
  }
  expect_failures = [var.log_retention_days]
}
