# One-time, per AWS account: remote-state bucket + lock table, and the GitHub OIDC identity provider.
#
#   cd infra/terraform/envs/bootstrap
#   terraform init && terraform apply -var 'state_bucket_name=portico-tfstate-<account id>'
#
# This root starts on LOCAL state (it creates the bucket everything else uses). After the first apply, migrate its
# own state into the bucket: add a backend "s3" block with key portico/bootstrap/terraform.tfstate and run
# `terraform init -migrate-state` (docs/runbooks/deploy.md, "First-time setup").
#
# NOTHING HERE HAS BEEN APPLIED. Requires the owner's authorization (OPEN_QUESTIONS Q4/Q22).

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = {
      Product   = "portico"
      Owner     = "Monoclay LLC"
      ManagedBy = "terraform"
      Component = "bootstrap"
    }
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "allowed_account_ids" {
  description = "Refuse to run against any other AWS account (set to the account the owner designates, Q4)."
  type        = list(string)
  default     = null
}

variable "state_bucket_name" {
  description = "Globally unique, e.g. portico-tfstate-<account id>."
  type        = string
}

variable "create_github_oidc_provider" {
  description = "false if the account already has the token.actions.githubusercontent.com provider."
  type        = bool
  default     = true
}

module "state" {
  source      = "../../modules/state-bootstrap"
  bucket_name = var.state_bucket_name
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

output "backend_config_example" {
  value = module.state.backend_config_example
}

output "github_oidc_provider_arn" {
  value = one(aws_iam_openid_connect_provider.github[*].arn)
}
