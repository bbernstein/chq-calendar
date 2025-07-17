# GitHub Secrets Setup for AWS Deployment

This document outlines the GitHub secrets required for automated deployment to AWS.

## Required GitHub Secrets

### AWS Configuration
Set these secrets in your GitHub repository: **Settings → Secrets and variables → Actions → Repository secrets**

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key ID for deployment user | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Access Key for deployment user | `abc123...` |
| `AWS_REGION` | AWS region where resources are deployed | `us-east-1` |

### Application Configuration
| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `LAMBDA_FUNCTION_NAME` | Name of the Lambda function for the backend | `chautauqua-calendar-generator` |
| `S3_BUCKET_NAME` | S3 bucket name for frontend hosting | `chqcal.org` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID | `E1234567890ABC` |
| `EVENTS_TABLE_NAME` | DynamoDB table name for events | `chq-calendar-events` |
| `DATA_SOURCES_TABLE_NAME` | DynamoDB table name for data sources | `chq-calendar-data-sources` |

## AWS IAM Policy Setup

### 1. Create IAM User for GitHub Actions

```bash
aws iam create-user --user-name github-actions-chq-calendar
```

### 2. Create IAM Policy

Create a policy named `GitHubActionsChqCalendarPolicy` with the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration",
                "lambda:GetFunction"
            ],
            "Resource": "arn:aws:lambda:*:*:function:chautauqua-calendar-generator"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:PutObjectAcl",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::chqcal.org",
                "arn:aws:s3:::chqcal.org/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetInvalidation"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:DescribeTable"
            ],
            "Resource": [
                "arn:aws:dynamodb:*:*:table/chq-calendar-events",
                "arn:aws:dynamodb:*:*:table/chq-calendar-data-sources"
            ]
        }
    ]
}
```

### 3. Attach Policy to User

```bash
aws iam attach-user-policy \
  --user-name github-actions-chq-calendar \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/GitHubActionsChqCalendarPolicy
```

### 4. Create Access Keys

```bash
aws iam create-access-key --user-name github-actions-chq-calendar
```

## Setup Instructions

### Step 1: Create AWS IAM User and Policy
1. Use the AWS CLI commands above or AWS Console
2. Save the Access Key ID and Secret Access Key

### Step 2: Get AWS Resource Information
Run these commands to get the required values:

```bash
# Get your AWS account ID and region
aws sts get-caller-identity
aws configure get region

# Get Lambda function name (if already deployed)
aws lambda list-functions --query 'Functions[?contains(FunctionName, `chautauqua`) || contains(FunctionName, `calendar`)].FunctionName'

# Get S3 bucket name
aws s3 ls | grep -i chq

# Get CloudFront distribution ID
aws cloudfront list-distributions --query 'DistributionList.Items[].{Id:Id,DomainName:DomainName}' --output table

# Get DynamoDB table names
aws dynamodb list-tables --query 'TableNames[?contains(@, `chq`) || contains(@, `calendar`)]'
```

### Step 3: Add Secrets to GitHub
1. Go to your repository on GitHub
2. Navigate to **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Add each secret from the table above

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