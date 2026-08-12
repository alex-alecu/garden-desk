import type { LlamaChat } from "node-llama-cpp";

/**
 * Leases one {@link LlamaChat} per context sequence so up to N chat turns can generate in
 * parallel on the single loaded model. Each turn receives the full conversation from Core, so
 * the leased instances hold no cross-turn state; a lease is returned to the pool when its turn
 * completes. The supervisor slot limiter never admits more concurrent chat turns than there are
 * sequences, so an idle instance is always available when a turn reaches this pool.
 */
export class ChatSequencePool {
  private readonly available: LlamaChat[];

  constructor(chats: readonly LlamaChat[]) {
    if (chats.length === 0) throw new Error("chat_pool_requires_sequence");
    this.available = [...chats];
  }

  get size(): number {
    return this.available.length;
  }

  async use<T>(operation: (chat: LlamaChat) => Promise<T>): Promise<T> {
    const chat = this.available.pop();
    if (chat === undefined) throw new Error("chat_pool_exhausted");
    try {
      return await operation(chat);
    } finally {
      this.available.push(chat);
    }
  }
}
