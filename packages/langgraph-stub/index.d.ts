export type ChannelReducer<T> = (existing: T | undefined, incoming: T) => T;

export interface ChannelConfig<T> {
  reducer: ChannelReducer<T>;
}

export interface GraphConfig {
  channels?: Record<string, ChannelConfig<any>>;
}

export const END: unique symbol;

export class StateGraph<State = any> {
  constructor(config?: GraphConfig);
  addNode(
    name: string,
    func: (
      state: State,
      context?: any
    ) => Partial<State> | Promise<Partial<State>>
  ): this;
  addEdge(from: string, to: string): this;
  addConditionalEdge(
    from: string,
    condition: (state: State) => any | Promise<any>,
    mapping: Record<string | symbol, string | symbol>
  ): this;
  compile(): {
    invoke(initialState?: Partial<State>, context?: any): Promise<State>;
    stream(
      initialState?: Partial<State>,
      context?: any
    ): AsyncIterable<{ node: string; state: State }>;
  };
}
