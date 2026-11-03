// Ambient module shim so `@oh-my-opencode/prompts-core` sources (which import
// `../prompts/**/*.md`) typecheck when pulled into this package's compilation
// graph — mirrors `packages/prompts-core/src/markdown-modules.d.ts`, whose
// declarations are otherwise only in scope for prompts-core's own tsconfig.
declare module "*.md" {
  const content: string
  export default content
}
