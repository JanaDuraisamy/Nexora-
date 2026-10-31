import { NexoraClient } from "@nexora/sdk-ts";

const baseUrl = import.meta.env.VITE_NEXORA_API_URL ?? "http://127.0.0.1:4000";
const apiToken = import.meta.env.VITE_NEXORA_API_TOKEN;

export const apiBaseUrl = baseUrl;

export const client = new NexoraClient({
  baseUrl,
  ...(apiToken === undefined || apiToken.length === 0 ? {} : { apiToken }),
});
