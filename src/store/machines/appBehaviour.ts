import { createMachine, interpret } from "xstate";

const clientStateMachine = createMachine(
  {
    id: "client",
    initial: "start",
    states: {
      start: {
        on: {
          CHECK_AUTH: [
            { target: "waiting", cond: "noInternet" },
            { target: "loadingData", cond: "isAuthorized" },
            { target: "auth" },
          ],
        },
      },
      waiting: {
        on: {
          RETRY: "start", // Переход на старт при повторной попытке
        },
      },
      auth: {
        on: {
          SUCCESS: "loadingData", // Успешная авторизация
          FAILURE: "auth", // Повторная авторизация
          BANNED: "banned", // Пользователь забанен или не имеет доступа
        },
      },
      loadingData: {
        on: {
          SUCCESS: "loaded",
          FAILURE: "auth", // Возврат к авторизации при ошибке
        },
      },
      loaded: {
        on: {
          CONNECT_SOCKET: "connectingSocket", // Переход к подключению к сокетам
        },
      },
      connectingSocket: {
        on: {
          SUCCESS: "operational", // Переход в штатный режим при успешном подключении
          FAILURE: "waiting", // Возврат в ожидание при ошибке
        },
      },
      operational: {
        type: "final", // Конечное состояние (штатный режим)
      },
      banned: {
        type: "final", // Конечное состояние для заблокированных пользователей
      },
    },
  },
  {
    // Условия переходов
    guards: {
      isAuthorized: (context, event) => event.isAuthorized === true,
      noInternet: (context, event) => event.hasInternet === false,
    },
  },
);
