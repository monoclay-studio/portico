# P1-1: the deploy role cannot read secrets, pass roles, register task definitions or run tasks, and only the real
# repository's deploy workflow on main, in a protected environment, can obtain it. Policies are built with jsonencode
# (not the mocked policy-document data source), so these assertions check the exact JSON AWS would receive.
mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-south-1", name = "ap-south-1" }
  }
  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
}

variables {
  name_prefix             = "portico-prod-aps1-c01"
  github_repository       = "monoclay-studio/portico"
  github_repository_id    = 987654321
  github_owner_id         = 123456
  github_environments     = ["production"]
  runtime                 = "fargate"
  repository_arns         = ["arn:aws:ecr:ap-south-1:123456789012:repository/portico-prod-aps1-c01/api"]
  deploy_config_parameter = "/portico/portico-prod-aps1-c01/deploy-config"
  web_bucket_arn          = "arn:aws:s3:::web"
  distribution_arn        = "arn:aws:cloudfront::123456789012:distribution/E1"
  ecs_cluster_name        = "portico-prod-aps1-c01"
  service_task_families   = ["portico-prod-aps1-c01-api", "portico-prod-aps1-c01-worker"]
}

run "fargate_role_cannot_read_secrets_or_run_arbitrary_tasks" {
  command = plan
  assert {
    condition = length([for st in output.policy.Statement : st if length(setintersection(st.Action, [
      "iam:PassRole", "ecs:RunTask", "ecs:StartTask", "ecs:RegisterTaskDefinition", "ecs:ExecuteCommand",
      "secretsmanager:GetSecretValue", "secretsmanager:*", "kms:Decrypt", "ssm:SendCommand", "ssm:GetParameters",
      "logs:*", "ecs:*", "iam:*", "*",
    ])) > 0]) == 0
    error_message = "the deploy role must not pass roles, run/register tasks, exec, read secrets/keys or send commands."
  }
  assert {
    condition     = alltrue([for st in output.policy.Statement : alltrue([for a in st.Action : !strcontains(a, "*")])])
    error_message = "no wildcard actions."
  }
  assert {
    condition     = alltrue([for st in output.policy.Statement : alltrue([for r in st.Resource : r != "*"]) if !contains(["EcrAuth", "ReadTargetHealth"], st.Sid)])
    error_message = "only ECR auth and target-health reads may use Resource *."
  }
  assert {
    condition     = one([for st in output.policy.Statement : st.Resource if st.Sid == "ReadDeployLogs"])[0] == "arn:aws:logs:ap-south-1:123456789012:log-group:/portico/portico-prod-aps1-c01/*"
    error_message = "log reads are limited to the cell's own /portico/<prefix>/ groups."
  }
}

run "trust_is_exact" {
  command = plan
  assert {
    condition = jsonencode(output.trust_policy.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"]) == jsonencode([
      "repository_owner_id:123456:repository_id:987654321:environment:production:ref:refs/heads/main:job_workflow_ref:monoclay-studio/portico/.github/workflows/deploy.yml@refs/heads/main",
    ])
    error_message = "subject = immutable ids + environment + main + the deploy workflow, matched exactly."
  }
  assert {
    condition     = output.trust_policy.Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com" && length(output.trust_policy.Statement) == 1 && !contains(keys(output.trust_policy.Statement[0].Condition), "StringLike")
    error_message = "no wildcard subject unless release tags are explicitly allowed."
  }
}

run "release_tags_are_opt_in_and_narrow" {
  command = plan
  variables {
    allow_release_tags = true
  }
  assert {
    condition     = output.trust_policy.Statement[1].Condition.StringLike["token.actions.githubusercontent.com:sub"][0] == "repository_owner_id:123456:repository_id:987654321:environment:production:ref:refs/tags/v*:job_workflow_ref:monoclay-studio/portico/.github/workflows/deploy.yml@refs/tags/v*"
    error_message = "the only wildcard is the tag name."
  }
}

run "demo_host_only_its_deploy_document" {
  command = plan
  variables {
    runtime                  = "single_host"
    host_instance_arn        = "arn:aws:ec2:ap-south-1:123456789012:instance/i-0123"
    host_deploy_document_arn = "arn:aws:ssm:ap-south-1:123456789012:document/portico-demo-aps1-c01-deploy"
  }
  assert {
    condition     = jsonencode(one([for st in output.policy.Statement : st.Resource if st.Sid == "DeployToDemoHost"])) == jsonencode(["arn:aws:ec2:ap-south-1:123456789012:instance/i-0123", "arn:aws:ssm:ap-south-1:123456789012:document/portico-demo-aps1-c01-deploy"])
    error_message = "the demo deploy role may send only the cell's deploy document, never AWS-RunShellScript."
  }
}

run "repository_id_required" {
  command = plan
  variables {
    github_repository_id = 0
  }
  expect_failures = [aws_iam_role.deploy]
}

run "no_wildcard_refs" {
  command = plan
  variables {
    allowed_refs = ["refs/heads/*"]
  }
  expect_failures = [var.allowed_refs]
}
