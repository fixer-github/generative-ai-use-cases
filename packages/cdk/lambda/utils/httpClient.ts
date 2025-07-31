async function parseResponseAsync<TResponse>(
  response: Response
): Promise<TResponse> {
  const text = await response.text();
  return JSON.parse(text);
}

export async function httpPostAsync<TRequest, TResponse>(
  url: string,
  request: TRequest,
  headers: Record<string, string> = {}
): Promise<TResponse> {
  const body = JSON.stringify(request);

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: body,
  });

  return await parseResponseAsync(response);
}

export async function httpGetAsync<TResponse>(
  url: string,
  headers: Record<string, string>
): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'GET',
    headers: headers,
  });

  return await parseResponseAsync(response);
}

export async function httpPutAsync<TRequest, TResponse>(
  url: string,
  request: TRequest,
  headers: Record<string, string> = {}
): Promise<TResponse> {
  const body = JSON.stringify(request);

  const response = await fetch(url, {
    method: 'PUT',
    headers: headers,
    body: body,
  });

  return await parseResponseAsync(response);
}

export async function httpDeleteAsync<TRequest, TResponse>(
  url: string,
  request: TRequest,
  headers: Record<string, string> = {}
): Promise<TResponse> {
  const body = JSON.stringify(request);

  const response = await fetch(url, {
    method: 'DELETE',
    headers: headers,
    body: body,
  });

  return await parseResponseAsync(response);
}
