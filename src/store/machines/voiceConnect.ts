import { createMachine, assign } from 'xstate';

export const voiceChannelMachine = createMachine({
  id: 'voiceChannel',
  initial: 'disconnected',
  context: {
    server: null,
    voiceChannelId: null,
    retryCount: 0,
    maxRetries: 3,
  },
  states: {
    disconnected: {
      on: {
        CONNECT: {
          target: 'connecting',
          actions: 'resetRetryCount',
        },
      },
    },
    connecting: {
      invoke: {
        src: 'connectToChannel',
        onDone: {
          target: 'connected',
          actions: 'setChannelContext',
        },
        onError: {
          target: 'waiting',
          actions: 'incrementRetryCount',
        },
      },
    },
    waiting: {
      after: {
        5000: [
          {
            target: 'connecting',
            cond: 'canRetry',
          },
          {
            target: 'disconnected',
            actions: 'resetRetryCount',
          },
        ],
      },
    },
    connected: {
      on: {
        DISCONNECT: {
          target: 'disconnected',
          actions: 'clearChannelContext',
        },
        RECONNECT: {
          target: 'connecting',
          actions: 'clearChannelContext',
        },
      },
    },
  },
},
{
  actions: {
    setChannelContext: assign({
      server: (context, event) =>
        event.type === 'done.invoke.connectToChannel' ? event.data.server : context.server,
      voiceChannelId: (context, event) =>
        event.type === 'done.invoke.connectToChannel' ? event.data.voiceChannelId : context.voiceChannelId,
    }),
    clearChannelContext: assign<VoiceChannelContext>({
      server: () => null,
      voiceChannelId: () => null,
    }),
    incrementRetryCount: assign<VoiceChannelContext>({
      retryCount: (context) => context.retryCount + 1,
    }),
    resetRetryCount: assign<VoiceChannelContext>({
      retryCount: () => 0,
    }),
  },
  guards: {
    canRetry: (context) => context.retryCount < context.maxRetries,
  },
});
