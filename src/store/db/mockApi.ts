interface FetchOptions {
    channelId: string;
    beforeMessageId?: number | null;
    limit: number;
  }
  
  export async function fetchMessagesFromServer({ channelId, beforeMessageId, limit }: FetchOptions): Promise<IArgonMessage[]> {
    // фейковая задержка
  
    const startId = beforeMessageId ?? 1000;
    const messages: IArgonMessage[] = [];
  
    for (let i = 0; i < limit; i++) {
      const id = startId - i - 1;
      if (id <= 0) break;
      messages.push({
        MessageId: id,
        ServerId: 'server-1',
        ChannelId: channelId,
        Text: `Сообщение #${id}`,
        Entities: [],
        CreatorId: 'user-1',
      });
    }
  
    return messages;
  }