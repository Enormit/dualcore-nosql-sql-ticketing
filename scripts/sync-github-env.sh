#!/usr/bin/env bash
set -euo pipefail

REPO="Enormit/dualcore-nosql-sql-ticketing"
ENV_NAME="production"

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ Chưa cài GitHub CLI (gh). Cài nhanh bằng: sudo apt update && sudo apt install -y gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "❌ Chưa đăng nhập GitHub CLI. Hãy chạy: gh auth login"
  exit 1
fi

echo "1️⃣  Đảm bảo Environment '$ENV_NAME' tồn tại trên GitHub..."
gh api -X PUT "repos/${REPO}/environments/${ENV_NAME}" >/dev/null

echo "2️⃣  Đọc secrets từ .env và outputs từ Terraform..."
eval "$(node -e '
const fs = require("fs");
const { execSync } = require("child_process");

const envMap = {};
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) envMap[m[1]] = m[2].trim();
}

const tfOut = JSON.parse(execSync("terraform -chdir=infra output -json", { encoding: "utf8" }));
const val = (k) => (tfOut[k] && tfOut[k].value) || "";

const vars = {
  NEON_DIRECT: envMap.NEON_DATABASE_DIRECT_URL || "",
  NEON_POOLED: envMap.NEON_DATABASE_POOLED_URL || "",
  TG_TOKEN: envMap.TELEGRAM_BOT_TOKEN || "",
  TG_CHAT: envMap.TELEGRAM_CHAT_ID || "",
  NEON_API_KEY: envMap.NEON_API_KEY || "",
  NEON_PROJECT_ID: envMap.NEON_PROJECT_ID || "",
  OIDC_DEPLOY_ROLE: val("github_oidc_deploy_role_arn"),
  OIDC_PR_ROLE: val("github_oidc_pr_plan_role_arn"),
  S3_BUCKET: val("frontend_s3_bucket"),
  API_ENDPOINT: val("api_endpoint"),
  CF_ID: "E2QO6PS7GCEO7S",
};

for (const [k, v] of Object.entries(vars)) {
  console.log(`${k}=${JSON.stringify(v)}`);
}
')"

echo "3️⃣  Đang đẩy Secrets lên Environment '$ENV_NAME'..."
printf "%s" "$OIDC_DEPLOY_ROLE" | gh secret set AWS_OIDC_DEPLOY_ROLE_ARN --repo "$REPO" --env "$ENV_NAME"
printf "%s" "$OIDC_PR_ROLE"     | gh secret set AWS_OIDC_PR_ROLE_ARN     --repo "$REPO" --env "$ENV_NAME"
printf "%s" "$NEON_DIRECT"      | gh secret set NEON_DATABASE_DIRECT_URL --repo "$REPO" --env "$ENV_NAME"
printf "%s" "$NEON_POOLED"      | gh secret set NEON_DATABASE_POOLED_URL --repo "$REPO" --env "$ENV_NAME"
printf "%s" "$TG_TOKEN"         | gh secret set TELEGRAM_BOT_TOKEN       --repo "$REPO" --env "$ENV_NAME"
printf "%s" "$TG_CHAT"          | gh secret set TELEGRAM_CHAT_ID         --repo "$REPO" --env "$ENV_NAME"
if [ -n "$NEON_API_KEY" ]; then
  printf "%s" "$NEON_API_KEY"   | gh secret set NEON_API_KEY             --repo "$REPO" --env "$ENV_NAME"
fi

echo "4️⃣  Đang đẩy Variables lên Environment '$ENV_NAME'..."
gh variable set AWS_REGION                 --body "ap-southeast-1" --repo "$REPO" --env "$ENV_NAME"
gh variable set FRONTEND_S3_BUCKET         --body "$S3_BUCKET"      --repo "$REPO" --env "$ENV_NAME"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --body "$CF_ID"          --repo "$REPO" --env "$ENV_NAME"
gh variable set API_ENDPOINT               --body "$API_ENDPOINT"   --repo "$REPO" --env "$ENV_NAME"
if [ -n "$NEON_PROJECT_ID" ]; then
  gh variable set NEON_PROJECT_ID          --body "$NEON_PROJECT_ID" --repo "$REPO" --env "$ENV_NAME"
fi

echo "✅ Hoàn tất đồng bộ Secrets & Variables lên GitHub Environment '$ENV_NAME'!"
