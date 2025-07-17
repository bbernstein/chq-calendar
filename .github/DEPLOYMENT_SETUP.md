# GitHub Secrets Setup for AWS Deployment

This document outlines the GitHub secrets required for automated deployment to AWS.

## 🚀 **Recommended: Terraform Setup (Automated)**

The easiest way to set up GitHub Actions deployment is using our Terraform infrastructure:

### Step 1: Deploy Infrastructure with GitHub Actions IAM
```bash
cd infrastructure
terraform apply
```

### Step 2: Get GitHub Secrets from Terraform Output
```bash
# View all secrets that need to be set
terraform output github_secrets

# Get commands to set secrets with GitHub CLI
terraform output github_secrets_setup_commands
```

### Step 3: Set GitHub Secrets Automatically
```bash
# Install GitHub CLI if not already installed
# https://cli.github.com/

# Authenticate with GitHub
gh auth login

# Run the output commands to set all secrets
terraform output -raw github_secrets_setup_commands | bash
```

That's it! The Terraform setup automatically:
- ✅ Creates IAM user with least-privilege permissions
- ✅ Generates access keys securely
- ✅ Outputs all values needed for GitHub secrets
- ✅ Provides ready-to-run commands for setup

## 📋 **Manual Setup (Alternative)**

If you prefer to set up manually, you'll need these GitHub secrets:

### Required GitHub Secrets
Set these secrets in your GitHub repository: **Settings → Secrets and variables → Actions → Repository secrets**

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID for deployment user | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key for deployment user | `abc123...` |
| `AWS_REGION` | AWS region where resources are deployed | `us-east-1` |
| `LAMBDA_FUNCTION_NAME` | Name of the Lambda function for the backend | `chautauqua-calendar-generator` |
| `S3_BUCKET_NAME` | S3 bucket name for frontend hosting | `chqcal.org` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID | `E1234567890ABC` |
| `EVENTS_TABLE_NAME` | DynamoDB table name for events | `chq-calendar-events` |
| `DATA_SOURCES_TABLE_NAME` | DynamoDB table name for data sources | `chq-calendar-data-sources` |

### Manual IAM Setup
If not using Terraform, you can create the IAM user manually (see the original IAM setup section below).

### Step 4: Set up Environment Protection (Optional)
1. Go to **Settings → Environments**
2. Create a new environment named `production`
3. Add required reviewers for production deployments
4. Set deployment branch rules if needed

## Deployment Workflow Triggers

### Automatic Deployment
- **Push to `main` branch**: Automatically deploys to production
- **Pull Request**: Runs build and test workflow only

### Manual Deployment
- Go to **Actions** tab in GitHub
- Select **Deploy to Production** workflow
- Click **Run workflow**
- Optionally check "Force deployment" to skip tests

## Troubleshooting

### Common Issues

1. **Lambda function not found**
   - Verify `LAMBDA_FUNCTION_NAME` secret matches actual function name
   - Check AWS region is correct

2. **S3 deployment fails**
   - Verify `S3_BUCKET_NAME` secret matches actual bucket name
   - Check IAM permissions for S3 actions

3. **CloudFront invalidation fails**
   - Verify `CLOUDFRONT_DISTRIBUTION_ID` is correct
   - Check IAM permissions for CloudFront actions

### Debug Commands
```bash
# Test AWS credentials
aws sts get-caller-identity

# Check Lambda function exists
aws lambda get-function --function-name YOUR_FUNCTION_NAME

# Check S3 bucket exists
aws s3 ls s3://YOUR_BUCKET_NAME

# Check CloudFront distribution
aws cloudfront get-distribution --id YOUR_DISTRIBUTION_ID
```

## Security Best Practices

1. **Least Privilege**: Only grant permissions needed for deployment
2. **Regular Rotation**: Rotate access keys periodically
3. **Monitor Usage**: Set up CloudTrail logging for deployment actions
4. **Environment Protection**: Use GitHub environment protection rules for production
5. **Secret Scanning**: Enable GitHub secret scanning to detect exposed keys

## Support

If you encounter issues:
1. Check the GitHub Actions logs for detailed error messages
2. Verify all secrets are set correctly
3. Test AWS credentials and permissions manually
4. Review AWS CloudTrail logs for permission issues