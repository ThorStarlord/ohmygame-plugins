// PixelLab API v2: https://api.pixellab.ai/v2/llms.txt
// Each paid request goes through host.submit, so a retry after a restart
// checks the original job instead of paying again. Results are PixelLab's own
// files, shown as they are: a PNG for Pixen, a GIF for characters.
const API = "https://api.pixellab.ai/v2";
const REFERENCE = "the character in the reference image";

export default {
  image: {
    async start(input, host) {
      if (input.model === "pixen") return pixen(input, host);
      if (input.model === "character") return character(input, host, input.prompt, null);
      if (input.model === "skeleton-animation") {
        if (input.references?.length !== 1) return { error: "Skeleton animation needs one character reference image" };
        return character(input, host, REFERENCE, input.prompt);
      }
      return { error: `Unknown PixelLab model ${input.model}` };
    },
    async check(task, host) {
      const job = await status(task.jobId, host);
      if (job.error || !job.done) return job.error ? job : { task, retryAfter: 3 };
      if (task.phase === "character" && task.action) {
        const response = await host.submit("animation", `${API}/characters/animations`, {
          method: "POST",
          auth: true,
          json: { character_id: task.characterId, description: REFERENCE, action_description: task.action, mode: "skeleton-v3", directions: ["south"] },
        });
        if (!response.ok) return { error: await detail(response) };
        const animation = await response.json();
        const jobId = animation.background_job_ids?.[0];
        if (typeof jobId !== "string" || typeof animation.animation_group_id !== "string") return { error: "PixelLab returned no animation job" };
        return { task: { phase: "animation", characterId: task.characterId, jobId, animationGroupId: animation.animation_group_id }, retryAfter: 3 };
      }
      const query = task.phase === "animation"
        ? `?animation_group_id=${encodeURIComponent(task.animationGroupId)}&direction=south`
        : "";
      return { outputs: [{ url: `${API}/characters/${encodeURIComponent(task.characterId)}/gif${query}`, auth: true }] };
    },
  },
};

async function pixen(input, host) {
  const response = await host.submit("image", `${API}/create-image-pixen`, {
    method: "POST",
    auth: true,
    json: { description: input.prompt, image_size: { width: 512, height: 512 }, no_background: input.transparentBackground === true },
  });
  if (!response.ok) return { error: await detail(response) };
  const image = (await response.json()).image?.base64;
  return typeof image === "string"
    ? { outputs: [{ base64: image.replace(/^data:image\/[a-z]+;base64,/, ""), mediaType: "image/png" }] }
    : { error: "PixelLab returned no image" };
}

/** Starts a character; with an action, the animation follows once it is ready. */
async function character(input, host, description, action) {
  const reference = input.references?.[0];
  const response = await host.submit("character", `${API}/create-character-v3`, {
    method: "POST",
    auth: true,
    json: {
      description,
      n_directions: 8,
      no_background: true,
      ...(reference ? { reference_image: { type: "base64", base64: `data:${reference.mediaType};base64,${reference.base64}` } } : {}),
    },
  });
  if (!response.ok) return { error: await detail(response) };
  const created = await response.json();
  if (typeof created.character_id !== "string" || typeof created.background_job_id !== "string") return { error: "PixelLab returned no character job" };
  return { task: { phase: "character", characterId: created.character_id, jobId: created.background_job_id, ...(action ? { action } : {}) }, retryAfter: 3 };
}

async function status(jobId, host) {
  const response = await host.fetch(`${API}/background-jobs/${encodeURIComponent(jobId)}`, { auth: true });
  if (!response.ok) return { error: await detail(response) };
  const job = await response.json();
  if (job.status === "completed") return { done: true };
  if (job.status === "failed" || job.status === "cancelled") return { error: `PixelLab job failed: ${message(job.last_response?.detail) ?? "no reason given"}` };
  return { done: false };
}

async function detail(response) {
  const body = await response.json().catch(() => ({}));
  return `PixelLab ${response.status}: ${message(body.detail) ?? "request failed"}`;
}

/** PixelLab's errors are a string, or FastAPI's list of field problems. */
function message(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => item?.msg).filter((text) => typeof text === "string").join("; ") || undefined;
  return undefined;
}
