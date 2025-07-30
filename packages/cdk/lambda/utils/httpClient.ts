class HttpClient {
  private readonly baseAddress: string;
  public Headers: Record<string, string>;

  constructor(baseAddress: string, headers?: Record<string, string>) {
    this.baseAddress = baseAddress;
    this.Headers = headers ?? {};

    this.Headers['Content-Type'] = 'application/json';
  }

  private async parseResponseAsync<TResponse>(
    response: Response
  ): Promise<TResponse> {
    const body = await response.text();
    const parsedResponse: TResponse = JSON.parse(body);

    return parsedResponse;
  }

  async PostAsync<TRequest, TResponse>(
    endPoint: string,
    request: TRequest
  ): Promise<TResponse> {
    const body = JSON.stringify(request);

    const response = await fetch(`${this.baseAddress}/${endPoint}`, {
      method: 'POST',
      headers: this.Headers,
      body: body,
    });

    return this.parseResponseAsync<TResponse>(response);
  }

  async GetAsync<TResponse>(endPoint: string): Promise<TResponse> {
    const response = await fetch(`${this.baseAddress}/${endPoint}`, {
      method: 'GET',
      headers: this.Headers,
    });

    return this.parseResponseAsync<TResponse>(response);
  }

  async PutAsync<TRequest, TResponse>(
    endPoint: string,
    request: TRequest
  ): Promise<TResponse> {
    const body = JSON.stringify(request);

    const response = await fetch(`${this.baseAddress}/${endPoint}`, {
      method: 'PUT',
      headers: this.Headers,
      body: body,
    });

    return this.parseResponseAsync<TResponse>(response);
  }

  async DeleteAsync<TRequest, TResponse>(
    endPoint: string,
    request: TRequest
  ): Promise<TResponse> {
    const body = JSON.stringify(request);

    const response = await fetch(`${this.baseAddress}/${endPoint}`, {
      method: 'DELETE',
      headers: this.Headers,
      body: body,
    });

    return this.parseResponseAsync<TResponse>(response);
  }
}

export default HttpClient;
