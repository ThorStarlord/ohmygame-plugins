// A Cloudflare Worker that starts the Index workflow every 30 minutes.
// GitHub runs index.yml's own schedule only every several hours under load,
// so a newly released plugin could take half a day to appear in the market.
// The workflow's schedule stays as a fallback; its concurrency group queues
// a run that starts while another is going.

export const WORKFLOW = "https://api.github.com/repos/WhiteTowerAI/ohmygame-plugins/actions/workflows/index.yml/dispatches";

/** Asks GitHub to run the Index workflow on main. GitHub answers 204. */
export async function dispatch(token, fetcher = fetch) {
  const response = await fetcher(WORKFLOW, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "ohmygame-index-trigger",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // A failed run shows in the Worker's logs and Cloudflare's cron history.
  if (response.status !== 204) throw new Error(`GitHub answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

export default {
  async scheduled(_controller, env) {
    await dispatch(env.GITHUB_TOKEN);
  },
};
