# --- Production alerting: CloudWatch alarms -> SNS -> email (F16, 2026-09-29) ----------------------
# Decision: CloudWatch alarms on the App Runner service's built-in AWS/AppRunner metrics, delivered by
# SNS email. No Sentry for the C# API.
#
# OPT-IN (`enable_alarms`, default false). This module has never been applied to the real account
# (see the PROD DRIFT NOTICE in main.tf), so the live alarms are created by the idempotent CLI mirror
# `scripts/ops/create-alarms.sh`, which uses the SAME names, metrics and thresholds. Keep the two in
# step — tests/governance/ops-alarms.test.ts fails if an alarm exists in one and not the other.
#
# The SNS email subscription stays "PendingConfirmation" — and delivers NOTHING — until the recipient
# clicks the link in the "AWS Notification - Subscription Confirmation" email.
#
# Metric names/dimensions verified read-only against the live account on 2026-09-29
# (`aws cloudwatch list-metrics --namespace AWS/AppRunner`): service-level metrics carry exactly
# {ServiceName, ServiceID}. `ActiveInstances` is deliberately NOT alarmed: it reads 0 whenever the
# service is idle (provisioned instances are not "active"), so a "< 1" alarm would page every night.
# `5xxStatusResponses` is only emitted once a 5xx occurs, hence treat_missing_data = notBreaching and
# FILL() in the rate expression.

locals {
  alarm_prefix = var.service_name
  apprunner_dimensions = var.enable_alarms ? {
    ServiceName = aws_apprunner_service.api.service_name
    ServiceID   = aws_apprunner_service.api.service_id
  } : {}

  # Simple single-metric alarms. The 5xx RATE alarm uses metric math and is declared separately.
  simple_alarms = {
    "5xx-count" = {
      description = "App Runner returned >= ${var.alarm_5xx_count_threshold} 5xx responses in 5 minutes."
      metric      = "5xxStatusResponses"
      statistic   = "Sum"
      extended    = null
      threshold   = var.alarm_5xx_count_threshold
      comparison  = "GreaterThanOrEqualToThreshold"
      evaluations = 1
      datapoints  = 1
    }
    "latency-p95" = {
      description = "p95 request latency above ${var.alarm_latency_p95_ms} ms for 15 minutes."
      metric      = "RequestLatency"
      statistic   = null
      extended    = "p95"
      threshold   = var.alarm_latency_p95_ms
      comparison  = "GreaterThanThreshold"
      evaluations = 3
      datapoints  = 3
    }
    "cpu-high" = {
      description = "Average CPU above ${var.alarm_cpu_percent}% for 15 minutes."
      metric      = "CPUUtilization"
      statistic   = "Average"
      extended    = null
      threshold   = var.alarm_cpu_percent
      comparison  = "GreaterThanThreshold"
      evaluations = 3
      datapoints  = 3
    }
    "memory-high" = {
      description = "Average memory above ${var.alarm_memory_percent}% for 15 minutes."
      metric      = "MemoryUtilization"
      statistic   = "Average"
      extended    = null
      threshold   = var.alarm_memory_percent
      comparison  = "GreaterThanThreshold"
      evaluations = 3
      datapoints  = 3
    }
  }
}

resource "aws_sns_topic" "alarms" {
  count = var.enable_alarms ? 1 : 0
  name  = "${local.alarm_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.enable_alarms ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# --- Extra alert recipients (var.alarm_extra_recipients, default none) ---------------------------------
# More inboxes and/or SMS numbers on the SAME topic every alarm publishes to, so a single inbox is not the
# only path to a person. Subscribed to whichever topic is in use: the one above (enable_alarms) or the
# externally managed one (synthetics_alarm_topic_arn; see synthetics.tf). The for_each condition reads
# variables only, so it is known at plan time. An entry starting with "+" is an E.164 number (sms);
# anything else is an email address (email, which delivers nothing until its confirmation link is clicked).
locals {
  alarm_extra_recipients = {
    for r in var.alarm_extra_recipients : r => (startswith(r, "+") ? "sms" : "email")
  }
}

resource "aws_sns_topic_subscription" "alarm_extra" {
  for_each = (var.enable_alarms || var.synthetics_alarm_topic_arn != "") ? local.alarm_extra_recipients : {}

  topic_arn = local.synthetics_alarm_topic_arn
  protocol  = each.value
  endpoint  = each.key

  lifecycle {
    # Same rule as the uptime alarms: the override names an externally managed topic, so it cannot be
    # combined with the topic this module creates (the recipients would land on a topic no alarm uses).
    precondition {
      condition     = !(var.synthetics_alarm_topic_arn != "" && var.enable_alarms)
      error_message = "synthetics_alarm_topic_arn is for an externally managed topic: set enable_alarms = false with it, or unset it to use the topic alarms.tf creates."
    }
    # SNS returns the existing subscription for a repeated endpoint, so two Terraform resources would own
    # one subscription and removing either would unsubscribe both.
    precondition {
      condition     = !(var.enable_alarms && contains(var.alarm_extra_recipients, var.alarm_email))
      error_message = "alarm_extra_recipients must not repeat alarm_email; it is already subscribed."
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "simple" {
  for_each = var.enable_alarms ? local.simple_alarms : {}

  alarm_name          = "${local.alarm_prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = "AWS/AppRunner"
  metric_name         = each.value.metric
  dimensions          = local.apprunner_dimensions
  statistic           = each.value.statistic
  extended_statistic  = each.value.extended
  period              = 300
  evaluation_periods  = each.value.evaluations
  datapoints_to_alarm = each.value.datapoints
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "error_rate" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${local.alarm_prefix}-5xx-rate"
  alarm_description   = "5xx responses above ${var.alarm_5xx_rate_percent}% of requests in 2 of 3 five-minute periods (only when >= 20 requests/period)."
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = var.alarm_5xx_rate_percent
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
  ok_actions          = [aws_sns_topic.alarms[0].arn]

  metric_query {
    id          = "rate"
    expression  = "IF(req >= 20, 100 * FILL(err, 0) / req, 0)"
    label       = "5xx rate (%)"
    return_data = true
  }

  metric_query {
    id = "err"
    metric {
      namespace   = "AWS/AppRunner"
      metric_name = "5xxStatusResponses"
      dimensions  = local.apprunner_dimensions
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "req"
    metric {
      namespace   = "AWS/AppRunner"
      metric_name = "Requests"
      dimensions  = local.apprunner_dimensions
      period      = 300
      stat        = "Sum"
    }
  }
}
