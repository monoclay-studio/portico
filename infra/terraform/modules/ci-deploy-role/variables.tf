variable "name_prefix" {
  type = string
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy, e.g. monoclay-studio/portico."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be owner/name."
  }
}

variable "github_repository_id" {
  description = "Immutable numeric id of the repository (GitHub API: repos/<owner>/<name> → id). A re-created or squatted repository gets a different id."
  type        = number
}

variable "github_owner_id" {
  description = "Immutable numeric id of the repository owner (organization or user)."
  type        = number
}

variable "workflow_path" {
  description = "Only this workflow file may deploy (job_workflow_ref)."
  type        = string
  default     = ".github/workflows/deploy.yml"
}

variable "allowed_refs" {
  description = "Exact git refs allowed to deploy. Default: main only (protected branch)."
  type        = list(string)
  default     = ["refs/heads/main"]
  validation {
    condition     = length(var.allowed_refs) > 0 && alltrue([for r in var.allowed_refs : startswith(r, "refs/") && !strcontains(r, "*") && !strcontains(r, ":")])
    error_message = "allowed_refs are exact refs such as refs/heads/main (no wildcards)."
  }
}

variable "allow_release_tags" {
  description = "Also allow refs/tags/v* (requires a tag-protection ruleset so only maintainers can push v* tags)."
  type        = bool
  default     = false
}

variable "github_environments" {
  description = "GitHub Environments whose jobs may assume the role (protected: main only, required reviewers — envs/github)."
  type        = list(string)
  validation {
    condition     = length(var.github_environments) > 0
    error_message = "At least one protected GitHub Environment is required."
  }
}

variable "runtime" {
  description = "fargate | single_host"
  type        = string
  validation {
    condition     = contains(["fargate", "single_host"], var.runtime)
    error_message = "runtime must be fargate or single_host."
  }
}

variable "repository_arns" {
  description = "ECR repositories the pipeline pushes to (api, worker, restore-drill)."
  type        = list(string)
}

variable "deploy_config_parameter" {
  description = "SSM parameter name, starting with /."
  type        = string
}

variable "web_bucket_arn" {
  type = string
}

variable "distribution_arn" {
  type = string
}

variable "ecs_cluster_name" {
  type    = string
  default = ""
}

variable "service_task_families" {
  description = "Task-definition families the services may run (api, worker)."
  type        = list(string)
  default     = []
}

variable "host_instance_arn" {
  type    = string
  default = ""
}

variable "host_deploy_document_arn" {
  description = "SSM document that runs `portico deploy <sha> <url>` with validated parameters (demo host)."
  type        = string
  default     = ""
}
