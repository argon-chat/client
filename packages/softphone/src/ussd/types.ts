// @argon/softphone - USSD interfaces and base classes
export interface UssdRequest {
  command: string;
  timeoutMs?: number;
}

export interface UssdResponse {
  success: boolean;
  output: string;
}

export interface IUssdTransport {
  execute(request: UssdRequest): Promise<UssdResponse>;
}

export interface IUssdCommand {
  pattern: string;
  handle(request: UssdRequest): Promise<UssdResponse> | UssdResponse;
}
