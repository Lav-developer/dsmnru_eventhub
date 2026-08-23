export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: string;
  };
}

const API_BASE = '/api/v1';

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  
  // Merge default headers
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error('Malformed JSON response from server');
  }

  if (!res.ok || !json.success) {
    const errMsg = json.error?.message || `Server returned status ${res.status}`;
    const errCode = json.error?.code || 'API_ERROR';
    const error = new Error(errMsg) as any;
    error.code = errCode;
    error.requestId = json.error?.requestId;
    throw error;
  }

  return json.data as T;
}
