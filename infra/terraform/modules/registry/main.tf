# Container image repositories for one cell. Kept separate from compute so an inactive (switched-off) staging
# cell still has somewhere to push images. Every tag is immutable (a git SHA always means the same bytes; promotion
# copies the same digest) EXCEPT `release`: the task definitions reference <repo>:release and a release moves it to
# an already-pushed SHA image (docs/runbooks/deploy.md). ECS resolves it to a digest once per deployment.

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.name_prefix}/${each.key}"
  image_tag_mutability = "IMMUTABLE_WITH_EXCLUSION"
  image_tag_mutability_exclusion_filter {
    filter      = var.release_tag
    filter_type = "WILDCARD"
  }
  force_delete = var.force_delete

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the most recent ${var.keep_images} images (rollback window)"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = var.keep_images }
        action       = { type = "expire" }
      },
    ]
  })
}
