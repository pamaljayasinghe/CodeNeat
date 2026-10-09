terraform {
required_version = ">= 1.5"
}
variable "region" {
type = string
default = "us-east-1"
}
resource "aws_s3_bucket" "logs" {
bucket = "demo-logs-${var.region}"
force_destroy = true
tags = {
Name = "logs"
Environment = "production"
}
}
output "bucket_arn" { value = aws_s3_bucket.logs.arn }
