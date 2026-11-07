output "vpc_id" {
  value = aws_vpc.this.id
}

output "cidr_block" {
  value = aws_vpc.this.cidr_block
}

output "availability_zones" {
  value = local.azs
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "public_subnet_cidrs" {
  description = "Where the ALB's nodes live (trusted proxies for X-Forwarded-For). Known at plan time."
  value       = local.public_cidrs
}

output "app_subnet_ids" {
  value = aws_subnet.app[*].id
}

output "data_subnet_ids" {
  value = aws_subnet.data[*].id
}

output "nat_public_ips" {
  description = "Egress IPs to give providers that allow-list callers (empty when nat_mode = none)."
  value       = aws_eip.nat[*].public_ip
}

output "security_group_ids" {
  value = {
    alb            = aws_security_group.alb.id
    api            = aws_security_group.api.id
    worker         = aws_security_group.worker.id
    ops            = aws_security_group.ops.id
    database       = aws_security_group.database.id
    drill_database = aws_security_group.drill_database.id
    host           = aws_security_group.host.id
  }
}

output "cloudfront_origin_cidrs" {
  description = "CloudFront origin-facing IPv4 ranges (AWS-managed prefix list), sorted. Refreshed on every plan."
  value       = sort([for e in data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.entries : e.cidr])
}

output "vpc_dns_support" {
  description = "Amazon-provided DNS (VPC+2) answers public names without NAT; SSO domain re-checks (DNS TXT) rely on it."
  value       = aws_vpc.this.enable_dns_support && aws_vpc.this.enable_dns_hostnames
}

output "cloudfront_prefix_list_id" {
  value = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}
