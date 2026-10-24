/** fetch against the running app as the Operator persona; the proxy answers 401 to requests without one. */
export function appFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("cookie", "persona=operator")
  return fetch(url, { ...init, headers })
}
