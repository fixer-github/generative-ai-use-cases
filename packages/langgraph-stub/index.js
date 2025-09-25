const END = Symbol('END');

class StateGraph {
  constructor(config = {}) {
    this.channels = config.channels || {};
    this.nodes = new Map();
    this.edges = new Map();
    this.conditionalEdges = new Map();
    this.startNode = null;
  }

  addNode(name, func) {
    this.nodes.set(name, func);
    if (!this.startNode) {
      this.startNode = name;
    }
    return this;
  }

  addEdge(from, to) {
    if (!this.edges.has(from)) {
      this.edges.set(from, []);
    }
    this.edges.get(from).push(to);
    return this;
  }

  addConditionalEdge(from, condition, mapping) {
    this.conditionalEdges.set(from, { condition, mapping });
    return this;
  }

  compile() {
    const graph = this;

    const applyReducers = (currentState, updates) => {
      const nextState = { ...currentState };
      for (const [key, value] of Object.entries(updates || {})) {
        if (graph.channels[key]?.reducer) {
          const reducer = graph.channels[key].reducer;
          const existing = nextState[key];
          nextState[key] = reducer(existing ?? [], value ?? []);
        } else {
          nextState[key] = value;
        }
      }
      return nextState;
    };

    const runNode = async (nodeName, state, context) => {
      const node = graph.nodes.get(nodeName);
      if (!node) {
        throw new Error(`Node ${nodeName} is not defined in the StateGraph`);
      }
      const result = await node(state, context);
      return applyReducers(state, result || {});
    };

    const getNextNode = async (nodeName, state) => {
      if (graph.conditionalEdges.has(nodeName)) {
        const { condition, mapping } = graph.conditionalEdges.get(nodeName);
        const branch = await condition(state);
        if (branch === END) {
          return END;
        }
        return mapping[branch];
      }
      const targets = graph.edges.get(nodeName) || [];
      return targets[0] ?? END;
    };

    return {
      async invoke(initialState = {}, context = {}) {
        let currentNode = graph.startNode;
        let state = { ...initialState };
        while (currentNode && currentNode !== END) {
          state = await runNode(currentNode, state, context);
          const next = await getNextNode(currentNode, state);
          currentNode = next === END ? null : next;
        }
        return state;
      },
      async *stream(initialState = {}, context = {}) {
        let currentNode = graph.startNode;
        let state = { ...initialState };
        while (currentNode && currentNode !== END) {
          state = await runNode(currentNode, state, context);
          yield { node: currentNode, state };
          const next = await getNextNode(currentNode, state);
          currentNode = next === END ? null : next;
        }
        return state;
      },
    };
  }
}

module.exports = {
  StateGraph,
  END,
};
