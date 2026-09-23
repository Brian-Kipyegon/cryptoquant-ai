

export type RequestError = Error & {
  statusCode?: number;
  payload?: any;
};

export function requestError(statusCode: number, message: string, payload?: any) {
  const error = new Error(message) as RequestError;
  error.statusCode = statusCode;
  error.payload = payload;
  return error;
}
