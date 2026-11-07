terraform {
  required_version = ">= 1.11.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
  # Partial configuration: terraform init -backend-config=backend.hcl (see backend.hcl.example).
  backend "s3" {}
}

provider "aws" {
  region              = var.region
  allowed_account_ids = var.allowed_account_ids
  default_tags {
    tags = {
      Product     = "portico"
      Owner       = "Monoclay LLC"
      ManagedBy   = "terraform"
      Environment = "demo"
      Cell        = var.cell
      Tier        = "demo"
      Data        = "sample-only"
    }
  }
}
