/**
 * API Client for E2E Tests
 *
 * Provides authenticated HTTP client for making API calls.
 */

import { testConfig } from '../setup';

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface ApiError {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * API Client for making authenticated HTTP requests
 */
export class ApiClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
  }

  /**
   * Create an API client with the configured base URL
   */
  static create(authToken: string): ApiClient {
    // Read from process.env first (set by setup.ts beforeAll), fallback to testConfig
    const baseUrl = process.env.E2E_API_BASE_URL || testConfig.apiBaseUrl;
    if (!baseUrl) {
      throw new Error(
        'API base URL is not configured. Please set E2E_API_BASE_URL environment variable.'
      );
    }
    return new ApiClient(baseUrl, authToken);
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body);
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Internal request method
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;

    // Extract origin from baseUrl for APIs that need it (e.g., Stripe checkout return URL)
    const baseUrlObj = new URL(this.baseUrl);
    const origin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

    const headers: Record<string, string> = {
      Authorization: this.authToken,
      'Content-Type': 'application/json',
      Origin: origin,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let data: T;
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }

    return {
      status: response.status,
      data,
      headers: responseHeaders,
    };
  }
}

/**
 * Check if response is an error (4xx or 5xx status)
 */
export function isErrorResponse(response: ApiResponse): boolean {
  return response.status >= 400;
}

/**
 * Assert response is successful (2xx status)
 */
export function assertSuccessResponse(
  response: ApiResponse,
  message?: string
): void {
  if (response.status < 200 || response.status >= 300) {
    const errorMessage =
      message ||
      `Expected successful response but got ${response.status}: ${JSON.stringify(response.data)}`;
    throw new Error(errorMessage);
  }
}
