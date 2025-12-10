import { IUssdTransport, UssdResponse } from "./IUssdTransport";

export class UssdClient {
  constructor(private readonly transport: IUssdTransport) {}

  async run(command: string, timeoutMs = 5000): Promise<UssdResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await this.transport.execute({
        command,
        timeoutMs,
      });

      return result;
    } catch (err: any) {
      if (err.name === "AbortError") {
        return { success: false, output: "USSD timeout" };
      }

      return { success: false, output: "USSD transport error: " + err.message };
    } finally {
      clearTimeout(timer);
    }
  }
}
