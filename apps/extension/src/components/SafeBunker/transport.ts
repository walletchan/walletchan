export async function bunkerCommand<T extends object = Record<string, unknown>>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error || "Bunker status unavailable");
  return response as T;
}
