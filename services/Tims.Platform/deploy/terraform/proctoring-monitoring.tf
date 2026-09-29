# AWS Budgets alerts; it does not stop spending. Activate the Component cost
# allocation tag in Billing before relying on this filter. Rekognition calls
# may not be tag-allocatable, so the invocation alarm is an additional signal.
resource "aws_budgets_budget" "proctoring" {
  count        = local.proctoring_count
  name         = "${var.service_name}-proctoring-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.proctoring_monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Component$proctoring"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.proctoring_budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.proctoring_budget_email]
  }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_request_age" {
  count               = local.proctoring_count
  alarm_name          = "${var.service_name}-proctoring-request-age"
  alarm_description   = "Oldest inference request has waited over 15 minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 900
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.proctoring_request[0].name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_result_age" {
  count               = local.proctoring_count
  alarm_name          = "${var.service_name}-proctoring-result-age"
  alarm_description   = "Oldest .NET result-consumer message has waited over 5 minutes."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 300
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.proctoring_result[0].name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_request_dlq" {
  count               = local.proctoring_count
  alarm_name          = "${var.service_name}-proctoring-request-dlq"
  alarm_description   = "A failed inference request entered its DLQ."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.proctoring_request_dlq[0].name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_result_dlq" {
  count               = local.proctoring_count
  alarm_name          = "${var.service_name}-proctoring-result-dlq"
  alarm_description   = "An unconsumed inference result entered its DLQ."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.proctoring_result_dlq[0].name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_worker_errors" {
  count               = local.proctoring_worker_count
  alarm_name          = "${var.service_name}-proctoring-worker-errors"
  alarm_description   = "The inference Lambda reported an error in the last five minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.proctoring_worker[0].function_name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}

resource "aws_cloudwatch_metric_alarm" "proctoring_daily_invocations" {
  count               = local.proctoring_worker_count
  alarm_name          = "${var.service_name}-proctoring-daily-invocations"
  alarm_description   = "Worker image-analysis volume exceeded its daily alert threshold. This is not a hard cap."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.proctoring_daily_worker_invocation_alarm
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.proctoring_worker[0].function_name }
  alarm_actions       = local.proctoring_alarm_actions
  tags                = { Component = "proctoring" }
}
