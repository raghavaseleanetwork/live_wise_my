import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server.
 * Uses EXPO_PUBLIC_DOMAIN if set; otherwise fallback for local dev.
 * On Android emulator use EXPO_PUBLIC_DOMAIN=10.0.2.2:5001 to reach host.
 * On physical device use your computer's IP e.g. 192.168.1.5:5001
 */
export function getApiUrl(): string {
  const host =
    process.env.EXPO_PUBLIC_DOMAIN ||
    process.env.EXPO_PUBLIC_API_URL ||
    "api.lifewiseee.com"; // Default to production domain

  try {
    // 1. Clean the host of any protocol or trailing paths
    const cleanedHost = host.replace(/^https?:\/\//, "").split("/")[0];

    if (!cleanedHost) {
      return "https://api.lifewiseee.com";
    }

    // 2. Identify if it's a local address
    // Matches localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x, 172.x.x.x
    const isLocal =
      cleanedHost.includes("localhost") ||
      cleanedHost.includes("127.0.0.1") ||
      cleanedHost.includes("10.0.2.2") ||
      /^(\d{1,3}\.){3}\d{1,3}/.test(cleanedHost);

    // 3. Construct the final URL securely
    const url = new URL(isLocal ? `http://${cleanedHost}` : `https://${cleanedHost}`);
    return url.href.replace(/\/$/, "");
  } catch (error) {
    console.error("[getApiUrl] Failed to parse API URL, using fallback:", error);
    return "https://api.lifewiseee.com";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
  token?: string | null,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // GETs must not be served from cache: screens refetch on focus to pick up
  // changes made elsewhere, and a cached response silently defeats that.
  if (method.toUpperCase() === "GET") {
    headers["Cache-Control"] = "no-cache";
    headers["Pragma"] = "no-cache";
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const baseUrl = getApiUrl();
      const url = new URL(queryKey.join("/") as string, baseUrl);

      const res = await fetch(url.toString(), {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
