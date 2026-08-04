# ============================================================================
# deploy-detail.ps1 - Deploy the "view detail" Edge Function + push detail page
# Prerequisites:
#   1. Downloaded supabase Windows binary and added to PATH (supabase --version works)
#   2. Ran "supabase login" (paste Access Token in browser)
# Usage (in PowerShell at the project root):
#   powershell -ExecutionPolicy Bypass -File deploy-detail.ps1
# Note: secrets are read from local config.json automatically (no hardcoding).
# ============================================================================
$root = "E:\workbuddy\2026-07-30-18-56-47\jxc-supabase"
$cfg  = Get-Content "$root\scripts\wecom-reports\config.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$SEC  = $cfg.detailSecret

Write-Host "[1/4] Linking Supabase project rfyuxjaewsgjsespogyw ..."
supabase link --project-ref rfyuxjaewsgjsespogyw

Write-Host "[2/4] Setting Edge Function secret DETAIL_SECRET (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected)..."
supabase secrets set "DETAIL_SECRET=$SEC"

Write-Host "[3/4] Deploying report-detail function (--no-verify-jwt: token-based access, no login)..."
supabase functions deploy report-detail --no-verify-jwt

Write-Host "[4/4] Committing and pushing detail.html + function source (push needs your local git creds)..."
cd $root
git add -A
git commit -m "feat: commission detail page and Edge Function"
git push

Write-Host "Done. Open the 'view detail' link on the push card to verify rendering."
