# Chautauqua Calendar Infrastructure

This directory contains Terraform configuration for deploying the Chautauqua Calendar application to AWS.

## Setup

1. **Copy the example terraform.tfvars file:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. **Edit terraform.tfvars with your actual values:**
   ```hcl
   # OAuth Configuration
   nextauth_secret       = "your-secure-secret-key"
   google_client_id      = "your-google-oauth-client-id"
   google_client_secret  = "your-google-oauth-secret"
   admin_email_whitelist = "your-admin-email@example.com"
   recaptcha_secret_key  = "your-recaptcha-secret"
   recaptcha_site_key    = "your-recaptcha-site-key"
   ```

3. **Initialize and apply Terraform:**
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

## Security Notes

- **Never commit `terraform.tfvars`** - it contains secrets and is already in `.gitignore`
- **Use strong values** for `nextauth_secret` (generate with `openssl rand -base64 32`)
- **Configure Google OAuth** with proper redirect URIs in Google Cloud Console
- **Set up reCAPTCHA** in Google reCAPTCHA admin console

## OAuth Setup

For Google OAuth configuration, you need to:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Google+ API
3. Create OAuth 2.0 credentials
4. Configure authorized redirect URIs:
   - Production: `https://chqcal.org/api/auth/callback/google`
   - Development: `http://localhost:3001/auth/google/callback`

## reCAPTCHA Setup

1. Go to [Google reCAPTCHA](https://www.google.com/recaptcha/admin)
2. Create a new site
3. Choose reCAPTCHA v3
4. Add your domains (chqcal.org for production, localhost for development)
5. Get the site key (public) and secret key (private)