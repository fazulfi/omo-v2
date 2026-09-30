import type { PluginInput } from "@opencode-ai/plugin"

export async function plugin(input: PluginInput): Promise<void> {
  void input
}

export function bad(x: any): any {
  return x as any
}
