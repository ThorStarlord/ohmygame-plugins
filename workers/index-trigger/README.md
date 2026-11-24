# Index trigger

A Cloudflare Worker that starts the [Index workflow](../../.github/workflows/index.yml)
every 30 minutes. GitHub runs the workflow's own schedule only every several
hours under load, so a newly released plugin could take half a day to appear
in the market. The workflow's schedule stays as a fallback.

The Worker has no route; it only runs on its cron.

## Set up

1. Create a fine-grained personal access token on GitHub:
   - Resource owner: `WhiteTowerAI`
   - Repository access: only `WhiteTowerAI/ohmygame-plugins`
   - Permissions: **Actions: Read and write** (nothing else)

   If the organization requires approval for fine-grained tokens, approve it
   in the organization's settings. Note its expiry: the Worker stops starting
   runs when it expires.
2. Deploy from this folder, in the Cloudflare account that holds the R2
   bucket:

   ```sh
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN
   ```

## Check it

- Cloudflare dashboard › Workers › `ohmygame-index-trigger` › Logs shows each
  run. An error names GitHub's answer; a `401` means the token expired or was
  revoked: make a new one and run `npx wrangler secret put GITHUB_TOKEN` again.
- Actions › Index on GitHub lists the runs it starts, as `workflow_dispatch`.
