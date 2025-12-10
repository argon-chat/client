import { IUssdCommand, IUssdTransport, UssdRequest, UssdResponse } from "./IUssdTransport";

export class LocalUssdTransport implements IUssdTransport {
  private commands: IUssdCommand[] = [];

  constructor(initialCommands?: IUssdCommand[]) {
    if (initialCommands) {
      this.commands.push(...initialCommands);
    }
  }

  addCommand(cmd: IUssdCommand): void {
    this.commands.push(cmd);
  }

  loadCommands(cmds: IUssdCommand[]): void {
    this.commands = [...cmds];
  }

  async execute(request: UssdRequest): Promise<UssdResponse> {
    await this.delay(500);

    const cmd = this.commands.find((x) => x.pattern === request.command);

    if (!cmd) {
      return {
        success: false,
        output: "__UNSUPPORTED__",
      };
    }

    return cmd.handle(request);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
