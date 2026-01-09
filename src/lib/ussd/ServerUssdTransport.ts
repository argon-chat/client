import { useApi } from "@/store/apiStore";
import { IUssdTransport, UssdRequest, UssdResponse } from "./IUssdTransport";
import { v7 } from "uuid";
import { logger } from "@argon/core";

export class ServerUssdTransport implements IUssdTransport {
  async execute(request: UssdRequest): Promise<UssdResponse> {
    try {
      const result = await useApi().callInteraction.UssdExecute(
        request.command,
        v7()
      );
      return { output: result.message, success: result.success };
    } catch (e: any) {
      logger.warn(`failed execute ussd '${request.command}' query`, e);
      return {
        success: false,
        output: `Network instability, cannot execute ussd`,
      };
    }
  }
}
