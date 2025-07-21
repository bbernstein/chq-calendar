# Infrastructure Deployment Instructions

This document explains how to deploy infrastructure changes using Terraform.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform installed (version 1.0 or higher)
- Access to the GitHub repository settings to add secrets

## Step 1: Run Terraform Locally

1. Navigate to the infrastructure directory:
   ```bash
   cd infrastructure/
   ```

2. Initialize Terraform (if not already done):
   ```bash
   terraform init
   ```

3. Review the planned changes:
   ```bash
   terraform plan
   ```

4. Apply the changes:
   ```bash
   terraform apply
   ```

5. When prompted, type `yes` to confirm the changes.

## Step 2: Get the Cache Bucket Name

After the Terraform apply completes successfully, get the cache bucket name:

```bash
terraform output cache_s3_bucket_name
```

You'll see output like:
```
"chautauqua-calendar-cache-a1b2c3d4"
```

## Step 3: Add Cache Bucket to GitHub Secrets

1. Go to your GitHub repository: https://github.com/bbernstein/chq-calendar
2. Click on **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:
   - **Name**: `CACHE_S3_BUCKET`
   - **Value**: The bucket name from step 2 (e.g., `chautauqua-calendar-cache-a1b2c3d4`)

## Step 4: Deploy Application

Now you can deploy the application with caching enabled:

1. Go to **Actions** → **Deploy to Production**
2. Click **Run workflow**
3. The deployment will use the cache bucket configured in GitHub secrets

## When to Run Terraform

You need to run Terraform when:

- Setting up the infrastructure for the first time
- Adding new AWS resources (S3 buckets, DynamoDB tables, etc.)
- Modifying IAM permissions
- Changing CloudFront configurations
- Updating Lambda function configurations

## Important Notes

- The `terraform.tfvars` file contains sensitive information and should not be committed to Git
- Terraform state is stored locally in `terraform.tfstate` - back this up or consider using remote state
- Always run `terraform plan` before `terraform apply` to review changes
- The cache bucket name includes a random suffix to ensure global uniqueness

## Troubleshooting

### Missing Variables Error
If you get errors about missing variables, ensure your `terraform.tfvars` file contains all required values.

### AWS Permissions Error
Ensure your AWS credentials have sufficient permissions to create/modify:
- S3 buckets
- Lambda functions
- IAM roles and policies
- CloudFront distributions
- DynamoDB tables
- API Gateway resources

### State Lock Error
If Terraform reports a state lock, ensure no other Terraform process is running.