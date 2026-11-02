import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"
import { BUILD_NODES } from "./build-nodes.ts"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const bundleOutputDir = join(repoRoot, "dist")

const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}
const adapterManifest = JSON.parse(
	readFileSync(join(repoRoot, "packages/omo-opencode/package.json"), "utf8"),
) as {
	devDependencies?: Record<string, string>
}

const bundleNodes = BUILD_NODES.filter(
	(node) => node.args[0] === "build" && node.args.includes("--outdir"),
)

function externalsOf(node: { args: readonly string[] }): readonly string[] {
	return node.args.flatMap((arg, index) => {
		if (arg !== "--external") return []
		const value = node.args[index + 1]
		return value === undefined ? [] : [value]
	})
}

function packageOf(specifier: string): string {
	const segments = specifier.split("/")
	return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

describe("plugin bundle runtime dependencies", () => {
	test("#given the bundle build nodes #when their externals are listed #then every external resolves from the bundle output directory", () => {
		const unresolved: string[] = []

		for (const node of bundleNodes) {
			for (const specifier of externalsOf(node)) {
				try {
					Bun.resolveSync(specifier, bundleOutputDir)
				} catch {
					unresolved.push(`${node.id}: ${specifier}`)
				}
			}
		}

		expect(unresolved).toEqual([])
	})

	test("#given the root manifest #when the OpenCode SDK dependencies are audited #then they are runtime dependencies, not dev-only", () => {
		const dependencies = rootManifest.dependencies ?? {}

		expect(dependencies["@opencode/client"]).toBeDefined()
		expect(dependencies["@opencode/plugin"]).toBeDefined()
		expect(rootManifest.devDependencies?.["@opencode/client"]).toBeUndefined()
		expect(rootManifest.devDependencies?.["@opencode/plugin"]).toBeUndefined()
	})

	test("#given the root manifest and the adapter manifest #when their SDK versions are compared #then they cannot drift apart", () => {
		const dependencies = rootManifest.dependencies ?? {}
		const adapterDevDependencies = adapterManifest.devDependencies ?? {}

		expect(dependencies["@opencode/client"]).toBe(adapterDevDependencies["@opencode/client"])
		expect(dependencies["@opencode/plugin"]).toBe(adapterDevDependencies["@opencode/plugin"])
	})

	test("#given the root manifest #when a bundle external is checked #then its package is declared at the root scope", () => {
		const dependencies = rootManifest.dependencies ?? {}
		const undeclared: string[] = []

		for (const node of bundleNodes) {
			for (const specifier of externalsOf(node)) {
				const packageName = packageOf(specifier)
				if (packageName.startsWith("@opencode/") && dependencies[packageName] === undefined) {
					undeclared.push(`${node.id}: ${specifier}`)
				}
			}
		}

		expect(undeclared).toEqual([])
	})
})
