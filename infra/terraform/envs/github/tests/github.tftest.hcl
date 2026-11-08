# The GitHub-side rules the deploy roles depend on, planned with a mocked GitHub provider.
mock_provider "github" {
  mock_data "github_repository" {
    defaults = { node_id = "R_kgDOExample", repo_id = 123456789, full_name = "monoclay-studio/portico" }
  }
}

variables {
  reviewer_user_ids = [1001]
}

run "subject_template_matches_the_deploy_role" {
  command = plan
  assert {
    # modules/ci-deploy-role builds: repository_owner_id:<id>:repository_id:<id>:environment:<e>:ref:<r>:job_workflow_ref:<w>
    condition     = jsonencode(output.oidc_claim_keys) == jsonencode(["repository_owner_id", "repository_id", "environment", "ref", "job_workflow_ref"])
    error_message = "the OIDC subject claim order must match modules/ci-deploy-role exactly."
  }
}

run "protected_environments" {
  command = plan
  assert {
    condition     = output.environments.production.prevent_self_review && output.environments.production.reviewers && output.environments.staging.reviewers
    error_message = "staging and production need a reviewer who did not start the run."
  }
  assert {
    condition     = alltrue([for e in values(output.environments) : e.custom_branch_policies])
    error_message = "every environment is limited to the main branch."
  }
  assert {
    condition     = alltrue([for p in github_repository_environment_deployment_policy.main_only : p.branch_pattern == "main"])
    error_message = "deployment branch policy: main only."
  }
}

run "main_is_protected" {
  command = plan
  assert {
    condition     = github_branch_protection.main.enforce_admins && !github_branch_protection.main.allows_force_pushes && github_branch_protection.main.required_pull_request_reviews[0].required_approving_review_count >= 1
    error_message = "main needs reviewed PRs, no force pushes, admins included."
  }
}
