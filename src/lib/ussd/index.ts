import { useMe } from "@/store/meStore";
import { IUssdCommand } from "./IUssdTransport";
import { LocalUssdTransport } from "./LocalUssdTransport";
import { UssdClient } from "./UssdClient";
import { HybridUssdTransport } from "./HybridUssdTransport";
import { ServerUssdTransport } from "./ServerUssdTransport";
import JsBarcode from "jsbarcode";
import { useApi } from "@/store/apiStore";

async function getBatteryLevel() {
  if ("getBattery" in navigator) {
    return 100;
  }

  const battery = (await (navigator as any).getBattery()) as {
    charging: boolean;
    chargingTime: boolean;
    dischargingTime: boolean;
    level: number;
  };
  return battery.level * 100;
}

const defaultCommands: IUssdCommand[] = [
  {
    pattern: "*#06#",
    handle: () => {
      const me = useMe().me;
      const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(el, me?.userId!.replaceAll("-", "")!, {
        format: "CODE128",
        displayValue: true,
      });

      return {
        success: true,
        output: `${new XMLSerializer().serializeToString(el)}`,
      };
    },
  },
  {
    pattern: "*#1234#",
    handle: () => {
      return {
        success: true,
        output: `Version: ${window.ui_version}\nBuild Time: ${window.ui_buildtime}\nBranch: ${window.ui_branch}`,
      };
    },
  },
  {
    pattern: "*#0228#",
    handle: async () => {
      return {
        success: true,
        output: `Battery Level: ${await getBatteryLevel()}`,
      };
    },
  },
  {
    pattern: "*228#",
    handle: async () => {
      // todo toggle dev mode
      return {
        success: true,
        output: `Dev Mode Activated`,
      };
    },
  },
  {
    pattern: "*000*",
    handle: async () => {
      window.location.reload();
      return {
        success: true,
        output: ``,
      };
    },
  },
  {
    pattern: "*#",
    handle: async () => {
      return {
        success: true,
        output: `Го`,
      };
    },
  },
  {
    pattern: "*999#",
    handle: async () => {
      const result = await useApi().callInteraction.BeginDialCheck("4cb2be31-34c9-f3c9-7916-7137173fffff");

      if (result.isFailedDialCheck()) {
        return {
          success: false,
          output: `${result.reason} ${result.priceMin}`
        }
      } else if (result.isSuccessDialCheck()) {
        return {
        success: true,
        output: `${result.priceMin}/min ${result.corelId} ${result.corlId}`,
      };
      }
      return {
        success: true,
        output: `Го`,
      };
    },
  },
  {
    pattern: "*#228*#",
    handle: async () => {
      return {
        success: true,
        output: `Че умный дохуя?\nПедофила блять спросить забыли\nПиздак закрой`,
      };
    },
  },
  {
    pattern: "*#58792*#",
    handle: async () => {
      return {
        success: true,
        output: `Pojebany kurwa  ja pierdole!!!`,
      };
    },
  },
];

const local = new LocalUssdTransport(defaultCommands);
const network = new ServerUssdTransport();

const transport = new HybridUssdTransport(local, network);

export const ussdClient = new UssdClient(transport);
