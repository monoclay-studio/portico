# VPC for one Portico cell: public subnets (load balancer, NAT, demo host), private "app" subnets (ECS tasks) and
# isolated "data" subnets (databases; no route to the internet). Egress strategy is chosen per tier:
#
#   nat_mode = "none"    no NAT gateway. Workloads run in public subnets with a public IP and no inbound rule
#                        except from the load balancer / CloudFront (lean tasks, demo host) and reach AWS APIs and
#                        third parties through the internet gateway. Private subnets have no internet egress in
#                        this mode; interface endpoints (if configured) reach AWS APIs only — never Stripe,
#                        Channex, identity providers or webhook targets.
#   nat_mode = "single"  one NAT gateway (≈ $41/month + $0.056/GB in ap-south-1). If its AZ fails, private tasks in
#                        other AZs lose internet egress (inbound traffic and AWS-endpoint traffic keep working).
#   nat_mode = "per_az"  one NAT gateway per AZ (≈ $41/month each). No cross-AZ dependency for egress.
#
# Interface endpoints cost $0.013/hour per endpoint per AZ in ap-south-1 (≈ $9.50/month) — four endpoints in two
# AZs cost more than a NAT gateway. `endpoint_az_count` limits how many AZs carry endpoint ENIs.

data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_region" "current" {}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Fixed layout inside a /16 so that adding AZs or cells never renumbers existing subnets:
  #   public  /20 at netnums 0..2   (x.x.0.0  – x.x.47.255)
  #   app     /19 at netnums 2..4   (x.x.64.0 – x.x.159.255)
  #   data    /21 at netnums 24..26 (x.x.192.0 – x.x.215.255)
  public_cidrs = [for i, _ in local.azs : cidrsubnet(var.cidr_block, 4, i)]
  app_cidrs    = [for i, _ in local.azs : cidrsubnet(var.cidr_block, 3, i + 2)]
  data_cidrs   = [for i, _ in local.azs : cidrsubnet(var.cidr_block, 5, i + 24)]

  nat_count          = var.nat_mode == "per_az" ? var.az_count : (var.nat_mode == "single" ? 1 : 0)
  endpoint_subnets   = slice(aws_subnet.app[*].id, 0, min(var.endpoint_az_count, var.az_count))
  interface_services = toset(var.interface_endpoints)
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name_prefix}-vpc" }
}

# The default security group must never be used: strip all rules.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-default-unused" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-igw" }
}

# ── Subnets ───────────────────────────────────────────────────────────────────────────────────────────────────

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name_prefix}-public-${local.azs[count.index]}", Tier = "public" }
}

resource "aws_subnet" "app" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.app_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.name_prefix}-app-${local.azs[count.index]}", Tier = "app" }
}

resource "aws_subnet" "data" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.data_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.name_prefix}-data-${local.azs[count.index]}", Tier = "data" }
}

# ── Routing ───────────────────────────────────────────────────────────────────────────────────────────────────

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  count  = local.nat_count
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat-${count.index}" }
}

resource "aws_nat_gateway" "this" {
  count         = local.nat_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.name_prefix}-nat-${local.azs[count.index]}" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "app" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-app-${local.azs[count.index]}" }
}

resource "aws_route" "app_nat" {
  count                  = local.nat_count > 0 ? var.az_count : 0
  route_table_id         = aws_route_table.app[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.nat_mode == "per_az" ? count.index : 0].id
}

resource "aws_route_table_association" "app" {
  count          = var.az_count
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app[count.index].id
}

# Data subnets have no default route at all: databases can only talk inside the VPC.
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-data" }
}

resource "aws_route_table_association" "data" {
  count          = var.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# ── VPC endpoints ─────────────────────────────────────────────────────────────────────────────────────────────

# Gateway endpoint for S3 is free: ECR image layers, documents and exports never cross a NAT gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat([aws_route_table.public.id, aws_route_table.data.id], aws_route_table.app[*].id)
  tags              = { Name = "${var.name_prefix}-s3" }
}

resource "aws_security_group" "endpoints" {
  name        = "${var.name_prefix}-vpce"
  description = "Interface VPC endpoints: HTTPS from inside the VPC only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-vpce" }
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_https" {
  security_group_id = aws_security_group.endpoints.id
  description       = "HTTPS from the VPC"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = var.cidr_block
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.interface_services
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = local.endpoint_subnets
  security_group_ids  = [aws_security_group.endpoints.id]
  tags                = { Name = "${var.name_prefix}-${each.key}" }
}

# ── Flow logs (optional; vended-log ingestion is $0.67/GB in ap-south-1) ────────────────────────────────────

resource "aws_cloudwatch_log_group" "flow" {
  count             = var.flow_logs_traffic_type == null ? 0 : 1
  name              = "/portico/${var.name_prefix}/vpc-flow"
  retention_in_days = var.flow_logs_retention_days
  kms_key_id        = var.logs_kms_key_arn
}

data "aws_iam_policy_document" "flow_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow" {
  count              = var.flow_logs_traffic_type == null ? 0 : 1
  name               = "${var.name_prefix}-vpc-flow"
  assume_role_policy = data.aws_iam_policy_document.flow_assume.json
}

data "aws_iam_policy_document" "flow" {
  count = var.flow_logs_traffic_type == null ? 0 : 1
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.flow[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow" {
  count  = var.flow_logs_traffic_type == null ? 0 : 1
  role   = aws_iam_role.flow[0].id
  policy = data.aws_iam_policy_document.flow[0].json
}

resource "aws_flow_log" "this" {
  count                = var.flow_logs_traffic_type == null ? 0 : 1
  vpc_id               = aws_vpc.this.id
  traffic_type         = var.flow_logs_traffic_type
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow[0].arn
  iam_role_arn         = aws_iam_role.flow[0].arn
}

# ── DNS firewall (defense in depth for non-live environments) ─────────────────────────────────────────────────
# The application already refuses external effects outside `live` (ADR-0010). For demo/sandbox cells we also
# make the domains of payment, channel, messaging and paid-AI providers unresolvable from inside the VPC.

resource "aws_route53_resolver_firewall_domain_list" "blocked" {
  count   = length(var.dns_firewall_blocked_domains) > 0 ? 1 : 0
  name    = "${var.name_prefix}-external-effects"
  domains = var.dns_firewall_blocked_domains
}

resource "aws_route53_resolver_firewall_rule_group" "blocked" {
  count = length(var.dns_firewall_blocked_domains) > 0 ? 1 : 0
  name  = "${var.name_prefix}-external-effects"
}

resource "aws_route53_resolver_firewall_rule" "blocked" {
  count                   = length(var.dns_firewall_blocked_domains) > 0 ? 1 : 0
  name                    = "block-external-effect-providers"
  action                  = "BLOCK"
  block_response          = "NXDOMAIN"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.blocked[0].id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.blocked[0].id
  priority                = 100
}

resource "aws_route53_resolver_firewall_rule_group_association" "blocked" {
  count                  = length(var.dns_firewall_blocked_domains) > 0 ? 1 : 0
  name                   = "${var.name_prefix}-external-effects"
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.blocked[0].id
  vpc_id                 = aws_vpc.this.id
  priority               = 101
}
