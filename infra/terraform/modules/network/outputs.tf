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

output "cloudfront_prefix_list_id" {
  value = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}
