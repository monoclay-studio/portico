output "trail" {
  value = {
    name           = aws_cloudtrail.account.name
    multi_region   = aws_cloudtrail.account.is_multi_region_trail
    log_validation = aws_cloudtrail.account.enable_log_file_validation
    global_events  = aws_cloudtrail.account.include_global_service_events
  }
}

output "guardduty_enabled" {
  value = aws_guardduty_detector.this.enable
}

output "rules" {
  description = "Rule name => { region, event names }, for tests and the incident runbook."
  value       = { for k, r in local.rules : k => { region = r.region, events = try(r.pattern.detail.eventName, []), pattern = r.pattern } }
}
