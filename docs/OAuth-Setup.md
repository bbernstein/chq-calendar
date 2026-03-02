# OAuth Setup Guide

This document explains how to set up Google OAuth authentication for the Chautauqua Calendar application.

## Local Development Setup

1. **Create a `.env` file** in the root directory (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. **Fill in your OAuth credentials** in the `.env` file:
   ```
   JWT_SECRET=your-secret-here
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ADMIN_EMAIL_WHITELIST=your-email@example.com
   ```

3. **Run Docker Compose** which will automatically use these environment variables:
   ```bash
   docker-compose up
   ```

## Production Setup

1. **Add values to `terraform.tfvars`** in the infrastructure directory:
   ```hcl
   jwt_secret       = "your-production-secret"
   google_client_id      = "your-google-client-id"
   google_client_secret  = "your-google-client-secret"
   admin_email_whitelist = "your-email@example.com"
   ```

2. **Apply Terraform**:
   ```bash
   cd infrastructure
   terraform apply
   ```

3. **Set up GitHub Secrets**:
   ```bash
   terraform output -raw github_secrets_setup_commands
   ```
   This will show you the exact `gh` commands to run.

## Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Configure authorized redirect URIs:
   - For local: `http://localhost:3000/api/auth/callback/google`
   - For production: `https://chqcal.org/api/auth/callback/google`

## Security Notes

- Never commit OAuth credentials to version control
- Use strong, unique values for `JWT_SECRET`
- Keep `terraform.tfvars` local and never commit it
- Use GitHub Secrets for CI/CD deployments