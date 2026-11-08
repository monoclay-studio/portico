# Workload security groups live with the network so that the database, compute and drill modules can reference
# each other's groups without a module dependency cycle. Rules are the complete allow-list: anything not listed
# is denied.

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "API load balancer: HTTPS from CloudFront only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-alb" }
}

resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api"
  description = "API tasks: app port from the load balancer only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-api" }
}

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker"
  description = "Worker tasks: no inbound"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-worker" }
}

resource "aws_security_group" "ops" {
  name        = "${var.name_prefix}-ops"
  description = "One-off tasks: migrations, role bootstrap, restore drills. No inbound"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-ops" }
}

resource "aws_security_group" "database" {
  name        = "${var.name_prefix}-database"
  description = "Primary database: Postgres from api, worker and ops tasks only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-database" }
}

resource "aws_security_group" "drill_database" {
  name        = "${var.name_prefix}-drill-database"
  description = "Restored drill databases: Postgres from ops tasks only (never from the application)"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-drill-database" }
}

resource "aws_security_group" "host" {
  name        = "${var.name_prefix}-host"
  description = "Demo single host: API port from CloudFront only"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${var.name_prefix}-host" }
}

# ── ALB ──
resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from CloudFront origin-facing ranges"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to API tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.api.id
}

# ── API / worker / ops ──
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "App port from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.alb.id
}

locals {
  task_groups = {
    api    = aws_security_group.api.id
    worker = aws_security_group.worker.id
    ops    = aws_security_group.ops.id
  }
}

resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  for_each          = local.task_groups
  security_group_id = each.value
  description       = "HTTPS to AWS APIs (endpoints or NAT) and, where egress exists, approved providers"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "tasks_postgres" {
  for_each                     = local.task_groups
  security_group_id            = each.value
  description                  = "Postgres to the primary database"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_egress_rule" "ops_to_drill_db" {
  security_group_id            = aws_security_group.ops.id
  description                  = "Postgres to restored drill databases"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.drill_database.id
}

# ── Databases ──
resource "aws_vpc_security_group_ingress_rule" "db_from_tasks" {
  for_each                     = local.task_groups
  security_group_id            = aws_security_group.database.id
  description                  = "Postgres from ${each.key} tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = each.value
}

resource "aws_vpc_security_group_ingress_rule" "drill_db_from_ops" {
  security_group_id            = aws_security_group.drill_database.id
  description                  = "Postgres from ops tasks (restore drill verifier)"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.ops.id
}

# ── Demo host ──
resource "aws_vpc_security_group_ingress_rule" "host_from_cloudfront" {
  security_group_id = aws_security_group.host.id
  description       = "API port from CloudFront origin-facing ranges"
  ip_protocol       = "tcp"
  from_port         = var.app_port
  to_port           = var.app_port
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "host_https" {
  security_group_id = aws_security_group.host.id
  description       = "HTTPS to ECR, CloudWatch, SSM and OS package mirrors"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "host_http" {
  security_group_id = aws_security_group.host.id
  description       = "HTTP for OS package mirrors that redirect"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}
