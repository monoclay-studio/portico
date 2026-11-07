# GitHub-side controls the AWS deploy roles rely on (review P1-1, AP-54). Applied by a repository admin with a
# GitHub token (GITHUB_TOKEN env var for the provider), once, and after any change. NOTHING HERE HAS BEEN APPLIED.
#
#   - OIDC subject template: repository_owner_id, repository_id, environment, ref, job_workflow_ref — the exact
#     string modules/ci-deploy-role matches with StringEquals. Without this template GitHub sends the default
#     subject and every deploy role refuses (fails closed).
#   - Environments demo, staging, production: deployable from `main` only; staging/production need a reviewer and
#     the person who started the run cannot approve it (prevent self-review).
#   - `main` is protected: pull requests with an approving review, required CI checks, no force-push, no deletion,
#     rules apply to administrators too. A merged PR is the only way code reaches a deploy role.

terraform {
  required_version = ">= 1.11.0"
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
  }
}

provider "github" {
  owner = var.owner
}

variable "owner" {
  description = "GitHub organization that owns the repository."
  type        = string
  default     = "monoclay-studio"
}

variable "repository" {
  type    = string
  default = "portico"
}

variable "reviewer_user_ids" {
  description = "Numeric GitHub user ids allowed to approve staging/production deploys (owner decision)."
  type        = list(number)
  validation {
    condition     = length(var.reviewer_user_ids) > 0
    error_message = "At least one reviewer is required for protected environments."
  }
}

variable "required_checks" {
  description = "CI job names that must pass before merging to main (.github/workflows/ci.yml)."
  type        = list(string)
  default     = ["verify", "infra"]
}

locals {
  claim_keys   = ["repository_owner_id", "repository_id", "environment", "ref", "job_workflow_ref"]
  environments = { demo = false, staging = true, production = true } # name => needs a reviewer
}

resource "github_actions_repository_oidc_subject_claim_customization_template" "this" {
  repository         = var.repository
  use_default        = false
  include_claim_keys = local.claim_keys
}

resource "github_repository_environment" "this" {
  for_each            = local.environments
  repository          = var.repository
  environment         = each.key
  prevent_self_review = each.value
  can_admins_bypass   = false

  dynamic "reviewers" {
    for_each = each.value ? [1] : []
    content {
      users = var.reviewer_user_ids
    }
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "main_only" {
  for_each       = local.environments
  repository     = var.repository
  environment    = github_repository_environment.this[each.key].environment
  branch_pattern = "main"
}

data "github_repository" "this" {
  name = var.repository
}

resource "github_branch_protection" "main" {
  repository_id           = data.github_repository.this.node_id
  pattern                 = "main"
  enforce_admins          = true
  allows_force_pushes     = false
  allows_deletions        = false
  require_signed_commits  = false
  required_linear_history = false

  required_pull_request_reviews {
    required_approving_review_count = 1
    dismiss_stale_reviews           = true
    require_last_push_approval      = true
  }

  required_status_checks {
    strict   = true
    contexts = var.required_checks
  }
}

output "oidc_claim_keys" {
  value = github_actions_repository_oidc_subject_claim_customization_template.this.include_claim_keys
}

output "environments" {
  value = { for k, e in github_repository_environment.this : k => { prevent_self_review = e.prevent_self_review, reviewers = length(e.reviewers) > 0, custom_branch_policies = e.deployment_branch_policy[0].custom_branch_policies } }
}

output "repository_ids" {
  description = "Feed into the cells' github_repository_id / github_owner_id (immutable)."
  value       = { repository_id = data.github_repository.this.repo_id, full_name = data.github_repository.this.full_name }
}
