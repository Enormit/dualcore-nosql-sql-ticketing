#!/usr/bin/env bash
set -euo pipefail

REPO="Enormit/dualcore-nosql-sql-ticketing"
ENV_NAME="production"

# Load GH_TOKEN from .env if not already exported
if [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ] && [ -f .env ]; then
  GH_TOKEN=$(node -e '
    const fs = require("fs");
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^(?:GH_TOKEN|GITHUB_TOKEN)=(.*)$/);
      if (m) { console.log(m[1].trim()); break; }
    }
  ')
fi

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "❌ Thiếu GH_TOKEN (hoặc GITHUB_TOKEN). Hãy chạy:"
  echo '   GH_TOKEN="github_pat_..." ./scripts/sync-github-env.sh'
  exit 1
fi

# Ensure libsodium-wrappers is available in /tmp for encrypting GitHub secrets without needing gh CLI
SODIUM_DIR="/tmp/polyflash-gh-sync"
if [ ! -d "$SODIUM_DIR/node_modules/libsodium-wrappers" ]; then
  echo "📦 Cài đặt libsodium-wrappers tạm thời vào $SODIUM_DIR..."
  mkdir -p "$SODIUM_DIR"
  npm install --prefix "$SODIUM_DIR" --no-save libsodium-wrappers >/dev/null 2>&1
fi

export GH_TOKEN="$TOKEN"
export REPO ENV_NAME SODIUM_DIR

node -e '
const fs = require("fs");
const { execSync } = require("child_process");
const sodium = require(`${process.env.SODIUM_DIR}/node_modules/libsodium-wrappers`);

const REPO = process.env.REPO;
const ENV_NAME = process.env.ENV_NAME;
const TOKEN = process.env.GH_TOKEN;

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function ghReq(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

(async () => {
  await sodium.ready;

  // 1. Ensure environment exists
  await ghReq("PUT", `/repos/${REPO}/environments/${ENV_NAME}`);
  console.log(`✅ Environment "${ENV_NAME}" ready.`);

  // 2. Read .env & Terraform outputs
  const envMap = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) envMap[m[1]] = m[2].trim();
  }
  const tfOut = JSON.parse(execSync("terraform -chdir=infra output -json", { encoding: "utf8" }));
  const val = (k) => (tfOut[k] && tfOut[k].value) || "";

  const secrets = {
    AWS_OIDC_DEPLOY_ROLE_ARN: val("github_oidc_deploy_role_arn"),
    AWS_OIDC_PR_ROLE_ARN: val("github_oidc_pr_plan_role_arn"),
    NEON_DATABASE_DIRECT_URL: envMap.NEON_DATABASE_DIRECT_URL || "",
    NEON_DATABASE_POOLED_URL: envMap.NEON_DATABASE_POOLED_URL || "",
    TELEGRAM_BOT_TOKEN: envMap.TELEGRAM_BOT_TOKEN || "",
    TELEGRAM_CHAT_ID: envMap.TELEGRAM_CHAT_ID || "",
    NEON_API_KEY: envMap.NEON_API_KEY || "",
  };

  const variables = {
    AWS_REGION: "ap-southeast-1",
    FRONTEND_S3_BUCKET: val("frontend_s3_bucket"),
    CLOUDFRONT_DISTRIBUTION_ID: "E2QO6PS7GCEO7S",
    API_ENDPOINT: val("api_endpoint"),
    NEON_PROJECT_ID: envMap.NEON_PROJECT_ID || "",
  };

  // 3. Get environment public key for secret encryption
  const pubKey = await ghReq("GET", `/repos/${REPO}/environments/${ENV_NAME}/secrets/public-key`);
  const binkey = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);

  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    const binsec = sodium.from_string(value);
    const encBytes = sodium.crypto_box_seal(binsec, binkey);
    const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
    await ghReq("PUT", `/repos/${REPO}/environments/${ENV_NAME}/secrets/${name}`, {
      encrypted_value,
      key_id: pubKey.key_id,
    });
    console.log(`🔐 Secret synced: ${name}`);
  }

  // 4. Upsert variables
  for (const [name, value] of Object.entries(variables)) {
    if (!value) continue;
    try {
      await ghReq("POST", `/repos/${REPO}/environments/${ENV_NAME}/variables`, { name, value });
    } catch {
      await ghReq("PATCH", `/repos/${REPO}/environments/${ENV_NAME}/variables/${name}`, { name, value });
    }
    console.log(`⚙️  Variable synced: ${name} = ${value}`);
  }

  console.log(`🎉 Hoàn tất đồng bộ toàn bộ Secrets & Variables lên GitHub Environment "${ENV_NAME}"!`);
})();
'
