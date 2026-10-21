// Existing business-logic fixtures simulate a model loading all capabilities
// before exercising handlers. Dedicated discovery tests cover selective loading.
export function withToolDiscovery(config: any, session: any) {
  const load = config.tools?.find((tool: any) => tool.name === "load_tools");
  if (!load) return session;
  return {
    ...session,
    setTools: async (tools: any[]) => {
      config.tools = tools;
    },
    sendAndWait: async (...args: any[]) => {
      const names = [...load.description.matchAll(/^([a-z_]+): /gm)].map(
        (match: any) => match[1],
      );
      for (let i = 0; i < names.length; i += 8) {
        const result = await load.handler({ names: names.slice(i, i + 8) }, {});
        if (result.success === false) throw new Error(result.error);
      }
      return session.sendAndWait(...args);
    },
  };
}
