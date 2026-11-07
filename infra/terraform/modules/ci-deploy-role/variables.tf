variable "name_prefix" {
  type = string
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy (owner decision; placeholder until confirmed)."
  type        = string
}

variable "github_environments" {
  description = "GitHub Environments whose jobs may assume the role (e.g. [\"production\"] with required reviewers)."
  type        = list(string)
}

variable "runtime" {
  description = "fargate | single_host"
  type        = string
}

variable "repository_arns" {
  type = list(string)
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

variable "pass_role_arns" {
  description = "Task and execution roles the pipeline may hand to ECS."
  type        = list(string)
  default     = []
}

variable "host_instance_arn" {
  type    = string
  default = ""
}
