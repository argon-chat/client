import { IUssdTransport, UssdRequest, UssdResponse } from "./IUssdTransport";
import { LocalUssdTransport } from "./LocalUssdTransport";

export class HybridUssdTransport implements IUssdTransport {
  constructor(
    private readonly local: LocalUssdTransport,
    private readonly remote: IUssdTransport
  ) {}

  async execute(request: UssdRequest): Promise<UssdResponse> {
    const localResult = await this.local.execute(request);

    if (localResult.output === "__UNSUPPORTED__") {
      return this.remote.execute(request);
    }

    return localResult;
  }
}
