# Messages contain only evidence IDs, sealed keys/checksums and model revisions;
# never raw images or candidate PII. Standard queues require idempotent consumers.
resource "aws_sqs_queue" "proctoring_request_dlq" {
  count                     = local.proctoring_count
  name                      = "${var.service_name}-proctoring-request-dlq"
  message_retention_seconds = 345600 # four days; never replay after seven-day media expiry
  max_message_size          = 32768
  sqs_managed_sse_enabled   = true
  tags                      = { Component = "proctoring" }
}

resource "aws_sqs_queue" "proctoring_request" {
  count                      = local.proctoring_count
  name                       = "${var.service_name}-proctoring-request"
  message_retention_seconds  = 86400
  max_message_size           = 32768
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 540 # >= six times the 90s Lambda timeout
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.proctoring_request_dlq[0].arn
    maxReceiveCount     = 3
  })
  tags = { Component = "proctoring" }
}

resource "aws_sqs_queue_redrive_allow_policy" "proctoring_request_dlq" {
  count     = local.proctoring_count
  queue_url = aws_sqs_queue.proctoring_request_dlq[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.proctoring_request[0].arn]
  })
}

resource "aws_sqs_queue" "proctoring_result_dlq" {
  count                     = local.proctoring_count
  name                      = "${var.service_name}-proctoring-result-dlq"
  message_retention_seconds = 345600
  max_message_size          = 32768
  sqs_managed_sse_enabled   = true
  tags                      = { Component = "proctoring" }
}

resource "aws_sqs_queue" "proctoring_result" {
  count                      = local.proctoring_count
  name                       = "${var.service_name}-proctoring-result"
  message_retention_seconds  = 86400
  max_message_size           = 32768
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 300
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.proctoring_result_dlq[0].arn
    maxReceiveCount     = 3
  })
  tags = { Component = "proctoring" }
}

resource "aws_sqs_queue_redrive_allow_policy" "proctoring_result_dlq" {
  count     = local.proctoring_count
  queue_url = aws_sqs_queue.proctoring_result_dlq[0].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.proctoring_result[0].arn]
  })
}
